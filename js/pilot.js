// Steuerung mit der Maus, wie in LoL oder Dota: Rechtsklick fährt dorthin,
// um Wände herum. Der Turm zeigt immer sofort zur Maus, Q ist der Abzug.
//
// Am Spiel selbst ändert das nichts: Daraus werden in jedem Bild dieselben
// Eingaben, die auch Tastatur und Gamepad liefern (Fahrtrichtung, Zielrichtung
// des Turms, Feuerknopf).
//
//   Rakete, Pistole  Q schießt zur Maus, gehalten feuert es weiter
//   Bombe            Q halten lädt auf, Richtung und Startpunkt stehen beim
//                    Drücken fest; loslassen sprengt dort, wo der Zielkreis ist
//   Blitze           solange Q gedrückt ist
//   Geist            Rechtsklick fährt am Rand zur nächsten Stelle, Q halten
//                    wirft weiter, loslassen wirft

import { solidAt } from './arenas.js';
import { moveIndex, moveAngle, angleDiff, circleInWall, pushOutOfWalls, rimNearest, rimPoint, rimLength, MOVE_DIRS } from './physics.js';
import { TANK_R, DT } from './config.js';

const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const STUCK_MS = 600;

// Freie Bahn für den Panzer von a nach b?
export function clearPath(arena, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(d / 0.15));
  for (let i = 1; i <= n; i += 1) {
    const f = i / n;
    if (circleInWall(arena, ax + (bx - ax) * f, ay + (by - ay) * f, TANK_R - 0.04)) return false;
  }
  return true;
}

// Weg über die Felder vom Panzer zum Ziel. Liegt das Ziel in einer Wand oder
// ist es nicht zu erreichen, geht es zum nächsten erreichbaren Feld. Liefert
// Wegpunkte (Feldmitten), der letzte ist das Ziel selbst.
export function findPath(arena, fx, fy, gx, gy) {
  const W = arena.W;
  const start = Math.floor(fy) * W + Math.floor(fx);
  const prev = new Int32Array(W * arena.H).fill(-2);
  prev[start] = -1;
  const queue = [start];
  let best = start;
  let bestD = Infinity;
  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head];
    const x = cell % W;
    const y = (cell - x) / W;
    const d = Math.hypot(x + 0.5 - gx, y + 0.5 - gy);
    if (d < bestD) {
      bestD = d;
      best = cell;
    }
    for (const [ox, oy] of NEIGHBORS) {
      const nx = x + ox;
      const ny = y + oy;
      if (solidAt(arena, nx, ny)) continue;
      // schräg nur, wenn nicht über eine Ecke geschnitten wird
      if (ox && oy && (solidAt(arena, x + ox, y) || solidAt(arena, x, y + oy))) continue;
      const next = ny * W + nx;
      if (prev[next] !== -2) continue;
      prev[next] = cell;
      queue.push(next);
    }
  }
  const points = [];
  for (let cell = best; cell !== start && cell >= 0; cell = prev[cell]) {
    const x = cell % W;
    points.unshift({ x: x + 0.5, y: (cell - x) / W + 0.5 });
  }
  // Ins angeklickte Feld genau an die Stelle, nur so weit, dass der Panzer hinpasst
  const end = { x: gx, y: gy };
  if (Math.floor(gx) === best % W && Math.floor(gy) === Math.floor(best / W)) pushOutOfWalls(arena, end, TANK_R);
  else {
    end.x = (best % W) + 0.5;
    end.y = Math.floor(best / W) + 0.5;
  }
  if (points.length) points[points.length - 1] = end;
  else points.push(end);
  return points;
}

export function createPilot() {
  let goal = null; // { x, y }: Ziel des Panzers
  let path = [];
  let plannedFor = '';
  let rimGoal = null; // Ziel des Geistes auf dem Rand
  let lastMove = 0;
  let goalTp = null; // für welchen Panzer (oder Geist) das Ziel gilt
  let check = { x: 0, y: 0, at: 0, tries: 0 };

  function cancel() {
    goal = null;
    path = [];
    rimGoal = null;
    lastMove = 0;
  }

  // Fahrtrichtung, die zum Wunschwinkel passt. Die bisherige bleibt, solange
  // sie nicht zu weit daneben liegt, damit der Panzer nicht hin und her zuckt.
  function direction(angle) {
    if (lastMove && Math.abs(angleDiff(angle, moveAngle(lastMove))) < (Math.PI / MOVE_DIRS) * 1.4) return lastMove;
    lastMove = moveIndex(Math.cos(angle), Math.sin(angle));
    return lastMove;
  }

  function driveTank(arena, tank, vehicle, now) {
    if (!goal) return 0;
    const key = `${arena.index}|${arena.stones || 0}|${goal.x}|${goal.y}`;
    if (key !== plannedFor) {
      plannedFor = key;
      path = findPath(arena, tank.x, tank.y, goal.x, goal.y);
    }
    // Wegpunkte überspringen, zu denen schon freie Bahn besteht
    let next = 0;
    for (let i = path.length - 1; i > 0; i -= 1) {
      if (clearPath(arena, tank.x, tank.y, path[i].x, path[i].y)) {
        next = i;
        break;
      }
    }
    if (next) path = path.slice(next);
    const target = path[0];
    const dx = target.x - tank.x;
    const dy = target.y - tank.y;
    const dist = Math.hypot(dx, dy);
    if (path.length === 1) {
      const stopping = (tank.v * tank.v) / (2 * vehicle.brake);
      if (dist < Math.max(0.06, stopping)) {
        cancel();
        return 0;
      }
    } else if (dist < 0.2) {
      path.shift();
      return driveTank(arena, tank, vehicle, now);
    }
    // Hängt er fest, neu planen, irgendwann aufgeben
    if (now - check.at > STUCK_MS) {
      const moved = Math.hypot(tank.x - check.x, tank.y - check.y);
      if (check.at && moved < 0.08) {
        check.tries += 1;
        plannedFor = '';
        if (check.tries > 3) {
          cancel();
          return 0;
        }
      } else check.tries = 0;
      check = { x: tank.x, y: tank.y, at: now, tries: check.tries };
    }
    return direction(Math.atan2(dy, dx));
  }

  function driveGhost(arena, ghost, params) {
    if (rimGoal === null) return 0;
    const L = rimLength(arena);
    let gap = rimGoal - ghost.s;
    if (gap > L / 2) gap -= L;
    else if (gap < -L / 2) gap += L;
    if (Math.abs(gap) <= params.speed * DT * 0.6) {
      rimGoal = null;
      return 0;
    }
    const here = rimPoint(arena, ghost.s);
    const ahead = rimPoint(arena, ghost.s + Math.sign(gap) * 0.25);
    return moveIndex(ahead.x - here.x, ahead.y - here.y);
  }

  return {
    // Rechtsklick: dorthin fahren (als Geist: zur nächsten Stelle am Rand)
    order(state, x, y) {
      goalTp = state.tp;
      if (state.ghostOn) {
        goal = null;
        rimGoal = rimNearest(state.arena, x, y);
      } else if (state.live) {
        rimGoal = null;
        goal = { x: Math.min(Math.max(x, 0.5), state.arena.W - 0.5), y: Math.min(Math.max(y, 0.5), state.arena.H - 0.5) };
        plannedFor = '';
        check = { x: 0, y: 0, at: 0, tries: 0 };
      }
    },
    cancel,
    goal: () => goal,

    // Ein Bild: liefert { move, aim, fire }. `cursor`: Mauspunkt in Feldern
    // oder null; `q`: Q gedrückt; `mouseAim`: der Turm folgt der Maus.
    steer(state, { cursor, q, mouseAim, now }) {
      const out = { move: 0, aim: null, fire: q };
      const { arena, tank, ghost, vehicle } = state;
      // neu eingestiegen oder Geist geworden: alte Ziele gelten nicht mehr
      if (state.tp !== goalTp) cancel();
      if (state.ghostOn) {
        goal = null;
        out.move = driveGhost(arena, ghost, state.ghostParams);
        return out;
      }
      rimGoal = null;
      if (!state.live) {
        cancel();
        return out;
      }
      out.move = driveTank(arena, tank, vehicle, now);
      // Ganz nah am Panzer wäre die Richtung zufällig: dann bleibt der Turm, wie er ist
      if (cursor && mouseAim && Math.hypot(cursor.x - tank.x, cursor.y - tank.y) > 0.3) {
        out.aim = Math.atan2(cursor.y - tank.y, cursor.x - tank.x);
      }
      return out;
    },
  };
}
