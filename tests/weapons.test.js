// Die vier Waffen: Rakete, Pistole, Bombe, Blitze
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, startMatch, stepSim, PHASE, EVENT } from '../js/sim.js';
import { packInput, aimIndex, newTank } from '../js/physics.js';
import { arenaOf } from '../js/arenas.js';
import { VEHICLES, TICK_RATE, TANK_R } from '../js/config.js';

const KIND = Object.fromEntries(VEHICLES.map((v, i) => [v.weapon.kind, i]));
const W = (kind) => VEHICLES[KIND[kind]].weapon;
const idle = () => [[], [], [], []];

// Zwei Panzer in der Arena Klassik, 0 mit der gewünschten Waffe
function duel(kind, a = [5.5, 1.8], b = [9.5, 1.8]) {
  const sim = createSim(4);
  const lineup = [{ slot: 0, vehicle: KIND[kind] }, { slot: 1, vehicle: 0 }];
  startMatch(sim, 3, [0, 4, 1], lineup);
  sim.order = [0];
  sim.arena = arenaOf(0);
  while (sim.phase === PHASE.COUNTDOWN) stepSim(sim, idle(), lineup);
  sim.players[0].tank = newTank(a[0], a[1], 0, VEHICLES[KIND[kind]]);
  sim.players[1].tank = newTank(b[0], b[1], Math.PI, VEHICLES[0]);
  for (const p of sim.players) p.shield = 0;
  const step = (code0, n = 1) => {
    for (let i = 0; i < n; i += 1) {
      const inputs = idle();
      inputs[0] = [[code0, 1]];
      stepSim(sim, inputs, lineup);
    }
  };
  const aimAt = (x, y) => aimIndex(Math.atan2(y - sim.players[0].tank.y, x - sim.players[0].tank.x));
  return { sim, step, aimAt, me: sim.players[0], foe: sim.players[1] };
}
const kinds = (sim, kind) => sim.events.filter((e) => e.kind === kind);

test('Pistole: trifft sofort, sechs Schuss, dann Nachladen', () => {
  const { sim, step, aimAt, me, foe } = duel('gun');
  const w = W('gun');
  step(packInput(0, aimAt(9.5, 1.8), false), 5);
  const before = foe.hp;
  step(packInput(0, aimAt(9.5, 1.8), true), 1);
  assert.equal(foe.hp, before - w.damage, 'sofort getroffen');
  assert.equal(kinds(sim, EVENT.SHOT).length, 1);
  // Dauerfeuer: Magazin leer, dann Pause
  let shots = 1;
  let seen = sim.nextEvent;
  const start = sim.tick;
  // fünf Abstände im Magazin, dann das Nachladen: knapp davor
  while (sim.tick - start < Math.round(((w.magazine - 1) * w.interval + w.reload) * TICK_RATE) - 2) {
    step(packInput(0, aimAt(foe.tank.x, foe.tank.y), true), 1);
    shots += sim.events.filter((e) => e.id >= seen && e.kind === EVENT.SHOT).length;
    seen = sim.nextEvent;
    foe.hp = 100;
    foe.lives = 3;
    foe.dead = 0;
  }
  assert.equal(shots, w.magazine, 'nach sechs Schuss wird nachgeladen');
  assert.equal(me.tank.ammo, 0);
});

test('Pistole: nicht durch Wände und nicht weiter als die Reichweite', () => {
  // Klassik: Wand von x 9 bis 13 in Zeile 3
  const wall = duel('gun', [11, 1.6], [11, 4.6]);
  wall.step(packInput(0, wall.aimAt(11, 4.6), false), 30);
  wall.step(packInput(0, wall.aimAt(11, 4.6), true), 1);
  assert.equal(wall.foe.hp, 100, 'Wand dazwischen');
  const far = duel('gun', [2.5, 1.6], [2.5 + W('gun').range + 1.5, 1.6]);
  far.step(packInput(0, far.aimAt(far.foe.tank.x, 1.6), true), 1);
  assert.equal(far.foe.hp, 100, 'zu weit weg');
});

test('Bombe: halten schiebt den Zielkreis hinaus, loslassen sprengt dort', () => {
  const { sim, step, aimAt, me, foe } = duel('mortar', [3.5, 1.6], [9.5, 1.6]);
  const w = W('mortar');
  const aim = aimAt(9.5, 1.6);
  step(packInput(0, aim, false), 10);
  const dist = 6;
  const hold = Math.round(((dist - 0.6) / w.charge) * TICK_RATE);
  step(packInput(0, aim, true), hold);
  assert.ok(Math.abs(me.tank.ch - dist) < 0.1, `Zielkreis bei ${me.tank.ch}`);
  step(packInput(0, aim, false), 1);
  const blast = kinds(sim, EVENT.BLAST)[0];
  assert.ok(blast && Math.abs(blast.x - 9.5) < 0.15, 'explodiert am Zielkreis');
  assert.ok(100 - foe.hp >= w.damage - 4, `fast voller Schaden in der Mitte: ${100 - foe.hp}`);
  assert.equal(me.hp, 100, 'weit genug weg, kein Eigenschaden');
  assert.equal(me.tank.ch, 0);
  assert.ok(me.tank.cd > 0, 'muss nachladen');
});

test('Bombe: geht durch Wände, am Rand weniger Schaden, zu kurz gehalten trifft sie einen selbst', () => {
  const through = duel('mortar', [11, 1.6], [11, 4.6]);
  const aim = through.aimAt(11, 4.6);
  through.step(packInput(0, aim, false), 30);
  through.step(packInput(0, aim, true), Math.round(((3 - 0.6) / W('mortar').charge) * TICK_RATE));
  through.step(packInput(0, aim, false), 1);
  assert.ok(through.foe.hp < 100, 'durch die Wand getroffen');

  const edge = duel('mortar', [3.5, 1.6], [10.5, 1.6]);
  const aim2 = edge.aimAt(10.5, 1.6);
  edge.step(packInput(0, aim2, true), Math.round(((6 - 0.6) / W('mortar').charge) * TICK_RATE));
  edge.step(packInput(0, aim2, false), 1);
  const lost = 100 - edge.foe.hp;
  assert.ok(lost >= W('mortar').edge && lost < W('mortar').damage - 10, `am Rand: ${lost}`);

  const self = duel('mortar', [5.5, 1.8], [15.5, 1.8]);
  self.step(packInput(0, -1, true), 2);
  self.step(packInput(0, -1, false), 1);
  assert.ok(self.me.hp < 100, 'eigener Panzer getroffen');
  assert.equal(self.me.kills, 0);
});

test('Blitze: treffen Gegner im Umkreis, nicht durch Wände, und verbrauchen Mana', () => {
  const w = W('zap');
  const near = duel('zap', [5.5, 1.8], [7.3, 1.8]);
  near.step(packInput(0, -1, true), Math.round(TICK_RATE));
  const pulses = kinds(near.sim, EVENT.ZAP).length;
  assert.ok(pulses >= 5 && pulses <= 7, `etwa sechs Blitze pro Sekunde: ${pulses}`);
  assert.equal(100 - near.foe.hp, pulses * w.damage);
  assert.ok(Math.abs(near.me.tank.mana - (1 - 1 / w.drain)) < 0.02, 'Mana sinkt');

  const far = duel('zap', [5.5, 1.8], [5.5 + w.radius + TANK_R + 0.3, 1.8]);
  far.step(packInput(0, -1, true), 30);
  assert.equal(far.foe.hp, 100, 'zu weit weg');

  const wall = duel('zap', [11, 1.6], [11, 4.6]);
  wall.step(packInput(0, -1, true), 30);
  assert.equal(wall.foe.hp, 100, 'Wand dazwischen');
});

test('Blitze: ist das Mana leer, erst loslassen; aufgeladen wird nur in Pausen', () => {
  const w = W('zap');
  const { step, me } = duel('zap', [5.5, 1.8], [15.5, 1.8]);
  step(packInput(0, -1, true), Math.round(w.drain * TICK_RATE) + 5);
  assert.equal(me.tank.mana, 0);
  assert.equal(me.tank.lock, 1);
  assert.equal(me.tank.on, 0);
  step(packInput(0, -1, false), Math.round((w.rest + w.refill) * TICK_RATE) + 5);
  assert.equal(me.tank.mana, 1, 'wieder voll');
  assert.equal(me.tank.lock, 0);
  step(packInput(0, -1, true), 1);
  assert.equal(me.tank.on, 1);
});

test('Bombe: Startpunkt und Richtung gelten ab dem Drücken, Fahren und Pfeile ändern nichts', () => {
  const { sim, step, aimAt, me } = duel('mortar', [3.5, 1.6], [15.5, 1.6]);
  const w = W('mortar');
  const aim = aimAt(15.5, 1.6); // nach rechts
  step(packInput(0, aim, false), 10);
  step(packInput(0, aim, true), 1); // Start
  const down = 1 + 4; // Fahrtrichtung nach unten (Index 5 = 90 Grad)
  const up = aimIndex(-Math.PI / 2);
  const hold = Math.round((4 / w.charge) * TICK_RATE);
  step(packInput(down, up, true), hold);
  assert.ok(me.tank.y > 2.2, `Panzer ist trotzdem gefahren (${me.tank.y.toFixed(2)})`);
  const c = { x: me.tank.ox + Math.cos(me.tank.ca) * me.tank.ch, y: me.tank.oy + Math.sin(me.tank.ca) * me.tank.ch };
  const toCircle = Math.atan2(c.y - me.tank.y, c.x - me.tank.x);
  assert.ok(Math.abs(me.tank.a - toCircle) < 0.01, 'Turm zeigt auf den Zielkreis, nicht dorthin, wohin der Pfeil will');
  assert.ok(me.tank.a < 0 && me.tank.a > -0.6, `leicht nach oben, weil der Panzer nach unten gefahren ist (${me.tank.a.toFixed(2)})`);
  step(packInput(down, up, false), 1);
  const blast = sim.events.find((e) => e.kind === EVENT.BLAST);
  assert.ok(Math.abs(blast.y - 1.6) < 0.01, 'Zielkreis bleibt auf der Linie vom Startpunkt');
  assert.ok(Math.abs(blast.x - (3.5 + 0.6 + 4)) < 0.15, `Abstand vom Startpunkt: ${blast.x.toFixed(2)}`);
  // nach dem Loslassen dreht der Turm wieder
  step(packInput(0, up, false), 30);
  assert.ok(me.tank.a < -1, 'Turm dreht wieder');
});

test('Tempo: schnell und langsam ändern alles, was sich bewegt oder lädt, aber nicht die Reichweite', async () => {
  const { vehicleFor, SETTINGS, rulesFor } = await import('../js/config.js');
  const { launchRocket, stepRocket } = await import('../js/physics.js');
  const speeds = SETTINGS.find((s) => s.key === 'speed').values;
  assert.deepEqual(speeds, [0.8, 1, 1.25]);
  assert.equal(rulesFor([0, 0, 0]).speed, 1, 'mittel ist der Normalfall');
  for (const f of speeds) {
    for (let i = 0; i < VEHICLES.length; i += 1) {
      const v = vehicleFor(i, f);
      assert.ok(Math.abs(v.speed - VEHICLES[i].speed * f) < 1e-9);
      assert.ok(Math.abs(v.turret - VEHICLES[i].turret * f) < 1e-9);
    }
    // Rakete: gleiche Strecke, schneller vorbei
    const w = vehicleFor(0, f).weapon;
    const r = launchRocket(arenaOf(0), newTank(2.5, 1.6, 0), w);
    let steps = 0;
    let dist = 0;
    while (r.life > 0) {
      const x = r.x;
      const y = r.y;
      stepRocket(arenaOf(0), r);
      dist += Math.hypot(r.x - x, r.y - y);
      steps += 1;
    }
    assert.ok(Math.abs(dist - VEHICLES[0].weapon.speed * VEHICLES[0].weapon.life) < 0.25, `Strecke ${dist.toFixed(2)}`);
    assert.ok(Math.abs(steps - Math.round((VEHICLES[0].weapon.life / f) * TICK_RATE)) <= 1);
  }
  // Im Spiel: schneller Panzer fährt in einer Sekunde weiter
  const run = (level) => {
    const sim = createSim(4);
    const lineup = [{ slot: 0, vehicle: 0 }, { slot: 1, vehicle: 0 }];
    startMatch(sim, 1, [0, 4, 1, level], lineup);
    sim.order = [0];
    sim.arena = arenaOf(0);
    while (sim.phase === PHASE.COUNTDOWN) stepSim(sim, idle(), lineup);
    sim.players[0].tank = newTank(3.5, 1.6, 0, VEHICLES[0]);
    for (let i = 0; i < TICK_RATE; i += 1) {
      const inputs = idle();
      inputs[0] = [[packInput(1, -1, false), 1]];
      stepSim(sim, inputs, lineup);
    }
    return sim.players[0].tank.x - 3.5;
  };
  const [slow, mid, fast] = [run(0), run(1), run(2)];
  assert.ok(slow < mid && mid < fast, `${slow.toFixed(2)} < ${mid.toFixed(2)} < ${fast.toFixed(2)}`);
});
