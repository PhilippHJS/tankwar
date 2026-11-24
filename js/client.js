// Die Sicht eines Geräts auf das Spiel.
//
// Der eigene Panzer wird bei jeder Eingabe sofort im eigenen Browser
// vorausberechnet, ohne auf den Gastgeber zu warten. Kommt dessen gültiger
// Stand an, werden die noch unbestätigten Eingaben darauf erneut angewendet.
// Weicht das vom Gezeigten ab, gleitet der Panzer unmerklich dorthin.
//
// Eigene Schüsse fliegen sofort los. Sobald der Gastgeber die Rakete bestätigt,
// wird sie durch seine ersetzt, ohne Sprung. Raketen prallen nur an festen
// Wänden ab, deshalb lässt sich ihr Flug genau bis in die Gegenwart
// weiterrechnen. Die anderen Panzer laufen mit einer kleinen Verzögerung
// zwischen zwei bekannten Ständen, damit sie auch bei unruhiger Verbindung
// flüssig fahren.

import { arenaOf } from './arenas.js';
import { withStones, dropStones, stonesBy, stoneOrder } from './stones.js';
import {
  newTank, copyTank, stepTank, launchRocket, stepRocket, copyRocket, gunRay, rayHitsCircle, blastPoint, IDLE, inputFire, withoutFire, wrap, angleDiff,
  newGhost, copyGhost, stepGhost, rimPoint, rimLength, ghostTarget,
} from './physics.js';
import { PHASE, EVENT, modeOf } from './sim.js';
import { DT, TICK_RATE, PROTOCOL, MAX_PLAYERS, VEHICLES, BOT_NAMES, TANK_R, cleanVehicle, rulesFor, vehicleFor, ghostFor } from './config.js';

const STEP_MS = DT * 1000;
const LOST_MS = 5000;

// Felder eines Panzers im Spielstand
export const P = {
  IN: 0, X: 1, Y: 2, H: 3, A: 4, V: 5, CD: 6, HP: 7, LIVES: 8, DEAD: 9, SHIELD: 10, PTS: 11, TP: 12, VEH: 13, KILLS: 14,
  AMMO: 15, CH: 16, MANA: 17, ZT: 18, REST: 19, LOCK: 20, ON: 21, OX: 22, OY: 23, CA: 24,
  GA: 25, GS: 26, GCD: 27, GCH: 28, // Geist: aktiv, Stelle auf dem Rand, Pause bis zum nächsten Wurf, Wurfweite
};
// Felder einer Geisterbombe
const B = { ID: 0, OWNER: 1, SX: 2, SY: 3, TX: 4, TY: 5, K0: 6, LAND: 7, BOOM: 8 };
// Felder einer Rakete
const R = { ID: 0, OWNER: 1, SEQ: 2, X: 3, Y: 4, VX: 5, VY: 6, LIFE: 7, B: 8 };
// Zusätzliche Effekte neben den Ereignissen des Gastgebers; ein Stein landet
export const FX = { FIRE: 100, THROW: 101, STONE: 102 };

export function createClient({ id, name, watch = false, link, vehicle = 0 }) {
  const client = {
    id,
    name,
    vehicle,
    status: 'joining', // joining | in | full | old | lost | closed
    slot: -1,
    lobby: null,
    arena: arenaOf(0), // im Sudden Death eine eigene Kopie, in die Steine fallen
    base: arenaOf(0),
    latest: null,
    rtt: null,
    effects: [], // Ereignisse fürs Zeichnen, werden dort abgeholt
  };

  const snaps = [];
  const pending = []; // eigene Eingaben, die der Gastgeber noch nicht bestätigt hat
  const me = newTank(0, 0, 0);
  const mePrev = newTank(0, 0, 0);
  const ghost = newGhost(); // der eigene Geist, vorausberechnet
  const ghostPrev = newGhost();
  const err = { x: 0, y: 0 };
  const seenEvents = new Set();
  const seenRockets = new Set();
  const recent = [];
  let ghosts = []; // eigene Raketen, die der Gastgeber noch nicht bestätigt hat
  const offsets = new Map(); // Rakete -> { x, y }: Rest des Übergangs von der eigenen zur bestätigten
  let others = []; // andere Panzer zum Anstoßen in der Vorhersage
  let seq = 0;
  let myTp = -1;
  let haveMe = false;
  let alpha = 1;
  let acc = 0;
  let lastFrame = null;
  let lastHello = -1e9;
  let lastPing = 0;
  let lastHeard = null;
  let stepsSinceSend = 0;
  let epoch = null;
  let welcomeN = 0;
  let wantFire = false;
  let fadeMs = 0;

  // Uhrenabgleich: Schrittnummer des Gastgebers als Funktion der eigenen Zeit
  const samples = [];
  let interval = 1;
  let delay = 3;
  let lastSnapK = null;

  function hostTickAt(now) {
    let best = -Infinity;
    for (const s of samples) if (s.v > best) best = s.v;
    return best + now / STEP_MS;
  }

  // Das eigene Fahrzeug im Tempo des laufenden Spiels, wie beim Gastgeber
  const speedNow = () => (client.latest ? rulesFor(client.latest.o).speed : 1);
  const myVehicle = () => vehicleFor(client.latest && client.slot >= 0 ? client.latest.p[client.slot][P.VEH] : client.vehicle, speedNow());

  function renderMe(out) {
    out.x = mePrev.x + (me.x - mePrev.x) * alpha + err.x;
    out.y = mePrev.y + (me.y - mePrev.y) * alpha + err.y;
    out.h = mePrev.h + angleDiff(me.h, mePrev.h) * alpha;
    out.a = mePrev.a + angleDiff(me.a, mePrev.a) * alpha;
    return out;
  }
  const before = { x: 0, y: 0, h: 0, a: 0 };
  const after = { x: 0, y: 0, h: 0, a: 0 };

  function loadTank(tank, arr) {
    tank.x = arr[P.X];
    tank.y = arr[P.Y];
    tank.h = arr[P.H];
    tank.a = arr[P.A];
    tank.v = arr[P.V];
    tank.cd = arr[P.CD];
    tank.ammo = arr[P.AMMO];
    tank.ch = arr[P.CH];
    tank.mana = arr[P.MANA];
    tank.zt = arr[P.ZT];
    tank.rest = arr[P.REST];
    tank.lock = arr[P.LOCK];
    tank.on = arr[P.ON];
    tank.ox = arr[P.OX];
    tank.oy = arr[P.OY];
    tank.ca = arr[P.CA];
  }
  const isLive = (arr) => arr[P.IN] === 1 && arr[P.LIVES] > 0 && arr[P.DEAD] === 0;
  const isGhost = (arr) => arr[P.GA] === 1;
  const ghostParams = () => ghostFor(speedNow());
  function loadGhost(g, arr) {
    g.s = arr[P.GS];
    g.cd = arr[P.GCD];
    g.ch = arr[P.GCH];
  }
  // Auf dem Ring zwischen zwei Stellen, über den kürzeren Weg
  function rimMix(a, b, f) {
    const L = rimLength(client.arena);
    let d = b - a;
    if (d > L / 2) d -= L;
    else if (d < -L / 2) d += L;
    return (((a + d * f) % L) + L) % L;
  }

  // Gültigen Stand übernehmen und die offenen Eingaben erneut anwenden
  function reconcile(snap) {
    const arr = snap.p[client.slot];
    const ack = snap.a[client.slot];
    while (pending.length && pending[0].seq <= ack) pending.shift();
    renderMe(before);
    loadTank(me, arr);
    copyTank(me, mePrev);
    const mode = modeOf(snap.ph);
    if (mode >= 0 && isLive(arr)) {
      const vehicle = myVehicle();
      for (let i = 0; i < pending.length; i += 1) {
        if (i === pending.length - 1) copyTank(me, mePrev);
        stepTank(client.arena, me, pending[i].code, vehicle, mode, others);
      }
    }
    // Als Geist: Stelle auf dem Rand und Wurfweite genauso vorausberechnen
    if (isGhost(arr)) {
      loadGhost(ghost, arr);
      copyGhost(ghost, ghostPrev);
      const params = ghostParams();
      for (let i = 0; i < pending.length; i += 1) {
        if (i === pending.length - 1) copyGhost(ghost, ghostPrev);
        stepGhost(client.arena, ghost, pending[i].code, params, mode);
      }
    }
    renderMe(after);
    const jumped = arr[P.TP] !== myTp || !haveMe;
    myTp = arr[P.TP];
    haveMe = true;
    const dx = before.x - after.x;
    const dy = before.y - after.y;
    if (jumped || !isLive(arr) || dx * dx + dy * dy > 1) {
      err.x = 0;
      err.y = 0;
    } else {
      err.x += dx;
      err.y += dy;
    }
  }

  function onSnapshot(snap, now) {
    if (!Array.isArray(snap.p) || snap.p.length !== MAX_PLAYERS) return;
    if (client.latest && (snap.rn < client.latest.rn || snap.k < client.latest.k - 2 * TICK_RATE)) return;
    const arena = arenaOf(snap.ar);
    if (arena !== client.base || (client.latest && snap.rn !== client.latest.rn)) {
      client.base = arena;
      client.arena = arena;
      snaps.length = 0;
      ghosts = [];
      offsets.clear();
    }

    let at = snaps.length;
    while (at > 0 && snaps[at - 1].k > snap.k) at -= 1;
    if (at > 0 && snaps[at - 1].k === snap.k) return;
    snaps.splice(at, 0, snap);
    while (snaps.length > 2 && snaps[snaps.length - 1].k - snaps[0].k > 2 * TICK_RATE) snaps.shift();

    samples.push({ v: snap.k - now / STEP_MS, at: now });
    while (samples.length > 1 && now - samples[0].at > 2500) samples.shift();
    if (lastSnapK !== null && snap.k > lastSnapK) interval += (Math.min(snap.k - lastSnapK, 12) - interval) * 0.1;
    if (lastSnapK === null || snap.k > lastSnapK) lastSnapK = snap.k;

    for (const e of snap.e || []) {
      if (seenEvents.has(e[0])) continue;
      seenEvents.add(e[0]);
      // Beim Einstieg mitten in der Runde keine alten Ereignisse nachspielen.
      // Eigene Schüsse und Bomben sind schon beim Drücken gezeigt worden.
      const own = e[3] === client.slot && (e[2] === EVENT.SHOT || e[2] === EVENT.BLAST);
      if (client.latest && !own) client.effects.push({ id: e[0], tick: e[1], kind: e[2], by: e[3], of: e[4], x: e[5], y: e[6], item: e[7], x2: e[8], y2: e[9] });
    }
    if (seenEvents.size > 600) {
      const keep = new Set((snap.e || []).map((e) => e[0]));
      for (const old of seenEvents) if (!keep.has(old)) seenEvents.delete(old);
    }

    if (!client.latest || snap.k > client.latest.k) {
      const fresh = !client.latest;
      client.latest = snap;
      others = [];
      snap.p.forEach((arr, slot) => {
        if (slot !== client.slot && isLive(arr)) others.push({ x: arr[P.X], y: arr[P.Y] });
      });
      // Neue Raketen der anderen: Mündungsfeuer
      for (const r of snap.r || []) {
        if (seenRockets.has(r[R.ID])) continue;
        seenRockets.add(r[R.ID]);
        const mineGhost = r[R.OWNER] === client.slot && ghosts.some((g) => g.seq === r[R.SEQ]);
        if (!fresh && !mineGhost) client.effects.push({ kind: FX.FIRE, by: r[R.OWNER], x: r[R.X], y: r[R.Y] });
      }
      if (seenRockets.size > 400) {
        const keep = new Set((snap.r || []).map((r) => r[R.ID]));
        for (const old of seenRockets) if (!keep.has(old)) seenRockets.delete(old);
      }
      if (client.slot >= 0) reconcile(snap);
    }
  }

  function forget() {
    client.status = 'joining';
    client.slot = -1;
    client.lobby = null;
    client.latest = null;
    snaps.length = 0;
    samples.length = 0;
    pending.length = 0;
    ghosts = [];
    offsets.clear();
    seenEvents.clear();
    seenRockets.clear();
    haveMe = false;
    lastSnapK = null;
    lastHello = -1e9;
    welcomeN = 0;
  }

  client.receive = (msg, now) => {
    if (!msg || typeof msg !== 'object') return;
    lastHeard = now;
    if (client.status === 'lost') client.status = client.slot >= 0 || watch ? 'in' : 'joining';
    if (msg.h !== undefined && msg.h !== epoch) {
      if (epoch !== null) forget();
      epoch = msg.h;
    }
    if (msg.t === 's') {
      if (client.status === 'in') onSnapshot(msg, now);
    } else if (msg.t === 'lobby') {
      if (client.lobby && msg.n < client.lobby.n) return;
      client.lobby = msg;
      if (client.status === 'in' && !watch && msg.n >= welcomeN && !msg.slots.some((slot) => slot.id === id)) {
        client.status = 'joining';
        client.slot = -1;
        haveMe = false;
      }
    } else if (msg.t === 'welcome') {
      client.status = 'in';
      welcomeN = msg.n || 0;
      if (client.slot !== msg.slot) {
        client.slot = msg.slot;
        pending.length = 0;
        ghosts = [];
        haveMe = false;
      }
    } else if (msg.t === 'full') {
      if (client.status !== 'in') client.status = 'full';
    } else if (msg.t === 'closed') {
      client.status = 'closed';
    } else if (msg.t === 'old') {
      client.status = 'old';
    } else if (msg.t === 'pong') {
      const rtt = now - msg.ts;
      if (rtt >= 0 && rtt < 5000) client.rtt = client.rtt === null ? rtt : client.rtt + (rtt - client.rtt) * 0.3;
    }
  };

  // Spielt der eigene Panzer gerade mit und lebt?
  function myArr() {
    return client.latest && client.slot >= 0 ? client.latest.p[client.slot] : null;
  }

  // Eigener Schuss, sofort gezeigt: Rakete fliegt los, Pistole zieht ihre
  // Spur, Bombe explodiert. Ob getroffen wurde, sagt der Gastgeber.
  function showShot(w, shot) {
    if (w.kind === 'rocket') {
      const g = { seq, r: launchRocket(client.arena, me, w) };
      stepRocket(client.arena, g.r);
      ghosts.push(g);
      client.effects.push({ kind: FX.FIRE, by: client.slot, x: g.r.x, y: g.r.y });
    } else if (w.kind === 'gun') {
      const ray = gunRay(client.arena, me, w.range);
      let end = ray.len;
      for (const o of others) end = Math.min(end, rayHitsCircle(ray.sx, ray.sy, ray.dx, ray.dy, ray.len, o.x, o.y, TANK_R));
      client.effects.push({ kind: EVENT.SHOT, by: client.slot, of: -1, x: ray.sx, y: ray.sy, x2: ray.sx + ray.dx * end, y2: ray.sy + ray.dy * end });
    } else if (w.kind === 'mortar') {
      const at = blastPoint(client.arena, me, shot);
      client.effects.push({ kind: EVENT.BLAST, by: client.slot, of: -1, x: at.x, y: at.y, item: Math.round(w.radius * 100) });
    }
  }

  // Sudden Death: Steine fallen lassen, bis zum Schritt, in dem der Gastgeber
  // gerade ist. Wann welcher fällt, steht fest. Nach Rundenende liegen so
  // viele, wie der Gastgeber sagt.
  // Der Schritt, in dem der Gastgeber jetzt gerade ist, wie bei den Raketen
  const presentTick = (now) => hostTickAt(now) + Math.min((client.rtt || 0) / 2, 120) / STEP_MS;
  function updateStones(now) {
    const latest = client.latest;
    if (!latest || !latest.sd) return;
    if (client.arena === client.base) client.arena = withStones(client.base);
    const playing = latest.ph === PHASE.PLAY && samples.length;
    // Runde vorbei, aber hier schon ein Stein mehr gefallen: zurück auf den Stand des Gastgebers
    if (!playing && (latest.sn || 0) < client.arena.stones) {
      client.arena = withStones(client.base);
      dropStones(client.arena, latest.sn || 0);
    }
    const arena = client.arena;
    const total = stoneOrder(arena).cells.length;
    const want = playing ? stonesBy(latest.sd, Math.floor(presentTick(now)), speedNow(), total) : latest.sn || 0;
    if (want <= arena.stones) return;
    const quiet = want - arena.stones > 8; // mitten im Sudden Death dazugekommen
    for (const cell of dropStones(arena, want)) {
      const cx = cell % arena.W;
      if (!quiet) client.effects.push({ kind: FX.STONE, x: cx + 0.5, y: (cell - cx) / arena.W + 0.5 });
    }
  }

  // Einmal pro Bild: Zeit vorrücken, Eingabe anwenden und verschicken.
  client.frame = (now, inputCode = IDLE) => {
    if (lastFrame === null) lastFrame = now;
    let elapsed = now - lastFrame;
    lastFrame = now;
    if (elapsed > 250) elapsed = STEP_MS;
    acc += elapsed;
    fadeMs = elapsed;

    if (lastHeard !== null && now - lastHeard > LOST_MS && (client.status === 'in' || client.status === 'joining')) client.status = 'lost';
    const knock = client.status === 'full' ? 3000 : 1000;
    if ((client.status === 'joining' || client.status === 'lost' || client.status === 'full') && now - lastHello > knock) {
      lastHello = now;
      link.send({ t: 'hello', name: client.name, v: PROTOCOL, vehicle: client.vehicle, watch: watch || undefined }, false);
    }
    if (now - lastPing > 1000) {
      lastPing = now;
      link.send({ t: 'ping', ts: now }, false);
    }

    updateStones(now);
    const arr = myArr();
    const mode = client.latest ? modeOf(client.latest.ph) : -1;
    const playing = client.status === 'in' && haveMe && arr && arr[P.IN] === 1 && mode >= 0;
    if (inputFire(inputCode) && playing) wantFire = true;
    if (!playing) wantFire = false;
    const vehicle = myVehicle();
    while (acc >= STEP_MS) {
      acc -= STEP_MS;
      for (const g of ghosts) stepRocket(client.arena, g.r);
      if (!playing) continue;
      // Ein kurzer Klick zählt auch, wenn er zwischen zwei Schritte fällt
      const code = withoutFire(inputCode) | (inputFire(inputCode) || wantFire ? 32 : 0);
      wantFire = false;
      seq += 1;
      pending.push({ seq, code });
      if (pending.length > 240) pending.shift();
      copyTank(me, mePrev);
      const shot = isLive(arr) ? stepTank(client.arena, me, code, vehicle, mode, others) : 0;
      if (shot) showShot(vehicle.weapon, shot);
      if (isGhost(arr)) {
        copyGhost(ghost, ghostPrev);
        const at = rimPoint(client.arena, ghost.s);
        if (stepGhost(client.arena, ghost, code, ghostParams(), mode)) client.effects.push({ kind: FX.THROW, by: client.slot, x: at.x, y: at.y });
      }
      recent.push(code);
      if (recent.length > 8) recent.shift();
      stepsSinceSend += 1;
      const direct = link.direct();
      if (stepsSinceSend >= (direct ? 1 : 2)) {
        stepsSinceSend = 0;
        const count = Math.min(recent.length, direct ? 4 : 8);
        link.send({ t: 'i', s: seq, c: recent.slice(recent.length - count) }, true);
      }
    }
    alpha = acc / STEP_MS;

    const fade = Math.exp(-elapsed / 70);
    err.x *= fade;
    err.y *= fade;

    if (samples.length) {
      let best = -Infinity;
      let worst = Infinity;
      for (const s of samples) {
        if (s.v > best) best = s.v;
        if (s.v < worst) worst = s.v;
      }
      const target = Math.min(Math.max(interval + (best - worst) + 0.5, 1.5), 30);
      delay += (target - delay) * (target > delay ? 0.2 : 0.02);
    }
  };

  const lerpOut = { x: 0, y: 0, h: 0, a: 0, v: 0, tp: 0 };
  function remoteAt(slot, tick) {
    const n = snaps.length;
    if (!n) return null;
    let b = 0;
    while (b < n && snaps[b].k <= tick) b += 1;
    const take = (p) => {
      lerpOut.x = p[P.X];
      lerpOut.y = p[P.Y];
      lerpOut.h = p[P.H];
      lerpOut.a = p[P.A];
      lerpOut.v = p[P.V];
      lerpOut.tp = p[P.TP];
      return lerpOut;
    };
    if (b === 0) return take(snaps[0].p[slot]);
    const pa = snaps[b - 1].p[slot];
    if (b === n) {
      // neuester Stand ist schon älter: kurz in Fahrtrichtung weiterdenken
      take(pa);
      const ahead = Math.min(tick - snaps[n - 1].k, 8) * DT;
      if (isLive(pa) && modeOf(snaps[n - 1].ph) > 0) {
        lerpOut.x += Math.cos(pa[P.H]) * pa[P.V] * ahead;
        lerpOut.y += Math.sin(pa[P.H]) * pa[P.V] * ahead;
      }
      return lerpOut;
    }
    const pb = snaps[b].p[slot];
    if (pa[P.TP] !== pb[P.TP]) return take(pa);
    const f = (tick - snaps[b - 1].k) / (snaps[b].k - snaps[b - 1].k);
    lerpOut.x = pa[P.X] + (pb[P.X] - pa[P.X]) * f;
    lerpOut.y = pa[P.Y] + (pb[P.Y] - pa[P.Y]) * f;
    lerpOut.h = wrap(pa[P.H] + angleDiff(pb[P.H], pa[P.H]) * f);
    lerpOut.a = wrap(pa[P.A] + angleDiff(pb[P.A], pa[P.A]) * f);
    lerpOut.v = pb[P.V];
    lerpOut.tp = pa[P.TP];
    return lerpOut;
  }

  function ghostAt(slot, tick) {
    const n = snaps.length;
    if (!n) return null;
    let b = 0;
    while (b < n && snaps[b].k <= tick) b += 1;
    if (b === 0) return snaps[0].p[slot][P.GS];
    const pa = snaps[b - 1].p[slot];
    if (b === n) return pa[P.GS];
    const pb = snaps[b].p[slot];
    if (!isGhost(pa) || !isGhost(pb)) return pb[P.GS];
    return rimMix(pa[P.GS], pb[P.GS], (tick - snaps[b - 1].k) / (snaps[b].k - snaps[b - 1].k));
  }

  // Raketen des Gastgebers bis in die Gegenwart weitergerechnet
  const probe = {};
  const next = {};
  function rocketNow(arr, tick, out) {
    probe.x = arr[R.X];
    probe.y = arr[R.Y];
    probe.vx = arr[R.VX];
    probe.vy = arr[R.VY];
    probe.life = arr[R.LIFE];
    probe.b = arr[R.B];
    const ahead = Math.max(0, Math.min(tick - client.latest.k, 15));
    const whole = Math.floor(ahead);
    for (let i = 0; i < whole && probe.life > 0; i += 1) stepRocket(client.arena, probe);
    if (probe.life <= 0) return false;
    copyRocket(probe, next);
    stepRocket(client.arena, next);
    const f = ahead - whole;
    out.x = probe.x + (next.x - probe.x) * f;
    out.y = probe.y + (next.y - probe.y) * f;
    out.vx = next.vx;
    out.vy = next.vy;
    return true;
  }

  const view = {
    ready: false, phase: PHASE.LOBBY, round: 0, tick: 0, ticksLeft: 0, arena: client.arena, levels: null, sd: 0, speed: 1,
    slot: -1, winners: [], champions: [], rockets: [], bombs: [],
    players: Array.from({ length: MAX_PLAYERS }, (_, slot) => ({
      slot, in: false, x: 0, y: 0, h: 0, a: 0, v: 0, hp: 0, maxHp: 100, lives: 0, dead: 0, shield: 0,
      points: 0, kills: 0, tp: 0, vehicle: 0, reload: 1, ammo: 0, ch: 0, ox: 0, oy: 0, ca: 0, mana: 1, on: 0, name: BOT_NAMES[slot], kind: 'free', online: true, mine: false,
    })),
  };
  const rocketPool = [];

  // Alles, was gezeichnet wird, für den Zeitpunkt `now`.
  client.view = (now) => {
    const latest = client.latest;
    view.ready = Boolean(latest && latest.rn > 0);
    view.slot = client.slot;
    if (!latest) return view;
    const hostTick = hostTickAt(now);
    view.phase = latest.ph;
    view.round = latest.rn;
    view.arena = client.arena;
    view.levels = latest.o;
    view.sd = latest.sd || 0;
    view.speed = speedNow();
    view.stoneTick = latest.ph === PHASE.PLAY ? presentTick(now) : -Infinity; // fürs Zeichnen der fallenden Steine
    view.tick = hostTick;
    view.ticksLeft = Math.max(0, latest.pe - hostTick);
    view.winners = latest.w || [];
    view.champions = latest.c || [];
    const renderTick = hostTick - delay;
    for (const out of view.players) {
      const arr = latest.p[out.slot];
      const info = client.lobby && client.lobby.slots[out.slot];
      out.mine = out.slot === client.slot;
      if (out.mine && haveMe) {
        renderMe(out);
        out.v = me.v;
        out.tp = arr[P.TP];
      } else {
        const r = remoteAt(out.slot, renderTick);
        if (r) {
          out.x = r.x; out.y = r.y; out.h = r.h; out.a = r.a; out.v = r.v; out.tp = r.tp;
        }
      }
      out.in = arr[P.IN] === 1;
      out.vehicle = cleanVehicle(arr[P.VEH]);
      out.maxHp = VEHICLES[out.vehicle].health;
      out.hp = arr[P.HP];
      out.lives = arr[P.LIVES];
      out.dead = arr[P.DEAD];
      out.shield = arr[P.SHIELD];
      out.points = arr[P.PTS];
      out.kills = arr[P.KILLS];
      // Waffe: Magazin, Zielkreis, Mana, Blitzen. Beim eigenen Panzer vorausberechnet.
      const tank = out.mine && haveMe ? me : null;
      out.ammo = tank ? tank.ammo : arr[P.AMMO];
      out.ch = tank ? tank.ch : arr[P.CH];
      out.mana = tank ? tank.mana : arr[P.MANA];
      out.on = tank ? tank.on : arr[P.ON];
      out.ox = tank ? tank.ox : arr[P.OX];
      out.oy = tank ? tank.oy : arr[P.OY];
      out.ca = tank ? tank.ca : arr[P.CA];
      // Geist
      out.ghost = isGhost(arr);
      if (out.ghost) {
        const mine = out.mine && haveMe;
        const s = mine ? rimMix(ghostPrev.s, ghost.s, alpha) : ghostAt(out.slot, renderTick);
        const at = rimPoint(client.arena, s);
        out.gx = at.x;
        out.gy = at.y;
        out.gnx = at.nx;
        out.gny = at.ny;
        out.gch = mine ? ghost.ch : arr[P.GCH];
        const cdMax = Math.max(1, Math.round(ghostParams().cooldown * TICK_RATE));
        out.gready = 1 - Math.min(cdMax, Math.max(0, mine ? ghost.cd : arr[P.GCD])) / cdMax;
        if (out.gch > 0) {
          const target = ghostTarget(client.arena, { s }, out.gch);
          out.gtx = target.x;
          out.gty = target.y;
        }
      }
      // Nachladen: 1 heißt bereit
      const w = vehicleFor(out.vehicle, speedNow()).weapon;
      const cdSecs = w.kind === 'gun' ? (out.ammo <= 0 ? w.reload : w.interval) : w.cooldown || 0;
      const cdMax = Math.max(1, Math.round(cdSecs * TICK_RATE));
      const cd = tank ? tank.cd : arr[P.CD];
      out.reload = 1 - Math.min(cdMax, Math.max(0, cd)) / cdMax;
      if (info) {
        out.name = info.name;
        out.kind = info.kind;
        out.online = info.online;
      }
    }

    // Geisterbomben: im Bogen vom Rand zum Ziel, dann liegen sie kurz und blinken
    view.bombs.length = 0;
    for (const b of latest.g || []) {
      if (hostTick >= b[B.BOOM]) continue;
      const f = Math.min(1, Math.max(0, (hostTick - b[B.K0]) / Math.max(1, b[B.LAND] - b[B.K0])));
      view.bombs.push({
        id: b[B.ID], owner: b[B.OWNER],
        x: b[B.SX] + (b[B.TX] - b[B.SX]) * f, y: b[B.SY] + (b[B.TY] - b[B.SY]) * f,
        tx: b[B.TX], ty: b[B.TY], height: Math.sin(Math.PI * f), landed: f >= 1,
        fuse: f >= 1 ? Math.min(1, (hostTick - b[B.LAND]) / Math.max(1, b[B.BOOM] - b[B.LAND])) : 0,
      });
    }

    // Raketen: bestätigte bis in die Gegenwart, eigene noch unbestätigte dazu
    const rocketTick = hostTick + Math.min((client.rtt || 0) / 2, 120) / STEP_MS;
    const ack = client.slot >= 0 ? latest.a[client.slot] : 0;
    const fade = Math.exp(-fadeMs / 90);
    const list = view.rockets;
    list.length = 0;
    const real = latest.r || [];
    for (let i = 0; i < real.length; i += 1) {
      const arr = real[i];
      const out = rocketPool[list.length] || (rocketPool[list.length] = {});
      if (!rocketNow(arr, rocketTick, out)) continue;
      out.id = arr[R.ID];
      out.owner = arr[R.OWNER];
      out.ghost = false;
      if (out.owner === client.slot) {
        const g = ghosts.findIndex((ghost) => ghost.seq === arr[R.SEQ]);
        if (g >= 0) {
          offsets.set(out.id, { x: ghosts[g].r.x - out.x, y: ghosts[g].r.y - out.y });
          ghosts.splice(g, 1);
        }
      }
      const off = offsets.get(out.id);
      if (off) {
        off.x *= fade;
        off.y *= fade;
        out.x += off.x;
        out.y += off.y;
        if (Math.abs(off.x) + Math.abs(off.y) < 0.002) offsets.delete(out.id);
      }
      list.push(out);
    }
    if (offsets.size > 50) offsets.clear();
    // Hat der Gastgeber die Eingabe schon verarbeitet und keine Rakete dazu, gab es keine
    ghosts = ghosts.filter((g) => g.r.life > 0 && g.seq > ack);
    for (const g of ghosts) {
      const out = rocketPool[list.length] || (rocketPool[list.length] = {});
      out.id = -g.seq;
      out.owner = client.slot;
      out.ghost = true;
      out.x = g.r.x;
      out.y = g.r.y;
      out.vx = g.r.vx;
      out.vy = g.r.vy;
      list.push(out);
    }
    return view;
  };

  // Für die Zielhilfe: wo der eigene Panzer gerade gezeigt wird
  client.myTank = () => (haveMe ? renderMe({}) : null);
  client.predicted = () => (haveMe ? me : null);
  client.setVehicle = (index) => {
    client.vehicle = cleanVehicle(index);
    link.send({ t: 'veh', v: client.vehicle }, false);
  };
  client.delayMs = () => delay * STEP_MS;
  client.leave = () => link.send({ t: 'bye' }, false);
  client.debug = () => ({ pending: pending.length, ghosts: ghosts.length, err: Math.hypot(err.x, err.y), delay, interval, seq, me: copyTank(me) });
  return client;
}
