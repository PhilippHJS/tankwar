// Musik aus Dateien im Ordner audio/:
//   menu.mp3  läuft auf der Startseite und im Raum
//   game.mp3  läuft während des Spiels
// Beide laufen in einer nahtlosen Schleife. Beim Wechsel zwischen Menü und
// Spiel wird übergeblendet, und jedes Stück macht dort weiter, wo es war.
// Fehlt eine Datei, bleibt es an dieser Stelle still.
//
// Abgespielt wird über die Web Audio API: Jede Datei wird einmal dekodiert und
// dann als Schleife abgespielt, ohne die kleine Lücke, die ein Audio-Element
// beim Wiederholen einer MP3 oft hat. Browser erlauben Ton erst nach einem
// Klick oder Tastendruck, deshalb wartet die Musik darauf.

import { audioContext } from './sound.js';

const FADE = 0.8; // Sekunden zum Ein- und Ausblenden
const TRACKS = {
  menu: { url: 'audio/menu.mp3', volume: 0.45 },
  game: { url: 'audio/game.mp3', volume: 0.24 }, // leiser, damit die Geräusche durchkommen
};

export function createMusic({ muted = false, onChange = () => {} } = {}) {
  const ctx = audioContext();
  let scene = null; // 'menu', 'game' oder null
  let off = muted;
  const tracks = {};

  function update() {
    if (!ctx) return;
    for (const [name, track] of Object.entries(tracks)) {
      if (!track.buffer) continue;
      const on = scene === name && !off;
      if (on && !track.source) {
        track.source = ctx.createBufferSource();
        track.source.buffer = track.buffer;
        track.source.loop = true;
        track.source.connect(track.gain);
        track.source.start();
      }
      const now = ctx.currentTime;
      track.gain.gain.cancelScheduledValues(now);
      track.gain.gain.setValueAtTime(track.gain.gain.value, now);
      track.gain.gain.linearRampToValueAtTime(on ? track.volume : 0, now + FADE);
    }
  }

  if (ctx) {
    for (const [name, { url, volume }] of Object.entries(TRACKS)) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      const track = { volume, gain, buffer: null, source: null, available: null };
      tracks[name] = track;
      fetch(url)
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .then((data) => (data ? ctx.decodeAudioData(data) : null))
        .then((decoded) => {
          track.buffer = decoded;
          track.available = Boolean(decoded);
          onChange();
          update();
        })
        .catch(() => {
          track.available = false;
          onChange();
        });
    }
    // Erst nach einem Klick oder Tastendruck darf Ton kommen
    const unlock = () => {
      if (ctx.state === 'suspended') ctx.resume().then(update).catch(() => {});
    };
    for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlock, { capture: true });
  }

  return {
    // Welches Stück gerade dran ist: 'menu' oder 'game'
    setScene(next) {
      if (scene === next) return;
      scene = next;
      update();
    },
    toggle() {
      off = !off;
      update();
      onChange();
      return off;
    },
    muted: () => off,
    // Gibt es dieses Stück (oder irgendeins, ohne Namen)?
    available: (name) => (name ? Boolean(tracks[name] && tracks[name].available) : Object.values(tracks).some((t) => t.available)),
    // Klick auf den Knopf, solange der Browser noch keinen Ton erlaubt: nur
    // freischalten, nicht gleich stummschalten
    locked: () => Boolean(ctx) && ctx.state === 'suspended',
    state: () => ({
      context: ctx ? ctx.state : 'none',
      scene,
      muted: off,
      tracks: Object.fromEntries(Object.entries(tracks).map(([name, t]) => [name, {
        available: t.available, playing: Boolean(t.source), volume: Math.round(t.gain.gain.value * 100) / 100,
      }])),
    }),
  };
}
