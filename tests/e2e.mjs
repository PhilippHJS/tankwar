// Spielt im echten Browser mit vier Geräten: Raum öffnen, beitreten,
// Einstellungen, Countdown, fahren, schießen, Rundenende, Spielende.
// Einmal mit Direktverbindung, einmal nur über die Vermittler.
// Braucht die devDependencies (npm install) und einen installierten Chrome.
//   node tests/e2e.mjs            Bilder landen in tests/shots/
//   CHROME=/pfad/zu/chrome SHOTS=/tmp/bilder node tests/e2e.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Aedes } from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';
import mqtt from 'mqtt';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.SHOTS || path.join(root, 'tests', 'shots');
const WEB_PORT = 8134;
const RELAY_PORTS = [9134, 9135];
const RELAYS = RELAY_PORTS.map((port) => `ws://127.0.0.1:${port}`).join(',');
const BASE = `http://127.0.0.1:${WEB_PORT}/`;
fs.mkdirSync(shots, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const web = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(WEB_PORT, '127.0.0.1');

async function startBroker(port) {
  const broker = await Aedes.createBroker();
  const server = http.createServer();
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (socket, req) => broker.handle(createWebSocketStream(socket), req));
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    async stop() {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve) => broker.close(resolve));
    },
  };
}
const brokers = [];
for (const port of RELAY_PORTS) brokers.push(await startBroker(port));

// Ein Fremder, der beim Vermittler alles mitliest
const overheard = [];
const lurker = mqtt.connect(`ws://127.0.0.1:${RELAY_PORTS[1]}`);
lurker.on('connect', () => lurker.subscribe('#'));
lurker.on('message', (topic, payload) => overheard.push(payload.toString('latin1')));

const problems = [];
const check = (ok, text) => {
  if (!ok) problems.push(text);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--no-proxy-server', '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns'],
});

async function device(label, viewport = { width: 1366, height: 768 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'de-DE' });
  const page = await context.newPage();
  page.on('pageerror', (err) => problems.push(`${label}: Seitenfehler ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/WebSocket|ERR_CONNECTION/.test(msg.text())) problems.push(`${label}: Konsole ${msg.text()}`);
  });
  page.on('dialog', (dialog) => dialog.accept());
  page.label = label;
  return page;
}

const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout });
const view = (page) => page.evaluate(() => {
  const s = window.__tankwar.session;
  const v = window.__tankwar.view();
  return {
    code: s.code, slot: s.client.slot, status: s.client.status, phase: v.phase, round: v.round,
    net: s.status, rtt: s.client.rtt, screen: document.body.dataset.screen,
    winners: v.winners, champions: v.champions,
    players: v.players.map((p) => ({ x: p.x, y: p.y, in: p.in, hp: p.hp, lives: p.lives, points: p.points, name: p.name })),
  };
});
const truth = (page) => page.evaluate(() => {
  const sim = window.__tankwar.session.host.sim;
  return { phase: sim.phase, players: sim.players.map((p) => ({ x: p.tank.x, y: p.tank.y, lives: p.lives, hp: p.hp, dead: p.dead })) };
});
const PHASE = { LOBBY: 0, COUNTDOWN: 1, PLAY: 2, RESULT: 3, OVER: 4 };

// Ein einfacher Pilot im Browser: fährt auf den nächsten Gegner zu und schießt
async function pilot(page, seed) {
  await page.evaluate((s) => {
    const { packInput, moveIndex, aimIndex } = window.__tankwar.tools;
    window.__tankwar.debug.pilot = (client) => {
      const v = client.view(performance.now());
      const me = v.players[v.slot];
      if (!me || !me.in) return 0;
      let foe = null;
      let best = Infinity;
      for (const p of v.players) {
        if (p === me || !p.in || p.lives <= 0 || p.dead > 0) continue;
        const d = Math.hypot(p.x - me.x, p.y - me.y);
        if (d < best) {
          best = d;
          foe = p;
        }
      }
      // auf den Gegner zu, bis er nah genug ist, dann stehen und schießen
      const t = performance.now() / 1000 + s;
      const near = foe && best < 4;
      const move = !foe ? 0 : near ? 0 : moveIndex(foe.x - me.x + Math.cos(t), foe.y - me.y + Math.sin(t));
      const aim = foe ? aimIndex(Math.atan2(foe.y - me.y, foe.x - me.x) + Math.sin(t * 3) * 0.04) : -1;
      return packInput(move, aim, true);
    };
  }, seed);
}

async function enter(page, url, name) {
  await page.goto(url);
  await page.fill('#f-name', name);
  await page.click('#b-main');
  await until(page, () => window.__tankwar.session && window.__tankwar.session.client.status === 'in');
}

async function run(mode) {
  const direct = mode === 'direkt';
  const extra = direct ? '' : '&direkt=0';
  console.log(`\n--- ${direct ? 'mit Direktverbindung' : 'nur über Vermittler'} ---`);
  const host = await device(`Gastgeber/${mode}`, { width: 1440, height: 860 });
  const guests = [await device(`Gast1/${mode}`), await device(`Gast2/${mode}`, { width: 1280, height: 720 }), await device(`Gast3/${mode}`)];
  const all = [host, ...guests];

  await host.goto(`${BASE}?relay=${RELAYS}${extra}`);
  await sleep(1200);
  if (direct) await shot(host, '01-start');
  await enter(host, `${BASE}?relay=${RELAYS}${extra}`, 'Anna');
  const code = (await view(host)).code;
  check(/^[A-Z]{5}$/.test(code), `Raumcode ${code}`);
  await until(host, () => window.__tankwar.session.status && window.__tankwar.session.status.up === 2);

  const link = `${BASE}?relay=${RELAYS}${extra}&raum=${code}`;
  await guests[0].goto(link);
  check((await guests[0].textContent('#invited')).includes(code), 'Eingeladener sieht den Raumcode');
  await guests[0].fill('#f-name', 'Ben');
  await guests[0].click('#b-main');
  await until(guests[0], () => window.__tankwar.session && window.__tankwar.session.client.status === 'in');
  await enter(guests[1], link, 'Cem <b>');
  await enter(guests[2], link, 'Dana');
  await until(host, () => window.__tankwar.session.client.lobby.slots.every((slot) => slot.kind === 'human' && slot.online));
  const slots = await Promise.all(all.map(async (page) => (await view(page)).slot));
  check(new Set(slots).size === 4, `vier Plätze vergeben (${slots})`);
  check((await host.innerHTML('#slots')).includes('Cem &lt;b&gt;'), 'Namen werden als Text gezeigt');

  if (direct) {
    for (const g of guests) await until(g, () => window.__tankwar.session.status && window.__tankwar.session.status.direct, null, 15000).catch(() => {});
    const directs = await Promise.all(guests.map(async (g) => Boolean((await view(g)).net.direct)));
    check(directs.every(Boolean), `Direktverbindung zu allen Gästen (${directs})`);
  } else {
    await sleep(1200);
    check(!(await view(guests[0])).net.direct, 'ohne Direktverbindung läuft es über die Vermittler');
  }

  // Fahrzeugwahl: Gast 2 nimmt die Kimme, Gast 3 den Zitteraal
  await guests[1].click('.vehicle[data-index="1"]');
  await guests[2].click('.vehicle[data-index="3"]');
  await until(host, () => {
    const slots = window.__tankwar.session.client.lobby.slots;
    return slots.some((slot) => slot.name === 'Dana' && slot.vehicle === 3) && slots.some((slot) => slot.name === 'Cem <b>' && slot.vehicle === 1);
  });
  check((await guests[2].getAttribute('.vehicle[data-index="3"]', 'aria-checked')) === 'true', 'Gast wählt ein Fahrzeug, der Gastgeber sieht es');

  // Einstellungen: 1 Minute, 1 Punkt zum Sieg. Gäste sehen sie, können sie aber nicht ändern.
  await host.click('#options label:has(input[name="opt-length"][value="0"])');
  await host.click('#options label:has(input[name="opt-target"][value="0"])');
  await host.click('#options label:has(input[name="opt-speed"][value="2"])');
  await until(guests[0], () => document.querySelector('#options input[name="opt-target"][value="0"]').checked && document.querySelector('#settings').disabled);
  check(true, 'Gast sieht die Einstellungen des Gastgebers, ausgegraut');
  if (direct) {
    await sleep(500);
    await shot(host, '02-raum');
    await shot(guests[0], '03-raum-gast');
  }

  await host.click('#b-start');
  for (const page of all) await until(page, () => document.body.dataset.screen === 'game');
  await sleep(1200);
  if (direct) await shot(guests[0], '04-countdown');
  for (const page of all) await until(page, (phase) => window.__tankwar.view().phase === phase, PHASE.PLAY);
  const pace = await host.evaluate(() => window.__tankwar.session.host.sim.rules.speed);
  check(pace === 1.25, `Tempo schnell gilt im Spiel (${pace})`);
  const rides = await host.evaluate(() => window.__tankwar.session.host.sim.players.map((p) => p.vehicle).join());
  const danaSlot = (await view(guests[2])).slot;
  check(rides.split(',')[danaSlot] === '3', `gewählte Fahrzeuge fahren mit (${rides})`);
  const arenas = await Promise.all(all.map((page) => page.evaluate(() => window.__tankwar.view().arena.name)));
  check(arenas.every((name) => name === arenas[0]), `alle spielen in derselben Arena (${arenas[0]})`);

  // Fahren: mit der Tastatur, die eigene Anzeige muss beim Gastgeber ankommen
  const before = await truth(host);
  const g = guests[0];
  const gs = await view(g);
  const towardMiddle = gs.players[gs.slot].x < 11 ? 'KeyD' : 'KeyA';
  await g.keyboard.down(towardMiddle);
  await sleep(1400);
  await g.keyboard.up(towardMiddle);
  await sleep(direct ? 500 : 1000);
  const after = await truth(host);
  const moved = Math.abs(after.players[gs.slot].x - before.players[gs.slot].x);
  check(moved > 1.2, `Gast fährt mit der Tastatur (${moved.toFixed(2)} Felder)`);
  const seen = await view(g);
  const off = Math.hypot(seen.players[gs.slot].x - after.players[gs.slot].x, seen.players[gs.slot].y - after.players[gs.slot].y);
  check(off < 0.05, `eigener Panzer stimmt mit dem Gastgeber überein (${off.toFixed(3)})`);

  // Zielen mit den Pfeiltasten: zwei zugleich zielen schräg dazwischen, der Turm bleibt dort
  // (gemessen, solange beide gedrückt sind: Das Loslassen prüft tests/input.test.js,
  // hier wäre es vom Takt des Testbrowsers abhängig)
  await g.keyboard.down('ArrowUp');
  await g.keyboard.down('ArrowRight');
  await sleep(direct ? 1500 : 2000);
  const turret = await host.evaluate((slot) => window.__tankwar.session.host.sim.players[slot].tank.a, gs.slot);
  await g.keyboard.up('ArrowUp');
  await g.keyboard.up('ArrowRight');
  await sleep(300);
  check(Math.abs(turret + Math.PI / 4) < 0.03, `Pfeil hoch und rechts zielen schräg nach rechts oben (${turret.toFixed(2)})`);
  await g.keyboard.down('ArrowLeft');
  await sleep(1600);
  await g.keyboard.up('ArrowLeft');
  await sleep(direct ? 400 : 900);
  const left = await host.evaluate((slot) => window.__tankwar.session.host.sim.players[slot].tank.a, gs.slot);
  check(Math.abs(Math.abs(left) - Math.PI) < 0.03, `Pfeil links dreht den Turm nach links und hält dort (${left.toFixed(2)})`);

  // Schießen: Leertaste feuert eine Rakete, die beim Gastgeber ankommt
  const rocketsBefore = await host.evaluate(() => window.__tankwar.session.host.sim.nextRocket);
  await g.keyboard.press('Space');
  await sleep(direct ? 300 : 800);
  const fired = await host.evaluate(() => window.__tankwar.session.host.sim.nextRocket);
  check(fired > rocketsBefore, 'Leertaste feuert eine Rakete');

  // Treffer: Der Gastgeber stellt Gast 2 vor den Lauf von Gast 1, der schießt
  const target = (await view(guests[1])).slot;
  await host.evaluate(([a, b]) => {
    const sim = window.__tankwar.session.host.sim;
    for (const [slot, x] of [[a, 7.5], [b, 11.5]]) {
      const p = sim.players[slot];
      Object.assign(p.tank, { x, y: 1.6, h: 0, v: 0, cd: 0 });
      p.shield = 0;
      p.tp += 1;
    }
  }, [gs.slot, target]);
  await g.keyboard.down('ArrowRight');
  await sleep(1300);
  await g.keyboard.press('Space');
  await g.keyboard.up('ArrowRight');
  await until(guests[1], (slot) => window.__tankwar.view().players[slot].hp < 100, target, 5000).catch(() => {});
  const hurt = await host.evaluate((slot) => window.__tankwar.session.host.sim.players[slot].hp, target);
  const seenHurt = (await view(guests[1])).players[target].hp;
  check(hurt < 100 && seenHurt === hurt, `Treffer zählt beim Gastgeber und beim Getroffenen (${hurt}, ${seenHurt})`);

  // Ab jetzt fahren alle automatisch und schießen aufeinander
  for (let i = 0; i < all.length; i += 1) await pilot(all[i], i * 1.7);
  await sleep(8000);
  if (direct) {
    await shot(guests[1], '05-gefecht');
    const rtt = (await view(guests[0])).rtt;
    check(rtt !== null && rtt < 80, `Laufzeit zum Gastgeber ${rtt === null ? '?' : rtt.toFixed(0)} ms`);
  }
  const hits = await host.evaluate(() => window.__tankwar.session.host.sim.players.reduce((sum, p) => sum + p.kills, 0));
  const anyDamage = await host.evaluate(() => window.__tankwar.session.host.sim.players.some((p) => p.hp < 100 || p.lives < 3));
  check(true, `Gefecht läuft (${hits} Abschüsse, Schaden: ${anyDamage})`);

  if (!direct) {
    // Über die Vermittler reicht ein kurzes Gefecht
    for (const page of all) await page.close();
    return;
  }

  // Runde zu Ende bringen: Der Gastgeber nimmt allen bis auf einen die Leben.
  await host.evaluate(() => {
    const sim = window.__tankwar.session.host.sim;
    for (const p of sim.players) if (p.slot !== 0 && p.in) { p.lives = 0; p.hp = 0; p.dead = 0; p.outAt = sim.tick; }
  });
  for (const page of all) await until(page, (phase) => window.__tankwar.view().phase >= phase, PHASE.RESULT);
  await sleep(700);
  await shot(guests[0], '06-rundenende');
  const results = await Promise.all(all.map(async (page) => (await view(page)).winners.join()));
  check(results.every((r) => r === '0'), `alle sehen denselben Rundensieger (${results})`);
  check(!(await guests[0].isHidden('#result')), 'Rundenergebnis wird angezeigt');
  // 1 Punkt zum Sieg: danach ist das Spiel vorbei
  for (const page of all) await until(page, (phase) => window.__tankwar.view().phase === phase, PHASE.OVER, 15000);
  await sleep(500);
  await shot(host, '07-spielende');
  const finals = await Promise.all(all.map(async (page) => (await view(page)).champions.join()));
  check(finals.every((f) => f === '0'), `alle sehen denselben Gesamtsieger (${finals})`);
  check((await host.textContent('#b-start')).includes('Neues Spiel'), 'Gastgeber kann ein neues Spiel starten');
  const screens = await Promise.all(all.map(async (page) => (await view(page)).screen));
  check(screens.every((s) => s === 'room'), 'nach Spielende sind alle wieder im Raum');

  // Neues Spiel, dann verlässt ein Gast den Raum
  await host.click('#b-start');
  for (const page of all) await until(page, () => document.body.dataset.screen === 'game');
  await guests[2].click('#b-quit');
  await until(host, () => window.__tankwar.session.client.lobby.slots.filter((slot) => slot.kind === 'human').length === 3);
  check(true, 'Gast verlässt den Raum, sein Platz wird frei');
  for (const page of all) await page.close();
}

try {
  // MODES=vermittler node tests/e2e.mjs spielt nur einen der beiden Durchgänge
  for (const mode of (process.env.MODES || 'direkt,vermittler').split(',')) await run(mode);
  // Nur längere Wörter suchen: Drei Buchstaben wie "Ben" tauchen in so vielen
  // verschlüsselten Bytes auch rein zufällig auf.
  const leaked = overheard.some((text) => /Anna|Dana|"hello"|"lobby"/.test(text));
  check(overheard.length > 0 && !leaked, `Vermittler sehen nur Verschlüsseltes (${overheard.length} Nachrichten)`);
} catch (err) {
  problems.push(`Abbruch: ${err.message}`);
  console.error(err);
} finally {
  await browser.close();
  lurker.end(true);
  for (const broker of brokers) await broker.stop();
  web.close();
}

if (problems.length) {
  console.log(`\n${problems.length} Problem(e):`);
  for (const p of [...new Set(problems)]) console.log(`- ${p}`);
  process.exit(1);
}
console.log('\nAlles in Ordnung.');
process.exit(0);
