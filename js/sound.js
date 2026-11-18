// Ein gemeinsamer Audio-Kontext für Musik und Geräusche. Browser erlauben Ton
// erst nach einem Klick oder Tastendruck, bis dahin ist er angehalten.

let ctx;

export function audioContext() {
  if (ctx !== undefined) return ctx;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) {
    ctx = null;
    return ctx;
  }
  ctx = new AC();
  const unlock = () => {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  };
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlock, { capture: true });
  return ctx;
}
