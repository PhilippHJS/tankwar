// Sudden Death: letzte Leben, keine Geister, fallende Steine
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, startMatch, stepSim, ghostActive, alive, PHASE, EVENT } from '../js/sim.js';
import { newTank } from '../js/physics.js';
import { arenaOf, ARENAS, solidAt } from '../js/arenas.js';
import { stoneOrder, landTick, stonesBy, cellLands, dropStones } from '../js/stones.js';
import { VEHICLES, TICK_RATE, SUDDEN, SHIELD_TICKS } from '../js/config.js';
import { createBot } from '../js/bots.js';

const idle = () => [[], [], [], []];

// Arena Klassik, Zeit fast um. Spieler 0 links oben im äußersten Ring,
// die anderen in der Mitte, wo lange nichts fällt.
function setup(slots = [0, 1, 2]) {
  const sim = createSim(4);
  const lineup = slots.map((slot) => ({ slot, vehicle: 0 }));
  startMatch(sim, 5, [0, 4, 1], lineup);
  sim.order = [0];
  sim.arena = arenaOf(0);
  while (sim.phase === PHASE.COUNTDOWN) stepSim(sim, idle(), lineup);
  const spots = [[1.5, 1.5], [9.5, 5.5], [12.5, 5.5]];
  for (const slot of slots) {
    sim.players[slot].tank = newTank(spots[slot][0], spots[slot][1], 0, VEHICLES[0]);
    sim.players[slot].shield = 0;
  }
  const step = (n = 1) => {
    for (let i = 0; i < n; i += 1) stepSim(sim, idle(), lineup);
  };
  const toSudden = () => {
    sim.phaseEnd = sim.tick + 1;
    step();
  };
  return { sim, lineup, step, toSudden };
}
const events = (sim, kind) => sim.events.filter((e) => e.kind === kind);

test('die Steine fallen in einer Spirale von außen nach innen, auch auf Wände, auf jedes Feld genau einmal', () => {
  for (const arena of ARENAS) {
    const { cells, rank } = stoneOrder(arena);
    assert.equal(cells.length, (arena.W - 2) * (arena.H - 2));
    assert.equal(new Set(cells).size, cells.length);
    assert.equal(cells[0], arena.W + 1, 'beginnt links oben');
    let walls = 0;
    for (let i = 0; i < cells.length; i += 1) {
      const x = cells[i] % arena.W;
      const y = (cells[i] - x) / arena.W;
      assert.ok(x >= 1 && y >= 1 && x <= arena.W - 2 && y <= arena.H - 2, 'nur im Innern');
      assert.equal(rank[cells[i]], i);
      if (solidAt(arena, x, y)) walls += 1;
      if (i) {
        const px = cells[i - 1] % arena.W;
        const py = (cells[i - 1] - px) / arena.W;
        assert.ok(Math.max(Math.abs(px - x), Math.abs(py - y)) <= 1, 'eine zusammenhängende Spirale');
      }
      // von außen nach innen: der Ring wird nie kleiner
      const ring = Math.min(x, y, arena.W - 1 - x, arena.H - 1 - y);
      if (i) {
        const px = cells[i - 1] % arena.W;
        const py = (cells[i - 1] - px) / arena.W;
        assert.ok(ring >= Math.min(px, py, arena.W - 1 - px, arena.H - 1 - py));
      }
    }
    assert.ok(walls > 0, 'Wände im Innern bekommen auch einen Stein');
  }
});

test('Gastgeber und Mitspieler zählen dieselben Steine', () => {
  for (const speed of [0.8, 1, 1.25]) {
    const total = 240;
    for (let t = 1000; t < 1000 + 40 * TICK_RATE; t += 7) {
      let n = 0;
      while (n < total && landTick(1000, n, speed) <= t) n += 1;
      assert.equal(stonesBy(1000, t, speed, total), n);
    }
  }
});

test('ist die Zeit um, beginnt der Sudden Death: nur noch das letzte Leben, keine Geister', () => {
  const { sim, toSudden } = setup();
  const [out, fine, waiting] = sim.players;
  out.lives = 0;
  out.hp = 0;
  out.outAt = sim.tick - 5 * TICK_RATE;
  assert.equal(ghostActive(sim, out), true);
  sim.bombs.push({ id: 1, owner: 0, sx: 0, sy: 0, tx: 5, ty: 5, k0: sim.tick, land: sim.tick + 99, boom: sim.tick + 120 });
  waiting.lives = 2;
  waiting.hp = 0;
  waiting.dead = 2 * TICK_RATE;
  toSudden();
  assert.equal(sim.phase, PHASE.PLAY, 'keine Wertung nach Zeit mehr');
  assert.ok(sim.sd > 0);
  assert.equal(fine.lives, 1);
  assert.equal(waiting.lives, 1);
  assert.equal(ghostActive(sim, out), false, 'Geister verschwinden');
  assert.equal(sim.bombs.length, 0);
  assert.notEqual(sim.arena, arenaOf(0), 'Steine fallen in eine Kopie');
  assert.equal(arenaOf(0).stones, undefined);
});

test('wer auf seinen Wiedereinstieg wartet, steigt noch einmal ein, auf ein Feld, das noch eine Weile frei bleibt', () => {
  const { sim, step, toSudden } = setup();
  const waiting = sim.players[2];
  waiting.lives = 2;
  waiting.hp = 0;
  waiting.dead = Math.round(4.5 * TICK_RATE);
  toSudden();
  while (waiting.dead > 0) step();
  assert.ok(alive(waiting));
  assert.equal(waiting.lives, 1);
  assert.equal(waiting.shield, SHIELD_TICKS);
  const lands = cellLands(sim.arena, sim.sd, sim.rules.speed, Math.floor(waiting.tank.x), Math.floor(waiting.tank.y));
  assert.ok(lands > sim.tick + SUDDEN.safe * TICK_RATE - 2);
  assert.ok(!solidAt(sim.arena, Math.floor(waiting.tank.x), Math.floor(waiting.tank.y)));
});

test('ist kein Platz mehr frei, bleibt man draußen', () => {
  const { sim, step, toSudden } = setup();
  sim.players[0].lives = 0;
  const waiting = sim.players[2];
  waiting.lives = 2;
  waiting.dead = 30;
  toSudden();
  dropStones(sim.arena, stoneOrder(sim.arena).cells.length);
  step(30);
  assert.equal(waiting.lives, 0);
  assert.ok(sim.phase === PHASE.RESULT);
  assert.deepEqual(sim.winners, [1]);
});

test('ein Stein kostet das Leben, auch mit Schutz; wer nur mit dem Rand darunter steht, wird weggeschoben', () => {
  const { sim, step, toSudden } = setup();
  const [under, , side] = sim.players;
  side.tank = newTank(2.5, 2.25, 0, VEHICLES[0]); // ragt ein Stück in Feld 2, 1
  toSudden();
  under.shield = SHIELD_TICKS * 5;
  const first = landTick(sim.sd, 0, sim.rules.speed);
  while (sim.tick < first - 1) step();
  assert.equal(under.lives, 1, 'der Schatten allein tut nichts');
  step();
  assert.equal(under.lives, 0);
  const crush = events(sim, EVENT.DESTROY).find((e) => e.of === 0);
  assert.equal(crush.by, -1, 'vom Stein erwischt');
  assert.ok(solidAt(sim.arena, 1, 1));
  while (sim.tick < landTick(sim.sd, 1, sim.rules.speed)) step();
  assert.ok(solidAt(sim.arena, 2, 1));
  assert.equal(side.lives, 1, 'nur gestreift');
  assert.ok(side.tank.y >= 2 + 0.4 - 1e-9, 'aus dem Stein geschoben');
});

test('Raketen im Feld eines landenden Steins verpuffen', () => {
  const { sim, step, toSudden } = setup([1, 2]);
  toSudden();
  sim.rockets.push({ id: 99, owner: 1, seq: 0, x: 1.5, y: 1.5, vx: 0, vy: 0, life: 9999, b: 0 });
  while (sim.tick < landTick(sim.sd, 0, sim.rules.speed)) step();
  assert.equal(sim.rockets.length, 0);
  assert.ok(events(sim, EVENT.POP).length);
});

test('wer zuletzt noch fährt, gewinnt; erwischt es die Letzten im selben Moment, gewinnen sie gemeinsam', () => {
  {
    const { sim, step, toSudden } = setup([0, 1]);
    toSudden();
    while (sim.phase === PHASE.PLAY) step();
    assert.deepEqual(sim.winners, [1]);
  }
  {
    const { sim, step, toSudden } = setup([0, 1]);
    sim.players[0].tank = newTank(5.3, 1.5, 0, VEHICLES[0]);
    sim.players[1].tank = newTank(5.7, 1.5, 0, VEHICLES[0]);
    toSudden();
    while (sim.phase === PHASE.PLAY) step();
    assert.deepEqual(sim.winners, [0, 1]);
    assert.equal(sim.players[0].outAt, sim.players[1].outAt);
  }
});

test('der Sudden Death endet immer: Bots fahren den Steinen davon, bis es eng wird', () => {
  const early = [];
  for (let seed = 1; seed <= 12; seed += 1) {
    const sim = createSim(4);
    const lineup = [0, 1].map((slot) => ({ slot, vehicle: (slot + seed) % 4 }));
    startMatch(sim, seed, [0, 4, 1], lineup);
    sim.order = [seed % ARENAS.length];
    const bots = lineup.map((e) => createBot(e.slot, seed));
    // ohne Schüsse: nur die Steine entscheiden
    const quiet = () => [...bots.map((bot) => [[bot.think(sim) & ~32, 0]]), [], []];
    while (sim.phase === PHASE.COUNTDOWN) stepSim(sim, quiet(), lineup);
    sim.phaseEnd = sim.tick + 1;
    let first = null;
    for (let i = 0; i < 60 * TICK_RATE && sim.phase === PHASE.PLAY; i += 1) {
      stepSim(sim, quiet(), lineup);
      if (first === null && sim.events.some((e) => e.kind === EVENT.DESTROY && e.by < 0)) first = sim.arena.stones;
    }
    assert.equal(sim.phase, PHASE.RESULT, 'irgendwann ist Schluss');
    // Erwischt wird erst, wenn nur noch die innersten Ringe frei sind
    if (first < 150) early.push(`${seed}: ${first}`);
  }
  // Manchmal stellt sich der andere Bot in den einzigen Ausgang, das kommt vor
  assert.ok(early.length <= 3, `Bots zu früh erwischt: ${early}`);
});
