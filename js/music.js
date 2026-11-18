// Menümusik. Liegt eine Datei `audio/menu.mp3` im Projekt, läuft sie auf der
// Startseite und im Raum in einer nahtlosen Schleife und blendet sich beim
// Wechsel ins Spiel aus. Fehlt die Datei, bleibt es still und der Knopf zum
// Stummschalten erscheint gar nicht erst.
//
// Abgespielt wird über die Web Audio API: Die Datei wird einmal dekodiert und
// dann als Schleife abgespielt, ohne die kleine Lücke, die ein Audio-Element
// beim Wiederholen einer MP3 oft hat. Browser erlauben Ton erst nach einem
// Klick oder Tastendruck, deshalb wartet die Musik darauf.

const FADE = 0.6; // Sekunden zum Ein- und Ausblenden

export function createMusic({ url = 'audio/menu.mp3', volume = 0.45, muted = false, onChange = () => {} } = {}) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  let ctx = null;
  let gain = null;
  let buffer = null;
  let source = null;
  let available = AC ? null : false; // null: noch unklar
  let menu = false; // ist gerade ein Menü zu sehen?
  let off = muted;

  function update() {
    if (!ctx || !buffer) return;
    const on = menu && !off;
    if (on && !source) {
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start();
    }
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(on ? volume : 0, now + FADE);
  }

  if (AC) {
    ctx = new AC();
    gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    fetch(url, { cache: 'force-cache' })
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((data) => (data ? ctx.decodeAudioData(data) : null))
      .then((decoded) => {
        buffer = decoded;
        available = Boolean(decoded);
        onChange();
        update();
      })
      .catch(() => {
        available = false;
        onChange();
      });
    // Erst nach einem Klick oder Tastendruck darf Ton kommen
    const unlock = () => {
      if (ctx.state === 'suspended') ctx.resume().then(update).catch(() => {});
    };
    for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlock, { capture: true });
  }

  return {
    // Menü sichtbar oder nicht: blendet ein oder aus
    setMenu(on) {
      if (menu === on) return;
      menu = on;
      update();
    },
    toggle() {
      off = !off;
      update();
      onChange();
      return off;
    },
    muted: () => off,
    available: () => available === true,
    state: () => ({
      available,
      context: ctx ? ctx.state : 'none',
      playing: Boolean(source),
      volume: gain ? gain.gain.value : 0,
      menu,
      muted: off,
    }),
  };
}
