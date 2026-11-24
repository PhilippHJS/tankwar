// Bewegung von Panzern und Raketen. Läuft beim Gastgeber und genauso im
// eigenen Browser für die Vorhersage, deshalb ohne Zufall und ohne Uhr: Gleicher
// Stand und gleiche Eingabe ergeben denselben neuen Stand.

import { solidAt } from './arenas.js';
import { DT, TICK_RATE, TANK_R, ROCKET_R, BARREL } from './config.js';

const TAU = Math.PI * 2;

// ---------- Eingaben ----------
//
// Eine Eingabe ist eine ganze Zahl: Fahrtrichtung (0 steht, 1 bis 24 die
// Richtungen im Uhrzeigersinn ab rechts, alle 15 Grad, fein genug fürs Fahren
// mit der Maus), Feuerknopf und Zielrichtung des Turms (0 behält die Richtung,
// sonst Winkel in 1024 Stufen plus eins).

export const MOVE_DIRS = 24;
export const AIM_STEPS = 1024;
export const IDLE = 0;
export const MAX_INPUT = 31 | 32 | (AIM_STEPS << 6);

export const packInput = (move, aim, fire) => move | (fire ? 32 : 0) | ((aim < 0 ? 0 : aim + 1) << 6);
export const inputMove = (code) => code & 31;
export const inputFire = (code) => (code & 32) !== 0;
export const inputAim = (code) => (code >> 6) - 1; // -1: Turm bleibt, wie er ist
export const withoutFire = (code) => code & ~32;

export const wrap = (a) => {
  let out = a % TAU;
  if (out > Math.PI) out -= TAU;
  else if (out <= -Math.PI) out += TAU;
  return out;
};
export const angleDiff = (to, from) => wrap(to - from);
export const aimIndex = (angle) => ((Math.round((angle / TAU) * AIM_STEPS) % AIM_STEPS) + AIM_STEPS) % AIM_STEPS;
export const aimAngle = (index) => wrap((index / AIM_STEPS) * TAU);
export function moveIndex(dx, dy) {
  if (dx === 0 && dy === 0) return 0;
  const step = Math.round((Math.atan2(dy, dx) / TAU) * MOVE_DIRS);
  return 1 + (((step % MOVE_DIRS) + MOVE_DIRS) % MOVE_DIRS);
}
export const moveAngle = (move) => wrap(((move - 1) / MOVE_DIRS) * TAU);

export function turnToward(from, to, max) {
  const d = angleDiff(to, from);
  if (Math.abs(d) <= max) return wrap(to);
  return wrap(from + Math.sign(d) * max);
}

// ---------- Wände ----------

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Schiebt einen Kreis aus allen Wänden heraus. So gleitet ein Panzer, der
// schräg gegen eine Wand fährt, an ihr entlang.
export function pushOutOfWalls(arena, body, r) {
  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false;
    const x0 = Math.floor(body.x - r);
    const x1 = Math.floor(body.x + r);
    const y0 = Math.floor(body.y - r);
    const y1 = Math.floor(body.y + r);
    for (let ty = y0; ty <= y1; ty += 1) {
      for (let tx = x0; tx <= x1; tx += 1) {
        if (!solidAt(arena, tx, ty)) continue;
        const cx = clamp(body.x, tx, tx + 1);
        const cy = clamp(body.y, ty, ty + 1);
        const dx = body.x - cx;
        const dy = body.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          body.x += (dx / d) * (r - d);
          body.y += (dy / d) * (r - d);
        } else {
          // Mitte steckt in der Wand: zur nächsten Kante hinaus
          const left = body.x - tx;
          const right = tx + 1 - body.x;
          const up = body.y - ty;
          const down = ty + 1 - body.y;
          const least = Math.min(left, right, up, down);
          if (least === left) body.x = tx - r;
          else if (least === right) body.x = tx + 1 + r;
          else if (least === up) body.y = ty - r;
          else body.y = ty + 1 + r;
        }
        moved = true;
      }
    }
    if (!moved) return;
  }
}

export function circleInWall(arena, x, y, r) {
  const x0 = Math.floor(x - r);
  const x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r);
  const y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      if (!solidAt(arena, tx, ty)) continue;
      const dx = x - clamp(x, tx, tx + 1);
      const dy = y - clamp(y, ty, ty + 1);
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

// ---------- Panzer ----------

// x, y: Mitte; h: Richtung der Wanne; a: Richtung des Turms; v: Tempo entlang
// der Wanne (negativ heißt rückwärts); cd: Schritte bis zum nächsten Schuss.
// Je nach Waffe: ammo Schuss im Magazin; ch Abstand des Zielkreises vom
// Startpunkt (0: lädt nicht auf); ox, oy, ca: Startpunkt und Richtung, beim
// Drücken festgehalten; mana 0 bis 1; zt Schritte bis zum nächsten Blitz; rest
// Schritte ohne Blitzen; lock: Mana war leer, erst loslassen; on: blitzt gerade.
export function newTank(x, y, h, vehicle = null) {
  const weapon = vehicle ? vehicle.weapon : {};
  return { x, y, h, a: h, v: 0, cd: 0, ammo: weapon.magazine || 0, ch: 0, ox: x, oy: y, ca: h, mana: 1, zt: 0, rest: 0, lock: 0, on: 0 };
}
const TANK_KEYS = ['x', 'y', 'h', 'a', 'v', 'cd', 'ammo', 'ch', 'ox', 'oy', 'ca', 'mana', 'zt', 'rest', 'lock', 'on'];
export function copyTank(src, dst = {}) {
  for (const key of TANK_KEYS) dst[key] = src[key];
  return dst;
}

// Wann ein Panzer was darf: im Countdown nur zielen, im Spiel alles, nach
// Rundenende noch fahren, aber nicht mehr schießen.
export const MODE = { AIM: 0, PLAY: 1, CRUISE: 2 };

// Ein Schritt. `others`: andere Panzer, an denen dieser anstößt.
// Gibt zurück, ob in diesem Schritt geschossen wurde.
export function stepTank(arena, tank, code, vehicle, mode, others = []) {
  // Der Turm zeigt sofort in die gewünschte Richtung, ohne Trägheit. Lädt der
  // Böller auf, lässt er sich nicht drehen (siehe unten).
  const aim = inputAim(code);
  if (aim >= 0 && !(tank.ch > 0)) tank.a = aimAngle(aim);

  // Fahren: Die Wanne dreht sich zur gewünschten Richtung. Liegt die eher hinter
  // dem Panzer, fährt er rückwärts, statt umständlich zu wenden.
  const move = mode === MODE.AIM ? 0 : inputMove(code);
  let target = 0;
  if (move) {
    const want = moveAngle(move);
    const ahead = Math.abs(angleDiff(want, tank.h));
    const behind = Math.abs(angleDiff(want + Math.PI, tank.h));
    let reverse;
    if (tank.v > 0.05) reverse = behind + 0.5 < ahead;
    else if (tank.v < -0.05) reverse = !(ahead + 0.5 < behind);
    else reverse = behind < ahead;
    const heading = reverse ? want + Math.PI : want;
    tank.h = turnToward(tank.h, heading, vehicle.turn * DT);
    const off = Math.abs(angleDiff(heading, tank.h));
    target = (reverse ? -1 : 1) * vehicle.speed * Math.max(0, Math.cos(off * 1.3));
  }
  const speedingUp = target !== 0 && Math.sign(target) !== -Math.sign(tank.v) && Math.abs(target) > Math.abs(tank.v);
  const rate = (speedingUp ? vehicle.accel : vehicle.brake) * DT;
  if (tank.v < target) tank.v = Math.min(target, tank.v + rate);
  else if (tank.v > target) tank.v = Math.max(target, tank.v - rate);

  if (tank.v !== 0) {
    tank.x += Math.cos(tank.h) * tank.v * DT;
    tank.y += Math.sin(tank.h) * tank.v * DT;
    for (const other of others) {
      const dx = tank.x - other.x;
      const dy = tank.y - other.y;
      const d2 = dx * dx + dy * dy;
      const min = TANK_R * 2;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      if (d > 1e-9) {
        tank.x += (dx / d) * (min - d);
        tank.y += (dy / d) * (min - d);
      }
    }
    pushOutOfWalls(arena, tank, TANK_R);
  }

  const shot = useWeapon(arena, tank, vehicle.weapon, mode === MODE.PLAY, inputFire(code));
  // Beim Aufladen zeigt der Turm von selbst immer auf den Zielkreis, auch
  // wenn der Panzer dabei fährt
  if (tank.ch > 0) {
    const c = blastPoint(arena, tank, tank.ch);
    if (Math.hypot(c.x - tank.x, c.y - tank.y) > 0.05) tank.a = Math.atan2(c.y - tank.y, c.x - tank.x);
  }
  return shot;
}

const ticks = (seconds) => Math.round(seconds * TICK_RATE);

// Abzug. Gibt 0 zurück, wenn nichts passiert, sonst einen Schuss: bei der
// Bombe den Abstand des Zielkreises, bei allen anderen 1.
function useWeapon(arena, tank, w, armed, fire) {
  if (tank.cd > 0) tank.cd -= 1;
  if (w.kind === 'rocket') {
    if (!armed || !fire || tank.cd > 0) return 0;
    tank.cd = ticks(w.cooldown);
    return 1;
  }
  if (w.kind === 'gun') {
    if (tank.cd <= 0 && tank.ammo <= 0) tank.ammo = w.magazine; // fertig nachgeladen
    if (!armed || !fire || tank.cd > 0 || tank.ammo <= 0) return 0;
    tank.ammo -= 1;
    tank.cd = tank.ammo > 0 ? ticks(w.interval) : ticks(w.reload);
    return 1;
  }
  if (w.kind === 'mortar') {
    if (!armed) {
      tank.ch = 0;
      return 0;
    }
    if (fire) {
      // Aufladen: Beim Drücken werden Startpunkt und Richtung festgehalten.
      // Von dort wandert der Zielkreis geradeaus hinaus, höchstens bis zum
      // Rand der Arena. Wohin der Panzer danach fährt, ändert daran nichts.
      if (tank.cd > 0) return 0;
      if (tank.ch <= 0) {
        tank.ox = tank.x;
        tank.oy = tank.y;
        tank.ca = tank.a;
        tank.ch = BARREL;
        return 0;
      }
      const next = Math.min(w.range, tank.ch + w.charge * DT);
      const px = tank.ox + Math.cos(tank.ca) * next;
      const py = tank.oy + Math.sin(tank.ca) * next;
      if (px >= 1 && px <= arena.W - 1 && py >= 1 && py <= arena.H - 1) tank.ch = next;
      return 0;
    }
    if (tank.ch <= 0) return 0;
    const dist = tank.ch;
    tank.ch = 0;
    tank.cd = ticks(w.cooldown);
    return dist;
  }
  if (w.kind === 'zap') {
    if (!fire) tank.lock = 0;
    const zapping = armed && fire && !tank.lock && tank.mana > 0;
    tank.on = zapping ? 1 : 0;
    if (!zapping) {
      tank.zt = 0;
      tank.rest += 1;
      if (tank.rest > ticks(w.rest)) tank.mana = Math.min(1, tank.mana + 1 / ticks(w.refill));
      return 0;
    }
    tank.rest = 0;
    tank.mana = Math.max(0, tank.mana - 1 / ticks(w.drain));
    if (tank.mana <= 0) tank.lock = 1;
    if (tank.zt > 0) {
      tank.zt -= 1;
      return 0;
    }
    tank.zt = ticks(w.pulse) - 1;
    return 1;
  }
  return 0;
}

// Wie weit ein Strahl von x, y in Richtung dx, dy (Länge 1) kommt, bis er auf
// eine Wand trifft, höchstens `max`.
export function castRay(arena, x, y, dx, dy, max) {
  const step = 0.04;
  for (let d = step; d <= max; d += step) {
    if (solidAt(arena, Math.floor(x + dx * d), Math.floor(y + dy * d))) return d - step;
  }
  return max;
}

// Schussbahn der Pistole: von der Mündung bis zur Wand oder zur Reichweite.
// Liegt die Mündung schon in der Wand, endet der Schuss sofort.
export function gunRay(arena, tank, range) {
  const dx = Math.cos(tank.a);
  const dy = Math.sin(tank.a);
  const toMuzzle = castRay(arena, tank.x, tank.y, dx, dy, BARREL);
  const sx = tank.x + dx * toMuzzle;
  const sy = tank.y + dy * toMuzzle;
  const len = toMuzzle < BARREL - 0.05 ? 0 : castRay(arena, sx, sy, dx, dy, range);
  return { sx, sy, dx, dy, len };
}

// Wo ein Strahl einen Kreis zuerst trifft, Abstand vom Start, sonst Infinity
export function rayHitsCircle(sx, sy, dx, dy, len, cx, cy, r) {
  const ox = cx - sx;
  const oy = cy - sy;
  const along = ox * dx + oy * dy;
  const side2 = ox * ox + oy * oy - along * along;
  if (side2 > r * r) return Infinity;
  const t = along - Math.sqrt(r * r - side2);
  const hit = t < 0 ? (ox * ox + oy * oy <= r * r ? 0 : Infinity) : t;
  return hit <= len ? hit : Infinity;
}

// Mitte des Zielkreises einer Bombe: `dist` Felder vom Startpunkt in die
// festgehaltene Richtung, im Feld
export function blastPoint(arena, tank, dist) {
  const x = Math.min(arena.W - 1, Math.max(1, tank.ox + Math.cos(tank.ca) * dist));
  const y = Math.min(arena.H - 1, Math.max(1, tank.oy + Math.sin(tank.ca) * dist));
  return { x, y };
}

// Schaden einer Bombe für einen Panzer in `d` Feldern Abstand zur Mitte, 0 außerhalb
export function blastDamage(w, d) {
  const reach = Math.max(0, d - TANK_R * 0.5);
  if (reach > w.radius) return 0;
  return Math.round(w.edge + (w.damage - w.edge) * (1 - reach / w.radius));
}

// Sieht der Zitteraal einen Gegner, ohne Wand dazwischen?
export function inZapReach(arena, tank, w, x, y) {
  const d = Math.hypot(x - tank.x, y - tank.y);
  if (d > w.radius + TANK_R * 0.5) return false;
  if (d < 1e-6) return true;
  return castRay(arena, tank.x, tank.y, (x - tank.x) / d, (y - tank.y) / d, d) >= d - TANK_R;
}

// ---------- Raketen ----------

// Fliegt `dist` Felder weit und prallt dabei an Wänden ab.
function travel(arena, r, dist) {
  const speed = Math.hypot(r.vx, r.vy);
  if (speed === 0 || dist <= 0) return;
  const n = Math.max(1, Math.ceil(dist / 0.06));
  const f = dist / speed / n;
  for (let i = 0; i < n; i += 1) {
    r.x += r.vx * f;
    if (circleInWall(arena, r.x, r.y, ROCKET_R)) {
      r.x -= r.vx * f;
      r.vx = -r.vx;
      r.b += 1;
    }
    r.y += r.vy * f;
    if (circleInWall(arena, r.x, r.y, ROCKET_R)) {
      r.y -= r.vy * f;
      r.vy = -r.vy;
      r.b += 1;
    }
  }
}

// Neue Rakete an der Mündung. Sie startet in der Mitte des Panzers und fliegt
// den Lauf entlang, damit sie auch direkt an einer Wand richtig abprallt.
export function launchRocket(arena, tank, weapon) {
  const r = {
    x: tank.x,
    y: tank.y,
    vx: Math.cos(tank.a) * weapon.speed,
    vy: Math.sin(tank.a) * weapon.speed,
    life: Math.round(weapon.life * TICK_RATE),
    b: 0, // so oft schon abgeprallt
  };
  travel(arena, r, BARREL);
  return r;
}

export function stepRocket(arena, r) {
  travel(arena, r, Math.hypot(r.vx, r.vy) * DT);
  r.life -= 1;
}

export const copyRocket = (src, dst = {}) => Object.assign(dst, { x: src.x, y: src.y, vx: src.vx, vy: src.vy, life: src.life, b: src.b });

// Flugbahn für die Ziellinie: Punkte von der Mündung über die Abpraller.
export function traceRocket(arena, tank, weapon, bounces = 1, tail = 1.4) {
  const r = launchRocket(arena, { x: tank.x, y: tank.y, a: tank.a }, weapon);
  const points = [{ x: tank.x + Math.cos(tank.a) * BARREL, y: tank.y + Math.sin(tank.a) * BARREL }];
  const speed = Math.hypot(r.vx, r.vy);
  let left = tail; // so weit geht die Linie nach dem letzten Abpraller noch
  for (let i = 0; i < r.life; i += 1) {
    const before = r.b;
    stepRocket(arena, r);
    if (r.b !== before) points.push({ x: r.x, y: r.y });
    if (r.b >= bounces) {
      left -= speed * DT;
      if (left <= 0) break;
    }
  }
  points.push({ x: r.x, y: r.y });
  return points;
}

// ---------- Geister auf dem Rand ----------
//
// Der Rand ist der Ring der äußeren Wandfelder. Ein Geist steht an einer
// Stelle `s` auf diesem Ring (0 links oben, dann im Uhrzeigersinn) und wirft
// nach innen, quer zur Wand, an den Ecken schräg.

export const rimLength = (arena) => 2 * (arena.W - 1) + 2 * (arena.H - 1);
const wrapRim = (arena, s) => {
  const L = rimLength(arena);
  return ((s % L) + L) % L;
};

export function rimPoint(arena, s) {
  const W = arena.W - 1;
  const H = arena.H - 1;
  const t = wrapRim(arena, s);
  let x;
  let y;
  if (t < W) {
    x = 0.5 + t;
    y = 0.5;
  } else if (t < W + H) {
    x = W + 0.5;
    y = 0.5 + (t - W);
  } else if (t < 2 * W + H) {
    x = W + 0.5 - (t - W - H);
    y = H + 0.5;
  } else {
    x = 0.5;
    y = H + 0.5 - (t - 2 * W - H);
  }
  let nx = 0;
  let ny = 0;
  if (y <= 0.5 + 1e-6) ny = 1;
  if (y >= H + 0.5 - 1e-6) ny = -1;
  if (x <= 0.5 + 1e-6) nx = 1;
  if (x >= W + 0.5 - 1e-6) nx = -1;
  const len = Math.hypot(nx, ny) || 1;
  return { x, y, nx: nx / len, ny: ny / len };
}

// Die Stelle auf dem Rand, die einem Punkt am nächsten ist
export function rimNearest(arena, x, y) {
  const W = arena.W - 1;
  const H = arena.H - 1;
  const cx = Math.min(W + 0.5, Math.max(0.5, x));
  const cy = Math.min(H + 0.5, Math.max(0.5, y));
  const options = [
    { d: cy - 0.5, s: cx - 0.5 },
    { d: W + 0.5 - cx, s: W + (cy - 0.5) },
    { d: H + 0.5 - cy, s: W + H + (W + 0.5 - cx) },
    { d: cx - 0.5, s: 2 * W + H + (H + 0.5 - cy) },
  ];
  options.sort((a, b) => a.d - b.d);
  return wrapRim(arena, options[0].s);
}

// s: Stelle auf dem Rand; cd: Schritte bis zum nächsten Wurf; ch: Wurfweite beim Halten
export const newGhost = (s = 0) => ({ s, cd: 0, ch: 0 });
export const copyGhost = (src, dst = {}) => Object.assign(dst, { s: src.s, cd: src.cd, ch: src.ch });

// Wohin die Bombe fliegt: von der Stelle auf dem Rand nach innen, im Feld
export function ghostTarget(arena, ghost, dist) {
  const p = rimPoint(arena, ghost.s);
  return {
    x: Math.min(arena.W - 1, Math.max(1, p.x + p.nx * dist)),
    y: Math.min(arena.H - 1, Math.max(1, p.y + p.ny * dist)),
  };
}

// Ein Schritt eines Geistes. Gibt die Wurfweite zurück, wenn geworfen wird, sonst 0.
export function stepGhost(arena, ghost, code, params, mode) {
  const move = mode === MODE.AIM ? 0 : inputMove(code);
  if (move) {
    // In die Richtung auf dem Ring, die am besten zur Taste passt. Das löst
    // auch die Ecken: Unten gedrückt wird an der Ecke rechts oben abgebogen.
    const want = moveAngle(move);
    const dx = Math.cos(want);
    const dy = Math.sin(want);
    const step = params.speed * DT;
    const here = rimPoint(arena, ghost.s);
    const ahead = rimPoint(arena, ghost.s + step);
    const back = rimPoint(arena, ghost.s - step);
    const da = (ahead.x - here.x) * dx + (ahead.y - here.y) * dy;
    const db = (back.x - here.x) * dx + (back.y - here.y) * dy;
    if (Math.max(da, db) > step * 0.2) {
      const dir = da >= db ? 1 : -1;
      let next = ghost.s + dir * step;
      // Über eine Ecke hinaus nur, wenn die Taste auch in die neue Richtung zeigt.
      // Sonst bleibt der Geist genau in der Ecke stehen.
      const W = arena.W - 1;
      const H = arena.H - 1;
      const L = rimLength(arena);
      for (const corner of [0, W, W + H, 2 * W + H, L]) {
        const crossed = dir > 0 ? ghost.s < corner - 1e-9 && next > corner : ghost.s > corner + 1e-9 && next < corner;
        if (!crossed) continue;
        const c = rimPoint(arena, corner);
        const beyond = rimPoint(arena, corner + dir * 0.1);
        if ((beyond.x - c.x) * dx + (beyond.y - c.y) * dy < 0.03) next = corner;
        break;
      }
      ghost.s = wrapRim(arena, next);
    }
  }
  if (ghost.cd > 0) ghost.cd -= 1;
  if (mode !== MODE.PLAY) {
    ghost.ch = 0;
    return 0;
  }
  if (inputFire(code)) {
    if (ghost.cd <= 0) ghost.ch = ghost.ch > 0 ? Math.min(params.range, ghost.ch + params.charge * DT) : params.min;
    return 0;
  }
  if (ghost.ch <= 0) return 0;
  const dist = ghost.ch;
  ghost.ch = 0;
  ghost.cd = Math.round(params.cooldown * TICK_RATE);
  return dist;
}

// Schaden einer Geisterbombe in `d` Feldern Abstand zur Mitte, 0 außerhalb
export function ghostDamage(params, d) {
  const reach = Math.max(0, d - TANK_R * 0.5);
  if (reach > params.radius) return 0;
  return Math.round(params.edge + (params.damage - params.edge) * (1 - reach / params.radius));
}
