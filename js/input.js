// Steuerung: Tastatur und Gamepad, beides gleichzeitig. Fahren und Zielen
// sind getrennt: WASD fährt, die Pfeiltasten richten den Turm aus, die
// Leertaste schießt. Gedrückt halten feuert, sobald wieder geladen ist.
//
// Pfeiltasten geben eine Richtung vor: Rechts dreht den Turm nach rechts, bis
// er dort ankommt, dann bleibt er stehen. Zwei Pfeile zugleich ergeben die
// Richtung dazwischen. Lässt man los, bleibt der Turm, wo er gerade ist. So
// lassen sich auch Winkel zwischen den acht Richtungen einstellen.
//
// Gelesen wird die Lage der Taste, nicht ihr Buchstabe, damit WASD auf jeder
// Tastatur an derselben Stelle liegt.

const KEYS = {
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  ArrowUp: 'aimU', ArrowDown: 'aimD', ArrowLeft: 'aimL', ArrowRight: 'aimR',
  Space: 'fire',
};
const AIM_KEYS = ['aimU', 'aimD', 'aimL', 'aimR'];
const DEAD = 0.3; // tote Zone der Sticks
// Wer eine Schrägrichtung loslässt, lässt die beiden Pfeile selten genau
// gleichzeitig los. So lange gilt die Schräge noch, damit der Turm nicht
// kurz in die Richtung der zuletzt gehaltenen Taste ausschert.
const RELEASE_MS = 150;

export function createControls(target = window) {
  const held = new Map(); // Taste -> Aktion
  const pressedAt = { up: 0, down: 0, left: 0, right: 0, aimU: 0, aimD: 0, aimL: 0, aimR: 0 };
  let counter = 0;
  let enabled = false;
  let moved = false;
  let tapped = false; // Leertaste seit dem letzten Lesen gedrückt
  let padSeen = false;
  let aimCount = 0;
  let lastAim = null;
  let holdUntil = 0;

  const isDown = (action) => {
    for (const value of held.values()) if (value === action) return true;
    return false;
  };
  const typing = (event) => {
    const el = event.target;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };

  target.addEventListener('keydown', (event) => {
    const action = KEYS[event.code];
    if (!action || !enabled || typing(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (event.repeat || held.has(event.code)) return;
    held.set(event.code, action);
    counter += 1;
    pressedAt[action] = counter;
    if (action === 'fire') tapped = true;
    else if (!AIM_KEYS.includes(action)) moved = true;
  });
  target.addEventListener('keyup', (event) => {
    if (held.delete(event.code)) event.preventDefault();
  });
  const release = () => held.clear();
  target.addEventListener('blur', release);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', release);

  const axis = (neg, pos) => {
    const n = isDown(neg);
    const p = isDown(pos);
    if (n && p) return pressedAt[neg] > pressedAt[pos] ? -1 : 1;
    return n ? -1 : p ? 1 : 0;
  };

  // Zielrichtung aus den Pfeiltasten, null: keine gedrückt
  function arrowAim(now) {
    const count = AIM_KEYS.filter(isDown).length;
    const ax = axis('aimL', 'aimR');
    const ay = axis('aimU', 'aimD');
    let aim = null;
    if (count > 0 && (ax || ay)) {
      aim = Math.atan2(ay, ax);
      if (count < aimCount && lastAim !== null) holdUntil = now + RELEASE_MS;
      else if (count > aimCount) holdUntil = 0;
      if (now < holdUntil) aim = lastAim;
      else lastAim = aim;
    } else {
      lastAim = null;
      holdUntil = 0;
    }
    aimCount = count;
    return aim;
  }

  function readPad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected) continue;
      const ax = (i) => (Math.abs(pad.axes[i] || 0) > DEAD ? pad.axes[i] : 0);
      const btn = (i) => Boolean(pad.buttons[i] && pad.buttons[i].pressed);
      let mx = ax(0);
      let my = ax(1);
      if (btn(14)) mx = -1;
      if (btn(15)) mx = 1;
      if (btn(12)) my = -1;
      if (btn(13)) my = 1;
      const rx = pad.axes[2] || 0;
      const ry = pad.axes[3] || 0;
      const aim = Math.hypot(rx, ry) > 0.45 ? Math.atan2(ry, rx) : null;
      const fire = btn(0) || btn(5) || btn(7);
      return { mx, my, aim, fire };
    }
    return null;
  }

  return {
    // mx, my: Fahrtrichtung; aim: Zielrichtung des Turms oder null (bleibt); fire
    read(now = performance.now()) {
      const out = { mx: 0, my: 0, aim: null, fire: false };
      if (!enabled) {
        tapped = false;
        return out;
      }
      out.mx = axis('left', 'right');
      out.my = axis('up', 'down');
      out.aim = arrowAim(now);
      out.fire = isDown('fire') || tapped;
      tapped = false;
      const pad = readPad();
      if (pad) {
        if (!out.mx && !out.my && (pad.mx || pad.my)) {
          out.mx = pad.mx;
          out.my = pad.my;
          moved = true;
        }
        if (out.aim === null && pad.aim !== null) {
          out.aim = pad.aim;
          padSeen = true;
        }
        if (pad.fire) out.fire = true;
      }
      return out;
    },
    setEnabled(on) {
      if (enabled && !on) release();
      enabled = on;
    },
    hasMoved: () => moved,
    usesPad: () => padSeen,
  };
}
