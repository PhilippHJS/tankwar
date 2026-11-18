// Steuerung: Tastatur, Maus und Gamepad, alles gleichzeitig. Fahren und
// Zielen sind getrennt: WASD fährt, der Turm folgt der Maus oder dreht sich mit
// den Pfeiltasten (oder Q und E). Geschossen wird mit Linksklick oder der
// Leertaste, gedrückt halten feuert, sobald wieder geladen ist.
//
// Gelesen wird die Lage der Taste, nicht ihr Buchstabe, damit WASD auf jeder
// Tastatur an derselben Stelle liegt.

const KEYS = {
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  ArrowLeft: 'turnL', KeyQ: 'turnL', ArrowRight: 'turnR', KeyE: 'turnR',
  Space: 'fire', ArrowUp: 'fire',
};
const DEAD = 0.3; // tote Zone der Sticks

export function createControls(target = window, surface = null) {
  const held = new Map(); // Taste -> Aktion
  const pressedAt = { up: 0, down: 0, left: 0, right: 0, turnL: 0, turnR: 0 };
  let counter = 0;
  let enabled = false;
  let moved = false;
  let mode = 'mouse'; // womit zuletzt gezielt wurde: mouse | keys | pad
  let pointer = null;
  let mouseFire = false;
  let tapped = false; // Klick oder Taste seit dem letzten Lesen
  let padSeen = false;

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
    else if (action === 'turnL' || action === 'turnR') mode = 'keys';
    else moved = true;
  });
  target.addEventListener('keyup', (event) => {
    if (held.delete(event.code)) event.preventDefault();
  });
  const release = () => {
    held.clear();
    mouseFire = false;
  };
  target.addEventListener('blur', release);
  document.addEventListener('visibilitychange', release);

  target.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    if (pointer && Math.abs(pointer.x - event.clientX) + Math.abs(pointer.y - event.clientY) > 2) mode = 'mouse';
    pointer = { x: event.clientX, y: event.clientY };
  });
  const area = surface || target;
  area.addEventListener('pointerdown', (event) => {
    if (!enabled || event.pointerType !== 'mouse' || event.button !== 0) return;
    pointer = { x: event.clientX, y: event.clientY };
    mode = 'mouse';
    mouseFire = true;
    tapped = true;
  });
  target.addEventListener('pointerup', (event) => {
    if (event.button === 0) mouseFire = false;
  });
  area.addEventListener('contextmenu', (event) => {
    if (enabled) event.preventDefault();
  });

  const axis = (neg, pos) => {
    const n = isDown(neg);
    const p = isDown(pos);
    if (n && p) return pressedAt[neg] > pressedAt[pos] ? -1 : 1;
    return n ? -1 : p ? 1 : 0;
  };

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
    read() {
      const out = { mx: 0, my: 0, fire: false, turn: 0, pointer, padAim: null, mode };
      if (!enabled) {
        tapped = false;
        return out;
      }
      out.mx = axis('left', 'right');
      out.my = axis('up', 'down');
      out.turn = axis('turnL', 'turnR');
      out.fire = mouseFire || isDown('fire') || tapped;
      tapped = false;
      const pad = readPad();
      if (pad) {
        if (!out.mx && !out.my && (pad.mx || pad.my)) {
          out.mx = pad.mx;
          out.my = pad.my;
          moved = true;
        }
        if (pad.aim !== null) {
          mode = 'pad';
          padSeen = true;
          out.padAim = pad.aim;
        }
        if (pad.fire) out.fire = true;
      }
      out.mode = mode;
      return out;
    },
    setEnabled(on) {
      if (enabled && !on) release();
      enabled = on;
    },
    hasMoved: () => moved,
    usesPad: () => padSeen,
    mode: () => mode,
  };
}
