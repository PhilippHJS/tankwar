// Die Regeln. Läuft nur beim Gastgeber und kennt weder Browser noch Netz:
// Eingaben rein, neuer Spielstand raus.
//
// Jeder hat pro Runde drei Leben und eine volle Lebensleiste. Ist die leer,
// ist ein Leben weg, der Panzer fünf Sekunden raus und steigt dann an einem
// freien Startplatz kurz unverwundbar wieder ein. Eigene Raketen treffen den
// eigenen Panzer nicht. Die Runde endet, wenn nur noch einer Leben hat.
// Ist die Zeit um, beginnt der Sudden Death (siehe SUDDEN und stones.js):
// jeder nur noch mit seinem letzten Leben, keine Geister, und von außen fallen
// Steine, bis einer übrig ist. Erwischt es die Letzten im selben Schritt,
// gewinnen sie gemeinsam. Jeder Sieger bekommt einen Punkt. Gespielt wird,
// bis jemand die eingestellten Punkte erreicht.

import { ARENAS, arenaOf } from './arenas.js';
import { makeRng } from './rng.js';
import {
  newTank, stepTank, launchRocket, stepRocket, gunRay, rayHitsCircle, blastPoint, blastDamage, inZapReach, MODE,
  newGhost, stepGhost, rimPoint, rimNearest, ghostTarget, ghostDamage, pushOutOfWalls,
} from './physics.js';
import { withStones, dropStones, stonesBy, stoneOrder, cellLands, crushes } from './stones.js';
import {
  MAX_PLAYERS, TICK_RATE, LIVES, RESPAWN_TICKS, SHIELD_TICKS, COUNTDOWN_TICKS, RESULT_TICKS, EVENT_TICKS,
  TANK_R, ROCKET_R, DEFAULT_LEVELS, DEFAULT_RULES, cleanLevels, rulesFor, cleanVehicle, vehicleFor, ghostFor, GHOST, SUDDEN,
} from './config.js';

export const PHASE = { LOBBY: 0, COUNTDOWN: 1, PLAY: 2, RESULT: 3, OVER: 4 };
// Treffer, Treffer auf den Schutz, Abschuss (item: verbleibende Leben; by -1:
// von einem Stein erwischt),
// Rakete verpufft, Wiedereinstieg, Pistolenschuss (von x, y bis x2, y2),
// Bombe (item: Radius in Hundertsteln), Blitz (of: getroffen, item: Schaden),
// Geisterbombe explodiert (item: Radius in Hundertsteln), Geist kehrt zurück
export const EVENT = { HIT: 0, BLOCK: 1, DESTROY: 2, POP: 3, SPAWN: 4, SHOT: 5, BLAST: 6, ZAP: 7, GBLAST: 8, REVIVE: 9 };

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
    order: ARENAS.map((_, i) => i), // Reihenfolge der Arenen in diesem Spiel
    field: 0, // so viele waren zu Beginn der Runde dabei
    sd: 0, // Schritt, in dem der Sudden Death begann, 0: noch nicht
    // in: spielt in dieser Runde mit; dead: Schritte bis zum Wiedereinstieg;
    // shield: Restzeit des Schutzes; outAt: Schritt, in dem das letzte Leben
    // verloren ging; tp: zählt jeden Sprung an einen neuen Ort
    // ghost: als Geist auf dem Rand (siehe GHOST); gone: ist gegangen, kein Geist
    players: Array.from({ length: count }, (_, slot) => ({
      slot, in: false, vehicle: 0, tank: newTank(0, 0, 0), hp: 0, lives: 0, dead: 0, shield: 0, outAt: 0,
      points: 0, kills: 0, tp: 0, ghost: newGhost(), gone: false, spawnAt: null, reborn: false,
    })),
    rockets: [], // { id, owner, seq, x, y, vx, vy, life, b }
    bombs: [], // Geisterbomben { id, owner, sx, sy, tx, ty, k0, land, boom }
    nextBomb: 1,
    nextRocket: 1,
    events: [],
    nextEvent: 1,
    winners: [], // Sieger der letzten Runde
    champions: [], // Sieger des ganzen Spiels
  };
}

// Das Fahrzeug eines Spielers im Tempo des laufenden Spiels
export const vehicleOf = (sim, player) => vehicleFor(player.vehicle, sim.rules.speed);
export const alive = (player) => player.in && player.lives > 0 && player.dead === 0;
export const ghostParams = (sim) => ghostFor(sim.rules.speed);
// Ist dieser Spieler gerade ein Geist auf dem Rand?
export function ghostActive(sim, p) {
  if (!p.in || p.lives > 0 || p.gone || sim.sd) return false;
  if (sim.phase !== PHASE.PLAY && sim.phase !== PHASE.RESULT) return false;
  return sim.tick - p.outAt >= Math.round(GHOST.delay * TICK_RATE);
}

// In welcher Phase die Panzer was dürfen (siehe MODE), -1: gar nichts
export function modeOf(phase) {
  if (phase === PHASE.COUNTDOWN) return MODE.AIM;
  if (phase === PHASE.PLAY) return MODE.PLAY;
  if (phase === PHASE.RESULT) return MODE.CRUISE;
  return -1;
}

function addEvent(sim, kind, by, of, x, y, item = 0, x2 = 0, y2 = 0) {
  sim.events.push({ id: sim.nextEvent, tick: sim.tick, kind, by, of, x, y, item, x2, y2 });
  sim.nextEvent += 1;
}

// Ein neues Spiel. `lineup`: wer mitspielt, [{ slot, vehicle }]
export function startMatch(sim, seed, levels, lineup) {
  sim.seed = seed >>> 0;
  sim.rng = makeRng(sim.seed);
  sim.levels = cleanLevels(levels);
  sim.rules = rulesFor(sim.levels);
  sim.order = sim.rng.shuffle(ARENAS.map((_, i) => i));
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
  sim.arena = arenaOf(sim.order[(sim.round - 1) % sim.order.length]);
  sim.phase = PHASE.COUNTDOWN;
  sim.phaseEnd = sim.tick + COUNTDOWN_TICKS;
  sim.sd = 0;
  sim.rockets = [];
  sim.bombs = [];
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
    p.ghost = newGhost();
    p.gone = false;
    p.spawnAt = null;
    p.reborn = false;
    if (!p.in) {
      p.lives = 0;
      p.hp = 0;
      continue;
    }
    p.vehicle = cleanVehicle(entry.vehicle);
    const spawn = sim.arena.spawns[order[seat % order.length]];
    seat += 1;
    p.tank = newTank(spawn.x, spawn.y, spawn.h, vehicleOf(sim, p));
    p.hp = vehicleOf(sim, p).health;
    p.lives = LIVES;
    p.tp += 1;
  }
  sim.field = seat;
}

export function backToLobby(sim) {
  sim.phase = PHASE.LOBBY;
  sim.sd = 0;
  sim.rockets = [];
  sim.bombs = [];
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
  p.gone = true;
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

// Im Sudden Death: das Feld nächst `want`, das noch frei ist, mindestens
// SUDDEN.safe Sekunden frei bleibt und nicht unter einem anderen Panzer liegt.
// null, wenn es keins mehr gibt.
function safeSpot(sim, want, me) {
  const arena = sim.arena;
  const until = sim.tick + SUDDEN.safe * TICK_RATE;
  let best = null;
  let bestD = Infinity;
  for (let cy = 1; cy < arena.H - 1; cy += 1) {
    for (let cx = 1; cx < arena.W - 1; cx += 1) {
      if (arena.solid[cy * arena.W + cx]) continue;
      if (cellLands(arena, sim.sd, sim.rules.speed, cx, cy) <= until) continue;
      const x = cx + 0.5;
      const y = cy + 0.5;
      if (sim.players.some((q) => q !== me && alive(q) && Math.hypot(q.tank.x - x, q.tank.y - y) < TANK_R * 2 + 0.1)) continue;
      const d = Math.hypot(x - want.x, y - want.y);
      if (d < bestD) {
        bestD = d;
        best = { x, y, h: Math.atan2(arena.H / 2 - y, arena.W / 2 - x) };
      }
    }
  }
  return best;
}

function respawn(sim, p) {
  // Nach einer Wiedergeburt steht der Startplatz schon fest: Dorthin ist der Geist geflogen.
  let spawn = p.spawnAt || freeSpawn(sim, p);
  if (sim.sd) {
    // Die Startplätze sind weg: so nah wie möglich daneben, wo noch Platz ist
    spawn = safeSpot(sim, spawn, p);
    if (!spawn) {
      p.spawnAt = null;
      p.reborn = false;
      p.lives = 0;
      p.outAt = sim.tick;
      return;
    }
  }
  const reborn = p.reborn;
  p.spawnAt = null;
  p.reborn = false;
  const turret = p.tank.a;
  p.tank = newTank(spawn.x, spawn.y, spawn.h, vehicleOf(sim, p));
  p.tank.a = turret;
  p.hp = reborn ? Math.max(1, Math.round(vehicleOf(sim, p).health * GHOST.revive)) : vehicleOf(sim, p).health;
  p.shield = SHIELD_TICKS;
  p.tp += 1;
  addEvent(sim, EVENT.SPAWN, p.slot, p.slot, spawn.x, spawn.y, reborn ? 1 : 0);
}

// Schaden an einem Panzer. Schutz hält alles ab. `quiet`: keine eigene
// Treffermeldung (die Bombe und die Blitze melden sich selbst). `ghost`: kam
// von einer Geisterbombe; gibt sie den Rest, kehrt der Geist zurück.
function hurt(sim, p, dmg, by, x, y, quiet = false, ghost = false) {
  if (p.shield > 0) {
    if (!quiet) addEvent(sim, EVENT.BLOCK, by, p.slot, x, y);
    return false;
  }
  p.hp = Math.max(0, p.hp - dmg);
  if (p.hp > 0) {
    if (!quiet) addEvent(sim, EVENT.HIT, by, p.slot, x, y, dmg);
    return true;
  }
  destroy(sim, p, by);
  const shooter = sim.players[by];
  if (ghost && shooter && shooter !== p && shooter.in && shooter.lives <= 0 && !shooter.gone) revive(sim, shooter);
  return true;
}

// Ein Leben weg. `by`: wer es war, -1 für einen Stein.
function destroy(sim, p, by) {
  p.hp = 0;
  p.lives -= 1;
  const shooter = sim.players[by];
  if (shooter && shooter !== p) shooter.kills += 1;
  addEvent(sim, EVENT.DESTROY, by, p.slot, p.tank.x, p.tank.y, p.lives);
  if (p.lives > 0) p.dead = RESPAWN_TICKS;
  else {
    p.outAt = sim.tick;
    p.ghost = newGhost(rimNearest(sim.arena, p.tank.x, p.tank.y));
  }
}

// Ein Geist hat einem Gegner den Rest gegeben: zurück mit einem Leben und
// einem Teil der Lebensleiste, an einem freien Startplatz, kurz geschützt.
// Erst fliegt der Geist dorthin, bei seiner Ankunft erscheint der Panzer.
// Das Ereignis trägt den Weg: von x, y (Rand) nach x2, y2 (Startplatz).
function revive(sim, p) {
  const from = rimPoint(sim.arena, p.ghost.s);
  const spawn = freeSpawn(sim, p);
  const flight = Math.round(GHOST.rebirth * TICK_RATE);
  p.lives = 1;
  p.outAt = 0;
  p.ghost = newGhost();
  p.hp = 0;
  p.dead = flight;
  p.spawnAt = spawn;
  p.reborn = true;
  addEvent(sim, EVENT.REVIVE, p.slot, p.slot, from.x, from.y, flight, spawn.x, spawn.y);
}

function throwBomb(sim, p, dist) {
  const params = ghostParams(sim);
  const from = rimPoint(sim.arena, p.ghost.s);
  const to = ghostTarget(sim.arena, p.ghost, dist);
  const flight = Math.max(1, Math.round((params.flight + params.flightPer * dist) * TICK_RATE));
  const fuse = Math.round(params.fuse * TICK_RATE);
  sim.bombs.push({
    id: sim.nextBomb, owner: p.slot, sx: from.x, sy: from.y, tx: to.x, ty: to.y,
    k0: sim.tick, land: sim.tick + flight, boom: sim.tick + flight + fuse,
  });
  sim.nextBomb += 1;
}

function stepGhosts(sim, inputs, mode) {
  const params = ghostParams(sim);
  for (const p of sim.players) {
    if (!ghostActive(sim, p)) continue;
    for (const [code] of inputs[p.slot] || []) {
      const dist = stepGhost(sim.arena, p.ghost, code, params, mode);
      if (dist) throwBomb(sim, p, dist);
    }
  }
}

// Geisterbomben explodieren nach Flug und kurzer Verzögerung. Sie treffen
// alle Panzer im Umkreis, nur nicht den, der sie geworfen hat.
function stepBombs(sim, damage) {
  const params = ghostParams(sim);
  const keep = [];
  for (const b of sim.bombs) {
    if (sim.tick < b.boom) {
      keep.push(b);
      continue;
    }
    addEvent(sim, EVENT.GBLAST, b.owner, -1, b.tx, b.ty, Math.round(params.radius * 100));
    if (!damage) continue;
    for (const q of sim.players) {
      if (q.slot === b.owner || !alive(q)) continue;
      const dmg = ghostDamage(params, Math.hypot(q.tank.x - b.tx, q.tank.y - b.ty));
      if (dmg > 0) hurt(sim, q, dmg, b.owner, q.tank.x, q.tank.y, true, true);
    }
  }
  sim.bombs = keep;
}

function fireGun(sim, p, w) {
  const ray = gunRay(sim.arena, p.tank, w.range);
  // Getroffen wird, wer zuerst im Weg steht, gemessen ab der Mitte des Schützen
  const offset = Math.hypot(ray.sx - p.tank.x, ray.sy - p.tank.y);
  const total = offset + ray.len;
  let target = null;
  let at = total;
  for (const q of sim.players) {
    if (q === p || !alive(q)) continue;
    const t = rayHitsCircle(p.tank.x, p.tank.y, ray.dx, ray.dy, total, q.tank.x, q.tank.y, TANK_R);
    if (t < at) {
      at = t;
      target = q;
    }
  }
  const end = Math.max(at, offset);
  const ex = p.tank.x + ray.dx * end;
  const ey = p.tank.y + ray.dy * end;
  addEvent(sim, EVENT.SHOT, p.slot, target ? target.slot : -1, ray.sx, ray.sy, 0, ex, ey);
  if (target) hurt(sim, target, w.damage, p.slot, ex, ey);
}

function fireMortar(sim, p, w, dist) {
  const at = blastPoint(sim.arena, p.tank, dist);
  addEvent(sim, EVENT.BLAST, p.slot, -1, at.x, at.y, Math.round(w.radius * 100));
  // Trifft alle im Umkreis, durch Wände und auch den Schützen selbst
  for (const q of sim.players) {
    if (!alive(q)) continue;
    const dmg = blastDamage(w, Math.hypot(q.tank.x - at.x, q.tank.y - at.y));
    if (dmg > 0) hurt(sim, q, dmg, p.slot, q.tank.x, q.tank.y, true);
  }
}

function fireZap(sim, p, w) {
  for (const q of sim.players) {
    if (q === p || !alive(q) || !inZapReach(sim.arena, p.tank, w, q.tank.x, q.tank.y)) continue;
    addEvent(sim, EVENT.ZAP, p.slot, q.slot, q.tank.x, q.tank.y, q.shield > 0 ? 0 : w.damage);
    hurt(sim, q, w.damage, p.slot, q.tank.x, q.tank.y, true);
  }
}

function stepTanks(sim, inputs, mode) {
  for (const p of sim.players) {
    const list = inputs[p.slot] || [];
    if (!alive(p) || mode < 0) continue;
    const others = [];
    for (const q of sim.players) if (q !== p && alive(q)) others.push(q.tank);
    const vehicle = vehicleOf(sim, p);
    const w = vehicle.weapon;
    for (const [code, seq] of list) {
      if (!alive(p)) break; // die eigene Bombe kann den eigenen Panzer zerstören
      const shot = stepTank(sim.arena, p.tank, code, vehicle, mode, others);
      if (!shot) continue;
      if (w.kind === 'gun') fireGun(sim, p, w);
      else if (w.kind === 'mortar') fireMortar(sim, p, w, shot);
      else if (w.kind === 'zap') fireZap(sim, p, w);
      else {
        const r = launchRocket(sim.arena, p.tank, w);
        r.id = sim.nextRocket;
        r.owner = p.slot;
        r.seq = seq || 0; // damit der Schütze seine vorausberechnete Rakete wiedererkennt
        sim.nextRocket += 1;
        sim.rockets.push(r);
      }
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
      const shooter = sim.players[r.owner];
      if (!damage) addEvent(sim, EVENT.BLOCK, r.owner, p.slot, r.x, r.y);
      else hurt(sim, p, shooter ? vehicleOf(sim, shooter).weapon.damage : 0, r.owner, r.x, r.y);
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

// Die Zeit ist um: nur noch das letzte Leben, Geister und ihre Bomben
// verschwinden, gleich fallen die ersten Steine. Wer gerade auf seinen
// Wiedereinstieg wartet, steigt noch einmal ein.
function startSudden(sim) {
  sim.sd = sim.tick;
  sim.arena = withStones(sim.arena);
  sim.bombs = [];
  for (const p of sim.players) if (p.in && p.lives > 1) p.lives = 1;
}

// Steine, die in diesem Schritt landen. Wer darunter steht, ist ein Leben
// los, auch mit Schutz. Wer nur mit dem Rand darunter steht, wird
// weggeschoben. Raketen in dem Feld verpuffen.
function stepStones(sim) {
  if (!sim.sd) return;
  const arena = sim.arena;
  const total = stoneOrder(arena).cells.length;
  for (const cell of dropStones(arena, stonesBy(sim.sd, sim.tick, sim.rules.speed, total))) {
    const cx = cell % arena.W;
    const cy = (cell - cx) / arena.W;
    for (const p of sim.players) {
      if (!alive(p)) continue;
      if (crushes(cx, cy, p.tank.x, p.tank.y)) {
        p.shield = 0;
        destroy(sim, p, -1);
      } else pushOutOfWalls(arena, p.tank, TANK_R);
    }
    sim.rockets = sim.rockets.filter((r) => {
      if (Math.floor(r.x) !== cx || Math.floor(r.y) !== cy) return true;
      addEvent(sim, EVENT.POP, r.owner, -1, r.x, r.y);
      return false;
    });
  }
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

function checkEnd(sim) {
  const field = sim.players.filter((p) => p.in);
  const standing = field.filter((p) => p.lives > 0);
  // Allein in der Runde: bis auch der Letzte erwischt ist
  if (sim.field >= 2 ? standing.length <= 1 : !standing.length) {
    // Hat es die Letzten im selben Schritt erwischt, gewinnen sie gemeinsam.
    finishRound(sim, standing.length ? standing : field.filter((p) => p.outAt === sim.tick));
    return;
  }
  if (!sim.sd && sim.tick >= sim.phaseEnd) startSudden(sim);
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
    stepGhosts(sim, inputs, mode);
    stepRockets(sim, true);
    stepBombs(sim, true);
    stepStones(sim);
    stepTimers(sim);
    checkEnd(sim);
  } else if (sim.phase === PHASE.RESULT) {
    // Ehrenrunde: fahren ja, schießen nein, Treffer zählen nicht mehr
    stepTanks(sim, inputs, mode);
    stepGhosts(sim, inputs, mode);
    stepRockets(sim, false);
    stepBombs(sim, false);
    stepTimers(sim);
    if (sim.tick >= sim.phaseEnd) {
      if (sim.champions.length) {
        sim.phase = PHASE.OVER;
        sim.rockets = [];
        sim.bombs = [];
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
