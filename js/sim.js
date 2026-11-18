// Die Regeln. Läuft nur beim Gastgeber und kennt weder Browser noch Netz:
// Eingaben rein, neuer Spielstand raus.
//
// Jeder hat pro Runde drei Leben und eine volle Lebensleiste. Ist die leer,
// ist ein Leben weg, der Panzer fünf Sekunden raus und steigt dann an einem
// freien Startplatz kurz unverwundbar wieder ein. Eigene Raketen treffen den
// eigenen Panzer nicht. Die Runde endet, wenn nur noch einer Leben hat, oder
// nach Ablauf der Zeit: Dann gewinnt, wer die meisten Leben hat, bei Gleichstand
// mehr Lebensleiste, sonst gewinnen mehrere. Jeder Sieger bekommt einen Punkt.
// Gespielt wird, bis jemand die eingestellten Punkte erreicht.

import { arenaOf } from './arenas.js';
import { makeRng } from './rng.js';
import { newTank, stepTank, launchRocket, stepRocket, MODE } from './physics.js';
import {
  MAX_PLAYERS, TICK_RATE, LIVES, RESPAWN_TICKS, SHIELD_TICKS, COUNTDOWN_TICKS, RESULT_TICKS, EVENT_TICKS,
  TANK_R, ROCKET_R, VEHICLES, DEFAULT_LEVELS, DEFAULT_RULES, cleanLevels, rulesFor, cleanVehicle,
} from './config.js';

export const PHASE = { LOBBY: 0, COUNTDOWN: 1, PLAY: 2, RESULT: 3, OVER: 4 };
// Treffer, Treffer auf den Schutz, Abschuss (item: verbleibende Leben),
// Rakete verpufft, Wiedereinstieg
export const EVENT = { HIT: 0, BLOCK: 1, DESTROY: 2, POP: 3, SPAWN: 4 };

export function createSim(count = MAX_PLAYERS) {
  return {
    tick: 0,
    phase: PHASE.LOBBY,
    phaseEnd: 0,
    round: 0,
    seed: 0,
    rng: makeRng(1),
    levels: DEFAULT_LEVELS.slice(),
    rules: DEFAULT_RULES,
    arena: arenaOf(0),
    field: 0, // so viele waren zu Beginn der Runde dabei
    // in: spielt in dieser Runde mit; dead: Schritte bis zum Wiedereinstieg;
    // shield: Restzeit des Schutzes; outAt: Schritt, in dem das letzte Leben
    // verloren ging; tp: zählt jeden Sprung an einen neuen Ort
    players: Array.from({ length: count }, (_, slot) => ({
      slot, in: false, vehicle: 0, tank: newTank(0, 0, 0), hp: 0, lives: 0, dead: 0, shield: 0, outAt: 0,
      points: 0, kills: 0, tp: 0,
    })),
    rockets: [], // { id, owner, seq, x, y, vx, vy, life, b }
    nextRocket: 1,
    events: [],
    nextEvent: 1,
    winners: [], // Sieger der letzten Runde
    champions: [], // Sieger des ganzen Spiels
  };
}

export const vehicleOf = (player) => VEHICLES[cleanVehicle(player.vehicle)];
export const alive = (player) => player.in && player.lives > 0 && player.dead === 0;

// In welcher Phase die Panzer was dürfen (siehe MODE), -1: gar nichts
export function modeOf(phase) {
  if (phase === PHASE.COUNTDOWN) return MODE.AIM;
  if (phase === PHASE.PLAY) return MODE.PLAY;
  if (phase === PHASE.RESULT) return MODE.CRUISE;
  return -1;
}

function addEvent(sim, kind, by, of, x, y, item = 0) {
  sim.events.push({ id: sim.nextEvent, tick: sim.tick, kind, by, of, x, y, item });
  sim.nextEvent += 1;
}

// Ein neues Spiel. `lineup`: wer mitspielt, [{ slot, vehicle }]
export function startMatch(sim, seed, levels, lineup) {
  sim.seed = seed >>> 0;
  sim.rng = makeRng(sim.seed);
  sim.levels = cleanLevels(levels);
  sim.rules = rulesFor(sim.levels);
  sim.arena = arenaOf(sim.rules.arena);
  sim.round = 0;
  sim.champions = [];
  for (const p of sim.players) {
    p.points = 0;
    p.kills = 0;
  }
  nextRound(sim, lineup);
}

export function nextRound(sim, lineup) {
  sim.round += 1;
  sim.phase = PHASE.COUNTDOWN;
  sim.phaseEnd = sim.tick + COUNTDOWN_TICKS;
  sim.rockets = [];
  sim.winners = [];
  const chosen = new Map(lineup.map((entry) => [entry.slot, entry]));
  const order = sim.rng.shuffle(sim.arena.spawns.map((_, i) => i));
  let seat = 0;
  for (const p of sim.players) {
    const entry = chosen.get(p.slot);
    p.in = Boolean(entry);
    p.dead = 0;
    p.shield = 0;
    p.outAt = 0;
    if (!p.in) {
      p.lives = 0;
      p.hp = 0;
      continue;
    }
    p.vehicle = cleanVehicle(entry.vehicle);
    const spawn = sim.arena.spawns[order[seat % order.length]];
    seat += 1;
    p.tank = newTank(spawn.x, spawn.y, spawn.h);
    p.hp = vehicleOf(p).health;
    p.lives = LIVES;
    p.tp += 1;
  }
  sim.field = seat;
}

export function backToLobby(sim) {
  sim.phase = PHASE.LOBBY;
  sim.rockets = [];
  sim.winners = [];
  sim.champions = [];
  for (const p of sim.players) p.in = false;
}

// Wer mitten in der Runde geht und von niemandem vertreten wird, scheidet aus.
export function retire(sim, slot) {
  const p = sim.players[slot];
  if (!p || !p.in || p.lives <= 0) return;
  p.lives = 0;
  p.hp = 0;
  p.dead = 0;
  p.outAt = sim.tick;
}

// Der Startplatz, der am weitesten von allen anderen Panzern weg ist.
function freeSpawn(sim, me) {
  let best = null;
  let bestScore = -1;
  for (const spawn of sim.arena.spawns) {
    let near = 1e9;
    for (const p of sim.players) {
      if (p === me || !alive(p)) continue;
      near = Math.min(near, Math.hypot(p.tank.x - spawn.x, p.tank.y - spawn.y));
    }
    const score = near + sim.rng() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = spawn;
    }
  }
  return best;
}

function respawn(sim, p) {
  const spawn = freeSpawn(sim, p);
  const turret = p.tank.a;
  p.tank = newTank(spawn.x, spawn.y, spawn.h);
  p.tank.a = turret;
  p.hp = vehicleOf(p).health;
  p.shield = SHIELD_TICKS;
  p.tp += 1;
  addEvent(sim, EVENT.SPAWN, p.slot, p.slot, spawn.x, spawn.y);
}

function stepTanks(sim, inputs, mode) {
  for (const p of sim.players) {
    const list = inputs[p.slot] || [];
    if (!alive(p) || mode < 0) continue;
    const others = [];
    for (const q of sim.players) if (q !== p && alive(q)) others.push(q.tank);
    const vehicle = vehicleOf(p);
    for (const [code, seq] of list) {
      if (!stepTank(sim.arena, p.tank, code, vehicle, mode, others)) continue;
      const r = launchRocket(sim.arena, p.tank, vehicle.weapon);
      r.id = sim.nextRocket;
      r.owner = p.slot;
      r.seq = seq || 0; // damit der Schütze seine vorausberechnete Rakete wiedererkennt
      sim.nextRocket += 1;
      sim.rockets.push(r);
    }
  }
}

function stepRockets(sim, damage) {
  const hitDist = TANK_R + ROCKET_R;
  const keep = [];
  for (const r of sim.rockets) {
    stepRocket(sim.arena, r);
    let gone = false;
    for (const p of sim.players) {
      if (p.slot === r.owner || !alive(p)) continue; // kein Eigenbeschuss
      const dx = p.tank.x - r.x;
      const dy = p.tank.y - r.y;
      if (dx * dx + dy * dy >= hitDist * hitDist) continue;
      gone = true;
      if (!damage || p.shield > 0) {
        addEvent(sim, EVENT.BLOCK, r.owner, p.slot, r.x, r.y);
        break;
      }
      const shooter = sim.players[r.owner];
      const dmg = shooter ? vehicleOf(shooter).weapon.damage : 0;
      p.hp = Math.max(0, p.hp - dmg);
      if (p.hp > 0) {
        addEvent(sim, EVENT.HIT, r.owner, p.slot, r.x, r.y, dmg);
        break;
      }
      p.lives -= 1;
      if (shooter) shooter.kills += 1;
      addEvent(sim, EVENT.DESTROY, r.owner, p.slot, p.tank.x, p.tank.y, p.lives);
      if (p.lives > 0) p.dead = RESPAWN_TICKS;
      else p.outAt = sim.tick;
      break;
    }
    if (gone) continue;
    if (r.life <= 0) {
      addEvent(sim, EVENT.POP, r.owner, -1, r.x, r.y);
      continue;
    }
    keep.push(r);
  }
  sim.rockets = keep;
}

function stepTimers(sim) {
  for (const p of sim.players) {
    if (!p.in || p.lives <= 0) continue;
    if (p.shield > 0) p.shield -= 1;
    if (p.dead > 0) {
      p.dead -= 1;
      if (p.dead === 0) respawn(sim, p);
    }
  }
}

function finishRound(sim, winners) {
  sim.winners = winners.map((p) => p.slot);
  for (const p of winners) p.points += 1;
  const top = Math.max(...sim.players.map((p) => p.points));
  sim.champions = top >= sim.rules.target ? sim.players.filter((p) => p.points === top).map((p) => p.slot) : [];
  sim.phase = PHASE.RESULT;
  sim.phaseEnd = sim.tick + RESULT_TICKS;
}

// Nach Ablauf der Zeit: meiste Leben, dann meiste Lebensleiste
export function leaders(players) {
  const standing = players.filter((p) => p.in && p.lives > 0);
  if (!standing.length) return [];
  const lives = Math.max(...standing.map((p) => p.lives));
  const most = standing.filter((p) => p.lives === lives);
  const hp = Math.max(...most.map((p) => p.hp));
  return most.filter((p) => p.hp === hp);
}

function checkEnd(sim) {
  const field = sim.players.filter((p) => p.in);
  const standing = field.filter((p) => p.lives > 0);
  if (sim.field >= 2 && standing.length <= 1) {
    // Haben sich die letzten gleichzeitig erwischt, gewinnen sie gemeinsam.
    finishRound(sim, standing.length ? standing : field.filter((p) => p.outAt === sim.tick));
    return;
  }
  if (sim.tick >= sim.phaseEnd) finishRound(sim, leaders(sim.players));
}

// Ein Schritt. `inputs[slot]`: Liste von [Eingabe, laufende Nummer], meist
// genau eine. `lineup`: wer in der nächsten Runde mitspielt, falls eine beginnt.
export function stepSim(sim, inputs, lineup = []) {
  sim.tick += 1;
  if (sim.events.length && sim.events[0].tick < sim.tick - EVENT_TICKS) {
    sim.events = sim.events.filter((event) => event.tick >= sim.tick - EVENT_TICKS);
  }
  const mode = modeOf(sim.phase);
  if (sim.phase === PHASE.COUNTDOWN) {
    stepTanks(sim, inputs, mode);
    if (sim.tick >= sim.phaseEnd) {
      sim.phase = PHASE.PLAY;
      sim.phaseEnd = sim.tick + sim.rules.seconds * TICK_RATE;
    }
  } else if (sim.phase === PHASE.PLAY) {
    stepTanks(sim, inputs, mode);
    stepRockets(sim, true);
    stepTimers(sim);
    checkEnd(sim);
  } else if (sim.phase === PHASE.RESULT) {
    // Ehrenrunde: fahren ja, schießen nein, Treffer zählen nicht mehr
    stepTanks(sim, inputs, mode);
    stepRockets(sim, false);
    stepTimers(sim);
    if (sim.tick >= sim.phaseEnd) {
      if (sim.champions.length) {
        sim.phase = PHASE.OVER;
        sim.rockets = [];
      } else {
        nextRound(sim, lineup);
      }
    }
  }
}

// Reihenfolge nach Punkten, dann Abschüssen
export function ranking(players) {
  return players
    .filter((p) => p.in || p.points > 0)
    .slice()
    .sort((a, b) => b.points - a.points || b.kills - a.kills || a.slot - b.slot);
}
