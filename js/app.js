// Oberfläche: Startseite, Raum, Anzeige im Spiel. Verdrahtet Gastgeber,
// eigenes Spiel, Netz, Steuerung und Leinwand.

import { createHost, createLoopback } from './host.js';
import { createClient } from './client.js';
import { createRenderer, drawTankShape } from './render.js';
import { createControls } from './input.js';
import { createMusic } from './music.js';
import { createSfx } from './sfx.js';
import { createHostNet, createGuestNet, makeRoomCode, cleanCode, makeId, supported, DEFAULT_RELAYS } from './net.js';
import { PHASE, EVENT } from './sim.js';
import { packInput, moveIndex, aimIndex } from './physics.js';
import { COLORS, VEHICLES, SETTINGS, DEFAULT_LEVELS, cleanLevels, rulesFor, TICK_RATE, LIVES, cleanVehicle } from './config.js';

const $ = (selector) => document.querySelector(selector);
const now = () => performance.now();
const params = new URLSearchParams(location.search);
// Für Tests: eigene Vermittler (?relay=ws://…,ws://…) und ohne Direktverbindung (?direkt=0)
const relays = params.get('relay') ? params.get('relay').split(',').filter(Boolean) : DEFAULT_RELAYS;
const useRtc = params.get('direkt') !== '0';

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function load(store, key) {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}
function save(store, key, value) {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // Speicher gesperrt: dann eben ohne
  }
}

const myId = load(sessionStorage, 'tankwar-id') || makeId();
save(sessionStorage, 'tankwar-id', myId);
const myVehicle = () => cleanVehicle(Number(load(localStorage, 'tankwar-vehicle')));

const canvas = $('#stage');
const renderer = createRenderer(canvas);
const controls = createControls(window);

// Musik aus audio/menu.mp3 und audio/game.mp3, falls vorhanden. Der Schalter
// erscheint nur, wo es auch Musik gibt: oben rechts im Menü, unten rechts im Spiel.
function showMusicButton() {
  const off = music.muted();
  const inGame = document.body.dataset.screen === 'game';
  for (const button of [$('#b-music'), $('#b-music-game')]) {
    button.textContent = off ? 'Musik: aus' : 'Musik: an';
    button.setAttribute('aria-pressed', String(!off));
  }
  $('#b-music').hidden = !music.available('menu') || inGame;
  $('#b-music-game').hidden = !music.available('game');
}
const music = createMusic({ muted: load(localStorage, 'tankwar-music') === 'aus', onChange: () => showMusicButton() });
// Geräusche im Spiel, mit eigenem Schalter unten rechts
const sfx = createSfx({ muted: load(localStorage, 'tankwar-sfx') === 'aus' });
function showSoundButton() {
  const off = sfx.muted();
  $('#b-sound').textContent = off ? 'Ton: aus' : 'Ton: an';
  $('#b-sound').setAttribute('aria-pressed', String(!off));
}
showSoundButton();
$('#b-sound').addEventListener('click', (event) => {
  save(localStorage, 'tankwar-sfx', sfx.toggle() ? 'aus' : 'an');
  showSoundButton();
  event.currentTarget.blur(); // sonst würde die Leertaste beim Schießen ihn wieder umschalten
});

let musicLocked = true;
// Der Browser erlaubt Ton erst nach dem ersten Klick. Ist dieser Klick der auf
// den Musikknopf, startet er die Musik, statt sie gleich wieder auszuschalten.
for (const button of [$('#b-music'), $('#b-music-game')]) {
  button.addEventListener('pointerdown', () => {
    musicLocked = music.locked();
  }, { capture: true });
  button.addEventListener('click', (event) => {
    event.currentTarget.blur(); // sonst würde die Leertaste ihn wieder umschalten
    if (musicLocked && !music.muted()) return;
    save(localStorage, 'tankwar-music', music.toggle() ? 'aus' : 'an');
  });
}

let session = null; // { role, code, host, client, net, status, since }
let invite = cleanCode(params.get('raum'));

// ---------- Vorschau auf der Startseite: vier Bots ----------

function createDemo() {
  const host = createHost({ autoRestart: true, levels: [1, 4, 1] });
  const loop = createLoopback(host, now);
  let client = null;
  const link = loop.connect('vorschau', (msg) => client.receive(msg, now()));
  client = createClient({ id: 'vorschau', name: '', watch: true, link });
  host.start();
  return { host, client };
}
const demo = createDemo();
let demoWanted = true;

// ---------- Symbole ----------

const kindOfVehicle = (index) => VEHICLES[cleanVehicle(index)].weapon.kind;
const GRAY = { color: '#3b4049', deep: '#262a31', light: '#4a505b', mark: 'circle' };
const icons = new Map();
// Symbol eines Panzers für Listen und Karten, mit derselben Zeichnung wie im
// Spiel, Bug nach oben. Einmal gemalt, dann aus dem Speicher.
function tankIcon(slot, { faded = false, vehicle = 0 } = {}) {
  const key = `${faded ? -1 : slot}|${cleanVehicle(vehicle)}`;
  let url = icons.get(key);
  if (!url) {
    const px = 96;
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const g = canvas.getContext('2d');
    // Von hinten bis zur Laufspitze sind es gut 1,2 Felder, die Mitte rutscht
    // deshalb etwas nach unten.
    const scale = px / 1.3;
    g.translate(px / 2, px / 2 + 0.12 * scale);
    g.scale(scale, scale);
    g.rotate(-Math.PI / 2);
    drawTankShape(g, faded ? GRAY : COLORS[slot] || COLORS[0], 0, { kind: kindOfVehicle(vehicle), plain: faded });
    url = canvas.toDataURL();
    icons.set(key, url);
  }
  return `<img class="ticon" src="${url}" alt="">`;
}

// ---------- Raum betreten und verlassen ----------

function setUrl(code) {
  const next = new URLSearchParams(location.search);
  if (code) next.set('raum', code);
  else next.delete('raum');
  const query = next.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
  document.title = code ? `Tank War, Raum ${code}` : 'Tank War';
}

function savedLevels() {
  try {
    return JSON.parse(load(localStorage, 'tankwar-settings') || 'null');
  } catch {
    return null;
  }
}

function openRoom(code) {
  const name = load(localStorage, 'tankwar-name') || 'Gastgeber';
  const host = createHost({ levels: savedLevels() });
  const loop = createLoopback(host, now);
  let client = null;
  const link = loop.connect(myId, (msg) => client.receive(msg, now()));
  client = createClient({ id: myId, name, link, vehicle: myVehicle() });
  const mine = { role: 'host', code, host, client, net: null, status: null, since: now() };
  if (supported()) {
    mine.net = createHostNet({
      room: code,
      urls: relays,
      host,
      localId: myId,
      now,
      useRtc,
      onStatus: (status) => {
        mine.status = status;
      },
      onConflict: () => {
        // Jemand anderes führt unter diesem Code schon einen Raum: neuen Code nehmen.
        if (session !== mine || host.slots.some((slot) => slot.kind === 'human' && slot.id !== myId)) return;
        closeSession();
        openRoom(makeRoomCode());
      },
    });
  }
  session = mine;
  save(sessionStorage, 'tankwar-room', JSON.stringify({ code, role: 'host' }));
  setUrl(code);
}

function joinRoom(code) {
  const name = load(localStorage, 'tankwar-name') || 'Gast';
  let client = null;
  const mine = { role: 'guest', code, host: null, client: null, net: null, status: null, since: now() };
  mine.net = createGuestNet({
    room: code,
    urls: relays,
    id: myId,
    now,
    useRtc,
    onMessage: (msg) => client.receive(msg, now()),
    onStatus: (status) => {
      mine.status = status;
    },
  });
  client = createClient({ id: myId, name, link: mine.net.link, vehicle: myVehicle() });
  mine.client = client;
  session = mine;
  save(sessionStorage, 'tankwar-room', JSON.stringify({ code, role: 'guest' }));
  setUrl(code);
}

function closeSession() {
  if (!session) return;
  if (session.host) session.host.close();
  else session.client.leave();
  const net = session.net;
  if (net) setTimeout(() => net.stop(), 300);
  session = null;
  controls.setEnabled(false);
  renderer.reset();
}

function leaveRoom() {
  if (!session) return;
  if (session.role === 'host') {
    const guests = session.host.slots.filter((slot) => slot.kind === 'human' && slot.id !== myId && slot.online).length;
    if (guests > 0 && !window.confirm('Wenn du gehst, endet der Raum für alle. Wirklich verlassen?')) return;
  }
  closeSession();
  save(sessionStorage, 'tankwar-room', null);
  invite = '';
  setUrl('');
  demoWanted = true;
  showStartMode();
}

// ---------- Startseite ----------

function showStartMode() {
  const invited = Boolean(invite);
  $('#invited').hidden = !invited;
  $('#invited').textContent = invited ? `Du bist in den Raum ${invite} eingeladen.` : '';
  $('#b-main').textContent = invited ? 'Beitreten' : 'Raum erstellen';
  $('#join').hidden = invited;
  $('#b-own').hidden = !invited;
  const touchOnly = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
  $('#start-note').textContent = touchOnly ? 'Gespielt wird mit der Tastatur oder einem Gamepad. Am Handy geht es noch nicht.' : '';
  $('#start-note').classList.remove('bad');
}

function takeName() {
  const name = $('#f-name').value.trim().slice(0, 14);
  if (!name) {
    $('#start-note').textContent = 'Gib zuerst einen Namen ein.';
    $('#start-note').classList.add('bad');
    $('#f-name').focus();
    return false;
  }
  save(localStorage, 'tankwar-name', name);
  return true;
}

function tryJoin(code) {
  if (!supported()) {
    $('#start-note').textContent = 'Dieser Browser kann keine Verbindung aufbauen. Nimm einen aktuellen Browser und öffne die Seite über https.';
    $('#start-note').classList.add('bad');
    return;
  }
  joinRoom(code);
}

$('#f-name').value = load(localStorage, 'tankwar-name') || '';
$('#enter').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!takeName()) return;
  if (invite) tryJoin(invite);
  else openRoom(makeRoomCode());
});
$('#join').addEventListener('submit', (event) => {
  event.preventDefault();
  const code = cleanCode($('#f-code').value);
  if (!code) {
    $('#start-note').textContent = 'Der Raumcode besteht aus fünf Buchstaben.';
    $('#start-note').classList.add('bad');
    $('#f-code').focus();
    return;
  }
  if (takeName()) tryJoin(code);
});
$('#b-own').addEventListener('click', () => {
  invite = '';
  setUrl('');
  showStartMode();
});

// ---------- Raum ----------

$('#b-start').addEventListener('click', () => {
  if (session && session.host) session.host.start();
});
$('#b-leave').addEventListener('click', leaveRoom);
$('#b-quit').addEventListener('click', leaveRoom);

$('#options').innerHTML = SETTINGS.map((row) => `<div class="opt" role="radiogroup" aria-label="${row.label}"><span class="name">${row.label}</span>${
  row.options.map((text, level) => `<label><input type="radio" name="opt-${row.key}" value="${level}"><span>${text}</span></label>`).join('')
}</div>`).join('');
$('#options').addEventListener('change', (event) => {
  if (!session || !session.host || !event.target.name.startsWith('opt-')) return;
  session.host.setLevel(event.target.name.slice(4), Number(event.target.value));
  save(localStorage, 'tankwar-settings', JSON.stringify(session.host.levels));
});

const bar = (n) => `<span class="bar">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
$('#vehicles').innerHTML = VEHICLES.map((v, index) => `<button type="button" class="vehicle" role="radio" data-index="${index}" aria-checked="false">`
  + `${tankIcon(0, { vehicle: index })}<span class="name">${v.name}<small>${v.weapon.name}</small></span><span class="hint">${v.hint}</span>`
  + `<span class="stats"><span>Tempo${bar(v.stats.tempo)}</span><span>Reichweite${bar(v.stats.reichweite)}</span><span>Wucht${bar(v.stats.wucht)}</span></span></button>`).join('');
$('#vehicles').addEventListener('click', (event) => {
  const button = event.target.closest('.vehicle');
  if (!button || !session) return;
  const index = Number(button.dataset.index);
  save(localStorage, 'tankwar-vehicle', String(index));
  session.client.setVehicle(index);
});

$('#b-copy').addEventListener('click', async () => {
  const input = $('#f-link');
  let ok = false;
  try {
    await navigator.clipboard.writeText(input.value);
    ok = true;
  } catch {
    input.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
  }
  $('#b-copy').textContent = ok ? 'Link kopiert' : 'Bitte von Hand kopieren';
  setTimeout(() => {
    $('#b-copy').textContent = 'Link kopieren';
  }, 1800);
});

// DOM nur anfassen, wenn sich wirklich etwas geändert hat
const shown = {};
function put(key, value, apply) {
  if (shown[key] === value) return;
  shown[key] = value;
  apply(value);
}

function netNote() {
  const st = session.status;
  const age = now() - session.since;
  const rtt = session.client.rtt === null ? '' : ` (${Math.round(session.client.rtt)} ms)`;
  if (session.role === 'host') {
    if (!supported() || (st && st.failed)) return ['Dieser Browser kann keine Verbindung aufbauen. Gegen Bots geht es trotzdem.', true];
    if (!st || st.up === 0) {
      if (st && st.everUp) return ['Verbindung zu den Vermittlern unterbrochen. Neuer Versuch läuft.', true];
      if (age > 8000) return ['Noch keine Verbindung zu den Vermittlern. Mitspieler können gerade nicht beitreten.', true];
      return ['Raum wird geöffnet …', false];
    }
    return [`Raum ist offen, ${st.up} von ${st.total} Vermittlern erreichbar.`, false];
  }
  const status = session.client.status;
  if (status === 'closed') return ['Der Gastgeber hat den Raum geschlossen.', true];
  if (status === 'full') return ['Der Raum ist schon voll. Sobald ein Platz frei wird, bist du drin.', true];
  if (status === 'old') return ['Diese Seite ist veraltet. Lade sie neu.', true];
  if (!st || st.up === 0) {
    if (age > 8000) return ['Keine Verbindung zu den Vermittlern. Prüfe dein Internet.', true];
    return ['Verbinde …', false];
  }
  if (!st.hostSeen) {
    if (age > 7000) return ['Unter diesem Code ist gerade kein Raum offen. Es wird weiter gesucht.', true];
    return ['Suche den Raum …', false];
  }
  if (status === 'lost') return ['Verbindung zum Gastgeber verloren. Neuer Versuch läuft.', true];
  if (status === 'joining') return ['Trete bei …', false];
  if (st.direct) return [`Direkt verbunden${rtt}.`, false];
  return [`Über Vermittler verbunden${rtt}. Eine direkte Leitung wird versucht.`, false];
}

const colored = (slot, name, me) => `<b style="color:${COLORS[slot].color}">${me ? 'Du' : esc(name)}</b>`;
function namesOf(slots, view) {
  const list = slots.map((slot) => colored(slot, view.players[slot].name, slot === view.slot));
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} und ${list[list.length - 1]}`;
}
function plainNames(slots, view) {
  const list = slots.map((slot) => (slot === view.slot ? 'Du' : view.players[slot].name));
  return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} und ${list[list.length - 1]}`;
}

function updateRoom(view) {
  const client = session.client;
  const lobby = client.lobby;
  const isHost = session.role === 'host';
  const over = view.ready && view.phase === PHASE.OVER && client.status === 'in';
  const levels = cleanLevels(lobby ? lobby.levels : DEFAULT_LEVELS);
  const bots = rulesFor(levels).bots;

  let title = `Raum <span class="code">${session.code}</span>`;
  let lead = isHost ? 'Schick den Link an deine Mitspieler. Bis zu vier Panzer passen in einen Raum.' : 'Der Gastgeber startet das Spiel.';
  if (over) {
    const champs = view.champions;
    const mine = champs.includes(view.slot);
    if (champs.length === 1) title = mine ? 'Du gewinnst!' : `${esc(view.players[champs[0]].name)} gewinnt`;
    else title = mine ? 'Geteilter Sieg' : 'Gleichstand';
    lead = `${champs.length > 1 ? `${esc(plainNames(champs, view))} gewinnen gemeinsam. ` : ''}Nach ${view.round} ${view.round === 1 ? 'Runde' : 'Runden'}.${isHost ? '' : ' Der Gastgeber startet das nächste Spiel.'}`;
  }
  put('title', title, (v) => {
    $('#room-title').innerHTML = v;
  });
  put('lead', lead, (v) => {
    $('#room-lead').textContent = v;
  });

  const order = over
    ? view.players.filter((p) => p.in || p.points > 0).sort((a, b) => b.points - a.points || b.kills - a.kills).map((p) => p.slot)
    : view.players.map((p) => p.slot);
  const rows = order.map((slot) => {
    const info = lobby ? lobby.slots[slot] : { name: view.players[slot].name, kind: 'free', id: null, online: true };
    const mine = info.id === myId;
    const empty = info.kind === 'free' && !bots && !over;
    const tag = mine ? 'du' : info.kind === 'free' ? (bots ? 'Bot' : '') : '';
    let state;
    const kills = view.players[slot].kills;
    if (over) state = `<span class="pts">${view.players[slot].points}<small>${kills} ${kills === 1 ? 'Abschuss' : 'Abschüsse'}</small></span>`;
    else if (empty) state = '<span class="state">frei</span>';
    else if (info.kind === 'human' && !info.online) state = '<span class="state">getrennt</span>';
    else if (info.kind === 'human' && isHost && !mine) state = `<span class="state">${session.net && session.net.isDirect(info.id) ? 'direkt verbunden' : 'über Vermittler'}</span>`;
    else if (info.kind === 'human') state = '<span class="state">bereit</span>';
    else state = '<span class="state">fährt mit</span>';
    const name = empty ? 'Freier Platz' : esc(info.name);
    const vehicle = over ? view.players[slot].vehicle : info.vehicle;
    const ride = empty ? '' : `<em>${VEHICLES[cleanVehicle(vehicle)].name}</em>`;
    return `<li class="${empty ? 'empty' : ''}${mine ? ' me' : ''}">${tankIcon(slot, { faded: empty, vehicle })}<span class="who">${name}${tag ? `<small>${tag}</small>` : ''}${ride}</span>${state}</li>`;
  }).join('');
  put('slots', rows, (v) => {
    $('#slots').innerHTML = v;
  });

  const linkParams = new URLSearchParams(location.search);
  linkParams.set('raum', session.code);
  put('link', `${location.origin}${location.pathname}?${linkParams}`, (v) => {
    $('#f-link').value = v;
  });
  put('options', `${levels}|${isHost}`, () => {
    SETTINGS.forEach((row, i) => {
      for (const radio of document.querySelectorAll(`#options input[name="opt-${row.key}"]`)) radio.checked = Number(radio.value) === levels[i];
    });
    $('#settings').disabled = !isHost;
    $('#settings-hint').textContent = isHost ? 'Gelten ab dem nächsten Spiel.' : 'Der Gastgeber stellt sie ein.';
  });
  const mySlot = lobby && lobby.slots.find((slot) => slot.id === myId);
  const chosen = mySlot ? mySlot.vehicle : client.vehicle;
  put('vehicle', `${chosen}|${client.slot}`, () => {
    for (const button of document.querySelectorAll('.vehicle')) {
      const index = Number(button.dataset.index);
      button.setAttribute('aria-checked', String(index === chosen));
      button.querySelector('.ticon').outerHTML = tankIcon(Math.max(0, client.slot), { vehicle: index });
    }
  });

  const can = isHost && session.host.canStart();
  put('start', `${isHost}|${over}|${can}`, () => {
    $('#b-start').hidden = !isHost;
    $('#b-start').disabled = !can;
    $('#b-start').textContent = over ? 'Neues Spiel starten' : 'Spiel starten';
  });
  let [note, bad] = netNote();
  if (isHost && !can && !bad) note = 'Für ein Spiel braucht es mindestens zwei Panzer. Lade jemanden ein oder fülle freie Plätze mit Bots.';
  put('note', `${note}|${bad}`, () => {
    $('#room-note').textContent = note;
    $('#room-note').classList.toggle('bad', bad);
  });
}

// ---------- Anzeige im Spiel ----------

const feed = [];
let feedKey = 0;
function addFeed(html, ms = 4200) {
  feed.push({ html, until: now() + ms, id: (feedKey += 1) });
  while (feed.length > 4) feed.shift();
  renderFeed();
}
function renderFeed() {
  const list = $('#feed');
  const ids = new Set(feed.map((entry) => String(entry.id)));
  for (const li of [...list.children]) if (!ids.has(li.dataset.id)) li.remove();
  for (const entry of feed) {
    if (list.querySelector(`[data-id="${entry.id}"]`)) continue;
    const li = document.createElement('li');
    li.dataset.id = entry.id;
    li.innerHTML = entry.html;
    list.append(li);
  }
}
function tickFeed(t) {
  let changed = false;
  for (let i = feed.length - 1; i >= 0; i -= 1) {
    const li = $('#feed').querySelector(`[data-id="${feed[i].id}"]`);
    if (t > feed[i].until - 500 && li) li.classList.add('gone');
    if (t > feed[i].until) {
      feed.splice(i, 1);
      changed = true;
    }
  }
  if (changed) renderFeed();
}

let lastKiller = -1;
let rebornUntil = 0;
function hudEvent(e, view) {
  if (e.kind === EVENT.REVIVE && e.of === view.slot) rebornUntil = now() + 1500;
  if (e.kind === EVENT.REVIVE) {
    const p = view.players[e.of];
    if (p) addFeed(e.of === view.slot ? 'Du bist als Geist zurück!' : `${colored(p.slot, p.name, false)} ist als Geist zurück!`);
    return;
  }
  if (e.kind !== EVENT.DESTROY) return;
  const by = view.players[e.by];
  const of = view.players[e.of];
  if (!by || !of) return;
  if (e.of === view.slot) lastKiller = e.by;
  const who = (p) => colored(p.slot, p.name, p.slot === view.slot);
  const out = e.item <= 0;
  const verb = e.by === view.slot ? 'erwischst' : 'erwischt';
  let text = `${who(by)} ${verb} ${e.of === view.slot ? 'dich' : who(of)}`;
  if (e.by === e.of) text = e.of === view.slot ? 'Du sprengst dich selbst' : `${who(of)} sprengt sich selbst`;
  if (out) text += e.of === view.slot ? '. Du bist raus' : `. ${who(of)} ist raus`;
  addFeed(text);
}

const secsOf = (ticks) => Math.max(0, Math.ceil(ticks / TICK_RATE));
const clockText = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
const pips = (n, target, fresh = false) => Array.from({ length: target }, (_, i) => `<i class="${i < n ? 'on' : ''}${fresh && i === n - 1 ? ' new' : ''}"></i>`).join('');

let playSince = 0;
let goUntil = 0;
let lastPhase = -1;
function updateHud(view, t) {
  const client = session.client;
  const target = rulesFor(view.levels).target;
  const field = view.players.filter((p) => p.in);
  const card = (p) => {
    const frac = p.maxHp ? p.hp / p.maxHp : 0;
    const cls = frac > 0.6 ? '' : frac > 0.3 ? 'mid' : 'low';
    const lives = Array.from({ length: LIVES }, (_, i) => `<i class="${i < p.lives ? '' : 'gone'}"></i>`).join('');
    const tag = p.ghost ? 'Geist' : p.mine ? 'du' : p.kind === 'free' ? 'Bot' : p.online ? '' : 'getrennt';
    return `<div class="pcard${p.mine ? ' me' : ''}${p.lives <= 0 ? ' out' : ''}" style="--c:${COLORS[p.slot].color}">${tankIcon(p.slot, { faded: p.lives <= 0, vehicle: p.vehicle })}`
      + `<div class="top"><span class="who">${esc(p.name)}</span>${tag ? `<span class="tag">${tag}</span>` : ''}<span class="lives">${lives}</span></div>`
      + `<div class="bottom"><span class="hp"><b class="${cls}" style="width:${Math.round(frac * 100)}%"></b></span><span class="pips">${pips(p.points, target)}</span></div></div>`;
  };
  const half = Math.ceil(field.length / 2);
  put('cards', field.map(card).join('|'), () => {
    $('#cards').innerHTML = field.slice(0, half).map(card).join('');
    $('#cards-right').innerHTML = field.slice(half).map(card).join('');
  });

  const counting = view.phase === PHASE.COUNTDOWN;
  const secs = counting ? rulesFor(view.levels).seconds : view.phase === PHASE.PLAY ? secsOf(view.ticksLeft) : 0;
  // Letzte zehn Sekunden: leises Ticken, die letzten drei etwas höher
  put('tick', view.phase === PHASE.PLAY && secs <= 10 && secs > 0 ? secs : 0, (v) => {
    if (v) sfx.tick(v <= 3);
  });
  put('timer', `${clockText(secs)}|${view.phase === PHASE.PLAY && secs <= 10}`, (v) => {
    const [text, soon] = v.split('|');
    $('#timer').textContent = text;
    $('#timer').classList.toggle('soon', soon === 'true');
  });
  put('round', `Runde ${view.round} · ${view.arena.name}`, (v) => {
    $('#round-label').textContent = v;
  });

  let conn = '';
  let bad = false;
  if (client.status === 'lost') {
    conn = 'Verbindung zum Gastgeber verloren';
    bad = true;
  } else if (session.role === 'guest' && session.status) {
    const rtt = client.rtt === null ? '' : `, ${Math.round(client.rtt / 5) * 5} ms`;
    conn = session.status.direct ? `direkt verbunden${rtt}` : `über Vermittler${rtt}`;
  }
  put('conn', `${conn}|${bad}`, () => {
    $('#conn').textContent = conn;
    $('#conn').classList.toggle('bad', bad);
  });

  if (view.phase === PHASE.PLAY && !playSince) playSince = t;
  if (view.phase !== PHASE.PLAY) playSince = 0;
  const pad = controls.usesPad();
  put('hint-text', pad, (v) => {
    $('#hint').textContent = v ? 'Linker Stick fährt, rechter zielt, A oder Schultertaste schießt' : 'WASD fährt, die Pfeiltasten zielen, die Leertaste schießt';
  });
  put('hint', controls.hasMoved() && playSince && t - playSince > 8000, (gone) => {
    $('#hint').classList.toggle('gone', gone);
  });

  // Mitteilung unten: abgeschossen, raus oder Zuschauer
  const me = view.slot >= 0 ? view.players[view.slot] : null;
  let down = '';
  if (view.phase === PHASE.PLAY || view.phase === PHASE.COUNTDOWN) {
    if (!me || !me.in) down = 'Du schaust zu und steigst in der nächsten Runde ein.';
    else if (me.ghost) down = 'Du bist ein Geist. Fahr am Rand entlang, halte die Leertaste und lass los, um eine Bombe zu werfen.<small>Gibst du damit einem Gegner den Rest, kehrst du mit einem Leben zurück.</small>';
    else if (me.lives <= 0) down = 'Alle Leben verloren.';
    else if (me.dead > 0 && now() < rebornUntil) down = 'Du kehrst zurück!';
    else if (me.dead > 0) {
      const killer = view.players[lastKiller];
      const by = killer && lastKiller !== view.slot ? ` von ${colored(killer.slot, killer.name, false)}` : '';
      down = `Abgeschossen${by}. Zurück in<span class="secs">${secsOf(me.dead)}</span>`;
    }
  }
  put('down', down, (v) => {
    $('#down').hidden = !v;
    $('#down').innerHTML = v;
  });

  // Countdown und „Los!“
  if (lastPhase === PHASE.COUNTDOWN && view.phase === PHASE.PLAY) goUntil = t + 700;
  lastPhase = view.phase;
  const going = view.phase === PHASE.PLAY && t < goUntil;
  put('count', counting || going, (v) => {
    $('#count').hidden = !v;
  });
  if (counting || going) {
    const left = Math.ceil(view.ticksLeft / TICK_RATE);
    const num = going ? 'Los!' : left <= 3 ? String(Math.max(left, 1)) : '';
    put('count-num', num, (v) => {
      if (v) sfx.count(v === 'Los!');
      $('#count-num').textContent = v;
      $('#count-num').classList.toggle('go', v === 'Los!');
    });
    put('count-round', `Runde ${view.round} · ${view.arena.name}`, (v) => {
      $('#count-round').textContent = v;
    });
    const others = field.length - (me && me.in ? 1 : 0);
    put('count-text', going ? '' : `${field.length} Panzer, je ${LIVES} Leben. ${others > 0 ? 'Wer zuletzt noch fährt, gewinnt.' : ''}`, (v) => {
      $('#count-text').textContent = v;
    });
  }

  // Rundenergebnis
  const result = view.phase === PHASE.RESULT;
  put('result', result, (v) => {
    $('#result').hidden = !v;
    if (v) sfx.result(view.winners.includes(view.slot), view.champions.length > 0);
  });
  if (result) {
    const winners = view.winners;
    const champs = view.champions;
    const color = winners.length === 1 ? COLORS[winners[0]].color : 'var(--accent)';
    let title;
    if (!winners.length) title = 'Niemand gewinnt';
    else if (winners.length === 1) title = winners[0] === view.slot ? 'Du holst die Runde' : `${esc(view.players[winners[0]].name)} holt die Runde`;
    else title = 'Unentschieden';
    const sorted = field.slice().sort((a, b) => b.points - a.points || b.kills - a.kills);
    const list = sorted.map((p) => `<li class="${winners.includes(p.slot) ? 'win' : ''}">${tankIcon(p.slot, { vehicle: p.vehicle })}<span class="who">${p.mine ? 'Du' : esc(p.name)}</span>`
      + `<span class="pips">${pips(p.points, target, winners.includes(p.slot))}</span></li>`).join('');
    let foot = `Nächste Runde in ${secsOf(view.ticksLeft)}`;
    if (champs.length === 1) foot = champs[0] === view.slot ? 'Du gewinnst das Spiel!' : `${namesOf(champs, view)} gewinnt das Spiel!`;
    else if (champs.length > 1) foot = `${namesOf(champs, view)} gewinnen das Spiel gemeinsam!`;
    const kicker = winners.length > 1 ? `${plainNames(winners, view)} teilen sich den Punkt` : `Runde ${view.round}`;
    put('result-card', `${title}|${list}|${foot}|${kicker}`, () => {
      $('#result .card').style.setProperty('--c', color);
      $('#result-kicker').textContent = kicker;
      $('#result-title').innerHTML = title;
      $('#result-list').innerHTML = list;
      $('#result-foot').innerHTML = foot;
    });
  }
}

// ---------- Steuerung ----------

function inputCode() {
  const c = controls.read();
  if (!session) return 0;
  const move = Math.abs(c.mx) + Math.abs(c.my) > 0.2 ? moveIndex(c.mx, c.my) : 0;
  return packInput(move, c.aim === null ? -1 : aimIndex(c.aim), c.fire);
}

// ---------- Takt ----------

// Der Spielstand des Gastgebers läuft über einen Taktgeber außerhalb der
// Seite weiter, auch wenn das Fenster gerade nicht vorne ist.
function startTicker(fn) {
  try {
    const source = 'setInterval(() => postMessage(0), 8);';
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    worker.onmessage = fn;
  } catch {
    setInterval(fn, 8);
  }
}
startTicker(() => {
  const t = now();
  if (session && session.host) session.host.advance(t);
  if (demoWanted) demo.host.advance(t);
});

const panelWidth = () => (window.innerWidth >= 980 ? 440 : 0);

// Messwerte und ein Eingriff für die Tests: `pilot` ersetzt die Steuerung.
const debug = { frames: 0, ms: 0, worst: 0, pilot: null };

function frame() {
  const started = now();
  try {
    drawFrame(started);
  } finally {
    const spent = now() - started;
    debug.frames += 1;
    debug.ms += spent;
    if (spent > debug.worst) debug.worst = spent;
    requestAnimationFrame(frame);
  }
}

function drawFrame(t) {
  let view = null;
  let screen = 'start';
  const code = inputCode();
  if (session) {
    session.client.frame(t, debug.pilot ? debug.pilot(session.client) : code);
    view = session.client.view(t);
    const status = session.client.status;
    const live = view.ready && (status === 'in' || status === 'lost')
      && (view.phase === PHASE.COUNTDOWN || view.phase === PHASE.PLAY || view.phase === PHASE.RESULT);
    screen = live ? 'game' : 'room';
  }
  const ownView = Boolean(view && view.ready && (view.phase !== PHASE.LOBBY));
  demoWanted = !ownView;

  put('screen', screen, (v) => {
    document.body.dataset.screen = v;
    $('#start').hidden = v !== 'start';
    $('#room').hidden = v !== 'room';
    $('#hud').hidden = v !== 'game';
    controls.setEnabled(v === 'game');
    if (v === 'room') $('#room').scrollTop = 0;
    music.setScene(v === 'game' ? 'game' : 'menu');
    showMusicButton();
    if (v === 'game' && document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (v !== 'game') {
      $('#count').hidden = true;
      $('#result').hidden = true;
      shown.count = undefined;
      shown.result = undefined;
    }
  });

  if (screen === 'game') {
    renderer.setInsets({ top: 74, right: 12, bottom: 34, left: 12 });
    updateHud(view, t);
  } else {
    renderer.setInsets({ top: 20, right: 20, bottom: 20, left: panelWidth() + 20 });
    if (screen === 'room') updateRoom(view);
  }

  // Neue Runde oder anderes Spiel: Spuren und Funken vom letzten Mal weg
  const scene = ownView ? `${session.code}|${view.round}` : `vorschau|${demo.client.view(t).round}`;
  put('scene', scene, () => renderer.reset());

  if (ownView) {
    for (const e of session.client.effects.splice(0)) {
      renderer.effect(e, view, t);
      if (screen === 'game') {
        hudEvent(e, view);
        sfx.effect(e, view);
      }
    }
    sfx.frame(view, screen === 'game');
    tickFeed(t);
    renderer.draw(view, t, { tags: true, aim: screen === 'game' });
  } else {
    sfx.frame(null, false);
    demo.client.frame(t);
    const demoView = demo.client.view(t);
    for (const e of demo.client.effects.splice(0)) renderer.effect(e, demoView, t);
    renderer.draw(demoView, t, { tags: false, aim: false });
  }
}

window.addEventListener('resize', () => renderer.resize());
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => renderer.resize());

// Nach dem Neuladen wieder in denselben Raum
const saved = (() => {
  try {
    return JSON.parse(load(sessionStorage, 'tankwar-room') || 'null');
  } catch {
    return null;
  }
})();
showStartMode();
if (saved && saved.code && saved.code === invite && load(localStorage, 'tankwar-name')) {
  if (saved.role === 'host') openRoom(saved.code);
  else if (supported()) joinRoom(saved.code);
}

// Für die Tests
window.__tankwar = {
  get session() {
    return session;
  },
  demo,
  debug,
  view: () => (session ? session.client.view(now()) : null),
  tools: { packInput, moveIndex, aimIndex },
  music,
  sfx,
};

requestAnimationFrame(frame);
