// Bewegung, Abpraller und Eingaben
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENAS, solidAt } from '../js/arenas.js';
import {
  packInput, inputMove, inputFire, inputAim, moveIndex, aimIndex, aimAngle, newTank, copyTank, stepTank, launchRocket, stepRocket,
  circleInWall, MODE, MAX_INPUT, angleDiff,
} from '../js/physics.js';
import { VEHICLES, TANK_R, ROCKET_R, TICK_RATE, MAX_PLAYERS } from '../js/config.js';

const arena = ARENAS[0];
const vehicle = VEHICLES[0];
const RIGHT = moveIndex(1, 0);
const LEFT = moveIndex(-1, 0);
const DOWN = moveIndex(0, 1);

test('Arenen sind geschlossen und haben genug Startplätze', () => {
  for (const a of ARENAS) {
    assert.ok(a.spawns.length >= MAX_PLAYERS, `${a.name}: zu wenig Startplätze`);
    for (let x = 0; x < a.W; x += 1) assert.ok(solidAt(a, x, 0) && solidAt(a, x, a.H - 1));
    for (let y = 0; y < a.H; y += 1) assert.ok(solidAt(a, 0, y) && solidAt(a, a.W - 1, y));
    for (const s of a.spawns) assert.ok(!circleInWall(a, s.x, s.y, TANK_R));
  }
});

test('in jeder Arena ist jedes freie Feld erreichbar', () => {
  for (const a of ARENAS) {
    const start = Math.floor(a.spawns[0].y) * a.W + Math.floor(a.spawns[0].x);
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const cell = queue.shift();
      const x = cell % a.W;
      const y = (cell - x) / a.W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (solidAt(a, nx, ny) || seen.has(ny * a.W + nx)) continue;
        seen.add(ny * a.W + nx);
        queue.push(ny * a.W + nx);
      }
    }
    let free = 0;
    for (let i = 0; i < a.W * a.H; i += 1) if (!a.solid[i]) free += 1;
    assert.equal(seen.size, free, a.name);
  }
});

test('Eingaben lassen sich verpacken und auspacken', () => {
  for (const move of [0, 1, 9, 16]) {
    for (const aim of [-1, 0, 511, 1023]) {
      for (const fire of [false, true]) {
        const code = packInput(move, aim, fire);
        assert.ok(code >= 0 && code <= MAX_INPUT);
        assert.equal(inputMove(code), move);
        assert.equal(inputAim(code), aim);
        assert.equal(inputFire(code), fire);
      }
    }
  }
  assert.ok(Math.abs(angleDiff(aimAngle(aimIndex(2.5)), 2.5)) < 0.01);
  assert.equal(moveIndex(0, 0), 0);
});

test('Panzer fahren gemächlich und bleiben aus den Wänden', () => {
  const tank = newTank(2.5, 2.5, 0);
  for (let i = 0; i < TICK_RATE; i += 1) stepTank(arena, tank, packInput(RIGHT, -1, false), vehicle, MODE.PLAY);
  const travelled = tank.x - 2.5;
  assert.ok(travelled > 1.6 && travelled < vehicle.speed, `eine Sekunde: ${travelled}`);
  // gegen die Wand links fahren
  for (let i = 0; i < 4 * TICK_RATE; i += 1) stepTank(arena, tank, packInput(LEFT, -1, false), vehicle, MODE.PLAY);
  assert.ok(!circleInWall(arena, tank.x, tank.y, TANK_R - 1e-6));
  assert.ok(Math.abs(tank.x - (1 + TANK_R)) < 0.01, `steht an der Wand: ${tank.x}`);
});

test('liegt das Ziel hinter dem Panzer, fährt er rückwärts statt zu wenden', () => {
  const tank = newTank(10.5, 1.8, 0);
  for (let i = 0; i < 30; i += 1) stepTank(arena, tank, packInput(LEFT, -1, false), vehicle, MODE.PLAY);
  assert.ok(tank.v < 0, 'Tempo negativ');
  assert.ok(Math.abs(angleDiff(tank.h, 0)) < 0.01, 'Wanne bleibt, wie sie war');
  assert.ok(tank.x < 10.5);
});

test('der Turm dreht sich unabhängig von der Wanne', () => {
  const tank = newTank(10.5, 1.8, 0);
  const aim = aimIndex(Math.PI / 2);
  for (let i = 0; i < TICK_RATE; i += 1) stepTank(arena, tank, packInput(RIGHT, aim, false), vehicle, MODE.PLAY);
  assert.ok(Math.abs(angleDiff(tank.a, Math.PI / 2)) < 0.01);
  assert.ok(Math.abs(angleDiff(tank.h, 0)) < 0.01);
  // ohne Zielvorgabe bleibt der Turm stehen
  const before = tank.a;
  stepTank(arena, tank, packInput(DOWN, -1, false), vehicle, MODE.PLAY);
  assert.equal(tank.a, before);
});

test('im Countdown nur zielen, nach Rundenende nicht mehr schießen', () => {
  const tank = newTank(10.5, 1.8, 0);
  const fired = stepTank(arena, tank, packInput(RIGHT, aimIndex(1), true), vehicle, MODE.AIM);
  assert.ok(!fired);
  assert.equal(tank.x, 10.5);
  assert.ok(tank.a > 0);
  assert.ok(!stepTank(arena, tank, packInput(RIGHT, -1, true), vehicle, MODE.CRUISE));
  assert.ok(tank.x > 10.5);
});

test('Nachladezeit zwischen zwei Schüssen', () => {
  const tank = newTank(10.5, 1.8, 0);
  let shots = 0;
  for (let i = 0; i < 2 * TICK_RATE; i += 1) if (stepTank(arena, tank, packInput(0, -1, true), vehicle, MODE.PLAY)) shots += 1;
  const expected = Math.ceil((2 * TICK_RATE) / Math.round(vehicle.weapon.cooldown * TICK_RATE));
  assert.equal(shots, expected);
});

test('Raketen prallen an jeder Wand ab und verpuffen nach ihrer Lebenszeit', () => {
  const tank = newTank(7.5, 1.8, -Math.PI / 2); // nach oben, gleich an die Wand
  const r = launchRocket(arena, tank, vehicle.weapon);
  for (let i = 0; i < 15; i += 1) stepRocket(arena, r);
  assert.ok(r.vy > 0, 'fliegt nach dem Abprallen nach unten');
  assert.ok(r.b >= 1);
  assert.ok(!circleInWall(arena, r.x, r.y, ROCKET_R));
  // schräg durch die Arena, nie in einer Wand
  const t2 = newTank(2.5, 2.5, 0.6);
  const r2 = launchRocket(arena, t2, vehicle.weapon);
  let steps = 0;
  while (r2.life > 0) {
    stepRocket(arena, r2);
    steps += 1;
    assert.ok(!circleInWall(arena, r2.x, r2.y, ROCKET_R), `Schritt ${steps}`);
    assert.ok(Math.abs(Math.hypot(r2.vx, r2.vy) - vehicle.weapon.speed) < 1e-9, 'Tempo bleibt gleich');
  }
  assert.equal(steps, Math.round(vehicle.weapon.life * TICK_RATE));
  assert.ok(r2.b >= 2, `prallt mehrfach ab: ${r2.b}`);
});

test('direkt an der Wand abgefeuert prallt die Rakete zurück', () => {
  const tank = newTank(1 + TANK_R + 0.01, 6.5, Math.PI); // Lauf zeigt in die Wand links
  const r = launchRocket(arena, tank, vehicle.weapon);
  assert.ok(r.vx > 0);
  assert.ok(!circleInWall(arena, r.x, r.y, ROCKET_R));
});

test('gleicher Stand und gleiche Eingaben ergeben denselben neuen Stand', () => {
  const a = newTank(3.5, 6.5, 0);
  const b = copyTank(a, {});
  const codes = Array.from({ length: 400 }, (_, i) => packInput(1 + (Math.floor(i / 25) % 16), (i * 37) % 1024, i % 9 === 0));
  for (const code of codes) {
    stepTank(arena, a, code, vehicle, MODE.PLAY);
    stepTank(arena, b, code, vehicle, MODE.PLAY);
  }
  assert.deepEqual(a, b);
});
