// Zielen mit den Pfeiltasten
import test from 'node:test';
import assert from 'node:assert/strict';
import { createControls } from '../js/input.js';

function keyboard() {
  const target = new EventTarget();
  const key = (type, code) => {
    const event = new Event(type);
    Object.assign(event, { code, repeat: false, ctrlKey: false, metaKey: false, altKey: false });
    target.dispatchEvent(event);
  };
  const controls = createControls(target);
  controls.setEnabled(true);
  return { controls, down: (code) => key('keydown', code), up: (code) => key('keyup', code) };
}
const deg = (rad) => Math.round((rad * 180) / Math.PI);

test('jeder Pfeil gibt eine Richtung vor, zwei zugleich die dazwischen', () => {
  const k = keyboard();
  assert.equal(k.controls.read(0).aim, null);
  const cases = [
    [['ArrowRight'], 0], [['ArrowDown'], 90], [['ArrowLeft'], 180], [['ArrowUp'], -90],
    [['ArrowUp', 'ArrowRight'], -45], [['ArrowDown', 'ArrowLeft'], 135], [['ArrowLeft', 'ArrowUp'], -135],
  ];
  let t = 0;
  for (const [codes, angle] of cases) {
    for (const code of codes) k.down(code);
    t += 1000;
    assert.equal(deg(k.controls.read(t).aim), angle, codes.join('+'));
    for (const code of codes) k.up(code);
    t += 1000;
    assert.equal(k.controls.read(t).aim, null, 'losgelassen: Turm bleibt stehen');
  }
});

test('wer eine Schräge loslässt, schert nicht kurz in eine Richtung aus', () => {
  const k = keyboard();
  k.down('ArrowUp');
  k.down('ArrowRight');
  assert.equal(deg(k.controls.read(0).aim), -45);
  k.up('ArrowUp');
  assert.equal(deg(k.controls.read(16).aim), -45, 'erst einer los: noch schräg');
  assert.equal(deg(k.controls.read(100).aim), -45);
  k.up('ArrowRight');
  assert.equal(k.controls.read(120).aim, null);
  // bleibt nur ein Pfeil länger gedrückt, gilt seine Richtung
  k.down('ArrowUp');
  k.down('ArrowRight');
  k.controls.read(1000);
  k.up('ArrowUp');
  k.controls.read(1016);
  assert.equal(deg(k.controls.read(1300).aim), 0);
});

test('WASD fährt, die Leertaste schießt, auch bei einem kurzen Tipp', () => {
  const k = keyboard();
  k.down('KeyW');
  k.down('KeyD');
  const c = k.controls.read(0);
  assert.deepEqual([c.mx, c.my], [1, -1]);
  k.down('Space');
  k.up('Space');
  assert.equal(k.controls.read(16).fire, true);
  assert.equal(k.controls.read(32).fire, false);
});
