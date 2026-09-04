// Fangs.io — client networking (owner: CLIENTNET)
// WebSocket transport, snapshot buffering + interpolation, input throttling, ping tracking.
// Browser ES module only — no Node APIs.

import { NET, SKINS } from '/shared/constants.js';

// Protocol-level timings (defined by SPEC.md protocol, not gameplay tuning):
const PING_INTERVAL_MS = 2000;       // send {t:'ping'} every 2s
const PING_SAMPLE_WINDOW = 8;        // rolling average window for ping
const INPUT_KEEPALIVE_MS = 100;      // resend unchanged input at most every 100ms
const INPUT_MIN_GAP_MS = 1000 / 30;  // protocol: input messages max 30Hz
const INPUT_ANGLE_EPS = 0.005;       // rad — below this a steer change is "unchanged"
const SNAP_BUFFER_MAX = 30;          // hard cap on buffered snapshots
const SNAP_BUFFER_KEEP_MS = 1000;    // drop snaps older than this behind the newest
const PING_PENDING_STALE_MS = 10000; // forget unanswered pings after this long

function num(v, fallback = 0) {
  v = +v;
  return Number.isFinite(v) ? v : fallback;
}

function lerp(a, b, t) {
  a = +a; b = +b;
  if (!Number.isFinite(b)) return Number.isFinite(a) ? a : 0;
  if (!Number.isFinite(a)) return b;
  return a + (b - a) * t;
}

// Shortest-arc angle interpolation.
function lerpAngle(a, b, t) {
  a = +a; b = +b;
  if (!Number.isFinite(b)) return Number.isFinite(a) ? a : 0;
  if (!Number.isFinite(a)) return b;
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function angleDelta(a, b) {
  let d = (num(b) - num(a)) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

// Deep-enough copy of a snap snake so callers can never mutate the buffer.
function cloneSnake(s) {
  const out = { ...s };
  const fx = Array.isArray(s.fx) ? s.fx.slice() : [];
  out.fx = fx;
  out.segs = Array.isArray(s.segs)
    ? s.segs.map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [num(s.x), num(s.y)]))
    : [];
  return out;
}

// Interpolate one snake between an older and newer snap entry.
// Segs match by index from the HEAD end (index 0 = head end); extra tail
// segments that only exist in the newer snap appear as-is (no popping).
function lerpSnakePair(o, n, t) {
  const out = { ...n };
  out.fx = Array.isArray(n.fx) ? n.fx.slice() : [];
  out.x = lerp(o.x, n.x, t);
  out.y = lerp(o.y, n.y, t);
  out.a = lerpAngle(o.a, n.a, t);
  const os = Array.isArray(o.segs) ? o.segs : [];
  const ns = Array.isArray(n.segs) ? n.segs : [];
  const segs = new Array(ns.length);
  for (let i = 0; i < ns.length; i++) {
    const np = ns[i];
    const op = i < os.length ? os[i] : null;
    if (Array.isArray(np) && Array.isArray(op)) {
      segs[i] = [lerp(op[0], np[0], t), lerp(op[1], np[1], t)];
    } else if (Array.isArray(np)) {
      segs[i] = [num(np[0]), num(np[1])];
    } else {
      segs[i] = [out.x, out.y];
    }
  }
  out.segs = segs;
  return out;
}

export class Net {
  // handlers: { onWelcome(msg), onSnap(rawSnap), onDead(msg), onClose(), onFull?(msg) }
  constructor(handlers) {
    this.handlers = handlers && typeof handlers === 'object' ? handlers : {};
    this.ws = null;
    this.id = null; // my snake id, set by 'welcome'

    this._snaps = []; // [{ snap, time }] time = local performance.now() at receive

    this._pingSeq = 0;
    this._pingPending = new Map(); // id -> sentAt
    this._pingSamples = [];
    this._pingAvg = 0;
    this._pingTimer = null;

    this._lastInput = null; // {a,b,f} last actually sent
    this._lastInputTime = -Infinity;
  }

  get ping() {
    return Math.round(this._pingAvg);
  }

  get connected() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  connect(name, skin) {
    this._teardown(false);

    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error('[net] websocket create failed', err);
      this._call('onClose');
      return;
    }
    this.ws = ws;

    const safeName = String(name == null ? '' : name).slice(0, 16) || 'snake';
    const maxSkin = SKINS.length - 1;
    const safeSkin = Math.min(maxSkin, Math.max(0, Math.floor(num(skin))));

    ws.onopen = () => {
      // Nothing is ever queued before OPEN; join is the first frame out.
      this._send({ t: 'join', name: safeName, skin: safeSkin });
      this._startPing();
    };
    ws.onmessage = (e) => this._onMessage(e);
    ws.onerror = () => { /* onclose always follows; nothing to do here */ };
    ws.onclose = () => {
      if (this.ws !== ws) return; // stale socket from a reconnect
      this._stopPing();
      this.ws = null;
      this._call('onClose');
    };
  }

  // s = {a, b, f}. Sends only when the input changed (with a 30Hz cap) or
  // when 100ms elapsed since the last send (keepalive). Drops silently when
  // the socket is not OPEN — nothing is queued.
  sendInput(s) {
    if (!s || typeof s !== 'object') return;
    if (!this.connected) return;
    const a = num(s.a);
    const b = s.b ? 1 : 0;
    const f = s.f ? 1 : 0;
    const now = performance.now();
    const since = now - this._lastInputTime;
    const last = this._lastInput;
    const changed =
      !last || b !== last.b || f !== last.f || angleDelta(last.a, a) > INPUT_ANGLE_EPS;

    if (changed ? since < INPUT_MIN_GAP_MS : since < INPUT_KEEPALIVE_MS) return;

    if (this._send({ t: 'input', a, b, f })) {
      this._lastInput = { a, b, f };
      this._lastInputTime = now;
    }
  }

  respawn() {
    this._send({ t: 'respawn' });
  }

  // Interpolated render-state for `now` (performance.now() clock — the rAF
  // timestamp main.js receives is the same timebase). Renders the world as it
  // was NET.INTERP_DELAY_MS ago, lerping between the two snaps that straddle
  // that instant. Returns {sn, fd, it, pj, me} or null before the first snap.
  view(now) {
    const buf = this._snaps;
    if (buf.length === 0) return null;
    const t0 = Number.isFinite(+now) ? +now : performance.now();
    const renderTime = t0 - NET.INTERP_DELAY_MS;

    const newest = buf[buf.length - 1];
    if (buf.length === 1 || renderTime >= newest.time) {
      // Snapshot gap / stall: hold the last snap's entities rather than popping.
      return this._compose(newest.snap, newest.snap, 1);
    }
    if (renderTime <= buf[0].time) {
      return this._compose(buf[0].snap, buf[0].snap, 1);
    }

    // Find the pair straddling renderTime (buffer is receive-ordered).
    let hi = buf.length - 1;
    while (hi > 0 && buf[hi - 1].time > renderTime) hi--;
    const older = buf[hi - 1];
    const newer = buf[hi];
    const span = newer.time - older.time;
    let t = span > 0 ? (renderTime - older.time) / span : 1;
    if (!Number.isFinite(t)) t = 1;
    t = Math.min(1, Math.max(0, t));
    return this._compose(older.snap, newer.snap, t);
  }

  // ---- internals ----------------------------------------------------------

  _compose(oldS, newS, t) {
    // Snakes: union of both snaps. In both -> lerped; only one -> as-is.
    const oldSn = new Map();
    if (Array.isArray(oldS.sn)) {
      for (const s of oldS.sn) if (s && s.id != null) oldSn.set(s.id, s);
    }
    const sn = [];
    const seen = new Set();
    if (Array.isArray(newS.sn)) {
      for (const s of newS.sn) {
        if (!s || s.id == null) continue;
        seen.add(s.id);
        const o = oldSn.get(s.id);
        sn.push(o && oldS !== newS ? lerpSnakePair(o, s, t) : cloneSnake(s));
      }
    }
    if (oldS !== newS) {
      for (const [id, o] of oldSn) if (!seen.has(id)) sn.push(cloneSnake(o));
    }

    // Food / items: the newer snap's arrays verbatim (treat as read-only).
    const fd = Array.isArray(newS.fd) ? newS.fd : [];
    const it = Array.isArray(newS.it) ? newS.it : [];

    // Projectiles: newer snap's list; lerp position when the id exists in both.
    const oldPj = new Map();
    if (Array.isArray(oldS.pj)) {
      for (const p of oldS.pj) if (Array.isArray(p)) oldPj.set(p[0], p);
    }
    const pj = [];
    if (Array.isArray(newS.pj)) {
      for (const p of newS.pj) {
        if (!Array.isArray(p)) continue;
        const o = oldS !== newS ? oldPj.get(p[0]) : null;
        if (o) {
          pj.push([p[0], lerp(o[1], p[1], t), lerp(o[2], p[2], t), lerpAngle(o[3], p[3], t), p[4]]);
        } else {
          pj.push([p[0], num(p[1]), num(p[2]), num(p[3]), p[4]]);
        }
      }
    }

    // me: newer me merged with the interpolated position of my own snake.
    let me = null;
    if (newS.me && typeof newS.me === 'object') {
      me = { ...newS.me };
      if (this.id != null) {
        const mine = sn.find((s) => s.id === this.id);
        if (mine) {
          me.x = mine.x;
          me.y = mine.y;
          me.a = mine.a;
        }
      }
      me.x = num(me.x);
      me.y = num(me.y);
      me.a = num(me.a);
    }

    return { sn, fd, it, pj, me };
  }

  _onMessage(e) {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return; // malformed frame: ignore
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'welcome':
        this.id = msg.id;
        this._call('onWelcome', msg);
        break;
      case 'snap':
        this._pushSnap(msg);
        // Events (msg.ev) and leaderboard (msg.lb) ride the raw snap and are
        // handed over immediately — they are NOT delayed by interpolation.
        this._call('onSnap', msg);
        break;
      case 'dead':
        this._call('onDead', msg);
        break;
      case 'pong':
        this._onPong(msg);
        break;
      case 'full':
        this._call('onFull', msg); // server closes the socket after; onClose follows
        break;
      default:
        break; // unknown message type: ignore
    }
  }

  _pushSnap(snap) {
    const time = performance.now();
    this._snaps.push({ snap, time });
    // Trim: keep at most SNAP_BUFFER_MAX and only the recent window, but
    // always retain at least 2 snaps so view() can interpolate.
    const buf = this._snaps;
    while (buf.length > SNAP_BUFFER_MAX) buf.shift();
    while (buf.length > 2 && buf[0].time < time - SNAP_BUFFER_KEEP_MS) buf.shift();
  }

  _startPing() {
    this._stopPing();
    const tick = () => {
      const now = performance.now();
      const id = ++this._pingSeq;
      this._pingPending.set(id, now);
      this._send({ t: 'ping', id });
      // Forget pings the server never answered.
      for (const [pid, sent] of this._pingPending) {
        if (now - sent > PING_PENDING_STALE_MS) this._pingPending.delete(pid);
      }
    };
    tick(); // immediate first sample
    this._pingTimer = setInterval(tick, PING_INTERVAL_MS);
  }

  _stopPing() {
    if (this._pingTimer !== null) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    this._pingPending.clear();
  }

  _onPong(msg) {
    const sent = this._pingPending.get(msg.id);
    if (sent === undefined) return;
    this._pingPending.delete(msg.id);
    const rtt = performance.now() - sent;
    if (!Number.isFinite(rtt) || rtt < 0) return;
    this._pingSamples.push(rtt);
    while (this._pingSamples.length > PING_SAMPLE_WINDOW) this._pingSamples.shift();
    let sum = 0;
    for (const v of this._pingSamples) sum += v;
    this._pingAvg = sum / this._pingSamples.length;
  }

  _send(obj) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch (err) {
      console.error('[net] send failed', err);
      return false;
    }
  }

  _call(name, arg) {
    const fn = this.handlers[name];
    if (typeof fn !== 'function') return;
    try {
      fn(arg);
    } catch (err) {
      console.error(`[net] handler ${name} threw`, err);
    }
  }

  // Detach a previous socket (reconnect path). Fresh connection state.
  _teardown(notify) {
    this._stopPing();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch { /* already closed */ }
    }
    this.id = null;
    this._snaps = [];
    this._pingSamples = [];
    this._pingAvg = 0;
    this._lastInput = null;
    this._lastInputTime = -Infinity;
    if (notify) this._call('onClose');
  }
}
