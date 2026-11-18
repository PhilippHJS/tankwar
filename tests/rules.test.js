// Regeln: Schaden, Leben, Wiedereinstieg, Rundenende, Punkte
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, startMatch, stepSim, retire, PHASE, EVENT, alive } from '../js/sim.js';
import { packInput, aimIndex, newTank } from '../js/physics.js';
import { createBot } from '../js/bots.js';
import { ARENAS, arenaOf } from '../js/arenas.js';
import {
  VEHICLES, LIVES, RESPAWN_TICKS, SHIELD_TICKS, COUNTDOWN_TICKS, RESULT_TICKS, TICK_RATE, DEFAULT_LEVELS,
} from '../js/config.js';

const weapon = VEHICLES[0].weapon;
const HITS_PER_LIFE = Math.ceil(VEHICLES[0].health / weapon.damage);
const idle = () => [[], [], [], []];

// Stufen: Dauer 1 min, Punkte 2, Bots an
function setup(levels = [0, 1, 1], slots = [0, 1]) {
  const sim = createSim(4);
  const lineup = slots.map((slot) => ({ slot, vehicle: 0 }));
  startMatch(sim, 7, levels, lineup);
  // Die Aufstellungen unten passen zur Arena Klassik
  sim.order = [0];
  sim.arena = arenaOf(0);
  while (sim.phase === PHASE.COUNTDOWN) stepSim(sim, idle(), lineup);
  return { sim, lineup };
}

// Stellt zwei Panzer in einer Reihe auf: 0 links, 1 rechts, freie Bahn
function lineUp(sim) {
  sim.players[0].tank = newTank(5.5, 1.8, 0);
  sim.players[1].tank = newTank(9.5, 1.8, 0);
  for (const p of sim.players) p.shield = 0;
}

function shoot(sim, lineup, from, to) {
  const a = sim.players[from].tank;
  const b = sim.players[to].tank;
  const inputs = idle();
  inputs[from] = [[packInput(0, aimIndex(Math.atan2(b.y - a.y, b.x - a.x)), true), 1]];
  sim.players[from].tank.cd = 0;
  // erst drehen, dann schießen
  for (let i = 0; i < 60 && !sim.rockets.length; i += 1) stepSim(sim, inputs, lineup);
  for (let i = 0; i < 120 && sim.rockets.length; i += 1) stepSim(sim, idle(), lineup);
}

test('nach dem Countdown läuft die Runde mit drei Leben und voller Leiste', () => {
  const { sim } = setup();
  assert.equal(sim.phase, PHASE.PLAY);
  assert.equal(sim.tick, COUNTDOWN_TICKS);
  for (const slot of [0, 1]) {
    assert.equal(sim.players[slot].lives, LIVES);
    assert.equal(sim.players[slot].hp, VEHICLES[0].health);
  }
  assert.equal(sim.players[2].in, false);
  assert.equal(sim.phaseEnd - sim.tick, 60 * TICK_RATE);
});

test('Treffer kosten Lebensleiste, ist sie leer, ein Leben und fünf Sekunden Pause', () => {
  const { sim, lineup } = setup();
  lineUp(sim);
  const seen = new Set();
  const kinds = [];
  for (let i = 0; i < HITS_PER_LIFE; i += 1) {
    shoot(sim, lineup, 0, 1);
    for (const e of sim.events) if (!seen.has(e.id)) { seen.add(e.id); kinds.push(e.kind); }
  }
  const p = sim.players[1];
  assert.deepEqual(kinds.filter((k) => k !== EVENT.POP), [...Array(HITS_PER_LIFE - 1).fill(EVENT.HIT), EVENT.DESTROY]);
  assert.equal(p.lives, LIVES - 1);
  assert.equal(p.hp, 0);
  assert.ok(p.dead > 0 && p.dead <= RESPAWN_TICKS);
  assert.equal(sim.players[0].kills, 1);
  const tp = p.tp;
  while (p.dead > 0) stepSim(sim, idle(), lineup);
  assert.equal(p.hp, VEHICLES[0].health);
  assert.equal(p.shield, SHIELD_TICKS);
  assert.equal(p.tp, tp + 1);
  assert.ok(alive(p));
});

test('frisch eingestiegen ist man kurz unverwundbar', () => {
  const { sim, lineup } = setup();
  lineUp(sim);
  sim.players[1].shield = SHIELD_TICKS;
  shoot(sim, lineup, 0, 1);
  assert.equal(sim.players[1].hp, VEHICLES[0].health);
  assert.ok(sim.events.some((e) => e.kind === EVENT.BLOCK));
});

test('eigene Raketen treffen den eigenen Panzer nicht', () => {
  const { sim, lineup } = setup();
  // direkt vor der Wand: die Rakete prallt sofort zurück durch den Schützen
  sim.players[0].tank = newTank(1.45, 6.5, Math.PI);
  sim.players[1].tank = newTank(19.5, 11.5, 0);
  const inputs = idle();
  inputs[0] = [[packInput(0, aimIndex(Math.PI), true), 1]];
  stepSim(sim, inputs, lineup);
  assert.equal(sim.rockets.length, 1);
  for (let i = 0; i < 60; i += 1) stepSim(sim, idle(), lineup);
  assert.equal(sim.players[0].hp, VEHICLES[0].health);
});

test('wer als Letzter Leben hat, holt den Punkt, dann geht es mit der nächsten Runde weiter', () => {
  const { sim, lineup } = setup([0, 1, 1], [0, 1, 2]);
  sim.players[1].lives = 0;
  sim.players[2].lives = 0;
  stepSim(sim, idle(), lineup);
  assert.equal(sim.phase, PHASE.RESULT);
  assert.deepEqual(sim.winners, [0]);
  assert.equal(sim.players[0].points, 1);
  assert.deepEqual(sim.champions, []);
  for (let i = 0; i < RESULT_TICKS; i += 1) stepSim(sim, idle(), lineup);
  assert.equal(sim.phase, PHASE.COUNTDOWN);
  assert.equal(sim.round, 2);
  assert.equal(sim.players[1].lives, LIVES);
});

test('wer die eingestellten Punkte erreicht, gewinnt das Spiel', () => {
  const { sim, lineup } = setup([0, 1, 1]); // 2 Punkte zum Sieg
  for (let round = 1; round <= 2; round += 1) {
    while (sim.phase === PHASE.COUNTDOWN) stepSim(sim, idle(), lineup);
    sim.players[1].lives = 0;
    stepSim(sim, idle(), lineup);
    assert.equal(sim.phase, PHASE.RESULT);
    for (let i = 0; i < RESULT_TICKS; i += 1) stepSim(sim, idle(), lineup);
  }
  assert.equal(sim.phase, PHASE.OVER);
  assert.deepEqual(sim.champions, [0]);
  assert.equal(sim.players[0].points, 2);
});

test('nach Ablauf der Zeit: erst Leben, dann Lebensleiste, sonst mehrere Sieger', () => {
  const cases = [
    { lives: [2, 3, 3], hp: [100, 20, 50], winners: [2] },
    { lives: [3, 1, 2], hp: [10, 100, 100], winners: [0] },
    { lives: [2, 2, 1], hp: [68, 68, 100], winners: [0, 1] },
  ];
  for (const c of cases) {
    const { sim, lineup } = setup([0, 1, 1], [0, 1, 2]);
    c.lives.forEach((lives, slot) => {
      sim.players[slot].lives = lives;
      sim.players[slot].hp = c.hp[slot];
    });
    sim.phaseEnd = sim.tick + 1;
    stepSim(sim, idle(), lineup);
    assert.equal(sim.phase, PHASE.RESULT);
    assert.deepEqual(sim.winners, c.winners);
  }
});

test('erwischen sich die letzten beiden gleichzeitig, gewinnen beide', () => {
  const { sim, lineup } = setup();
  for (const p of sim.players) if (p.in) { p.lives = 1; p.hp = 1; p.shield = 0; }
  sim.players[0].tank = newTank(5.5, 1.8, 0);
  sim.players[1].tank = newTank(8.5, 1.8, Math.PI);
  const inputs = idle();
  inputs[0] = [[packInput(0, aimIndex(0), true), 1]];
  inputs[1] = [[packInput(0, aimIndex(Math.PI), true), 1]];
  stepSim(sim, inputs, lineup);
  for (let i = 0; i < 60 && sim.phase === PHASE.PLAY; i += 1) stepSim(sim, idle(), lineup);
  assert.equal(sim.phase, PHASE.RESULT);
  assert.deepEqual(sim.winners, [0, 1]);
});

test('wer mitten im Spiel geht, scheidet aus', () => {
  const { sim, lineup } = setup([0, 1, 0], [0, 1, 2]);
  retire(sim, 1);
  assert.equal(sim.players[1].lives, 0);
  stepSim(sim, idle(), lineup);
  assert.equal(sim.phase, PHASE.PLAY);
  retire(sim, 2);
  stepSim(sim, idle(), lineup);
  assert.equal(sim.phase, PHASE.RESULT);
  assert.deepEqual(sim.winners, [0]);
});

test('vier Bots spielen ein ganzes Spiel zu Ende', () => {
  const sim = createSim(4);
  const lineup = [0, 1, 2, 3].map((slot) => ({ slot, vehicle: 0 }));
  startMatch(sim, 4242, DEFAULT_LEVELS, lineup);
  const bots = lineup.map((e) => createBot(e.slot, 4242));
  let ticks = 0;
  while (sim.phase !== PHASE.OVER && ticks < 60 * 60 * 40) {
    stepSim(sim, bots.map((bot) => [[bot.think(sim), 0]]), lineup);
    ticks += 1;
  }
  assert.equal(sim.phase, PHASE.OVER);
  assert.ok(sim.champions.length >= 1);
  assert.ok(sim.players.some((p) => p.points >= 3));
});

test('jedes Spiel mischt die Arenen und spielt sie Runde für Runde im Kreis', () => {
  const seen = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sim = createSim(4);
    const lineup = [{ slot: 0, vehicle: 0 }, { slot: 1, vehicle: 0 }];
    startMatch(sim, seed, [0, 4, 1], lineup);
    assert.deepEqual(sim.order.slice().sort(), ARENAS.map((_, i) => i));
    seen.add(sim.order.join());
    const played = [];
    for (let round = 1; round <= ARENAS.length + 2; round += 1) {
      played.push(sim.arena.index);
      sim.players[1].lives = 0;
      while (sim.phase === PHASE.COUNTDOWN) stepSim(sim, idle(), lineup);
      sim.players[1].lives = 0;
      stepSim(sim, idle(), lineup);
      sim.players[0].points = 0; // nie fertig werden
      sim.champions = [];
      for (let i = 0; i < RESULT_TICKS; i += 1) stepSim(sim, idle(), lineup);
    }
    assert.deepEqual(played, [...sim.order, sim.order[0], sim.order[1]]);
    // Startplätze passen in jede Arena
    assert.ok(sim.players[0].tank.x > 0);
  }
  assert.ok(seen.size > 1, 'Reihenfolge ist zufällig');
});
