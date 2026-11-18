// Zeichnet das Spielfeld auf eine Leinwand: Arena, Panzer, Raketen, Effekte,
// Lebensleisten und die Zielhilfe. Kennt die Regeln nur so weit, wie es fürs
// Zeichnen nötig ist.

import { solidAt } from './arenas.js';
import { traceRocket, gunRay, blastPoint } from './physics.js';
import { EVENT, PHASE } from './sim.js';
import { FX } from './client.js';
import { COLORS, VEHICLES, TANK_R, BARREL, LIVES } from './config.js';
import { makeRng } from './rng.js';

const TAU = Math.PI * 2;
const FLOOR = '#d8c7a0';
const FLOOR_DARK = '#c9b68c';
const WALL_TOP = '#6f7f96';
const WALL_TOP_HI = '#8c9cb2';
const WALL_SIDE = '#3d4859';
const WALL_EDGE = '#2a3240';
const FRONT = 0.24; // Höhe der Wandvorderseite in Feldern

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Das Zeichen auf dem Turm, im Feld von -1 bis 1
export function markPath(ctx, mark, s) {
  ctx.beginPath();
  if (mark === 'circle') ctx.arc(0, 0, s, 0, TAU);
  else if (mark === 'square') ctx.rect(-s * 0.85, -s * 0.85, s * 1.7, s * 1.7);
  else if (mark === 'triangle') {
    ctx.moveTo(s * 1.1, 0);
    ctx.lineTo(-s * 0.7, s * 0.95);
    ctx.lineTo(-s * 0.7, -s * 0.95);
    ctx.closePath();
  } else if (mark === 'diamond') {
    ctx.moveTo(s * 1.15, 0);
    ctx.lineTo(0, s * 1.15);
    ctx.lineTo(-s * 1.15, 0);
    ctx.lineTo(0, -s * 1.15);
    ctx.closePath();
  } else if (mark === 'cross') {
    const t = s * 0.38;
    ctx.rect(-s, -t, s * 2, t * 2);
    ctx.rect(-t, -s, t * 2, s * 2);
  } else if (mark === 'ring') {
    ctx.arc(0, 0, s, 0, TAU);
    ctx.arc(0, 0, s * 0.5, 0, TAU, true);
  } else if (mark === 'bar') ctx.rect(-s, -s * 0.4, s * 2, s * 0.8);
  else {
    for (let i = 0; i < 10; i += 1) {
      const r = i % 2 ? s * 0.45 : s * 1.1;
      const th = (i / 10) * TAU - Math.PI / 2;
      if (i) ctx.lineTo(Math.cos(th) * r, Math.sin(th) * r);
      else ctx.moveTo(Math.cos(th) * r, Math.sin(th) * r);
    }
    ctx.closePath();
  }
}

// Ein Panzer in Feldern, Mitte bei 0,0, schon gedreht nach der Wanne.
// `turret`: Turmwinkel relativ zur Wanne. Wird auch für die Symbole im Raum benutzt.
export function drawTankShape(ctx, look, turret, { tread = 0, recoil = 0, wreck = false, flash = 0, kind = 'rocket' } = {}) {
  const body = wreck ? '#4a4744' : look.color;
  const deep = wreck ? '#24211f' : look.deep;
  const light = wreck ? '#5e5a55' : look.light;
  // Ketten
  for (const side of [-1, 1]) {
    ctx.fillStyle = wreck ? '#1d1c1b' : '#2b2e34';
    roundRect(ctx, -0.44, side * 0.3 - 0.1, 0.88, 0.2, 0.07);
    ctx.fill();
    ctx.strokeStyle = wreck ? '#2c2a28' : '#474c55';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    const offset = ((tread % 0.13) + 0.13) % 0.13;
    for (let x = -0.42 + offset; x < 0.43; x += 0.13) {
      ctx.moveTo(x, side * 0.3 - 0.08);
      ctx.lineTo(x, side * 0.3 + 0.08);
    }
    ctx.stroke();
  }
  // Wanne
  ctx.fillStyle = body;
  roundRect(ctx, -0.37, -0.25, 0.74, 0.5, 0.08);
  ctx.fill();
  ctx.lineWidth = 0.04;
  ctx.strokeStyle = deep;
  ctx.stroke();
  // Bug: hellere Platte vorne, damit man sieht, wohin er fährt
  ctx.fillStyle = light;
  ctx.globalAlpha *= 0.55;
  roundRect(ctx, 0.17, -0.19, 0.14, 0.38, 0.04);
  ctx.fill();
  ctx.globalAlpha /= 0.55;
  ctx.fillStyle = deep;
  ctx.globalAlpha *= 0.35;
  ctx.fillRect(-0.33, -0.21, 0.08, 0.42);
  ctx.globalAlpha /= 0.35;

  // Turm, je nach Waffe anders
  ctx.save();
  ctx.rotate(turret);
  const metal = wreck ? '#2f2d2b' : '#3a3f48';
  const dark = wreck ? '#1f1e1c' : '#262a31';
  const shine = 'rgba(255,255,255,0.18)';
  const g = ctx.createRadialGradient(-0.06, -0.07, 0.02, 0, 0, 0.26);
  g.addColorStop(0, light);
  g.addColorStop(1, body);
  ctx.lineWidth = 0.04;
  ctx.strokeStyle = deep;
  if (kind === 'gun') {
    // zwei schlanke Läufe, eckiger Turm
    for (const side of [-0.05, 0.05]) {
      ctx.fillStyle = metal;
      roundRect(ctx, 0.05 - recoil, side - 0.027, BARREL + 0.06, 0.054, 0.02);
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(BARREL + 0.03 - recoil, side - 0.035, 0.08, 0.07);
    }
    ctx.fillStyle = g;
    roundRect(ctx, -0.17, -0.16, 0.34, 0.32, 0.07);
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'mortar') {
    // kurzer, dicker Lauf, breiter Turm
    ctx.fillStyle = metal;
    roundRect(ctx, 0.04 - recoil, -0.1, 0.4, 0.2, 0.04);
    ctx.fill();
    ctx.fillStyle = dark;
    roundRect(ctx, 0.36 - recoil, -0.135, 0.12, 0.27, 0.04);
    ctx.fill();
    ctx.fillStyle = shine;
    ctx.fillRect(0.08 - recoil, -0.08, 0.26, 0.03);
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const th = (i / 8) * TAU + Math.PI / 8;
      ctx.lineTo(Math.cos(th) * 0.25, Math.sin(th) * 0.25);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'zap') {
    // Spule statt Lauf, in der Mitte eine leuchtende Kugel
    ctx.fillStyle = wreck ? '#3b3632' : '#8a5a2b';
    ctx.beginPath();
    ctx.arc(0, 0, 0.23, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = wreck ? '#25211e' : '#d49a5a';
    ctx.lineWidth = 0.035;
    for (const r of [0.2, 0.15]) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = wreck ? '#4a4744' : light;
    ctx.beginPath();
    ctx.arc(0, 0, 0.1, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = deep;
    ctx.stroke();
    // kleiner Fühler zeigt, wohin der Turm schaut
    ctx.fillStyle = metal;
    roundRect(ctx, 0.2, -0.03, 0.16, 0.06, 0.02);
    ctx.fill();
  } else {
    ctx.fillStyle = metal;
    roundRect(ctx, 0.04 - recoil, -0.06, BARREL - 0.04, 0.12, 0.03);
    ctx.fill();
    ctx.fillStyle = dark;
    roundRect(ctx, BARREL - 0.1 - recoil, -0.075, 0.1, 0.15, 0.03);
    ctx.fill();
    ctx.fillStyle = shine;
    ctx.fillRect(0.08 - recoil, -0.05, BARREL - 0.2, 0.025);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 0.21, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  if (!wreck) {
    ctx.fillStyle = deep;
    markPath(ctx, look.mark, kind === 'mortar' ? 0.09 : kind === 'zap' ? 0.05 : 0.075);
    ctx.fill('evenodd');
  }
  ctx.restore();

  if (flash > 0) {
    ctx.globalAlpha *= flash;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, -0.44, -0.4, 0.88, 0.8, 0.12);
    ctx.fill();
  }
}

const kindOf = (p) => (VEHICLES[p.vehicle] || VEHICLES[0]).weapon.kind;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let width = 0;
  let height = 0;
  let insets = { top: 0, right: 0, bottom: 0, left: 0 };
  let S = 40; // Pixel pro Feld
  let ox = 0;
  let oy = 0;
  let floor = null;
  let floorKey = '';
  let lastT = null;
  let viewNow = null; // für Blitze, die dem Zitteraal folgen

  const particles = [];
  const scorches = [];
  const treads = [];
  const looks = new Map(); // Panzer -> Zustand nur fürs Zeichnen
  let shake = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    floorKey = '';
  }

  function layout(arena) {
    const w = Math.max(100, width - insets.left - insets.right);
    const h = Math.max(100, height - insets.top - insets.bottom);
    S = Math.max(8, Math.floor(Math.min(w / arena.W, h / arena.H)));
    ox = Math.round(insets.left + (w - arena.W * S) / 2);
    oy = Math.round(insets.top + (h - arena.H * S) / 2);
  }

  // Boden und Wände einmal vorzeichnen
  function buildFloor(arena) {
    const key = `${arena.index}|${S}|${dpr}`;
    if (key === floorKey && floor) return;
    floorKey = key;
    const px = S * dpr;
    floor = document.createElement('canvas');
    floor.width = Math.ceil(arena.W * px);
    floor.height = Math.ceil(arena.H * px);
    const f = floor.getContext('2d');
    f.scale(px, px);
    const rng = makeRng(arena.index * 977 + 13);
    const solid = (x, y) => solidAt(arena, x, y);

    f.fillStyle = FLOOR;
    f.fillRect(0, 0, arena.W, arena.H);
    for (let y = 0; y < arena.H; y += 1) {
      for (let x = 0; x < arena.W; x += 1) {
        if (solid(x, y)) continue;
        f.fillStyle = (x + y) % 2 ? 'rgba(120,90,40,0.045)' : 'rgba(255,250,235,0.05)';
        f.fillRect(x, y, 1, 1);
        f.fillStyle = `rgba(110,85,45,${0.03 + rng() * 0.04})`;
        f.fillRect(x, y, 1, 1);
      }
    }
    // Fugen
    f.strokeStyle = FLOOR_DARK;
    f.lineWidth = 0.03;
    f.beginPath();
    for (let x = 1; x < arena.W; x += 1) {
      f.moveTo(x, 0);
      f.lineTo(x, arena.H);
    }
    for (let y = 1; y < arena.H; y += 1) {
      f.moveTo(0, y);
      f.lineTo(arena.W, y);
    }
    f.stroke();
    // Sprenkel
    for (let i = 0; i < arena.W * arena.H * 3; i += 1) {
      f.fillStyle = rng() < 0.5 ? 'rgba(90,70,40,0.18)' : 'rgba(255,255,255,0.22)';
      const s = 0.015 + rng() * 0.03;
      f.fillRect(rng() * arena.W, rng() * arena.H, s, s);
    }
    // Startplätze als aufgemalte Kreise
    for (const spawn of arena.spawns) {
      f.strokeStyle = 'rgba(120,90,45,0.35)';
      f.lineWidth = 0.05;
      f.setLineDash([0.12, 0.09]);
      f.beginPath();
      f.arc(spawn.x, spawn.y, 0.62, 0, TAU);
      f.stroke();
      f.setLineDash([]);
      f.fillStyle = 'rgba(120,90,45,0.12)';
      f.beginPath();
      f.arc(spawn.x, spawn.y, 0.5, 0, TAU);
      f.fill();
    }
    // Schatten der Wände
    f.fillStyle = 'rgba(40,30,15,0.28)';
    for (let y = 0; y < arena.H; y += 1) {
      for (let x = 0; x < arena.W; x += 1) {
        if (solid(x, y)) f.fillRect(x + 0.14, y + 0.2, 1, 1);
      }
    }
    // Wände: Vorderseite unten, Deckel darüber
    for (let y = 0; y < arena.H; y += 1) {
      for (let x = 0; x < arena.W; x += 1) {
        if (!solid(x, y)) continue;
        const openBelow = y + 1 < arena.H && !solid(x, y + 1);
        f.fillStyle = WALL_SIDE;
        f.fillRect(x, y, 1, 1);
        const topH = openBelow ? 1 - FRONT : 1;
        f.fillStyle = WALL_TOP;
        f.fillRect(x, y, 1, topH);
        // Kanten zum Boden hin
        f.fillStyle = WALL_TOP_HI;
        if (!solid(x, y - 1) && y > 0) f.fillRect(x, y, 1, 0.07);
        if (!solid(x - 1, y) && x > 0) f.fillRect(x, y, 0.06, topH);
        f.fillStyle = 'rgba(20,25,35,0.35)';
        if (!solid(x + 1, y) && x < arena.W - 1) f.fillRect(x + 0.94, y, 0.06, topH);
        if (openBelow) {
          f.fillStyle = 'rgba(0,0,0,0.25)';
          f.fillRect(x, y + topH, 1, 0.04);
          f.fillStyle = 'rgba(255,255,255,0.06)';
          f.fillRect(x, y + 1 - 0.06, 1, 0.06);
        }
        // Platten mit Nieten
        f.strokeStyle = 'rgba(30,36,48,0.28)';
        f.lineWidth = 0.03;
        f.strokeRect(x + 0.12, y + 0.1, 0.76, topH - 0.2);
        f.fillStyle = 'rgba(25,30,40,0.4)';
        for (const [rx, ry] of [[0.2, 0.18], [0.8, 0.18], [0.2, topH - 0.18], [0.8, topH - 0.18]]) {
          f.beginPath();
          f.arc(x + rx, y + ry, 0.035, 0, TAU);
          f.fill();
        }
      }
    }
    // Außenkante
    f.strokeStyle = WALL_EDGE;
    f.lineWidth = 0.06;
    f.strokeRect(0.03, 0.03, arena.W - 0.06, arena.H - 0.06);
  }

  const sx = (x) => ox + x * S;
  const sy = (y) => oy + y * S;

  function spawn(p) {
    particles.push(p);
    if (particles.length > 1400) particles.splice(0, particles.length - 1400);
  }
  function burst(x, y, count, make) {
    for (let i = 0; i < count; i += 1) spawn(make(i));
  }

  function lookOf(slot) {
    let look = looks.get(slot);
    if (!look) {
      look = { lx: null, ly: null, tread: 0, recoilAt: -1e9, flashAt: -1e9, tp: -1, trailAt: 0, smokeAt: 0 };
      looks.set(slot, look);
    }
    return look;
  }

  // Ein Ereignis des Gastgebers oder ein eigener Schuss
  function effect(e, view, t) {
    const rand = Math.random;
    const color = (slot) => (COLORS[slot] || COLORS[0]).color;
    if (e.kind === FX.FIRE) {
      const p = view.players[e.by];
      if (!p) return;
      lookOf(e.by).recoilAt = t;
      const mx = p.x + Math.cos(p.a) * (BARREL + 0.05);
      const my = p.y + Math.sin(p.a) * (BARREL + 0.05);
      spawn({ kind: 'flash', x: mx, y: my, r: 0.32, life: 0.09, max: 0.09, color: '#fff3c4' });
      burst(mx, my, 5, () => {
        const th = p.a + (rand() - 0.5) * 0.9;
        const v = 1 + rand() * 1.5;
        return { kind: 'smoke', x: mx, y: my, vx: Math.cos(th) * v, vy: Math.sin(th) * v, r: 0.07 + rand() * 0.06, grow: 0.5, life: 0.4, max: 0.4, color: '200,195,185' };
      });
      return;
    }
    if (e.kind === EVENT.HIT || e.kind === EVENT.BLOCK) {
      const shield = e.kind === EVENT.BLOCK;
      spawn({ kind: 'flash', x: e.x, y: e.y, r: shield ? 0.5 : 0.45, life: 0.12, max: 0.12, color: shield ? '#d8f6ff' : '#ffe39a' });
      spawn({ kind: 'ring', x: e.x, y: e.y, r: 0.1, grow: shield ? 3.2 : 2.4, life: 0.3, max: 0.3, color: shield ? '#9ce8ff' : '#ffd166', width: 0.06 });
      burst(e.x, e.y, shield ? 10 : 12, () => {
        const th = rand() * TAU;
        const v = 2 + rand() * 4;
        return { kind: 'spark', x: e.x, y: e.y, vx: Math.cos(th) * v, vy: Math.sin(th) * v, life: 0.25 + rand() * 0.25, max: 0.5, color: shield ? '#bff2ff' : rand() < 0.5 ? '#ffd166' : color(e.by) };
      });
      if (!shield) {
        lookOf(e.of).flashAt = t;
        burst(e.x, e.y, 4, () => ({ kind: 'smoke', x: e.x, y: e.y, vx: (rand() - 0.5) * 1.2, vy: (rand() - 0.5) * 1.2, r: 0.12, grow: 0.8, life: 0.6, max: 0.6, color: '90,85,80' }));
        if (e.of === view.slot) shake = Math.max(shake, 0.12);
      }
      return;
    }
    if (e.kind === EVENT.DESTROY) {
      spawn({ kind: 'flash', x: e.x, y: e.y, r: 1.4, life: 0.18, max: 0.18, color: '#fff0c0' });
      spawn({ kind: 'ring', x: e.x, y: e.y, r: 0.2, grow: 5, life: 0.45, max: 0.45, color: '#ffb347', width: 0.1 });
      burst(e.x, e.y, 18, () => {
        const th = rand() * TAU;
        const v = 0.6 + rand() * 2.6;
        return { kind: 'fire', x: e.x, y: e.y, vx: Math.cos(th) * v, vy: Math.sin(th) * v, r: 0.12 + rand() * 0.16, grow: 0.6, life: 0.35 + rand() * 0.3, max: 0.65 };
      });
      burst(e.x, e.y, 12, () => {
        const th = rand() * TAU;
        const v = 0.4 + rand() * 1.4;
        return { kind: 'smoke', x: e.x, y: e.y, vx: Math.cos(th) * v, vy: Math.sin(th) * v, r: 0.2 + rand() * 0.15, grow: 1.1, life: 0.9 + rand() * 0.8, max: 1.7, color: '55,52,50' };
      });
      burst(e.x, e.y, 9, () => {
        const th = rand() * TAU;
        const v = 2.5 + rand() * 3.5;
        return { kind: 'debris', x: e.x, y: e.y, vx: Math.cos(th) * v, vy: Math.sin(th) * v, rot: rand() * TAU, spin: (rand() - 0.5) * 20, s: 0.06 + rand() * 0.08, life: 0.6 + rand() * 0.4, max: 1, color: rand() < 0.5 ? color(e.of) : '#3a3f48' };
      });
      scorches.push({ x: e.x, y: e.y, r: 0.75, t, rot: rand() * TAU });
      if (scorches.length > 40) scorches.shift();
      shake = Math.max(shake, e.of === view.slot ? 0.4 : 0.18);
      return;
    }
    if (e.kind === EVENT.SHOT) {
      lookOf(e.by).recoilAt = t;
      spawn({ kind: 'tracer', x: e.x, y: e.y, x2: e.x2, y2: e.y2, life: 0.11, max: 0.11, color: (COLORS[e.by] || COLORS[0]).light });
      spawn({ kind: 'flash', x: e.x, y: e.y, r: 0.22, life: 0.07, max: 0.07, color: '#fff3c4' });
      if (e.of < 0) {
        burst(e.x2, e.y2, 4, () => {
          const th = rand() * TAU;
          return { kind: 'spark', x: e.x2, y: e.y2, vx: Math.cos(th) * 2.5, vy: Math.sin(th) * 2.5, life: 0.18, max: 0.18, color: '#e8dcc0' };
        });
      }
      return;
    }
    if (e.kind === EVENT.BLAST) {
      const r = (e.item || 130) / 100;
      lookOf(e.by).recoilAt = t;
      spawn({ kind: 'flash', x: e.x, y: e.y, r: r * 1.5, life: 0.2, max: 0.2, color: '#fff0c0' });
      spawn({ kind: 'ring', x: e.x, y: e.y, r: 0.3, grow: (r - 0.3) / 0.3, life: 0.3, max: 0.3, color: '#ffb347', width: 0.12 });
      burst(e.x, e.y, 16, () => {
        const th = rand() * TAU;
        const v = 0.8 + rand() * 2.4;
        return { kind: 'fire', x: e.x, y: e.y, vx: Math.cos(th) * v, vy: Math.sin(th) * v, r: 0.14 + rand() * 0.18, grow: 0.7, life: 0.3 + rand() * 0.3, max: 0.6 };
      });
      burst(e.x, e.y, 10, () => {
        const th = rand() * TAU;
        const v = 0.3 + rand() * 1.2;
        return { kind: 'smoke', x: e.x, y: e.y, vx: Math.cos(th) * v, vy: Math.sin(th) * v, r: 0.22 + rand() * 0.15, grow: 1, life: 0.8 + rand() * 0.6, max: 1.4, color: '70,64,58' };
      });
      scorches.push({ x: e.x, y: e.y, r: r * 0.9, t, rot: rand() * TAU });
      if (scorches.length > 40) scorches.shift();
      const me = view.players[view.slot];
      if (me && Math.hypot(me.x - e.x, me.y - e.y) < r + 1.5) shake = Math.max(shake, 0.3);
      else shake = Math.max(shake, 0.1);
      return;
    }
    if (e.kind === EVENT.ZAP) {
      spawn({ kind: 'bolt', from: e.by, x: e.x, y: e.y, life: 0.14, max: 0.14, color: (COLORS[e.by] || COLORS[0]).light });
      if (e.item > 0) lookOf(e.of).flashAt = t;
      burst(e.x, e.y, 3, () => {
        const th = rand() * TAU;
        return { kind: 'spark', x: e.x, y: e.y, vx: Math.cos(th) * 3, vy: Math.sin(th) * 3, life: 0.2, max: 0.2, color: e.item > 0 ? '#c8f6ff' : '#ffffff' };
      });
      return;
    }
    if (e.kind === EVENT.POP) {
      spawn({ kind: 'flash', x: e.x, y: e.y, r: 0.25, life: 0.08, max: 0.08, color: '#ffe8b0' });
      burst(e.x, e.y, 5, () => ({ kind: 'smoke', x: e.x, y: e.y, vx: (rand() - 0.5) * 1.4, vy: (rand() - 0.5) * 1.4, r: 0.07, grow: 0.6, life: 0.5, max: 0.5, color: '170,165,155' }));
      return;
    }
    if (e.kind === EVENT.SPAWN) {
      spawn({ kind: 'ring', x: e.x, y: e.y, r: 1.4, grow: -3.6, life: 0.35, max: 0.35, color: color(e.of), width: 0.08 });
      burst(e.x, e.y, 14, () => {
        const th = rand() * TAU;
        return { kind: 'spark', x: e.x + Math.cos(th) * 0.8, y: e.y + Math.sin(th) * 0.8, vx: -Math.cos(th) * 2, vy: -Math.sin(th) * 2, life: 0.35, max: 0.35, color: color(e.of) };
      });
    }
  }

  function stepParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      if (p.vx !== undefined) {
        const drag = p.kind === 'debris' ? 3 : p.kind === 'spark' ? 2 : 2.5;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.exp(-drag * dt);
        p.vy *= Math.exp(-drag * dt);
      }
      if (p.grow) p.r = Math.max(0.01, p.r + p.grow * dt);
      if (p.spin) p.rot += p.spin * dt;
    }
  }

  function drawParticles(below) {
    for (const p of particles) {
      const isBelow = p.kind === 'smoke' || p.kind === 'debris';
      if (isBelow !== below) continue;
      const k = p.life / p.max;
      const x = sx(p.x);
      const y = sy(p.y);
      if (p.kind === 'smoke') {
        ctx.fillStyle = `rgba(${p.color},${0.45 * k})`;
        ctx.beginPath();
        ctx.arc(x, y, p.r * S, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'fire') {
        const g = ctx.createRadialGradient(x, y, 0, x, y, p.r * S);
        g.addColorStop(0, `rgba(255,248,210,${k})`);
        g.addColorStop(0.45, `rgba(255,170,60,${0.9 * k})`);
        g.addColorStop(1, 'rgba(220,60,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, p.r * S, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.lineWidth = Math.max(1, S * 0.04);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - p.vx * S * 0.03, y - p.vy * S * 0.03);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.kind === 'flash') {
        const g = ctx.createRadialGradient(x, y, 0, x, y, p.r * S);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = k;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, p.r * S, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (p.kind === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = k;
        ctx.lineWidth = p.width * S * k + 1;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.01, p.r) * S, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.kind === 'debris') {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.s * S, -p.s * S * 0.6, p.s * 2 * S, p.s * 1.2 * S);
        ctx.restore();
      } else if (p.kind === 'tracer') {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.globalAlpha = k;
        ctx.strokeStyle = 'rgba(255,240,190,0.45)';
        ctx.lineWidth = Math.max(3, S * 0.14);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(sx(p.x2), sy(p.y2));
        ctx.stroke();
        ctx.strokeStyle = '#fffbe8';
        ctx.lineWidth = Math.max(1.5, S * 0.045);
        ctx.stroke();
        ctx.restore();
      } else if (p.kind === 'bolt') {
        const from = viewNow && viewNow.players[p.from];
        if (from) zigzag(sx(from.x), sy(from.y), x, y, p.color, k);
      } else if (p.kind === 'glow') {
        ctx.globalAlpha = k * 0.8;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, p.r * S * k, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  // Ein zuckender Blitz von a nach b
  function zigzag(ax, ay, bx, by, color, k) {
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    const parts = Math.max(4, Math.round(len / (S * 0.35)));
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      for (let i = 1; i < parts; i += 1) {
        const f = i / parts;
        const off = (Math.random() - 0.5) * S * 0.3;
        ctx.lineTo(ax + (bx - ax) * f + nx * off, ay + (by - ay) * f + ny * off);
      }
      ctx.lineTo(bx, by);
    };
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.globalAlpha = Math.min(1, k * 1.4);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, S * 0.1);
    path();
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.2, S * 0.035);
    path();
    ctx.stroke();
    ctx.restore();
  }

  // Zielkreis einer Bombe, die gerade aufgeladen wird: sehen alle
  function drawCharge(p, t) {
    const w = (VEHICLES[p.vehicle] || VEHICLES[0]).weapon;
    if (w.kind !== 'mortar' || !(p.ch > 0)) return;
    const look = COLORS[p.slot];
    const at = blastPoint(viewNow.arena, p, p.ch);
    const cx = sx(at.x);
    const cy = sy(at.y);
    const r = w.radius * S;
    ctx.save();
    ctx.setLineDash([Math.max(2, S * 0.08), Math.max(3, S * 0.12)]);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(1, S * 0.03);
    ctx.beginPath();
    ctx.moveTo(sx(p.ox), sy(p.oy));
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.fillStyle = look.color;
    ctx.globalAlpha = 0.16 + 0.06 * Math.sin(t / 80);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.lineDashOffset = -t / 30;
    ctx.setLineDash([Math.max(4, S * 0.22), Math.max(3, S * 0.12)]);
    ctx.strokeStyle = look.color;
    ctx.lineWidth = Math.max(2, S * 0.06);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = Math.max(1.5, S * 0.04);
    ctx.beginPath();
    ctx.moveTo(cx - S * 0.22, cy);
    ctx.lineTo(cx + S * 0.22, cy);
    ctx.moveTo(cx, cy - S * 0.22);
    ctx.lineTo(cx, cy + S * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  // Zitteraal beim Blitzen: knisternder Kreis um den Panzer
  function drawAura(p, t) {
    const w = (VEHICLES[p.vehicle] || VEHICLES[0]).weapon;
    if (w.kind !== 'zap') return;
    const x = sx(p.x);
    const y = sy(p.y);
    const r = w.radius * S;
    const look = COLORS[p.slot];
    ctx.save();
    if (p.on) {
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, 'rgba(160,240,255,0.16)');
      g.addColorStop(1, 'rgba(160,240,255,0.04)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(190,245,255,0.55)';
      ctx.lineWidth = Math.max(1.5, S * 0.04);
      ctx.setLineDash([Math.max(3, S * 0.1), Math.max(4, S * 0.16)]);
      ctx.lineDashOffset = t / 20;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < 3; i += 1) {
        const th = Math.random() * TAU;
        const len = 0.35 + Math.random() * 0.4;
        zigzag(x + Math.cos(th) * S * 0.12, y + Math.sin(th) * S * 0.12, x + Math.cos(th) * S * len, y + Math.sin(th) * S * len, look.light, 0.8);
      }
    } else if (p.mine) {
      // eigene Reichweite als dezenter Ring
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = Math.max(1, S * 0.025);
      ctx.setLineDash([Math.max(2, S * 0.06), Math.max(4, S * 0.14)]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRocket(r, t) {
    const look = COLORS[r.owner] || COLORS[0];
    const angle = Math.atan2(r.vy, r.vx);
    ctx.save();
    ctx.translate(sx(r.x), sy(r.y));
    ctx.rotate(angle);
    ctx.scale(S, S);
    // Flamme
    const flick = 0.75 + Math.sin(t * 0.07 + r.id) * 0.15 + Math.random() * 0.15;
    const g = ctx.createLinearGradient(-0.34 * flick - 0.1, 0, -0.1, 0);
    g.addColorStop(0, 'rgba(255,120,40,0)');
    g.addColorStop(0.6, 'rgba(255,170,60,0.9)');
    g.addColorStop(1, 'rgba(255,245,200,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-0.1, -0.05);
    ctx.lineTo(-0.1 - 0.3 * flick, 0);
    ctx.lineTo(-0.1, 0.05);
    ctx.closePath();
    ctx.fill();
    // Leitwerk
    ctx.fillStyle = look.deep;
    ctx.beginPath();
    ctx.moveTo(-0.11, -0.1);
    ctx.lineTo(-0.02, -0.04);
    ctx.lineTo(-0.02, 0.04);
    ctx.lineTo(-0.11, 0.1);
    ctx.closePath();
    ctx.fill();
    // Körper
    ctx.fillStyle = '#f3efe6';
    roundRect(ctx, -0.12, -0.05, 0.22, 0.1, 0.04);
    ctx.fill();
    ctx.fillStyle = look.color;
    ctx.beginPath();
    ctx.moveTo(0.08, -0.05);
    ctx.quadraticCurveTo(0.2, -0.04, 0.22, 0);
    ctx.quadraticCurveTo(0.2, 0.04, 0.08, 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.015;
    roundRect(ctx, -0.12, -0.05, 0.22, 0.1, 0.04);
    ctx.stroke();
    ctx.restore();
  }

  function trail(r, dt) {
    const look = lookOf(`r${r.id}`);
    look.trailAt -= dt;
    if (look.trailAt > 0) return;
    look.trailAt = 0.018;
    const speed = Math.hypot(r.vx, r.vy) || 1;
    const bx = r.x - (r.vx / speed) * 0.24;
    const by = r.y - (r.vy / speed) * 0.24;
    spawn({ kind: 'smoke', x: bx, y: by, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3, r: 0.05, grow: 0.35, life: 0.45, max: 0.45, color: '235,230,220' });
    spawn({ kind: 'glow', x: bx, y: by, r: 0.09, life: 0.14, max: 0.14, color: 'rgba(255,190,90,0.9)' });
  }

  function drawBars(p, x, y) {
    const w = 0.84 * S;
    const h = Math.max(4, 0.11 * S);
    const left = x - w / 2;
    const top = y - 0.78 * S;
    const frac = p.maxHp ? Math.max(0, Math.min(1, p.hp / p.maxHp)) : 0;
    ctx.fillStyle = 'rgba(20,22,28,0.78)';
    roundRect(ctx, left - 1.5, top - 1.5, w + 3, h + 3, 3);
    ctx.fill();
    ctx.fillStyle = frac > 0.6 ? '#5fe07a' : frac > 0.3 ? '#ffc83a' : '#ff5b4f';
    if (frac > 0) {
      roundRect(ctx, left, top, w * frac, h, 2);
      ctx.fill();
    }
    // Waffe, nur beim eigenen Panzer: Nachladen (gelb heißt bereit),
    // Magazin der Pistole, Mana des Zitteraals
    if (p.mine) {
      const weapon = (VEHICLES[p.vehicle] || VEHICLES[0]).weapon;
      const rh = Math.max(3, 0.06 * S);
      const rt = top + h + 3;
      ctx.fillStyle = 'rgba(20,22,28,0.7)';
      roundRect(ctx, left - 1, rt - 1, w + 2, rh + 2, 2);
      ctx.fill();
      if (weapon.kind === 'zap') {
        ctx.fillStyle = p.mana >= 1 ? '#7fe9ff' : 'rgba(127,233,255,0.7)';
        if (p.mana > 0) {
          roundRect(ctx, left, rt, w * Math.min(1, p.mana), rh, 1.5);
          ctx.fill();
        }
      } else if (weapon.kind === 'gun' && p.ammo > 0) {
        const gap = 2;
        const cell = (w - gap * (weapon.magazine - 1)) / weapon.magazine;
        for (let i = 0; i < weapon.magazine; i += 1) {
          ctx.fillStyle = i < p.ammo ? '#ffc83a' : 'rgba(235,230,215,0.18)';
          ctx.fillRect(left + i * (cell + gap), rt, cell, rh);
        }
      } else {
        ctx.fillStyle = p.reload >= 1 ? '#ffc83a' : 'rgba(235,230,215,0.75)';
        if (p.reload > 0) {
          roundRect(ctx, left, rt, w * Math.min(1, p.reload), rh, 1.5);
          ctx.fill();
        }
      }
    }
    // Leben als Punkte
    const dot = Math.max(2, 0.055 * S);
    for (let i = 0; i < LIVES; i += 1) {
      ctx.fillStyle = i < p.lives ? '#ffffff' : 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.arc(left + w + dot * 2.4 + i * dot * 2.6, top + h / 2, dot, 0, TAU);
      ctx.fill();
    }
    const fontPx = Math.max(10, Math.round(0.27 * S));
    ctx.font = `700 ${fontPx}px Barlow, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20,18,15,0.7)';
    const label = p.mine ? 'Du' : p.name;
    ctx.strokeText(label, x, top - 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x, top - 3);
  }

  function drawShield(p, x, y, t) {
    const look = COLORS[p.slot];
    const pulse = 0.5 + Math.sin(t / 90) * 0.2;
    const r = 0.62 * S;
    const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, `rgba(190,240,255,${0.35 * pulse + 0.1})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = look.light;
    ctx.globalAlpha = 0.5 + pulse * 0.5;
    ctx.lineWidth = Math.max(1.5, 0.05 * S);
    ctx.beginPath();
    ctx.arc(x, y, r, t / 300, t / 300 + 1.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r, t / 300 + Math.PI, t / 300 + Math.PI + 1.6);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Zielhilfe für den eigenen Panzer: bei der Rakete die Bahn bis zum ersten
  // Abpraller, bei der Pistole die Schusslinie bis zur Wand oder Reichweite.
  function drawAim(p, view) {
    const vehicle = VEHICLES[p.vehicle] || VEHICLES[0];
    const w = vehicle.weapon;
    let points;
    if (w.kind === 'rocket') points = traceRocket(view.arena, p, w, 1, 1.6);
    else if (w.kind === 'gun') {
      const ray = gunRay(view.arena, p, w.range);
      points = [{ x: ray.sx, y: ray.sy }, { x: ray.sx + ray.dx * ray.len, y: ray.sy + ray.dy * ray.len }];
    } else if (w.kind === 'mortar' && !(p.ch > 0)) {
      // Richtung, in die der Zielkreis beim Drücken wandern wird
      const end = blastPoint(view.arena, { ox: p.x, oy: p.y, ca: p.a }, w.range);
      points = [{ x: p.x + Math.cos(p.a) * 0.6, y: p.y + Math.sin(p.a) * 0.6 }, end];
    } else return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([Math.max(2, S * 0.06), Math.max(4, S * 0.16)]);
    for (let i = 0; i < points.length - 1; i += 1) {
      ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.28)';
      ctx.lineWidth = Math.max(1.5, S * 0.045);
      ctx.beginPath();
      ctx.moveTo(sx(points[i].x), sy(points[i].y));
      ctx.lineTo(sx(points[i + 1].x), sy(points[i + 1].y));
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(view, t, opts = {}) {
    const dt = lastT === null ? 0 : Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    viewNow = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!view || !view.arena) return;
    const arena = view.arena;
    layout(arena);
    buildFloor(arena);
    stepParticles(dt);

    shake = Math.max(0, shake - dt * 1.6);
    const amp = shake * shake * S * 0.9;
    ctx.save();
    if (amp > 0.1) ctx.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);

    // Arena mit Schatten nach außen
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = S * 0.8;
    ctx.shadowOffsetY = S * 0.18;
    ctx.fillStyle = WALL_SIDE;
    ctx.fillRect(ox, oy, arena.W * S, arena.H * S);
    ctx.restore();
    ctx.drawImage(floor, ox, oy, arena.W * S, arena.H * S);

    // Brandflecken und Kettenspuren
    for (const sc of scorches) {
      const age = (t - sc.t) / 1000;
      const k = Math.max(0, 1 - age / 14);
      if (k <= 0) continue;
      const g = ctx.createRadialGradient(sx(sc.x), sy(sc.y), 0, sx(sc.x), sy(sc.y), sc.r * S);
      g.addColorStop(0, `rgba(30,22,15,${0.5 * k})`);
      g.addColorStop(0.6, `rgba(40,30,20,${0.25 * k})`);
      g.addColorStop(1, 'rgba(40,30,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx(sc.x), sy(sc.y), sc.r * S, 0, TAU);
      ctx.fill();
    }
    while (treads.length && t - treads[0].t > 6000) treads.shift();
    for (const tr of treads) {
      const k = 1 - (t - tr.t) / 6000;
      ctx.fillStyle = `rgba(95,72,40,${0.22 * k})`;
      const c = Math.cos(tr.h);
      const s = Math.sin(tr.h);
      for (const side of [-0.3, 0.3]) {
        const x = sx(tr.x - s * side);
        const y = sy(tr.y + c * side);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(tr.h);
        ctx.fillRect(-0.05 * S, -0.08 * S, 0.1 * S, 0.16 * S);
        ctx.restore();
      }
    }

    const playing = view.phase === PHASE.COUNTDOWN || view.phase === PHASE.PLAY || view.phase === PHASE.RESULT;
    const shown = playing || view.phase === PHASE.OVER;
    drawParticles(true);

    if (shown) {
      // Wracks unter den fahrenden Panzern
      for (const p of view.players) {
        if (!p.in || (p.dead === 0 && p.lives > 0)) continue;
        const look = lookOf(p.slot);
        ctx.save();
        ctx.translate(sx(p.x), sy(p.y));
        ctx.rotate(p.h);
        ctx.scale(S, S);
        ctx.globalAlpha = p.lives > 0 ? 0.9 : 0.6;
        drawTankShape(ctx, COLORS[p.slot], p.a - p.h, { wreck: true, tread: look.tread, kind: kindOf(p) });
        ctx.restore();
        look.smokeAt -= dt;
        if (look.smokeAt <= 0 && p.lives > 0) {
          look.smokeAt = 0.09;
          spawn({ kind: 'smoke', x: p.x + (Math.random() - 0.5) * 0.3, y: p.y + (Math.random() - 0.5) * 0.3, vx: 0.15, vy: -0.5, r: 0.1, grow: 0.5, life: 1.2, max: 1.2, color: '60,58,56' });
        }
      }
      // Panzer
      for (const p of view.players) {
        if (!p.in || p.dead > 0 || p.lives <= 0) continue;
        const look = lookOf(p.slot);
        if (look.tp !== p.tp) {
          look.tp = p.tp;
          look.lx = null;
        }
        if (look.lx !== null) {
          const moved = Math.hypot(p.x - look.lx, p.y - look.ly);
          if (moved > 0.0005 && moved < 1) {
            const back = Math.cos(p.h) * (p.x - look.lx) + Math.sin(p.h) * (p.y - look.ly) < 0;
            look.tread += back ? -moved : moved;
            look.trackDist = (look.trackDist || 0) + moved;
            if (look.trackDist > 0.16) {
              look.trackDist = 0;
              treads.push({ x: p.x, y: p.y, h: p.h, t });
              if (treads.length > 1000) treads.shift();
            }
          }
        }
        look.lx = p.x;
        look.ly = p.y;
        const x = sx(p.x);
        const y = sy(p.y);
        ctx.save();
        ctx.translate(x + S * 0.08, y + S * 0.11);
        ctx.rotate(p.h);
        ctx.fillStyle = 'rgba(40,28,10,0.3)';
        roundRect(ctx, -0.47 * S, -0.43 * S, 0.94 * S, 0.86 * S, 0.14 * S);
        ctx.fill();
        ctx.restore();
        const sinceShot = (t - look.recoilAt) / 1000;
        const recoil = sinceShot < 0.18 ? 0.09 * (1 - sinceShot / 0.18) : 0;
        const sinceHit = (t - look.flashAt) / 1000;
        const flash = sinceHit < 0.16 ? 0.7 * (1 - sinceHit / 0.16) : 0;
        const blink = p.shield > 0 && Math.floor(t / 110) % 2 === 0 ? 0.55 : 1;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.h);
        ctx.scale(S, S);
        ctx.globalAlpha = blink;
        drawTankShape(ctx, COLORS[p.slot], p.a - p.h, { tread: look.tread, recoil, flash, kind: kindOf(p) });
        ctx.restore();
      }
    }

    // Raketen
    const ids = new Set();
    for (const r of view.rockets) {
      ids.add(`r${r.id}`);
      trail(r, dt);
    }
    for (const key of looks.keys()) if (typeof key === 'string' && !ids.has(key)) looks.delete(key);
    drawParticles(false);
    for (const r of view.rockets) drawRocket(r, t);

    if (shown) {
      for (const p of view.players) {
        if (!p.in || p.dead > 0 || p.lives <= 0) continue;
        if (p.shield > 0) drawShield(p, sx(p.x), sy(p.y), t);
        drawAura(p, t);
      }
      for (const p of view.players) {
        if (p.in && p.dead === 0 && p.lives > 0) drawCharge(p, t);
      }
      const me = view.slot >= 0 ? view.players[view.slot] : null;
      if (opts.aim && me && me.in && me.dead === 0 && me.lives > 0 && (view.phase === PHASE.PLAY || view.phase === PHASE.COUNTDOWN)) drawAim(me, view);
      if (opts.tags) {
        for (const p of view.players) {
          if (!p.in || p.dead > 0 || p.lives <= 0) continue;
          drawBars(p, sx(p.x), sy(p.y));
        }
      }
    }
    ctx.restore();
  }

  function toWorld(px, py) {
    return { x: (px - ox) / S, y: (py - oy) / S };
  }

  function reset() {
    particles.length = 0;
    scorches.length = 0;
    treads.length = 0;
    looks.clear();
  }

  resize();
  return {
    draw,
    effect,
    resize,
    reset,
    toWorld,
    setInsets(next) {
      insets = next;
    },
    tileSize: () => S,
  };
}
