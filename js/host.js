// Der Gastgeber: führt den gültigen Spielstand, vergibt die Plätze und
// schickt allen laufend den Stand. Kennt weder Browser noch Netz, die
// Nachrichten gehen über "Leitungen", die von außen eingehängt werden.
//
// Jede Nachricht darf verloren gehen, doppelt oder verspätet ankommen:
// Spielstände tragen ihre Schrittnummer, Eingaben eine laufende Nummer.

import { createSim, startMatch, backToLobby, stepSim, retire, alive, ghostActive, modeOf, PHASE } from './sim.js';
import { createBot } from './bots.js';
import { MAX_INPUT } from './physics.js';
import { randomSeed } from './rng.js';
import { DT, TICK_RATE, PROTOCOL, MAX_PLAYERS, BOT_NAMES, SETTINGS, VEHICLES, cleanLevels, rulesFor, cleanVehicle } from './config.js';

const OFFLINE_MS = 5000; // ohne Lebenszeichen gilt ein Mitspieler als weg, ein Bot vertritt ihn
const FREE_MS = 20000; // dann wird sein Platz außerhalb eines Spiels wieder frei
const QUEUE_MAX = 40;
const RESTART_MS = 5000; // nur für die Vorschau: so lange nach Spielende geht es von vorn los

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const randomVehicle = () => Math.floor(Math.random() * VEHICLES.length);
function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Gibt den Bots Fahrzeuge, die kein Spieler gewählt hat, und jedem Bot ein
// anderes. Ein Bot behält sein Fahrzeug, solange es frei bleibt; mit `fresh`
// wird neu gelost. Reichen die Fahrzeuge nicht, wird möglichst wenig doppelt
// vergeben: erst, was nur Spieler fahren, dann, was schon ein Bot fährt.
export function assignBotVehicles(slots, fresh = false) {
  const all = VEHICLES.map((_, i) => i);
  const taken = new Set(slots.filter((slot) => slot.kind === 'human').map((slot) => slot.vehicle));
  const used = new Set();
  const open = [];
  for (const slot of slots) {
    if (slot.kind !== 'free') continue;
    if (!fresh && !taken.has(slot.vehicle) && !used.has(slot.vehicle)) used.add(slot.vehicle);
    else open.push(slot);
  }
  const pool = [
    ...shuffled(all.filter((i) => !taken.has(i) && !used.has(i))),
    ...shuffled(all.filter((i) => taken.has(i) && !used.has(i))),
    ...shuffled([...used]),
  ];
  open.forEach((slot, n) => {
    slot.vehicle = pool[n % pool.length];
  });
}

const live = (phase) => phase === PHASE.COUNTDOWN || phase === PHASE.PLAY || phase === PHASE.RESULT;

export function createHost({ levels, autoRestart = false, onChange = () => {} } = {}) {
  const sim = createSim(MAX_PLAYERS);
  const lines = [];
  // kind: 'human' oder 'free'. Freie Plätze fährt ein Bot, wenn Bots an sind.
  const slots = Array.from({ length: MAX_PLAYERS }, (_, index) => ({
    index, kind: 'free', id: null, name: BOT_NAMES[index], online: true, heard: 0,
    queue: [], recvSeq: 0, ackSeq: 0, bot: createBot(index, index + 1), vehicle: randomVehicle(),
  }));
  assignBotVehicles(slots, true);
  const host = { sim, slots, levels: cleanLevels(levels) };
  const epoch = Math.floor(Math.random() * 2147483647) + 1; // erkennt, wenn der Gastgeber neu geladen hat
  let version = 1;
  let clock = null;
  let overAt = 0;
  let lobbyDue = 0;

  const slotOf = (id) => slots.find((slot) => slot.id === id) || null;
  // Jede Änderung an den Plätzen kann einem Bot sein Fahrzeug wegnehmen.
  // Neue Fahrzeuge gelten ab der nächsten Runde.
  const changed = () => {
    assignBotVehicles(slots);
    version += 1;
    lobbyDue = 0;
    onChange();
  };
  const rules = () => rulesFor(host.levels);

  function sendTo(id, msg) {
    for (const line of lines) if (line.sendTo(id, msg)) return;
  }
  function broadcast(msg, fast) {
    for (const line of lines) line.broadcast(msg, fast, sim.tick);
  }
  const isDirect = (id) => lines.some((line) => line.isDirect && line.isDirect(id));

  function free(slot) {
    slot.kind = 'free';
    slot.id = null;
    slot.name = BOT_NAMES[slot.index];
    slot.online = true;
    slot.queue.length = 0;
    // Der Bot fährt mit dem Fahrzeug des Spielers weiter, solange es kein
    // anderer fährt.
  }

  // Wer im nächsten Spiel oder in der nächsten Runde dabei ist
  host.lineup = () => {
    const bots = rules().bots;
    return slots.filter((slot) => slot.kind === 'human' || bots).map((slot) => ({ slot: slot.index, vehicle: slot.vehicle }));
  };
  host.canStart = () => host.lineup().length >= 2;

  function lobbyMessage() {
    return {
      t: 'lobby',
      h: epoch,
      n: version,
      phase: sim.phase,
      round: sim.round,
      levels: host.levels,
      slots: slots.map((slot) => ({ name: slot.name, kind: slot.kind, id: slot.id, online: slot.online, vehicle: slot.vehicle })),
    };
  }

  function snapshot() {
    return {
      t: 's',
      h: epoch,
      k: sim.tick,
      ph: sim.phase,
      pe: sim.phaseEnd,
      rn: sim.round,
      o: sim.levels,
      ar: sim.arena.index,
      // Je Panzer, Reihenfolge siehe P in client.js
      p: sim.players.map((p) => {
        const t = p.tank;
        return [
          p.in ? 1 : 0, r4(t.x), r4(t.y), r4(t.h), r4(t.a), r4(t.v), t.cd,
          p.hp, p.lives, p.dead, p.shield, p.points, p.tp, p.vehicle, p.kills,
          t.ammo, r4(t.ch), r4(t.mana), t.zt, t.rest, t.lock, t.on, r4(t.ox), r4(t.oy), r4(t.ca),
          ghostActive(sim, p) ? 1 : 0, r4(p.ghost.s), p.ghost.cd, r4(p.ghost.ch),
        ];
      }),
      g: sim.bombs.map((b) => [b.id, b.owner, r4(b.sx), r4(b.sy), r4(b.tx), r4(b.ty), b.k0, b.land, b.boom]),
      r: sim.rockets.map((r) => [r.id, r.owner, r.seq, r4(r.x), r4(r.y), r4(r.vx), r4(r.vy), r.life, r.b]),
      w: sim.winners,
      c: sim.champions,
      a: slots.map((slot) => slot.ackSeq),
      e: sim.events.map((e) => [e.id, e.tick, e.kind, e.by, e.of, r4(e.x), r4(e.y), e.item, r4(e.x2), r4(e.y2)]),
    };
  }

  host.addLine = (line) => lines.push(line);

  host.start = () => {
    if (live(sim.phase) || !host.canStart()) return false;
    for (const slot of slots) {
      slot.queue.length = 0;
      slot.ackSeq = slot.recvSeq;
    }
    const seed = randomSeed();
    slots.forEach((slot) => {
      slot.bot = createBot(slot.index, seed);
    });
    // Bots fahren in jedem Spiel neu geloste Fahrzeuge
    assignBotVehicles(slots, true);
    startMatch(sim, seed, host.levels, host.lineup());
    overAt = 0;
    changed();
    return true;
  };

  host.toLobby = () => {
    backToLobby(sim);
    changed();
  };

  // Stellt eine Einstellung auf eine Stufe. Gilt ab dem nächsten Spiel.
  host.setLevel = (key, level) => {
    const index = SETTINGS.findIndex((setting) => setting.key === key);
    if (index < 0) return;
    const next = host.levels.slice();
    next[index] = level;
    host.levels = cleanLevels(next);
    changed();
  };

  host.setVehicle = (id, vehicle) => {
    const slot = slotOf(id);
    if (!slot) return;
    slot.vehicle = cleanVehicle(vehicle);
    changed();
  };

  // Nachricht eines Mitspielers
  host.handle = (id, msg, now) => {
    if (!msg || typeof msg !== 'object') return;
    let slot = slotOf(id);
    if (slot) slot.heard = now;

    if (msg.t === 'hello') {
      if (msg.v !== PROTOCOL) {
        sendTo(id, { t: 'old' });
        return;
      }
      if (msg.watch) {
        sendTo(id, { t: 'welcome', h: epoch, slot: -1, n: version });
        return;
      }
      const name = String(msg.name || '').trim().slice(0, 14) || 'Namenlos';
      if (!slot) {
        slot = slots.find((candidate) => candidate.kind === 'free');
        if (!slot) {
          sendTo(id, { t: 'full' });
          return;
        }
        // Fährt gerade ein Bot auf diesem Platz, übernimmt der Mensch dessen
        // Panzer. Sonst steigt er mit der nächsten Runde ein.
        slot.kind = 'human';
        slot.id = id;
        slot.vehicle = cleanVehicle(msg.vehicle);
      }
      slot.name = name;
      slot.online = true;
      slot.heard = now;
      slot.queue.length = 0;
      slot.recvSeq = 0;
      slot.ackSeq = 0;
      changed();
      sendTo(id, { t: 'welcome', h: epoch, slot: slot.index, n: version });
      return;
    }
    if (msg.t === 'ping') {
      sendTo(id, { t: 'pong', ts: msg.ts });
      return;
    }
    if (!slot) return;

    if (msg.t === 'i' && Array.isArray(msg.c) && Number.isInteger(msg.s)) {
      if (!slot.online) {
        slot.online = true;
        changed();
      }
      const first = msg.s - msg.c.length + 1;
      for (let i = 0; i < msg.c.length; i += 1) {
        const seq = first + i;
        const code = msg.c[i];
        if (seq <= slot.recvSeq || !Number.isInteger(code) || code < 0 || code > MAX_INPUT) continue;
        slot.queue.push({ seq, code });
        slot.recvSeq = seq;
      }
      while (slot.queue.length > QUEUE_MAX) slot.ackSeq = slot.queue.shift().seq;
    } else if (msg.t === 'veh') {
      host.setVehicle(id, msg.v);
    } else if (msg.t === 'bye') {
      free(slot);
      // Ohne Bots scheidet der Panzer aus, mit Bots fährt einer für ihn weiter.
      if (!rules().bots) retire(sim, slot.index);
      changed();
    }
  };

  function drain(slot) {
    if (slot.queue.length) {
      slot.ackSeq = slot.queue[slot.queue.length - 1].seq;
      slot.queue.length = 0;
    }
  }

  function inputsFor(slot) {
    const p = sim.players[slot.index];
    const human = slot.kind === 'human' && slot.online;
    if (modeOf(sim.phase) < 0 || !p.in || (!alive(p) && !ghostActive(sim, p))) {
      drain(slot);
      return [];
    }
    if (!human) return [[slot.bot.think(sim), 0]];
    // Meist genau eine Eingabe pro Schritt. Staut es sich, zwei auf einmal.
    const q = slot.queue;
    const take = q.length === 0 ? 0 : q.length > (isDirect(slot.id) ? 3 : 7) ? 2 : 1;
    const list = [];
    for (let i = 0; i < take; i += 1) {
      const item = q.shift();
      list.push([item.code, item.seq]);
      slot.ackSeq = item.seq;
    }
    return list;
  }

  function step(now) {
    const before = sim.phase;
    const beforeRound = sim.round;
    stepSim(sim, slots.map(inputsFor), host.lineup());
    if (sim.phase !== before || sim.round !== beforeRound) {
      if (sim.phase === PHASE.OVER) overAt = now;
      changed();
    }
    if (live(sim.phase) || sim.tick % 12 === 0) broadcast(snapshot(), true);
  }

  function upkeep(now) {
    for (const slot of slots) {
      if (slot.kind !== 'human') continue;
      const silent = now - slot.heard;
      if (slot.online && silent > OFFLINE_MS) {
        slot.online = false;
        slot.queue.length = 0;
        changed();
      }
      if (!slot.online && !live(sim.phase) && silent > FREE_MS) {
        free(slot);
        changed();
      }
    }
    if (autoRestart && sim.phase === PHASE.OVER && now - overAt > RESTART_MS) host.start();
    if (now >= lobbyDue) {
      lobbyDue = now + 1000;
      broadcast(lobbyMessage(), false);
    }
  }

  // Bringt den Spielstand auf die Zeit `now` (ms).
  host.advance = (now) => {
    if (clock === null) clock = now;
    if (now - clock > 300) clock = now - 300; // nach einer langen Pause nicht alles nachholen
    let steps = 0;
    while (now - clock >= DT * 1000 && steps < 12) {
      clock += DT * 1000;
      step(now);
      steps += 1;
    }
    upkeep(now);
  };

  host.close = () => broadcast({ t: 'closed', h: epoch }, false);
  host.lobby = lobbyMessage;
  host.ticksPerSecond = TICK_RATE;
  return host;
}

// Leitung ohne Netz: verbindet den Gastgeber mit dem Spiel im selben Fenster.
// Nachrichten gehen als Text hin und her, genau wie über das Netz.
export function createLoopback(host, now) {
  const ends = new Map();
  host.addLine({
    sendTo(id, msg) {
      const deliver = ends.get(id);
      if (!deliver) return false;
      deliver(JSON.parse(JSON.stringify(msg)));
      return true;
    },
    broadcast(msg) {
      if (!ends.size) return;
      const text = JSON.stringify(msg);
      for (const deliver of ends.values()) deliver(JSON.parse(text));
    },
    isDirect: (id) => ends.has(id),
  });
  return {
    connect(id, deliver) {
      ends.set(id, deliver);
      return {
        send: (msg) => host.handle(id, JSON.parse(JSON.stringify(msg)), now()),
        close: () => ends.delete(id),
        direct: () => true,
        local: true,
      };
    },
  };
}
