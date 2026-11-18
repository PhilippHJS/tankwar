// Gastgeber und Mitspieler über eine künstlich schlechte Leitung:
// Verzögerung, Schwankung und verlorene Nachrichten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../js/host.js';
import { createClient } from '../js/client.js';
import { PHASE } from '../js/sim.js';
import { packInput, aimIndex, IDLE } from '../js/physics.js';
import { makeRng } from '../js/rng.js';

function createWorld({ latency = 40, jitter = 10, loss = 0.05, levels } = {}) {
  let clock = 0;
  const rng = makeRng(99);
  const host = createHost({ levels });
  const queue = [];
  const ends = new Map();
  const post = (fast, fn) => {
    if (fast && rng() < loss) return;
    queue.push({ at: clock + latency + rng() * jitter, fn });
  };
  host.addLine({
    sendTo(id, msg) {
      const deliver = ends.get(id);
      if (!deliver) return false;
      const text = JSON.stringify(msg);
      post(false, () => deliver(JSON.parse(text)));
      return true;
    },
    broadcast(msg, fast) {
      const text = JSON.stringify(msg);
      for (const deliver of ends.values()) post(fast, () => deliver(JSON.parse(text)));
    },
    isDirect: () => true,
  });
  const clients = [];
  function join(id) {
    let client = null;
    ends.set(id, (msg) => client.receive(msg, clock));
    const link = {
      send: (msg, fast) => {
        const text = JSON.stringify(msg);
        post(fast, () => host.handle(id, JSON.parse(text), clock));
      },
      direct: () => true,
    };
    client = createClient({ id, name: id, link });
    client.pilot = () => IDLE;
    clients.push(client);
    return client;
  }
  function leave(client) {
    client.leave();
    const i = clients.indexOf(client);
    if (i >= 0) clients.splice(i, 1);
  }
  function run(ms, each) {
    const end = clock + ms;
    while (clock < end) {
      clock += 4;
      queue.sort((a, b) => a.at - b.at);
      while (queue.length && queue[0].at <= clock) queue.shift().fn();
      host.advance(clock);
      if (clock % 16 === 0) {
        for (const client of clients) {
          client.frame(clock, client.pilot(clock));
          client.view(clock);
        }
        if (each) each(clock);
      }
    }
  }
  return { host, join, leave, run, now: () => clock };
}

const drive = (seed) => (t) => {
  const phase = Math.floor(t / 900 + seed) % 6;
  const move = phase === 5 ? 0 : 1 + ((phase * 5 + seed * 3) % 16);
  return packInput(move, aimIndex(t / 700 + seed), (t / 100 + seed) % 7 < 2);
};

test('vier finden ihren Platz, der fünfte muss warten', () => {
  const w = createWorld();
  const players = ['a', 'b', 'c', 'd'].map((id) => w.join(id));
  w.run(1500);
  assert.deepEqual(players.map((c) => c.slot).sort(), [0, 1, 2, 3]);
  assert.ok(players.every((c) => c.status === 'in'));
  const late = w.join('e');
  w.run(1500);
  assert.equal(late.status, 'full');
});

test('die Vorhersage trifft den Stand des Gastgebers, eigene Raketen werden bestätigt', () => {
  const w = createWorld({ latency: 50, jitter: 25, loss: 0.08 });
  const players = ['a', 'b', 'c', 'd'].map((id) => w.join(id));
  players.forEach((c, i) => {
    c.pilot = drive(i);
  });
  w.run(1500);
  assert.equal(w.host.start(), true);
  let worstGhosts = 0;
  let fired = 0;
  w.run(20000, () => {
    for (const c of players) {
      const d = c.debug();
      worstGhosts = Math.max(worstGhosts, d.ghosts);
    }
    fired = w.host.sim.nextRocket - 1;
  });
  assert.ok(fired > 20, `geschossen: ${fired}`);
  assert.ok(worstGhosts <= 4, `unbestätigte Raketen: ${worstGhosts}`);
  // Alle halten an: Dann muss jeder seinen Panzer genau dort sehen, wo er beim Gastgeber steht.
  for (const c of players) c.pilot = () => IDLE;
  w.run(1500);
  for (const c of players) {
    const truth = w.host.sim.players[c.slot];
    const shown = c.view(w.now()).players[c.slot];
    if (truth.dead > 0 || truth.lives <= 0 || !truth.in) continue;
    const off = Math.hypot(shown.x - truth.tank.x, shown.y - truth.tank.y);
    assert.ok(off < 0.01, `Spieler ${c.slot} weicht ${off} ab`);
    assert.equal(c.debug().ghosts, 0);
  }
});

test('wer mitten im Spiel dazukommt, steigt mit der nächsten Runde ein', () => {
  // Bots aus, damit Plätze frei bleiben
  const w = createWorld({ levels: [0, 2, 0] });
  const a = w.join('a');
  const b = w.join('b');
  w.run(1500);
  w.host.start();
  w.run(5000);
  const c = w.join('c');
  w.run(1500);
  assert.ok(c.slot >= 0);
  assert.equal(w.host.sim.players[c.slot].in, false);
  assert.equal(c.view(w.now()).phase, PHASE.PLAY);
  // Runde beenden
  w.host.sim.players[b.slot].lives = 0;
  w.run(8000);
  assert.equal(w.host.sim.round, 2);
  assert.equal(w.host.sim.players[c.slot].in, true);
  assert.equal(c.view(w.now()).players[c.slot].in, true);
  assert.ok(a.slot >= 0);
});

test('wer geht, scheidet ohne Bots aus, mit Bots fährt einer weiter', () => {
  for (const bots of [0, 1]) {
    const w = createWorld({ levels: [0, 2, bots] });
    const a = w.join('a');
    const b = w.join('b');
    const c = w.join('c');
    w.run(1500);
    w.host.start();
    w.run(5000);
    const slot = b.slot;
    w.leave(b);
    w.run(1000);
    const p = w.host.sim.players[slot];
    if (bots) assert.ok(p.lives > 0, 'Bot übernimmt');
    else assert.equal(p.lives, 0, 'scheidet aus');
    assert.ok(a.slot >= 0 && c.slot >= 0);
  }
});

test('reißt die Verbindung ab, vertritt ein Bot und der Spieler kommt zurück auf seinen Platz', () => {
  const w = createWorld({ levels: [0, 2, 0] });
  const a = w.join('a');
  const b = w.join('b');
  w.run(1500);
  w.host.start();
  w.run(4000);
  const slot = b.slot;
  // b ist weg, ohne sich abzumelden
  const keep = b.frame;
  b.frame = () => {};
  w.run(6500);
  assert.equal(w.host.slots[slot].online, false);
  const before = w.host.sim.players[slot].tank.x + w.host.sim.players[slot].tank.y;
  w.run(2000);
  const after = w.host.sim.players[slot].tank.x + w.host.sim.players[slot].tank.y;
  assert.notEqual(before, after, 'ein Bot fährt den Panzer');
  b.frame = keep;
  w.run(1500);
  assert.equal(b.slot, slot);
  assert.equal(w.host.slots[slot].online, true);
  assert.ok(a.slot >= 0);
});
