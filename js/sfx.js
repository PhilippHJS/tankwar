// Geräusche im Spiel, alle im Browser erzeugt, ohne Dateien. Bewusst sparsam:
// Schüsse, Treffer, Explosionen, Blitze, Wiedereinstieg, Countdown und ein
// kurzes Signal am Rundenende. Dazu für den eigenen Panzer ein Summen beim
// Aufladen der Bombe, ein Knistern beim Blitzen und ein leises Klicken, wenn
// wieder nachgeladen ist.
//
// Was weiter weg passiert, ist leiser, und was links oder rechts passiert,
// kommt etwas mehr von links oder rechts. Gleiche Geräusche kurz
// hintereinander werden zusammengefasst, damit es nicht zu voll wird.

import { audioContext } from './sound.js';
import { EVENT } from './sim.js';
import { FX } from './client.js';
import { VEHICLES } from './config.js';

const VOLUME = 0.7;

export function createSfx({ muted = false } = {}) {
  const ctx = audioContext();
  let off = muted;
  const silent = {
    effect() {}, frame() {}, count() {}, result() {},
    toggle() { off = !off; return off; }, muted: () => off,
  };
  if (!ctx) return silent;

  const master = ctx.createGain();
  master.gain.value = off ? 0 : VOLUME;
  const squash = ctx.createDynamicsCompressor();
  squash.threshold.value = -16;
  squash.knee.value = 12;
  squash.ratio.value = 4;
  master.connect(squash);
  squash.connect(ctx.destination);

  // Eine Sekunde Rauschen als Rohstoff für Explosionen und Schüsse
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

  const ready = () => !off && ctx.state === 'running';
  const lastAt = new Map();
  function once(key, gap) {
    const now = ctx.currentTime;
    if (now - (lastAt.get(key) || -1) < gap) return false;
    lastAt.set(key, now);
    return true;
  }

  function output(pan) {
    if (!pan || !ctx.createStereoPanner) return master;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(master);
    return p;
  }
  function envelope(t, vol, attack, dur) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }
  function tone({ type = 'sine', f, to = f, dur, vol, attack = 0.005, pan = 0, delay = 0 }) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to !== f) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = envelope(t, vol, attack, dur);
    o.connect(g);
    g.connect(output(pan));
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function hiss({ dur, vol, filter = 'lowpass', f = 1000, to = f, q = 0.8, attack = 0.004, pan = 0, delay = 0 }) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const fl = ctx.createBiquadFilter();
    fl.type = filter;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (to !== f) fl.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + dur);
    const g = envelope(t, vol, attack, dur);
    src.connect(fl);
    fl.connect(g);
    g.connect(output(pan));
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.05);
  }

  // Lautstärke und Richtung nach Entfernung vom eigenen Panzer
  function place(view, x, y) {
    const arena = view.arena;
    const me = view.slot >= 0 ? view.players[view.slot] : null;
    const ref = me && me.in && me.lives > 0 ? me : { x: arena.W / 2, y: arena.H / 2 };
    const d = Math.hypot(x - ref.x, y - ref.y);
    const near = Math.max(0.35, 1 - d / 24);
    const pan = Math.max(-1, Math.min(1, (x - arena.W / 2) / (arena.W / 2))) * 0.5;
    return { near, pan };
  }

  // ---------- die einzelnen Geräusche ----------

  const sounds = {
    rocket(k, pan) {
      hiss({ dur: 0.28, vol: 0.32 * k, f: 1400, to: 260, pan });
      tone({ f: 170, to: 55, dur: 0.2, vol: 0.38 * k, pan });
    },
    gun(k, pan) {
      hiss({ dur: 0.07, vol: 0.22 * k, filter: 'highpass', f: 1800, pan });
      tone({ type: 'square', f: 950, to: 260, dur: 0.06, vol: 0.06 * k, pan });
    },
    boom(k, pan, big) {
      hiss({ dur: big ? 1.1 : 0.8, vol: (big ? 0.7 : 0.55) * k, f: 1100, to: 90, attack: 0.006, pan });
      tone({ f: big ? 95 : 110, to: 38, dur: big ? 0.6 : 0.45, vol: 0.6 * k, pan });
      if (big) hiss({ dur: 0.35, vol: 0.18 * k, filter: 'bandpass', f: 520, q: 3, pan, delay: 0.05 });
    },
    clank(k, pan) {
      tone({ type: 'square', f: 240, to: 120, dur: 0.09, vol: 0.12 * k, pan });
      hiss({ dur: 0.06, vol: 0.16 * k, filter: 'bandpass', f: 1600, q: 2, pan });
    },
    ting(k, pan) {
      tone({ f: 1500, dur: 0.18, vol: 0.08 * k, pan });
      tone({ f: 2250, dur: 0.14, vol: 0.05 * k, pan });
    },
    crackle(k, pan) {
      hiss({ dur: 0.06, vol: 0.12 * k, filter: 'bandpass', f: 3200, q: 1.5, pan });
    },
    puff(k, pan) {
      hiss({ dur: 0.16, vol: 0.07 * k, f: 700, to: 200, pan });
    },
    chime(k, pan) {
      tone({ type: 'triangle', f: 520, to: 1040, dur: 0.3, vol: 0.08 * k, attack: 0.03, pan });
    },
    click() {
      tone({ type: 'square', f: 1300, dur: 0.025, vol: 0.035 });
      tone({ type: 'square', f: 1700, dur: 0.025, vol: 0.03, delay: 0.05 });
    },
  };

  function effect(e, view) {
    if (!ready() || !view.arena) return;
    const by = view.players[e.by];
    const at = e.kind === FX.FIRE && by ? by : e;
    const { near, pan } = place(view, at.x, at.y);
    const mine = e.by === view.slot;
    const k = mine ? 1 : near;
    switch (e.kind) {
      case FX.FIRE:
        if (once(`fire${e.by}`, 0.08)) sounds.rocket(k, pan);
        break;
      case EVENT.SHOT:
        if (once(`shot${e.by}`, 0.05)) sounds.gun(k, pan);
        break;
      case EVENT.BLAST:
        if (once('blast', 0.05)) sounds.boom(k, pan, false);
        break;
      case EVENT.DESTROY:
        sounds.boom(e.of === view.slot ? 1 : near, pan, true);
        break;
      case EVENT.HIT:
        if (once(`hit${e.of}`, 0.06)) sounds.clank(e.of === view.slot ? 1.2 : near, pan);
        break;
      case EVENT.BLOCK:
        if (once('block', 0.08)) sounds.ting(near, pan);
        break;
      case EVENT.ZAP:
        if (once('zap', 0.07)) sounds.crackle(e.of === view.slot || mine ? 1 : near, pan);
        break;
      case EVENT.POP:
        if (once('pop', 0.12)) sounds.puff(near, pan);
        break;
      case EVENT.SPAWN:
        sounds.chime(e.of === view.slot ? 1 : near * 0.7, pan);
        break;
      default:
    }
  }

  // ---------- Dauergeräusche des eigenen Panzers ----------

  // Summen beim Aufladen der Bombe: wird höher, je weiter der Kreis draußen ist
  let hum = null;
  // Knistern beim Blitzen
  let buzz = null;
  let lastReload = 1;
  let lastAmmo = -1;

  function startHum() {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.05);
    o.connect(g);
    g.connect(master);
    o.start();
    return { o, g };
  }
  function startBuzz() {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 92;
    const fl = ctx.createBiquadFilter();
    fl.type = 'bandpass';
    fl.frequency.value = 1100;
    fl.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.045, ctx.currentTime + 0.06);
    // leichtes Flattern
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 13;
    const depth = ctx.createGain();
    depth.gain.value = 0.02;
    lfo.connect(depth);
    depth.connect(g.gain);
    o.connect(fl);
    fl.connect(g);
    g.connect(master);
    o.start();
    lfo.start();
    return { o, g, lfo };
  }
  function stop(node) {
    if (!node) return null;
    const t = ctx.currentTime;
    node.g.gain.cancelScheduledValues(t);
    node.g.gain.setValueAtTime(node.g.gain.value, t);
    node.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    node.o.stop(t + 0.1);
    if (node.lfo) node.lfo.stop(t + 0.1);
    return null;
  }

  function frame(view, playing) {
    const me = view && view.slot >= 0 ? view.players[view.slot] : null;
    const live = playing && ready() && me && me.in && me.lives > 0 && me.dead === 0;
    const w = me ? (VEHICLES[me.vehicle] || VEHICLES[0]).weapon : null;
    // Bombe
    if (live && w.kind === 'mortar' && me.ch > 0) {
      if (!hum) hum = startHum();
      hum.o.frequency.setTargetAtTime(180 + 520 * Math.min(1, me.ch / w.range), ctx.currentTime, 0.03);
    } else hum = stop(hum);
    // Blitze
    if (live && w.kind === 'zap' && me.on) {
      if (!buzz) buzz = startBuzz();
    } else buzz = stop(buzz);
    // Nachgeladen
    if (live && (w.kind === 'rocket' || w.kind === 'mortar')) {
      if (lastReload < 1 && me.reload >= 1) sounds.click();
      lastReload = me.reload;
    } else lastReload = 1;
    if (live && w.kind === 'gun') {
      if (lastAmmo === 0 && me.ammo > 0) sounds.click();
      lastAmmo = me.ammo;
    } else lastAmmo = -1;
  }

  // Countdown: 3, 2, 1 und ein höherer Ton zum Los
  function count(go) {
    if (!ready()) return;
    if (go) tone({ type: 'square', f: 880, dur: 0.35, vol: 0.09 });
    else tone({ type: 'square', f: 440, dur: 0.14, vol: 0.08 });
  }

  // Rundenende: aufwärts, wenn man gewonnen hat, sonst abwärts
  function result(won, final) {
    if (!ready()) return;
    const notes = won ? [523, 659, 784, 1047] : [523, 440, 349];
    notes.forEach((f, i) => tone({ type: 'triangle', f, dur: final && i === notes.length - 1 ? 0.7 : 0.22, vol: 0.09, delay: i * 0.12 }));
  }

  return {
    effect,
    frame,
    count,
    result,
    toggle() {
      off = !off;
      master.gain.setTargetAtTime(off ? 0 : VOLUME, ctx.currentTime, 0.05);
      if (off) {
        hum = stop(hum);
        buzz = stop(buzz);
      }
      return off;
    },
    muted: () => off,
  };
}
