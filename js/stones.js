// Sudden Death: die fallenden Steine. Wann welcher Stein fällt, steht fest,
// sobald der Sudden Death beginnt. Gastgeber und Mitspieler rechnen es
// deshalb jeder für sich aus, über das Netz geht nur der Startschritt.
//
// Die Steine fallen Ring für Ring von außen nach innen, jeder Ring im
// Uhrzeigersinn ab der linken oberen Ecke, so dass eine Spirale entsteht. Der
// äußerste Rand ist schon Wand und bleibt außen vor; Wände im Innern bekommen
// ihren Stein wie jedes andere Feld.

import { TICK_RATE, SUDDEN } from './config.js';

const LEAD = Math.round(SUDDEN.lead * TICK_RATE);
const orders = new Map();

// Felder in der Reihenfolge, in der die Steine fallen. `cells`: Feldnummern
// (y * W + x); `rank`: für jedes Feld seine Stelle in der Reihe, -1 für den Rand.
export function stoneOrder(arena) {
  const key = `${arena.W}x${arena.H}`;
  let order = orders.get(key);
  if (order) return order;
  const { W, H } = arena;
  const cells = [];
  for (let k = 1; k <= W - 1 - k && k <= H - 1 - k; k += 1) {
    const x0 = k;
    const x1 = W - 1 - k;
    const y0 = k;
    const y1 = H - 1 - k;
    for (let x = x0; x <= x1; x += 1) cells.push(y0 * W + x);
    for (let y = y0 + 1; y <= y1; y += 1) cells.push(y * W + x1);
    if (y1 > y0) for (let x = x1 - 1; x >= x0; x -= 1) cells.push(y1 * W + x);
    if (x1 > x0) for (let y = y1 - 1; y > y0; y -= 1) cells.push(y * W + x0);
  }
  const rank = new Int32Array(W * H).fill(-1);
  cells.forEach((cell, i) => {
    rank[cell] = i;
  });
  order = { cells: Int32Array.from(cells), rank };
  orders.set(key, order);
  return order;
}

// Schritte von einem Stein zum nächsten
export const stoneEvery = (speed = 1) => (SUDDEN.every * TICK_RATE) / (speed > 0 ? speed : 1);

// Der Schritt, in dem Stein Nummer `i` landet. Der erste landet eine
// Vorwarnzeit nach Beginn, so dass sein Schatten sofort zu sehen ist.
export const landTick = (sd, i, speed) => sd + LEAD + Math.floor(i * stoneEvery(speed));

// Wie viele Steine bis einschließlich Schritt `tick` gelandet sind
export function stonesBy(sd, tick, speed, total) {
  if (!sd) return 0;
  let n = Math.max(0, Math.ceil((tick - sd - LEAD + 1) / stoneEvery(speed)));
  while (n > 0 && landTick(sd, n - 1, speed) > tick) n -= 1;
  while (n < total && landTick(sd, n, speed) <= tick) n += 1;
  return Math.min(n, total);
}

// Wann der Stein auf dieses Feld fällt; Infinity, wenn nie
export function cellLands(arena, sd, speed, cx, cy) {
  if (!sd || cx < 0 || cy < 0 || cx >= arena.W || cy >= arena.H) return Infinity;
  const i = stoneOrder(arena).rank[cy * arena.W + cx];
  return i < 0 ? Infinity : landTick(sd, i, speed);
}

// Eine Arena, in die Steine fallen dürfen: eigenes Raster, das Original
// bleibt unberührt.
export function withStones(arena) {
  return { ...arena, solid: arena.solid.slice(), stones: 0 };
}

// Lässt Steine fallen, bis `count` liegen. Gibt die neuen Felder zurück.
export function dropStones(arena, count) {
  const cells = stoneOrder(arena).cells;
  const fresh = [];
  const until = Math.min(count, cells.length);
  while (arena.stones < until) {
    const cell = cells[arena.stones];
    arena.solid[cell] = 1;
    fresh.push(cell);
    arena.stones += 1;
  }
  return fresh;
}

// Abstand eines Punktes von einem Feld (0 im Feld)
export function cellDistance(cx, cy, x, y) {
  const dx = x - Math.min(Math.max(x, cx), cx + 1);
  const dy = y - Math.min(Math.max(y, cy), cy + 1);
  return Math.hypot(dx, dy);
}

// Erwischt ein Stein auf Feld cx, cy einen Panzer mit Mitte x, y? Steht er
// nur mit dem Rand darunter, wird er stattdessen weggeschoben.
export const crushes = (cx, cy, x, y) => cellDistance(cx, cy, x, y) < SUDDEN.crush;
