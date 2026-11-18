// Arenen. Jede ist ein Raster aus Feldern: `#` ist Wand, `.` Boden, eine
// Ziffer ein Startplatz (Boden). Neue Arenen brauchen nur ein neues Raster.
// Für mehr Spieler braucht eine Arena entsprechend viele Startplätze.

const RAW = [
  {
    name: 'Klassik',
    hint: 'Ein Rechteck mit Deckung in den Ecken und einem Block in der Mitte.',
    rows: [
      '######################',
      '#....................#',
      '#.1................2.#',
      '#........####........#',
      '#...##..........##...#',
      '#...#............#...#',
      '#......#..##..#......#',
      '#......#..##..#......#',
      '#...#............#...#',
      '#...##..........##...#',
      '#........####........#',
      '#.3................4.#',
      '#....................#',
      '######################',
    ],
  },
];

function parse(raw, index) {
  const H = raw.rows.length;
  const W = raw.rows[0].length;
  const solid = new Uint8Array(W * H);
  const spawns = [];
  raw.rows.forEach((row, y) => {
    if (row.length !== W) throw new Error(`Arena ${raw.name}: Zeile ${y} hat die falsche Länge`);
    [...row].forEach((ch, x) => {
      if (ch === '#') solid[y * W + x] = 1;
      else if (ch >= '1' && ch <= '9') spawns[Number(ch) - 1] = { x: x + 0.5, y: y + 0.5 };
    });
  });
  // Startplätze schauen zur Mitte
  for (const spawn of spawns) spawn.h = Math.atan2(H / 2 - spawn.y, W / 2 - spawn.x);
  return { index, name: raw.name, hint: raw.hint, W, H, solid, spawns: spawns.filter(Boolean) };
}

export const ARENAS = RAW.map(parse);

export const arenaOf = (index) => ARENAS[index] || ARENAS[0];

// Außerhalb des Rasters ist alles Wand.
export function solidAt(arena, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= arena.W || ty >= arena.H) return true;
  return arena.solid[ty * arena.W + tx] === 1;
}
