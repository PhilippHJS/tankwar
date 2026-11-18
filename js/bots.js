// Bots für freie Plätze und als Vertretung, wenn jemand die Verbindung
// verliert. Laufen nur beim Gastgeber und liefern dieselben Eingaben wie ein
// Mensch.
//
// Ein Bot sucht sich den nächsten Gegner, weicht Raketen aus, die auf ihn
// zufliegen, und fährt über die Felder auf seinen Gegner zu oder hält Abstand.
// Wie er zielt und schießt, hängt von seiner Waffe ab:
//   Rakete  rechnet ein paar Schussrichtungen samt Abprallern durch
//   Pistole schießt bei freier Sicht und in Reichweite
//   Bombe   lädt auf, bis der Zielkreis beim Gegner ist, und hält Abstand
//   Blitze  fährt ran und blitzt, solange Mana da ist
// Ein bisschen Ungenauigkeit ist Absicht.

import { solidAt } from './arenas.js';
import { makeRng } from './rng.js';
import {
  packInput, moveIndex, aimIndex, launchRocket, stepRocket, copyRocket, angleDiff, castRay, inZapReach, blastPoint, rimPoint, rimLength, IDLE,
} from './physics.js';
import { alive, vehicleOf, ghostActive, ghostParams, PHASE, EVENT } from './sim.js';
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

// Freie Sicht zwischen zwei Punkten?
function clearLine(arena, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay);
  if (d < 1e-6) return true;
  return castRay(arena, ax, ay, (bx - ax) / d, (by - ay) / d, d) >= d - TANK_R;
}

export function createBot(slot, seed) {
  const rng = makeRng((seed ^ Math.imul(slot + 1, 2654435761)) >>> 0);
  let target = -1;
  let retargetAt = 0;
  let planAt = 0;
  let plan = null; // Rakete: { angle, score }
  let noise = 0; // Zielfehler, wird alle paar Schritte neu gewürfelt
  let field = null;
  let fieldKey = '';
  let fieldAt = -1e9;
  let dodge = null; // { dx, dy, until }
  let stray = null; // { dx, dy, until }: kurz woandershin, wenn er festhängt
  let strafe = rng() < 0.5 ? 1 : -1;
  let strafeAt = 0;
  let last = { x: 0, y: 0, tick: 0 };
  let heardEvent = 0; // Ereignisse bis hierhin schon angesehen
  let calmUntil = 0; // Bombe: kleine Denkpause nach jedem Wurf
  const probe = {};

  // Trifft eine Rakete in diese Richtung? Liefert die Schritte bis zum Treffer.
  function trial(sim, me, angle, foes) {
    const weapon = vehicleOf(sim, me).weapon;
    const r = launchRocket(sim.arena, { x: me.tank.x, y: me.tank.y, a: angle }, weapon);
    const reach = TANK_R + ROCKET_R - 0.06;
    const limit = Math.min(r.life, 150);
    for (let i = 1; i <= limit; i += 1) {
      stepRocket(sim.arena, r);
      for (const foe of foes) {
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

  function planRocket(sim, me, foe, foes) {
    const direct = Math.atan2(foe.tank.y - me.tank.y, foe.tank.x - me.tank.x);
    const tries = [direct, direct + 0.07, direct - 0.07];
    const spread = 26;
    const offset = rng() * ((Math.PI * 2) / spread);
    for (let i = 0; i < spread; i += 1) tries.push(offset + (i / spread) * Math.PI * 2);
    let best = null;
    const turretRate = vehicleOf(sim, me).turret;
    for (const angle of tries) {
      const steps = trial(sim, me, angle, foes);
      if (!Number.isFinite(steps)) continue;
      const turning = (Math.abs(angleDiff(angle, me.tank.a)) / turretRate) * 60;
      const score = steps + turning * 0.8;
      if (!best || score < best.score) best = { angle, score };
    }
    return best && best.score < 190 ? best : null;
  }

  // Fliegt eine gegnerische Rakete bald in diesen Panzer, oder lädt jemand
  // eine Bombe auf, deren Zielkreis ihn erwischen würde? Bots sehen nicht alles
  // und reagieren nicht sofort, sonst wären sie kaum zu treffen.
  function threat(sim, me) {
    for (const p of sim.players) {
      if (p === me || !alive(p) || p.tank.ch <= 0) continue;
      const w = vehicleOf(sim, p).weapon;
      const { x: cx, y: cy } = blastPoint(sim.arena, p.tank, p.tank.ch);
      if (Math.hypot(me.tank.x - cx, me.tank.y - cy) < w.radius + 1.2 && rng() < 0.9) {
        // weg von der Mitte des Kreises: wie eine Rakete, die quer dazu fliegt
        return { i: 0, x: cx, y: cy, vx: -(me.tank.y - cy), vy: me.tank.x - cx };
      }
    }
    let soonest = null;
    const near = TANK_R + ROCKET_R + 0.3;
    for (const r of sim.rockets) {
      if (r.owner === me.slot) continue;
      if (Math.hypot(r.x - me.tank.x, r.y - me.tank.y) > 7) continue;
      copyRocket(r, probe);
      for (let i = 1; i <= 40 && probe.life > 0; i += 1) {
        stepRocket(sim.arena, probe);
        const dx = me.tank.x - probe.x;
        const dy = me.tank.y - probe.y;
        if (dx * dx + dy * dy < near * near) {
          const seen = i > 8 && rng() < 0.7;
          if (seen && (!soonest || i < soonest.i)) soonest = { i, x: probe.x, y: probe.y, vx: probe.vx, vy: probe.vy };
          break;
        }
      }
    }
    return soonest;
  }

  function freeAhead(sim, x, y, dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    return !solidAt(sim.arena, Math.floor(x + (dx / len) * 0.9), Math.floor(y + (dy / len) * 0.9));
  }

  // Nächstes Feld über die Abstände zum Gegner: näher heran oder weiter weg
  function viaField(sim, tank, closer) {
    const arena = sim.arena;
    const tx = Math.floor(tank.x);
    const ty = Math.floor(tank.y);
    const here = field[ty * arena.W + tx];
    let best = null;
    let bestD = here < 0 ? (closer ? 1e9 : -1) : here;
    for (const [ox, oy] of NEIGHBORS) {
      const nx = tx + ox;
      const ny = ty + oy;
      if (solidAt(arena, nx, ny)) continue;
      if (ox && oy && (solidAt(arena, tx + ox, ty) || solidAt(arena, tx, ty + oy))) continue;
      const d = field[ny * arena.W + nx];
      if (d < 0) continue;
      if (closer ? d < bestD : d > bestD) {
        bestD = d;
        best = [nx + 0.5, ny + 0.5];
      }
    }
    return best ? [best[0] - tank.x, best[1] - tank.y] : [0, 0];
  }

  // Als Geist: an die Stelle auf dem Rand fahren, von der aus der schwächste
  // Gegner quer zur Wand zu treffen ist, aufladen und werfen
  let ghostNoise = 0;
  function haunt(sim, me) {
    const arena = sim.arena;
    const params = ghostParams(sim);
    const foes = sim.players.filter((p) => p !== me && alive(p));
    if (!foes.length || sim.phase !== PHASE.PLAY) return IDLE;
    const foe = foes.reduce((a, b) => (b.hp + (b.shield ? 200 : 0) < a.hp + (a.shield ? 200 : 0) ? b : a));
    const W = arena.W - 1;
    const H = arena.H - 1;
    const lead = params.flight + params.fuse + 0.4;
    const fx = foe.tank.x + Math.cos(foe.tank.h) * foe.tank.v * lead;
    const fy = foe.tank.y + Math.sin(foe.tank.h) * foe.tank.v * lead;
    const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const L = rimLength(arena);
    const options = [
      { s: clampTo(fx - 0.5, 0, W), d: fy - 0.5 },
      { s: W + clampTo(fy - 0.5, 0, H), d: W + 0.5 - fx },
      { s: W + H + clampTo(W + 0.5 - fx, 0, W), d: H + 0.5 - fy },
      { s: 2 * W + H + clampTo(H + 0.5 - fy, 0, H), d: fx - 0.5 },
    ].filter((o) => o.d >= params.min && o.d <= params.range);
    if (!options.length) return IDLE;
    const along = (to) => {
      let d = to - me.ghost.s;
      if (d > L / 2) d -= L;
      if (d < -L / 2) d += L;
      return d;
    };
    const best = options.reduce((a, b) => (Math.abs(along(b.s)) + b.d * 0.4 < Math.abs(along(a.s)) + a.d * 0.4 ? b : a));
    const gap = along(best.s);
    let dx = 0;
    let dy = 0;
    if (Math.abs(gap) > 0.25) {
      const here = rimPoint(arena, me.ghost.s);
      const next = rimPoint(arena, me.ghost.s + Math.sign(gap) * 0.2);
      dx = next.x - here.x;
      dy = next.y - here.y;
    }
    // aufladen, bis die Wurfweite passt, dann loslassen
    if (me.ghost.ch === 0) ghostNoise = (rng() - 0.5) * 1.4;
    const want = best.d + ghostNoise;
    const fire = me.ghost.cd <= 0 && Math.abs(gap) < 0.6 && (me.ghost.ch === 0 ? Math.abs(gap) < 0.3 : me.ghost.ch < want);
    return packInput(moveIndex(dx, dy), -1, fire);
  }

  function think(sim) {
    const me = sim.players[slot];
    if (me && ghostActive(sim, me)) return haunt(sim, me);
    if (!me || !alive(me)) return IDLE;
    const t = sim.tick;
    const tank = me.tank;
    const arena = sim.arena;
    const w = vehicleOf(sim, me).weapon;
    const playing = sim.phase === PHASE.PLAY;
    const foes = sim.players.filter((p) => p !== me && alive(p));
    if (!foes.length) return packInput(0, -1, false);

    // Wer ihn gerade getroffen hat, wird zum Ziel
    for (const e of sim.events) {
      if (e.id <= heardEvent) continue;
      heardEvent = e.id;
      const blast = e.kind === EVENT.BLAST && Math.hypot(e.x - tank.x, e.y - tank.y) < e.item / 100 + TANK_R;
      const hit = (e.kind === EVENT.HIT || e.kind === EVENT.ZAP) && e.of === slot;
      if ((blast || hit) && e.by !== slot && foes.some((p) => p.slot === e.by) && rng() < 0.8) {
        target = e.by;
        retargetAt = t + 150 + rng.int(90);
      }
    }
    if (t >= retargetAt || !foes.some((p) => p.slot === target)) {
      let best = null;
      let bestD = Infinity;
      for (const p of foes) {
        // Wer mit Bomben aus der Ferne wirft, wird bevorzugt gejagt, wie es Menschen auch tun
        const lobber = vehicleOf(sim, p).weapon.kind === 'mortar' ? 4 : 0;
        const d = Math.hypot(p.tank.x - tank.x, p.tank.y - tank.y) + (p.shield > 0 ? 6 : 0) + rng() * 2 - lobber;
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
    const far = Math.hypot(foe.tank.x - tank.x, foe.tank.y - tank.y);
    if (t >= planAt) {
      planAt = t + 12 + rng.int(16);
      noise = rng() - 0.5;
      plan = w.kind === 'rocket' && playing ? planRocket(sim, me, foe, foes) : null;
    }

    // ---------- Zielen und Schießen, je nach Waffe ----------
    // wish: 'near' heranfahren, 'keep' Abstand halten und kreisen, 'away' weg
    let aimTo = direct;
    let fire = false;
    let wish = 'keep';
    if (w.kind === 'rocket') {
      if (plan) aimTo = plan.angle + noise * 0.12;
      const lined = Math.abs(angleDiff(aimTo, tank.a)) < 0.06;
      fire = Boolean(plan) && lined && tank.cd <= 0;
      wish = far > 8 || !plan ? 'near' : 'keep';
    } else if (w.kind === 'gun') {
      aimTo = direct + noise * 0.26;
      const sight = clearLine(arena, tank.x, tank.y, foe.tank.x, foe.tank.y);
      const lined = Math.abs(angleDiff(aimTo, tank.a)) < 0.05;
      fire = playing && sight && lined && far < w.range - 0.3;
      wish = !sight || far > w.range - 1.5 ? 'near' : far < 3 ? 'away' : 'keep';
    } else if (w.kind === 'mortar') {
      // Dorthin, wo der Gegner gleich sein wird
      const lead = 0.4 + noise * 0.3;
      const lx = foe.tank.x + Math.cos(foe.tank.h) * foe.tank.v * lead;
      const ly = foe.tank.y + Math.sin(foe.tank.h) * foe.tank.v * lead;
      const safe = w.radius + TANK_R + 0.6;
      if (tank.ch > 0) {
        // Richtung steht fest: loslassen, wenn der Kreis auf Höhe des Gegners
        // ist, aber nie zu nah am eigenen Panzer
        const along = (lx - tank.ox) * Math.cos(tank.ca) + (ly - tank.oy) * Math.sin(tank.ca) + noise * 1.6;
        const c = blastPoint(arena, tank, tank.ch);
        const near = Math.hypot(c.x - tank.x, c.y - tank.y) < safe;
        fire = tank.ch < Math.min(w.range, along) || near;
        if (!fire) calmUntil = t + 40 + rng.int(80);
      } else {
        aimTo = Math.atan2(ly - tank.y, lx - tank.x) + noise * 0.2;
        const lined = Math.abs(angleDiff(aimTo, tank.a)) < 0.08;
        const reach = Math.hypot(lx - tank.x, ly - tank.y);
        fire = playing && tank.cd <= 0 && t >= calmUntil && lined && reach > safe && reach < w.range + 0.5;
      }
      wish = far < 3 ? 'away' : far > 7 ? 'near' : 'keep';
    } else if (w.kind === 'zap') {
      const reach = foes.some((p) => inZapReach(arena, tank, w, p.tank.x, p.tank.y));
      fire = playing && reach && !tank.lock && tank.mana > 0;
      // leer gelaufen: kurz Abstand nehmen, bis wieder Mana da ist
      wish = tank.lock || tank.mana < 0.25 ? (far < 4 ? 'away' : 'keep') : 'near';
    }

    // ---------- Fahren ----------
    let dx = 0;
    let dy = 0;
    const danger = playing && (t % 6 === slot || sim.players.some((p) => p.tank.ch > 0)) ? threat(sim, me) : null;
    if (danger && (!dodge || t >= dodge.until)) {
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
      const fx = Math.floor(foe.tank.x);
      const fy = Math.floor(foe.tank.y);
      const key = `${arena.index}:${fx}:${fy}`;
      if (key !== fieldKey || t - fieldAt > 45) {
        field = distanceField(arena, fx, fy);
        fieldKey = key;
        fieldAt = t;
      }
      if (t >= strafeAt) {
        strafeAt = t + 50 + rng.int(80);
        if (rng() < 0.45) strafe = -strafe;
      }
      const close = w.kind === 'zap' ? 1.2 : 2;
      if (wish === 'near' && far > close) [dx, dy] = viaField(sim, tank, true);
      else if (wish === 'away') [dx, dy] = viaField(sim, tank, false);
      else {
        // seitlich kreisen, mal hin, mal her
        dx = -Math.sin(direct) * strafe;
        dy = Math.cos(direct) * strafe;
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
      if ((dx || dy) && moved < 0.15 && playing) {
        const angle = rng() * Math.PI * 2;
        stray = { dx: Math.cos(angle), dy: Math.sin(angle), until: t + 30 };
      }
      last = { x: tank.x, y: tank.y, tick: t };
    }

    return packInput(moveIndex(dx, dy), aimIndex(aimTo), fire);
  }

  return { think };
}
