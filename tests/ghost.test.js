// Geister: Rand, Bomben, Rückkehr
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, startMatch, stepSim, retire, ghostActive, PHASE, EVENT } from '../js/sim.js';
import { packInput, moveIndex, newTank, rimPoint, rimNearest } from '../js/physics.js';
import { arenaOf } from '../js/arenas.js';
import { GHOST, VEHICLES, TICK_RATE, LIVES } from '../js/config.js';

const idle = () => [[], [], [], []];
const RIGHT = moveIndex(1, 0);
const DOWN = moveIndex(0, 1);

// Drei Panzer in der Arena Klassik. Spieler 0 hat alle Leben verloren.
function setup() {
  const sim = createSim(4);
  const lineup = [0, 1, 2].map((slot) => ({ slot, vehicle: 0 }));
  startMatch(sim, 5, [0, 4, 1], lineup);
  sim.order = [0];
  sim.arena = arenaOf(0);
  while (sim.phase === PHASE.COUNTDOWN) stepSim(sim, idle(), lineup);
  sim.players[1].tank = newTank(5.5, 6.5, 0, VEHICLES[0]);
  sim.players[2].tank = newTank(16.5, 6.5, Math.PI, VEHICLES[0]);
  for (const p of sim.players) p.shield = 0;
  const me = sim.players[0];
  me.tank = newTank(5.5, 2.5, 0, VEHICLES[0]);
  me.hp = 0;
  me.lives = 0;
  me.outAt = sim.tick;
  me.ghost.s = rimNearest(sim.arena, me.tank.x, me.tank.y);
  const step = (code, n = 1) => {
    for (let i = 0; i < n; i += 1) {
      const inputs = idle();
      inputs[0] = [[code, 1]];
      stepSim(sim, inputs, lineup);
    }
  };
  return { sim, me, step };
}
const events = (sim, kind) => sim.events.filter((e) => e.kind === kind);

test('wer alle Leben verloren hat, wird kurz darauf zum Geist am nächsten Rand', () => {
  const { sim, me, step } = setup();
  assert.equal(ghostActive(sim, me), false, 'noch nicht sofort');
  step(0, Math.round(GHOST.delay * TICK_RATE));
  assert.equal(ghostActive(sim, me), true);
  const at = rimPoint(sim.arena, me.ghost.s);
  assert.equal(at.y, 0.5, 'oben auf dem Rand');
  assert.ok(Math.abs(at.x - 5.5) < 0.01);
  assert.equal(at.ny, 1, 'schaut nach unten, also nach innen');
});

test('der Geist fährt auf dem Rand und biegt an den Ecken ab', () => {
  const { sim, me, step } = setup();
  step(0, TICK_RATE);
  step(packInput(RIGHT, -1, false), 6 * TICK_RATE);
  let at = rimPoint(sim.arena, me.ghost.s);
  assert.equal(at.y, 0.5);
  assert.ok(at.x > 20, `ganz rechts oben angekommen: ${at.x.toFixed(2)}`);
  step(packInput(DOWN, -1, false), TICK_RATE);
  at = rimPoint(sim.arena, me.ghost.s);
  assert.equal(at.x, sim.arena.W - 0.5, 'rechts am Rand');
  assert.ok(at.y > 2, `nach unten abgebogen: ${at.y.toFixed(2)}`);
  assert.equal(at.nx, -1, 'schaut jetzt nach links');
});

test('Geisterbombe: kurz getippt fliegt sie nah, gehalten weit; sie explodiert erst nach der Landung, schwach und durch Wände', () => {
  const { sim, me, step } = setup();
  step(0, TICK_RATE);
  // genau über Spieler 1 stellen (x 5.5), der unten bei y 6.5 steht
  me.ghost.s = 5;
  const hold = Math.round(((6 - GHOST.min) / GHOST.charge) * TICK_RATE);
  step(packInput(0, -1, true), hold + 1);
  step(0, 1);
  assert.equal(sim.bombs.length, 1);
  const b = sim.bombs[0];
  assert.ok(Math.abs(b.ty - 6.5) < 0.15, `landet bei ${b.ty.toFixed(2)}`);
  assert.ok(b.land > sim.tick && b.boom > b.land, 'fliegt erst, dann Zündschnur');
  assert.equal(sim.players[1].hp, 100, 'noch kein Schaden im Flug');
  while (sim.bombs.length) step(0, 1);
  const lost = 100 - sim.players[1].hp;
  assert.ok(lost > 0 && lost <= GHOST.damage, `schwach: ${lost}`);
  assert.equal(events(sim, EVENT.GBLAST).length, 1);
  // danach eine lange Pause
  assert.ok(me.ghost.cd > 3 * TICK_RATE);
  step(packInput(0, -1, true), 30);
  step(0, 1);
  assert.equal(sim.bombs.length, 0, 'während der Pause kein neuer Wurf');
});

test('gibt der Geist einem Gegner den Rest, kehrt er mit einem Leben und 30 % zurück', () => {
  const { sim, me, step } = setup();
  step(0, TICK_RATE);
  me.ghost.s = 5;
  sim.players[1].hp = 5;
  step(packInput(0, -1, true), Math.round(((6 - GHOST.min) / GHOST.charge) * TICK_RATE) + 1);
  step(0, 1);
  while (sim.bombs.length) step(0, 1);
  assert.equal(sim.players[1].lives, LIVES - 1, 'Gegner verliert ein Leben');
  assert.equal(me.lives, 1);
  assert.equal(ghostActive(sim, me), false);
  const revive = events(sim, EVENT.REVIVE)[0];
  assert.ok(revive, 'Wiedergeburt gemeldet');
  assert.equal(revive.y, 0.5, 'fliegt vom Rand los');
  assert.equal(me.kills, 1);
  // Erst fliegt der Geist zum Startplatz, dann erscheint der Panzer dort
  assert.ok(me.dead > 0, 'noch unterwegs');
  while (me.dead > 0) step(0, 1);
  assert.equal(me.hp, Math.round(VEHICLES[0].health * GHOST.revive));
  assert.ok(me.shield > 0, 'kurz geschützt');
  assert.ok(Math.abs(me.tank.x - revive.x2) < 1e-9 && Math.abs(me.tank.y - revive.y2) < 1e-9, 'dort, wohin der Geist geflogen ist');
  const spawn = events(sim, EVENT.SPAWN).find((e) => e.of === 0);
  assert.equal(spawn.item, 1, 'als Wiedergeburt erkennbar');
});

test('Raketen eines schon ausgeschiedenen Panzers holen ihn nicht zurück, wer geht, wird kein Geist', () => {
  const { sim, me, step } = setup();
  // Rakete von Spieler 0, die nach seinem Aus noch trifft
  sim.players[1].hp = 5;
  sim.rockets.push({ id: 99, owner: 0, seq: 0, x: 5.5, y: 5.6, vx: 0, vy: 5, life: 100, b: 0 });
  step(0, 10);
  assert.equal(sim.players[1].lives, LIVES - 1);
  assert.equal(me.lives, 0, 'bleibt draußen');
  retire(sim, 2);
  step(0, 2 * TICK_RATE);
  assert.equal(ghostActive(sim, sim.players[2]), false);
});
