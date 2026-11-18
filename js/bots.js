// Bots für freie Plätze und als Vertretung, wenn jemand die Verbindung
// verliert. Laufen nur beim Gastgeber und liefern dieselben Eingaben wie ein
// Mensch.
//
// Ein Bot sucht sich den nächsten Gegner, rechnet alle paar Schritte ein paar
// Schussrichtungen samt Abprallern durch und schießt, wenn eine trifft. Er
// weicht Raketen aus, die auf ihn zufliegen, und fährt sonst über die Felder
// auf seinen Gegner zu. Ein bisschen Ungenauigkeit ist Absicht.

import { solidAt } from './arenas.js';
import { makeRng } from './rng.js';
import { packInput, moveIndex, aimIndex, launchRocket, stepRocket, copyRocket, angleDiff, IDLE } from './physics.js';
import { alive, vehicleOf, PHASE } from './sim.js';
import { TANK_R, ROCKET_R, DT } from './config.js';

const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Abstand in Feldern von einem Feld zu allen anderen, um Wände herum
function distanceField(arena, sx, sy) {
  const dist = new Int16Array(arena.W * arena.H).fill(-1);
  if (solidAt(arena, sx, sy)) return dist;
  const queue = [sy * arena.W + sx];
  dist[queue[0]] = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head];
    const x = cell % arena.W;
    const y = (cell - x) / arena.W;
    for (let k = 0; k < 4; k += 1) {
      const nx = x + NEIGHBORS[k][0];
      const ny = y + NEIGHBORS[k][1];
      if (solidAt(arena, nx, ny)) continue;
      const next = ny * arena.W + nx;
      if (dist[next] >= 0) continue;
      dist[next] = dist[cell] + 1;
      queue.push(next);
    }
  }
  return dist;
}

export function createBot(slot, seed) {
  const rng = makeRng((seed ^ Math.imul(slot + 1, 2654435761)) >>> 0);
  let target = -1;
  let retargetAt = 0;
  let planAt = 0;
  let plan = null; // { angle, score }
  let field = null;
  let fieldKey = '';
  let fieldAt = -1e9;
  let dodge = null; // { dx, dy, until }
  let stray = null; // { dx, dy, until }: kurz woandershin, wenn er festhängt
  let strafe = rng() < 0.5 ? 1 : -1;
  let strafeAt = 0;
  let last = { x: 0, y: 0, tick: 0 };
  let calmUntil = 0;
  const probe = {};

  // Trifft eine Rakete in diese Richtung? Liefert die Schritte bis zum Treffer.
  function trial(sim, me, angle, foes) {
    const weapon = vehicleOf(me).weapon;
    const r = launchRocket(sim.arena, { x: me.tank.x, y: me.tank.y, a: angle }, weapon);
    const reach = TANK_R + ROCKET_R - 0.06;
    const limit = Math.min(r.life, 130);
    for (let i = 1; i <= limit; i += 1) {
      stepRocket(sim.arena, r);
      for (const foe of foes) {
        // Wo der Gegner ungefähr sein wird, wenn er weiterfährt
        const t = Math.min(i, 40) * DT;
        const fx = foe.tank.x + Math.cos(foe.tank.h) * foe.tank.v * t;
        const fy = foe.tank.y + Math.sin(foe.tank.h) * foe.tank.v * t;
        const dx = fx - r.x;
        const dy = fy - r.y;
        if (dx * dx + dy * dy < reach * reach) return i + r.b * 18 + (foe.shield > 0 ? 200 : 0);
      }
    }
    return Infinity;
  }

  function planShot(sim, me, foe, foes) {
    const direct = Math.atan2(foe.tank.y - me.tank.y, foe.tank.x - me.tank.x);
    const tries = [direct, direct + 0.07, direct - 0.07];
    const spread = 26;
    const offset = rng() * ((Math.PI * 2) / spread);
    for (let i = 0; i < spread; i += 1) tries.push(offset + (i / spread) * Math.PI * 2);
    let best = null;
    const turretRate = vehicleOf(me).turret;
    for (const angle of tries) {
      const steps = trial(sim, me, angle, foes);
      if (!Number.isFinite(steps)) continue;
      const turning = (Math.abs(angleDiff(angle, me.tank.a)) / turretRate) * 60;
      const score = steps + turning * 0.8;
      if (!best || score < best.score) best = { angle, score };
    }
    return best && best.score < 170 ? best : null;
  }

  // Fliegt eine gegnerische Rakete bald in diesen Panzer?
  function threat(sim, me) {
    let soonest = null;
    const near = TANK_R + ROCKET_R + 0.3;
    for (const r of sim.rockets) {
      if (r.owner === me.slot) continue;
      if (Math.hypot(r.x - me.tank.x, r.y - me.tank.y) > 7) continue;
      copyRocket(r, probe);
      for (let i = 1; i <= 34 && probe.life > 0; i += 1) {
        stepRocket(sim.arena, probe);
        const dx = me.tank.x - probe.x;
        const dy = me.tank.y - probe.y;
        if (dx * dx + dy * dy < near * near) {
          if (!soonest || i < soonest.i) soonest = { i, x: probe.x, y: probe.y, vx: probe.vx, vy: probe.vy };
          break;
        }
      }
    }
    return soonest;
  }

  function freeAhead(sim, x, y, dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    const tx = Math.floor(x + (dx / len) * 0.9);
    const ty = Math.floor(y + (dy / len) * 0.9);
    return !solidAt(sim.arena, tx, ty);
  }

  function think(sim) {
    const me = sim.players[slot];
    if (!me || !alive(me)) return IDLE;
    const t = sim.tick;
    const tank = me.tank;
    const arena = sim.arena;
    const foes = sim.players.filter((p) => p !== me && alive(p));
    if (!foes.length) return packInput(0, -1, false);

    if (t >= retargetAt || !foes.some((p) => p.slot === target)) {
      let best = null;
      let bestD = Infinity;
      for (const p of foes) {
        const d = Math.hypot(p.tank.x - tank.x, p.tank.y - tank.y) + (p.shield > 0 ? 6 : 0) + rng() * 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      target = best.slot;
      retargetAt = t + 90 + rng.int(120);
    }
    const foe = sim.players[target];
    const direct = Math.atan2(foe.tank.y - tank.y, foe.tank.x - tank.x);

    // ---------- Zielen und Schießen ----------
    if (t >= planAt) {
      planAt = t + 12 + rng.int(16);
      plan = sim.phase === PHASE.PLAY ? planShot(sim, me, foe, foes) : null;
      if (plan) plan.angle += (rng() - 0.5) * 0.12; // nicht ganz perfekt
    }
    const aimTo = plan ? plan.angle : direct;
    const lined = Math.abs(angleDiff(aimTo, tank.a)) < 0.06;
    // Nach jedem Schuss eine kleine Denkpause, sonst wären Bots zu treffsicher
    const fire = Boolean(plan) && lined && tank.cd <= 0 && t >= calmUntil;
    if (fire) calmUntil = t + 50 + rng.int(40);

    // ---------- Fahren ----------
    let dx = 0;
    let dy = 0;
    const danger = sim.phase === PHASE.PLAY ? threat(sim, me) : null;
    if (danger && (!dodge || t >= dodge.until)) {
      // quer zur Flugrichtung, weg von der Bahn
      const vl = Math.hypot(danger.vx, danger.vy) || 1;
      let px = -danger.vy / vl;
      let py = danger.vx / vl;
      const side = (tank.x - danger.x) * px + (tank.y - danger.y) * py;
      if (side < 0 || (side === 0 && rng() < 0.5)) {
        px = -px;
        py = -py;
      }
      if (!freeAhead(sim, tank.x, tank.y, px, py)) {
        px = -px;
        py = -py;
      }
      dodge = { dx: px, dy: py, until: t + 22 };
    }
    if (dodge && t < dodge.until) {
      dx = dodge.dx;
      dy = dodge.dy;
    } else if (stray && t < stray.until) {
      dx = stray.dx;
      dy = stray.dy;
    } else {
      const tx = Math.floor(tank.x);
      const ty = Math.floor(tank.y);
      const fx = Math.floor(foe.tank.x);
      const fy = Math.floor(foe.tank.y);
      const key = `${arena.index}:${fx}:${fy}`;
      if (key !== fieldKey || t - fieldAt > 45) {
        field = distanceField(arena, fx, fy);
        fieldKey = key;
        fieldAt = t;
      }
      const here = field[ty * arena.W + tx];
      const far = Math.hypot(foe.tank.x - tank.x, foe.tank.y - tank.y);
      if (t >= strafeAt) {
        strafeAt = t + 50 + rng.int(80);
        if (rng() < 0.45) strafe = -strafe;
      }
      if (here > 4 || (here > 2 && !plan) || far > 8) {
        // näher heran, über das Feld mit dem kleinsten Abstand
        let best = null;
        let bestD = here < 0 ? 1e9 : here;
        for (const [ox, oy] of NEIGHBORS) {
          const nx = tx + ox;
          const ny = ty + oy;
          if (solidAt(arena, nx, ny)) continue;
          if (ox && oy && (solidAt(arena, tx + ox, ty) || solidAt(arena, tx, ty + oy))) continue;
          const d = field[ny * arena.W + nx];
          if (d >= 0 && d < bestD) {
            bestD = d;
            best = [nx + 0.5, ny + 0.5];
          }
        }
        if (best) {
          dx = best[0] - tank.x;
          dy = best[1] - tank.y;
        }
      } else {
        // auf Abstand seitlich kreisen, mal hin, mal her
        dx = -Math.sin(direct) * strafe;
        dy = Math.cos(direct) * strafe;
        if (far < 3) {
          dx -= Math.cos(direct) * 0.8;
          dy -= Math.sin(direct) * 0.8;
        }
        if (!freeAhead(sim, tank.x, tank.y, dx, dy)) {
          strafe = -strafe;
          dx = -dx;
          dy = -dy;
        }
      }
    }

    // Hängt er fest, kurz in eine zufällige freie Richtung
    if (t - last.tick >= 40) {
      const moved = Math.hypot(tank.x - last.x, tank.y - last.y);
      if ((dx || dy) && moved < 0.15 && sim.phase === PHASE.PLAY) {
        const angle = rng() * Math.PI * 2;
        stray = { dx: Math.cos(angle), dy: Math.sin(angle), until: t + 30 };
      }
      last = { x: tank.x, y: tank.y, tick: t };
    }

    return packInput(moveIndex(dx, dy), aimIndex(aimTo), fire);
  }

  return { think };
}
