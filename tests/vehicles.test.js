// Welche Fahrzeuge die Bots bekommen
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, assignBotVehicles } from '../js/host.js';
import { PROTOCOL, VEHICLES } from '../js/config.js';

const bots = (host) => host.slots.filter((slot) => slot.kind === 'free');
const botRides = (host) => bots(host).map((slot) => slot.vehicle);
const humanRides = (host) => host.slots.filter((slot) => slot.kind === 'human').map((slot) => slot.vehicle);
const hello = (host, id, vehicle) => host.handle(id, { t: 'hello', v: PROTOCOL, name: id, vehicle }, 0);

function assertFair(host) {
  const rides = botRides(host);
  assert.equal(new Set(rides).size, rides.length, `Bots fahren doppelt: ${rides}`);
  for (const ride of rides) assert.ok(!humanRides(host).includes(ride), `Bot fährt ${ride}, das ein Spieler gewählt hat`);
}

test('ohne Spieler fahren die Bots lauter verschiedene Fahrzeuge', () => {
  for (let i = 0; i < 30; i += 1) {
    const host = createHost();
    assert.deepEqual(botRides(host).sort(), VEHICLES.map((_, n) => n));
  }
});

test('Bots nehmen keins, das ein Spieler gewählt hat, und keins doppelt', () => {
  for (let i = 0; i < 30; i += 1) {
    const host = createHost();
    hello(host, 'a', 0);
    hello(host, 'b', 1);
    assertFair(host);
    assert.deepEqual(botRides(host).sort(), [2, 3]);
    host.start();
    assertFair(host);
  }
});

test('wählen zwei Spieler dasselbe, bleiben für die Bots mehr übrig', () => {
  for (let i = 0; i < 30; i += 1) {
    const host = createHost();
    hello(host, 'a', 2);
    hello(host, 'b', 2);
    assertFair(host);
    hello(host, 'c', 3);
    assertFair(host);
    assert.equal(botRides(host).length, 1);
  }
});

test('wechselt ein Spieler, weicht nur der Bot aus, der dieses Fahrzeug fuhr', () => {
  for (let i = 0; i < 30; i += 1) {
    const host = createHost();
    hello(host, 'a', 0);
    hello(host, 'b', 1);
    const before = new Map(bots(host).map((slot) => [slot.index, slot.vehicle]));
    host.handle('b', { t: 'veh', v: 2 }, 0);
    assertFair(host);
    for (const slot of bots(host)) {
      if (before.get(slot.index) === 2) assert.equal(slot.vehicle, 1);
      else assert.equal(slot.vehicle, before.get(slot.index));
    }
  }
});

test('geht ein Spieler, fährt der Bot auf seinem Platz mit seinem Fahrzeug weiter', () => {
  const host = createHost();
  hello(host, 'a', 0);
  hello(host, 'b', 3);
  const slot = host.slots.find((s) => s.id === 'b');
  host.handle('b', { t: 'bye' }, 0);
  assert.equal(slot.kind, 'free');
  assert.equal(slot.vehicle, 3);
  assertFair(host);
});

test('mehr Bots als Fahrzeuge: jedes Fahrzeug kommt dran, bevor eins doppelt fährt', () => {
  const slots = Array.from({ length: 7 }, () => ({ kind: 'free', vehicle: 0 }));
  slots[0] = { kind: 'human', vehicle: 1 };
  assignBotVehicles(slots, true);
  const count = new Map();
  for (const slot of slots.slice(1)) count.set(slot.vehicle, (count.get(slot.vehicle) || 0) + 1);
  // vier Fahrzeuge, sechs Bots: die drei freien je einmal, dann die 1, dann zwei doppelt
  assert.equal(count.size, VEHICLES.length);
  assert.ok([...count.values()].every((n) => n <= 2));
});
