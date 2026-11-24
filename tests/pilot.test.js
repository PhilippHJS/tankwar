// Maussteuerung: Rechtsklick fährt um Wände herum, Q schießt zur Maus
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilot, findPath, clearPath } from '../js/pilot.js';
import { arenaOf, ARENAS, solidAt } from '../js/arenas.js';
import {
  newTank, stepTank, packInput, aimIndex, blastPoint, newGhost, stepGhost, rimPoint, rimNearest, angleDiff, circleInWall, MODE,
} from '../js/physics.js';
import { vehicleFor, ghostFor, TANK_R, TICK_RATE } from '../js/config.js';

const MS = 1000 / TICK_RATE;

// Fährt einen Panzer mit dem Piloten, bis `done` oder die Zeit um ist
function drive(arena, tank, vehicle, pilot, { cursor = null, q = () => false, mouseAim = false, seconds = 20, onShot = null } = {}) {
  for (let i = 0; i < seconds * TICK_RATE; i += 1) {
    const state = { arena, tank, live: true, ghostOn: false, vehicle, tp: 'x', seq: i };
    const out = pilot.steer(state, { cursor, q: q(i), mouseAim, now: i * MS });
    const code = packInput(out.move, out.aim === null ? -1 : aimIndex(out.aim), out.fire);
    const shot = stepTank(arena, tank, code, vehicle, MODE.PLAY);
    if (shot && onShot && onShot(shot, i) === false) return i;
  }
  return -1;
}

test('der Weg führt um Wände herum und nie hindurch', () => {
  for (const arena of ARENAS) {
    const from = arena.spawns[0];
    const to = arena.spawns[3];
    const path = findPath(arena, from.x, from.y, to.x, to.y);
    assert.ok(path.length > 1, arena.name);
    let x = from.x;
    let y = from.y;
    for (const p of path) {
      assert.ok(!solidAt(arena, Math.floor(p.x), Math.floor(p.y)));
      x = p.x;
      y = p.y;
    }
    assert.ok(Math.hypot(x - to.x, y - to.y) < 0.01);
    assert.ok(clearPath(arena, path[0].x, path[0].y, path[0].x, path[0].y));
  }
});

test('Rechtsklick: der Panzer fährt um Wände herum ans Ziel und hält dort an', () => {
  for (const arena of ARENAS) {
    const vehicle = vehicleFor(0, 1);
    const from = arena.spawns[0];
    const to = arena.spawns[3];
    const tank = newTank(from.x, from.y, 0, vehicle);
    const pilot = createPilot();
    pilot.order({ arena, live: true, tp: 'x' }, to.x, to.y);
    drive(arena, tank, vehicle, pilot, { seconds: 25 });
    assert.ok(Math.hypot(tank.x - to.x, tank.y - to.y) < 0.15, `${arena.name}: ${tank.x.toFixed(2)}, ${tank.y.toFixed(2)}`);
    assert.equal(pilot.goal(), null, 'angekommen');
    assert.ok(Math.abs(tank.v) < 0.01, 'steht');
    assert.ok(!circleInWall(arena, tank.x, tank.y, TANK_R - 0.01));
  }
});

test('ein Klick in eine Wand fährt so nah wie möglich heran', () => {
  const arena = arenaOf(0); // Klassik, Block in der Mitte bei 10..11, 6..7
  const vehicle = vehicleFor(1, 1);
  const tank = newTank(5.5, 6.5, 0, vehicle);
  const pilot = createPilot();
  pilot.order({ arena, live: true, tp: 'x' }, 10.6, 6.6);
  drive(arena, tank, vehicle, pilot, { seconds: 10 });
  assert.equal(pilot.goal(), null);
  assert.ok(Math.hypot(tank.x - 10.6, tank.y - 6.6) < 1.3, `${tank.x}, ${tank.y}`);
  assert.ok(!circleInWall(arena, tank.x, tank.y, TANK_R - 0.01));
});

test('der Turm zeigt sofort zur Maus, Q schießt genau dorthin', () => {
  const arena = arenaOf(0);
  for (const kind of [0, 1]) {
    const vehicle = vehicleFor(kind, 1);
    const tank = newTank(5.5, 6.5, 0, vehicle);
    const pilot = createPilot();
    const cursor = { x: 5.5 - 3, y: 6.5 + 2 }; // links unten
    const want = Math.atan2(2, -3);
    let at = null;
    drive(arena, tank, vehicle, pilot, {
      cursor, mouseAim: true, seconds: 1, q: (i) => i === 2, // nur ein kurzer Druck
      onShot: (shot, i) => {
        at = { a: tank.a, i };
        return false;
      },
    });
    assert.ok(at, `${vehicle.name} schießt`);
    assert.equal(at.i, 2, 'sofort');
    assert.ok(Math.abs(angleDiff(at.a, want)) < 0.01, `${vehicle.name} zur Maus: ${at.a.toFixed(3)} statt ${want.toFixed(3)}`);
  }
  // ohne Trägheit: ein Schritt, und der Turm zeigt in die neue Richtung
  const vehicle = vehicleFor(0, 1);
  const tank = newTank(5.5, 6.5, 0, vehicle);
  stepTank(arena, tank, packInput(0, aimIndex(2.5), false), vehicle, MODE.PLAY);
  assert.ok(Math.abs(angleDiff(tank.a, 2.5)) < 0.01);
});

test('Böller: Q halten lädt auf, Fahren und Maus ändern dann nichts mehr, loslassen sprengt', () => {
  const arena = arenaOf(0);
  const vehicle = vehicleFor(2, 1);
  const tank = newTank(5.5, 6.5, 0, vehicle);
  const pilot = createPilot();
  const hold = 70; // Schritte mit gedrücktem Q
  let cursor = { x: 9.5, y: 4.5 };
  const dir = Math.atan2(4.5 - 6.5, 9.5 - 5.5);
  let landed = null;
  let from = null;
  for (let i = 0; i < 3 * TICK_RATE && !landed; i += 1) {
    const q = i >= 1 && i <= hold;
    if (i === 10) {
      // mitten im Aufladen: woanders hinzeigen und wegfahren
      cursor = { x: 2.5, y: 11.5 };
      pilot.order({ arena, live: true, tp: 'x' }, 3.5, 9.5);
    }
    const state = { arena, tank, live: true, ghostOn: false, vehicle, tp: 'x', seq: i };
    const out = pilot.steer(state, { cursor, q, mouseAim: true, now: i * MS });
    if (i === 1) from = { x: tank.x, y: tank.y };
    const shot = stepTank(arena, tank, packInput(out.move, out.aim === null ? -1 : aimIndex(out.aim), out.fire), vehicle, MODE.PLAY);
    if (shot) landed = { at: blastPoint(arena, tank, shot), dist: shot, i };
  }
  assert.ok(landed, 'gesprengt');
  assert.equal(landed.i, hold + 1, 'beim Loslassen');
  assert.ok(Math.hypot(tank.x - from.x, tank.y - from.y) > 0.5, 'ist dabei gefahren');
  const want = { x: from.x + Math.cos(dir) * landed.dist, y: from.y + Math.sin(dir) * landed.dist };
  assert.ok(Math.hypot(landed.at.x - want.x, landed.at.y - want.y) < 0.05, 'Richtung vom Drücken');
  const grown = 0.6 + vehicle.weapon.charge * (hold - 1) / TICK_RATE;
  assert.ok(Math.abs(landed.dist - grown) < 0.05, `so weit, wie lange gehalten: ${landed.dist.toFixed(2)} statt ${grown.toFixed(2)}`);
});

test('als Geist: Rechtsklick fährt am Rand zur nächsten Stelle, Q halten wirft weiter', () => {
  const arena = arenaOf(0);
  const params = ghostFor(1);
  const ghost = newGhost(rimNearest(arena, 3, 0.5));
  const pilot = createPilot();
  const state = { arena, ghost, ghostOn: true, live: false, ghostParams: params, tp: 'g', seq: 0 };
  const click = { x: 21.5, y: 9 }; // rechter Rand, um eine Ecke herum
  pilot.order(state, click.x, click.y);
  for (let i = 0; i < 6 * TICK_RATE; i += 1) {
    state.seq = i;
    const out = pilot.steer(state, { cursor: null, q: false, mouseAim: false, now: i * MS });
    stepGhost(arena, ghost, packInput(out.move, -1, false), params, MODE.PLAY);
  }
  const at = rimPoint(arena, ghost.s);
  const want = rimPoint(arena, rimNearest(arena, click.x, click.y));
  assert.ok(Math.hypot(at.x - want.x, at.y - want.y) < 0.15, `${at.x}, ${at.y}`);
  let thrown = null;
  for (let i = 0; i < 4 * TICK_RATE && thrown === null; i += 1) {
    state.seq = 1000 + i;
    const out = pilot.steer(state, { cursor: { x: 3, y: 3 }, q: i >= 1 && i <= 60, mouseAim: true, now: (1000 + i) * MS });
    const dist = stepGhost(arena, ghost, packInput(out.move, -1, out.fire), params, MODE.PLAY);
    if (dist) thrown = dist;
  }
  const grown = params.min + params.charge * 59 / TICK_RATE;
  assert.ok(Math.abs(thrown - grown) < 0.05, `Weite ${thrown}`);
});
