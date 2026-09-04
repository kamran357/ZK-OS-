// server/index.js - Fangs.io NET module (owner: NET)
// Entry point: HTTP static server + WebSocket sessions + sim loop + snapshot loop.
// One port (default 8787) serves the client statics AND the websocket.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

import { WORLD, TICK, AOI_RADIUS, SPAWN, NET, SKINS } from '../shared/constants.js';
import { World } from './world.js';
import { BotController } from './bots.js';

const PORT = Number(process.env.PORT) || 8787;

// Protocol-level (not game-tuning) constants, per SPEC server/index.js contract.
const JOIN_TIMEOUT_MS = 5000;      // first message must be a valid join within this window
const INPUT_MAX_PER_S = 60;        // input msgs per rolling second above this are dropped
const PING_MAX_PER_S = 10;         // ping msgs per rolling second above this are dropped
const MAX_MSG_BYTES = 2048;        // any frame larger than this is ignored
const HEARTBEAT_MS = 30000;        // ws-level ping to reap dead sockets

// ---------------------------------------------------------------------------
// Paths (import.meta.url based so cwd never matters)
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'client');
const SHARED_DIR = path.join(ROOT, 'shared');
const ASSETS_DIR = path.join(ROOT, 'assets');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

// ---------------------------------------------------------------------------
// Small numeric helpers (NaN can never reach the wire)
// ---------------------------------------------------------------------------

function num(v, d = 0) {
  return Number.isFinite(v) ? v : d;
}

function r1(v) {
  return Math.round(num(v) * 10) / 10;
}

// Throttled error logger so one broken client/tick cannot spam stdout.
const errLogLast = new Map();
function logErr(tag, err) {
  const now = Date.now();
  if (now - (errLogLast.get(tag) || 0) < 2000) return;
  errLogLast.set(tag, now);
  const detail = err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : String(err);
  console.error(`[err:${tag}] ${detail}`);
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------

function plain(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

// Join baseDir + rel, normalize, and refuse anything that escapes baseDir.
function resolveSafe(baseDir, rel) {
  const p = path.normalize(path.join(baseDir, rel));
  if (p === baseDir || p.startsWith(baseDir + path.sep)) return p;
  return null;
}

async function handleHttp(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, 404, 'not found');

    let pathname = (req.url || '/').split('?')[0].split('#')[0];
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      return plain(res, 404, 'not found');
    }
    if (pathname.includes('\0')) return plain(res, 404, 'not found');
    if (pathname === '/') pathname = '/index.html';

    let filePath;
    if (pathname.startsWith('/shared/')) {
      filePath = resolveSafe(SHARED_DIR, pathname.slice('/shared/'.length));
    } else if (pathname.startsWith('/assets/')) {
      filePath = resolveSafe(ASSETS_DIR, pathname.slice('/assets/'.length));
    } else {
      // client/ files are served at root paths: /main.js, /styles.css, ...
      filePath = resolveSafe(CLIENT_DIR, pathname.slice(1));
    }
    if (!filePath) return plain(res, 404, 'not found');

    const type = MIME[path.extname(filePath).toLowerCase()];
    if (!type) return plain(res, 404, 'not found');

    let body;
    try {
      body = await readFile(filePath);
    } catch {
      return plain(res, 404, 'not found');
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    logErr('http', err);
    try {
      plain(res, 500, 'server error');
    } catch {
      /* socket already gone */
    }
  }
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

const world = new World();
const bots = new BotController(world);

const clients = new Map(); // snakeId -> client record (humans only)
const aliveState = new Map(); // snakeId -> last observed alive flag (humans + bots, for kill log)
let nextClientId = 1;
let simTick = 0;

function humanCount() {
  let n = 0;
  for (const c of clients.values()) if (c.joined) n++;
  return n;
}

function send(ws, obj) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch (err) {
    logErr('send', err);
  }
}

function safeClose(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch {
    /* ignore */
  }
  const t = setTimeout(() => {
    try {
      if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
    } catch {
      /* ignore */
    }
  }, 3000);
  if (typeof t.unref === 'function') t.unref();
}

// ---------------------------------------------------------------------------
// Sanitizers / defensive readers for state owned by CORE and COMBAT
// ---------------------------------------------------------------------------

function sanitizeName(raw) {
  let s = typeof raw === 'string' ? raw : '';
  s = s.replace(/[^\x20-\x7E]/g, '').trim().slice(0, 16).trim();
  return s || 'snake';
}

function sanitizeSkin(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), SKINS.length - 1);
}

function headOf(snake) {
  try {
    const h = snake.head();
    if (h && Number.isFinite(h.x) && Number.isFinite(h.y)) return { x: h.x, y: h.y };
  } catch {
    /* fall through */
  }
  return { x: WORLD.W / 2, y: WORLD.H / 2 };
}

function boostOf(snake) {
  if (typeof snake.boosting === 'boolean') return snake.boosting ? 1 : 0;
  const inp = snake.input;
  return inp && (inp.b === 1 || inp.b === true) ? 1 : 0;
}

function fxOf(snake, now) {
  if (Array.isArray(snake.fx)) {
    return snake.fx.filter((x) => typeof x === 'string').slice(0, 4);
  }
  const pw = snake.power;
  if (pw && typeof pw === 'object') {
    const k = pw.k ?? pw.key;
    if (typeof k === 'string' && k && (!Number.isFinite(pw.until) || pw.until > now)) return [k];
  }
  return [];
}

function hpOf(snake) {
  if (Number.isFinite(snake.hp)) return Math.round(snake.hp);
  const pw = snake.power;
  if (pw && typeof pw === 'object') {
    const k = pw.k ?? pw.key;
    if (k === 'shield' && Number.isFinite(pw.hits)) return Math.round(pw.hits);
  }
  return 0;
}

// Extract killer name + cause from whatever shape CORE stored on the snake.
function deathInfo(snake) {
  let w = 'body';
  const d = snake.dead;
  if (typeof d === 'string' && d) {
    w = d;
  } else if (d && typeof d === 'object') {
    if (typeof d.w === 'string' && d.w) w = d.w;
    else if (typeof d.reason === 'string' && d.reason) w = d.reason;
  }
  if (typeof snake.deadReason === 'string' && snake.deadReason) w = snake.deadReason;
  else if (typeof snake.deathReason === 'string' && snake.deathReason) w = snake.deathReason;

  let k = '';
  const candidates = [
    snake.killerName,
    snake.killedBy,
    snake.killer,
    d && typeof d === 'object' ? d.k : null,
    d && typeof d === 'object' ? d.killer : null,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c) {
      k = c;
      break;
    }
    if (c && typeof c === 'object' && typeof c.name === 'string' && c.name) {
      k = c.name;
      break;
    }
  }
  if (!k) k = w === 'border' ? 'the border' : 'the arena';
  return { k, w };
}

// ---------------------------------------------------------------------------
// Snapshot packing (exact SPEC protocol; every number NaN-guarded + rounded)
// ---------------------------------------------------------------------------

function packSnake(snake, now) {
  const h = headOf(snake);
  let raw = [];
  try {
    raw = snake.segments() || [];
  } catch {
    raw = [];
  }
  const segs = [];
  for (let i = 0; i < raw.length; i += 2) {
    const p = raw[i];
    if (!p) continue;
    segs.push([r1(p[0]), r1(p[1])]);
  }
  return {
    id: snake.id,
    n: String(snake.name ?? 'snake'),
    sk: Number.isInteger(snake.skin) ? snake.skin : 0,
    x: r1(h.x),
    y: r1(h.y),
    a: r1(num(snake.angle, 0)),
    segs,
    boost: boostOf(snake),
    len: Math.round(num(snake.length, 0)),
    fx: fxOf(snake, now),
  };
}

function packMe(snake, now) {
  const h = headOf(snake);
  let wpn = null;
  const wp = snake.weapon;
  if (wp && typeof wp === 'object') {
    const k = wp.k ?? wp.kind ?? wp.key;
    if (typeof k === 'string' && k) wpn = { k, ammo: Math.max(0, Math.round(num(wp.ammo, 0))) };
  }
  let pw = null;
  const p = snake.power;
  if (p && typeof p === 'object') {
    const k = p.k ?? p.key;
    if (typeof k === 'string' && k && (!Number.isFinite(p.until) || p.until > now)) {
      pw = { k, until: Math.round(num(p.until, 0)) };
    }
  }
  return {
    x: r1(h.x),
    y: r1(h.y),
    a: r1(num(snake.angle, 0)),
    len: Math.round(num(snake.length, 0)),
    score: Math.round(num(snake.score, 0)),
    hp: hpOf(snake),
    wpn,
    pw,
    boost: boostOf(snake),
  };
}

function sendSnapshot(client, lb, now) {
  const snake = world.snakes.get(client.id);
  if (snake && snake.alive) {
    const h = headOf(snake);
    client.cx = h.x;
    client.cy = h.y;
  }
  // While dead the camera stays at the last death position.
  const aoi = world.queryAOI(client.cx, client.cy, AOI_RADIUS) || {};

  const sn = [];
  if (Array.isArray(aoi.sn)) {
    for (const s of aoi.sn) {
      if (!s || !s.alive) continue;
      sn.push(packSnake(s, now));
    }
  }
  const fd = [];
  if (Array.isArray(aoi.fd)) {
    for (const f of aoi.fd) {
      if (!f) continue;
      fd.push([f.id, r1(f.x), r1(f.y), Math.max(1, Math.round(num(f.v, 1)))]);
    }
  }
  const it = [];
  if (Array.isArray(aoi.it)) {
    for (const item of aoi.it) {
      if (!item) continue;
      it.push([item.id, r1(item.x), r1(item.y), String(item.kind ?? 'crate')]);
    }
  }
  const pj = [];
  if (Array.isArray(aoi.pj)) {
    for (const proj of aoi.pj) {
      if (!proj) continue;
      pj.push([proj.id, r1(proj.x), r1(proj.y), r1(num(proj.a ?? proj.angle, 0)), String(proj.kind ?? proj.k ?? 'blaster')]);
    }
  }

  let ev = [];
  try {
    ev = world.drainEvents(client.id) || [];
  } catch (err) {
    logErr('drainEvents', err);
  }

  const snap = { t: 'snap', tk: simTick, sn, fd, it, pj, ev, lb };
  if (snake && snake.alive) snap.me = packMe(snake, now);
  send(client.ws, snap);
}

// Detect alive -> dead transitions for ALL snakes (kill log) and notify humans once.
function scanDeaths(now) {
  for (const [id, s] of world.snakes) {
    const isAlive = !!(s && s.alive);
    const was = aliveState.get(id);
    if (was === undefined) {
      aliveState.set(id, isAlive);
      continue;
    }
    if (was && !isAlive) {
      aliveState.set(id, false);
      const { k, w } = deathInfo(s);
      console.log(`[kill] ${s.name} (${id}) by ${k} via ${w}`);
      const client = clients.get(id);
      if (client) {
        client.deathAt = now;
        send(client.ws, {
          t: 'dead',
          k,
          w,
          score: Math.round(num(s.score, 0)),
          len: Math.round(num(s.length, 0)),
          ms: SPAWN.RESPAWN_COOLDOWN_MS,
        });
      }
      if (s.justDied) {
        try {
          s.justDied = false; // consume the flag so nothing double-fires
        } catch {
          /* frozen object, fine */
        }
      }
    } else if (!was && isAlive) {
      aliveState.set(id, true);
    }
  }
  for (const id of aliveState.keys()) {
    if (!world.snakes.has(id)) aliveState.delete(id);
  }
}

// ---------------------------------------------------------------------------
// WebSocket message handling
// ---------------------------------------------------------------------------

function handleMessage(client, msg) {
  const now = Date.now();
  switch (msg.t) {
    case 'join': {
      if (client.joined) return;
      if (humanCount() >= NET.MAX_PLAYERS) {
        send(client.ws, { t: 'full' });
        safeClose(client.ws, 4001, 'server full');
        return;
      }
      const name = sanitizeName(msg.name);
      const skin = sanitizeSkin(msg.skin);
      const id = 'h' + (nextClientId++).toString(36);
      let snake;
      try {
        snake = world.addPlayer(id, name, skin, false);
      } catch (err) {
        logErr('addPlayer', err);
        safeClose(client.ws, 4002, 'join failed');
        return;
      }
      client.id = id;
      client.name = name;
      client.joined = true;
      client.deathAt = 0;
      clearTimeout(client.joinTimer);
      const h = snake ? headOf(snake) : { x: WORLD.W / 2, y: WORLD.H / 2 };
      client.cx = h.x;
      client.cy = h.y;
      aliveState.set(id, true);
      clients.set(id, client);
      send(client.ws, { t: 'welcome', id, w: WORLD.W, h: WORLD.H });
      console.log(`[join] ${name} (${id}) skin=${skin} humans=${humanCount()}`);
      return;
    }
    case 'input': {
      if (!client.joined) return;
      if (now - client.inWindowStart >= 1000) {
        client.inWindowStart = now;
        client.inCount = 0;
      }
      client.inCount++;
      if (client.inCount > INPUT_MAX_PER_S) return; // rolling rate limit: drop
      let a = Number(msg.a);
      if (!Number.isFinite(a)) return;
      a = Math.atan2(Math.sin(a), Math.cos(a)); // normalize to (-PI, PI], kills abs-huge values
      if (!Number.isFinite(a)) return;
      const b = msg.b === 1 || msg.b === true ? 1 : 0;
      const f = msg.f === 1 || msg.f === true ? 1 : 0;
      try {
        world.setInput(client.id, { a, b, f });
      } catch (err) {
        logErr('setInput', err);
      }
      return;
    }
    case 'respawn': {
      if (!client.joined) return;
      const snake = world.snakes.get(client.id);
      if (!snake || snake.alive) return;
      if (!client.deathAt || now - client.deathAt < SPAWN.RESPAWN_COOLDOWN_MS) return;
      try {
        world.respawn(client.id);
        client.deathAt = 0;
        const s2 = world.snakes.get(client.id);
        if (s2 && s2.alive) {
          aliveState.set(client.id, true);
          const h = headOf(s2);
          client.cx = h.x;
          client.cy = h.y;
        }
      } catch (err) {
        logErr('respawn', err);
      }
      return;
    }
    case 'ping': {
      if (now - client.pingWindowStart >= 1000) {
        client.pingWindowStart = now;
        client.pingCount = 0;
      }
      client.pingCount++;
      if (client.pingCount > PING_MAX_PER_S) return;
      const pid = msg.id;
      if (typeof pid === 'number' || (typeof pid === 'string' && pid.length <= 64)) {
        send(client.ws, { t: 'pong', id: pid });
      }
      return;
    }
    default:
      return; // unknown message types are silently ignored
  }
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

const server = http.createServer(handleHttp);
const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws) => {
  const client = {
    id: null,
    ws,
    name: '',
    joined: false,
    cx: WORLD.W / 2,
    cy: WORLD.H / 2,
    deathAt: 0,
    inWindowStart: 0,
    inCount: 0,
    pingWindowStart: 0,
    pingCount: 0,
    joinTimer: null,
  };

  ws.isAlivePing = true;
  ws.on('pong', () => {
    ws.isAlivePing = true;
  });

  client.joinTimer = setTimeout(() => {
    if (!client.joined) safeClose(ws, 4000, 'join timeout');
  }, JOIN_TIMEOUT_MS);

  ws.on('message', (data) => {
    let msg;
    try {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      if (text.length > MAX_MSG_BYTES) return;
      msg = JSON.parse(text);
    } catch {
      return; // malformed frame: ignore, never throw
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    try {
      handleMessage(client, msg);
    } catch (err) {
      logErr('message', err);
    }
  });

  ws.on('close', () => {
    clearTimeout(client.joinTimer);
    if (client.joined && client.id) {
      try {
        world.removePlayer(client.id);
      } catch (err) {
        logErr('removePlayer', err);
      }
      aliveState.delete(client.id);
      clients.delete(client.id);
      console.log(`[leave] ${client.name} (${client.id}) humans=${humanCount()}`);
    }
  });

  ws.on('error', (err) => {
    logErr('ws', err);
  });
});

wss.on('error', (err) => {
  logErr('wss', err);
});

// Sim loop: fixed cadence, clamped dt so pauses/lag spikes never teleport snakes.
let lastTickAt = Date.now();
setInterval(() => {
  const now = Date.now();
  let dt = (now - lastTickAt) / 1000;
  lastTickAt = now;
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  else if (dt > 0.1) dt = 0.1;
  simTick++;
  try {
    world.step(dt, now);
  } catch (err) {
    logErr('world.step', err);
  }
  try {
    bots.step(dt, now);
  } catch (err) {
    logErr('bots.step', err);
  }
}, 1000 / TICK.RATE);

// Snapshot loop: per-human AOI snap; one bad client can never kill the loop.
setInterval(() => {
  const now = Date.now();
  try {
    scanDeaths(now);
  } catch (err) {
    logErr('scanDeaths', err);
  }
  let lb = [];
  try {
    lb = (world.leaderboard() || []).slice(0, 10);
  } catch (err) {
    logErr('leaderboard', err);
  }
  for (const client of clients.values()) {
    if (!client.joined || client.ws.readyState !== WebSocket.OPEN) continue;
    try {
      sendSnapshot(client, lb, now);
    } catch (err) {
      logErr(`snapshot:${client.id}`, err);
    }
  }
}, 1000 / TICK.SNAPSHOT_HZ);

// Heartbeat: terminate sockets that stopped answering ws-level pings.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlivePing === false) {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      continue;
    }
    ws.isAlivePing = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
}, HEARTBEAT_MS);
if (typeof heartbeat.unref === 'function') heartbeat.unref();

process.on('uncaughtException', (err) => {
  logErr('uncaughtException', err);
});
process.on('unhandledRejection', (err) => {
  logErr('unhandledRejection', err);
});

process.on('SIGINT', () => {
  console.log('[shutdown] SIGINT');
  try {
    wss.close();
  } catch {
    /* ignore */
  }
  try {
    server.close(() => process.exit(0));
  } catch {
    process.exit(0);
  }
  const t = setTimeout(() => process.exit(0), 1500);
  if (typeof t.unref === 'function') t.unref();
});

server.listen(PORT, () => {
  console.log(`fangs.io server listening on http://localhost:${PORT} (ws same port)`);
});
