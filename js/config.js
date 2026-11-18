// Stellschrauben des Spiels. Längen in Feldern, Zeiten in Sekunden oder
// Schritten (60 pro Sekunde).

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const PROTOCOL = 1;

// Plätze im Raum. Alles ist auf eine beliebige Zahl ausgelegt, für mehr
// Spieler braucht es nur mehr Farben (siehe COLORS) und Arenen mit genug
// Startplätzen.
export const MAX_PLAYERS = 4;

export const LIVES = 3; // je Runde
export const RESPAWN_TICKS = 5 * TICK_RATE; // so lange ist man nach einem Abschuss raus
export const SHIELD_TICKS = Math.round(2 * TICK_RATE); // unverwundbar nach dem Wiedereinstieg
export const COUNTDOWN_TICKS = Math.round(3.4 * TICK_RATE);
export const RESULT_TICKS = 5 * TICK_RATE; // so lange steht das Rundenergebnis, dann geht es weiter
export const EVENT_TICKS = 3 * TICK_RATE; // so lange bleibt ein Ereignis im Spielstand

export const TANK_R = 0.4; // Panzer stoßen als Kreis an
export const ROCKET_R = 0.12;
export const BARREL = 0.6; // von der Mitte bis zur Mündung

// Fahrzeuge. Für den Anfang gibt es eins, die Auswahl im Raum ist aber schon da.
// Tempo in Feldern pro Sekunde, Drehen in Bogenmaß pro Sekunde.
export const VEHICLES = [
  {
    id: 'prellbock',
    name: 'Prellbock',
    hint: 'Feuert Raketen, die an jeder Wand abprallen.',
    health: 100,
    speed: 2.2, // eher gemächlich
    accel: 8, // so schnell kommt er auf Tempo
    brake: 14,
    turn: 3.4, // Wanne
    turret: 3.4, // Turm, unabhängig von der Fahrtrichtung
    weapon: {
      name: 'Rakete',
      speed: 5, // mittelschnell
      damage: 34, // drei Treffer kosten ein Leben
      cooldown: 1.5, // so lange dauert das Nachladen
      life: 3.8, // dann verpufft sie
    },
    // für die Balken in der Auswahl, 1 bis 5
    stats: { tempo: 2, panzer: 3, feuer: 2 },
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
  { key: 'arena', label: 'Arena', options: ['Klassik'], values: [0], normal: 0 },
  { key: 'bots', label: 'Freie Plätze', options: ['leer lassen', 'mit Bots füllen'], values: [false, true], normal: 1 },
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
    arena: value.arena,
    bots: value.bots,
  };
}
export const DEFAULT_RULES = rulesFor(DEFAULT_LEVELS);

export const cleanVehicle = (index) => (Number.isInteger(index) && index >= 0 && index < VEHICLES.length ? index : 0);
