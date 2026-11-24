// Stellschrauben des Spiels. Längen in Feldern, Zeiten in Sekunden oder
// Schritten (60 pro Sekunde).

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const PROTOCOL = 8;

// Plätze im Raum. Alles ist auf eine beliebige Zahl ausgelegt, für mehr
// Spieler braucht es nur mehr Farben (siehe COLORS) und Arenen mit genug
// Startplätzen.
export const MAX_PLAYERS = 4;

export const LIVES = 3; // je Runde
export const RESPAWN_TICKS = 5 * TICK_RATE; // so lange ist man nach einem Abschuss raus
export const SHIELD_TICKS = Math.round(2 * TICK_RATE); // unverwundbar nach dem Wiedereinstieg
export const COUNTDOWN_TICKS = Math.round(3.4 * TICK_RATE);
export const RESULT_TICKS = 5 * TICK_RATE; // so lange steht das Rundenergebnis, dann geht es weiter
export const EVENT_TICKS = TICK_RATE; // so lange bleibt ein Ereignis im Spielstand

export const TANK_R = 0.4; // Panzer stoßen als Kreis an
export const ROCKET_R = 0.12;
export const BARREL = 0.6; // von der Mitte bis zur Mündung

// Fahrzeuge. Tempo in Feldern pro Sekunde, Drehen in Bogenmaß pro Sekunde,
// Zeiten in Sekunden. `kind` bestimmt, wie die Waffe funktioniert:
//   rocket  Rakete, prallt an jeder Wand ab
//   gun     Sofort-Treffer bis zur ersten Wand, Magazin mit Nachladen
//   mortar  Leertaste halten schiebt den Zielkreis geradeaus hinaus, loslassen
//           sprengt dort; Startpunkt und Richtung gelten ab dem Drücken
//   zap     Leertaste halten trifft alle Gegner im Umkreis, verbraucht Mana
// `stats`: Balken in der Auswahl, 1 bis 5.
// `turret`: Der Turm von Spielern zeigt sofort aufs Ziel. Nur Bots drehen ihn
// so schnell, sonst wären sie kaum zu schlagen.
const HULL = { health: 100, accel: 8, brake: 14, turn: 3.4, turret: 3.4 };
export const VEHICLES = [
  {
    ...HULL,
    id: 'prellbock',
    name: 'Prellbock',
    hint: 'Raketen, die an jeder Wand abprallen.',
    speed: 2.2,
    weapon: {
      kind: 'rocket',
      name: 'Rakete',
      speed: 5, // mittelschnell
      damage: 34, // drei Treffer kosten ein Leben
      cooldown: 1.5, // so lange dauert das Nachladen
      life: 3.8, // dann verpufft sie
    },
    stats: { tempo: 2, reichweite: 4, wucht: 3 },
  },
  {
    ...HULL,
    id: 'kimme',
    name: 'Kimme',
    hint: 'Schnelle Schüsse, die sofort treffen. Reichen 8 Felder weit, 6 Schuss pro Magazin.',
    speed: 2.2,
    weapon: {
      kind: 'gun',
      name: 'Pistole',
      damage: 12,
      interval: 0.3, // zwischen zwei Schüssen
      magazine: 6,
      reload: 2, // ist das Magazin leer, so lange nachladen
      range: 8,
    },
    stats: { tempo: 2, reichweite: 3, wucht: 2 },
  },
  {
    ...HULL,
    id: 'boeller',
    name: 'Böller',
    hint: 'Q halten schiebt den Zielkreis in Richtung Maus hinaus, loslassen sprengt dort. Geht durch Wände und trifft auch dich.',
    speed: 2,
    weapon: {
      kind: 'mortar',
      name: 'Bombe',
      charge: 4, // so schnell wandert der Zielkreis hinaus
      range: 9,
      radius: 1.3,
      damage: 50, // in der Mitte
      edge: 20, // am Rand
      cooldown: 2.5,
    },
    stats: { tempo: 1, reichweite: 5, wucht: 5 },
  },
  {
    ...HULL,
    id: 'zitteraal',
    name: 'Zitteraal',
    hint: 'Schnell. Q halten trifft alle Gegner in der Nähe mit Blitzen, solange Mana da ist.',
    speed: 3,
    weapon: {
      kind: 'zap',
      name: 'Blitze',
      radius: 2.2,
      damage: 6, // je Blitz und Gegner
      pulse: 1 / 6, // so oft blitzt es, also 36 Schaden pro Sekunde
      drain: 3, // volles Mana reicht so lange
      refill: 6, // von leer auf voll
      rest: 0.5, // erst nach dieser Pause lädt es wieder auf
    },
    stats: { tempo: 4, reichweite: 1, wucht: 4 },
  },
];

// Spielerfarben. Das Zeichen auf dem Turm unterscheidet sie auch ohne Farbe.
export const COLORS = [
  { name: 'Rot', color: '#ff5b4f', deep: '#a82d25', light: '#ffb1a8', mark: 'circle' },
  { name: 'Blau', color: '#4fa8ff', deep: '#205fae', light: '#b4daff', mark: 'square' },
  { name: 'Grün', color: '#62d26f', deep: '#2b8237', light: '#c0f0c4', mark: 'triangle' },
  { name: 'Gelb', color: '#ffc83a', deep: '#a8780c', light: '#ffe7a6', mark: 'diamond' },
  { name: 'Lila', color: '#b583ff', deep: '#6b3fb8', light: '#e1cfff', mark: 'cross' },
  { name: 'Orange', color: '#ff9a3c', deep: '#b35a10', light: '#ffd3a8', mark: 'ring' },
  { name: 'Türkis', color: '#3fd9cf', deep: '#16867f', light: '#b6f3ee', mark: 'bar' },
  { name: 'Pink', color: '#ff7cc4', deep: '#b33c7d', light: '#ffc9e7', mark: 'star' },
];

export const BOT_NAMES = ['Blechbüchse', 'Rostlaube', 'Klapperkiste', 'Schrotti', 'Dosenöffner', 'Kettenhund', 'Brummbär', 'Bolzen'];

// Was der Gastgeber im Raum einstellt. Übertragen wird nur die Stufe.
export const SETTINGS = [
  { key: 'length', label: 'Rundendauer', options: ['1 min', '2 min', '3 min', '5 min'], values: [60, 120, 180, 300], normal: 2 },
  { key: 'target', label: 'Punkte zum Sieg', options: ['1', '2', '3', '4', '5'], values: [1, 2, 3, 4, 5], normal: 2 },
  { key: 'bots', label: 'Freie Plätze', options: ['leer lassen', 'mit Bots füllen'], values: [false, true], normal: 1 },
  { key: 'speed', label: 'Tempo', options: ['langsam', 'mittel', 'schnell'], values: [0.8, 1, 1.25], normal: 1 },
];
export const DEFAULT_LEVELS = SETTINGS.map((setting) => setting.normal);

// Macht aus beliebigen Daten eine gültige Liste von Stufen.
export function cleanLevels(levels) {
  return SETTINGS.map((setting, i) => {
    const level = Array.isArray(levels) ? levels[i] : undefined;
    return Number.isInteger(level) && level >= 0 && level < setting.values.length ? level : setting.normal;
  });
}

// Die Regeln eines Spiels, aus den Stufen ausgerechnet.
export function rulesFor(levels) {
  const clean = cleanLevels(levels);
  const value = {};
  SETTINGS.forEach((setting, i) => {
    value[setting.key] = setting.values[clean[i]];
  });
  return {
    seconds: value.length,
    target: value.target,
    bots: value.bots,
    speed: value.speed, // Faktor auf das ganze Spieltempo
  };
}
export const DEFAULT_RULES = rulesFor(DEFAULT_LEVELS);

export const cleanVehicle = (index) => (Number.isInteger(index) && index >= 0 && index < VEHICLES.length ? index : 0);

// Ein Fahrzeug im eingestellten Tempo. Alles, was sich bewegt oder lädt, wird
// um den Faktor schneller oder langsamer: Fahren, Drehen, Raketen, Zielkreis,
// Nachladen, Blitze und Mana. Reichweiten und Schaden pro Treffer bleiben
// gleich, die Rakete fliegt also gleich weit.
const paced = new Map();
export function vehicleFor(index, speed = 1) {
  const key = `${cleanVehicle(index)}|${speed}`;
  if (paced.has(key)) return paced.get(key);
  const v = VEHICLES[cleanVehicle(index)];
  const f = speed > 0 ? speed : 1;
  const w = { ...v.weapon };
  if (w.kind === 'rocket') Object.assign(w, { speed: w.speed * f, cooldown: w.cooldown / f, life: w.life / f });
  else if (w.kind === 'gun') Object.assign(w, { interval: w.interval / f, reload: w.reload / f });
  else if (w.kind === 'mortar') Object.assign(w, { charge: w.charge * f, cooldown: w.cooldown / f });
  else if (w.kind === 'zap') Object.assign(w, { pulse: w.pulse / f, drain: w.drain / f, refill: w.refill / f, rest: w.rest / f });
  const out = { ...v, speed: v.speed * f, accel: v.accel * f, brake: v.brake * f, turn: v.turn * f, turret: v.turret * f, weapon: w };
  paced.set(key, out);
  return out;
}

// Geister: Wer alle Leben verloren hat, fährt kurz darauf als Geist auf dem
// Rand der Arena herum und wirft kleine Bomben nach innen. Leertaste halten
// wirft weiter. Die Bombe fliegt über Wände hinweg, landet und explodiert
// kurz danach. Wer damit einem Gegner den Rest gibt, kehrt mit einem Leben und
// einem Teil der Lebensleiste zurück.
export const GHOST = {
  delay: 1, // so lange nach dem letzten Leben, bis der Geist erscheint
  speed: 6.5, // auf dem Rand, Felder pro Sekunde: einmal herum in gut 10 Sekunden
  charge: 5, // so schnell wächst die Wurfweite beim Halten
  min: 1, // Wurfweite beim kurzen Tippen
  range: 12,
  cooldown: 4.5,
  flight: 0.25, // Flugzeit: so lange plus …
  flightPer: 0.045, // … so lange je Feld
  fuse: 0.35, // nach der Landung bis zur Explosion
  radius: 1.1,
  damage: 14, // in der Mitte, recht schwach
  edge: 6,
  revive: 0.3, // so viel Lebensleiste nach der Rückkehr
  rebirth: 0.6, // so lange fliegt der Geist zum Startplatz, dann erscheint der Panzer
};

// Geister im eingestellten Tempo, wie die Fahrzeuge
const pacedGhost = new Map();
export function ghostFor(speed = 1) {
  if (pacedGhost.has(speed)) return pacedGhost.get(speed);
  const f = speed > 0 ? speed : 1;
  const out = {
    ...GHOST,
    speed: GHOST.speed * f,
    charge: GHOST.charge * f,
    cooldown: GHOST.cooldown / f,
    flight: GHOST.flight / f,
    flightPer: GHOST.flightPer / f,
    fuse: GHOST.fuse / f,
  };
  pacedGhost.set(speed, out);
  return out;
}

// Sudden Death: Ist die Zeit um, hat jeder nur noch sein letztes Leben, es
// gibt keinen Wiedereinstieg und keine Geister mehr. Von außen nach innen
// fallen Steine in einer Spirale, auch auf Wände, bis nur noch einer übrig ist.
// Wer gerade auf seinen Wiedereinstieg wartet, steigt noch einmal ein.
export const SUDDEN = {
  lead: 1, // so lange vorher zeigt ein Schatten, wo ein Stein landet
  every: 0.11, // Sekunden je Stein bei mittlerem Tempo: alles zu in gut 26 Sekunden
  fall: 0.3, // so lange sieht man einen Stein fallen (nur fürs Zeichnen)
  crush: 0.2, // erwischt, wenn die Mitte des Panzers näher am Feld ist; sonst wird er weggeschoben
  safe: 3, // Wiedereinstieg nur auf ein Feld, das mindestens so lange frei bleibt
};
