// Fangs.io — Snake entity. Path-based slither movement (client-only local sim).
import { SNAKE, POWERS } from '../shared/constants.js';
import { clamp, turnToward, dist, nextId } from './util.js';

export class Snake {
  constructor(id, name, skin, x, y, angle, isBot) {
    this.id = id;
    this.name = name;
    this.skin = ((skin | 0) % 8 + 8) % 8;
    this.isBot = !!isBot;
    this.alive = true;
    this.angle = angle;
    this.input = { a: angle, b: 0, f: 0 };
    this.lengthF = SNAKE.START_SEGS;
    this.best = SNAKE.START_SEGS; // max length reached (score-ish)
    this.kills = 0;
    this.weapon = null; // {key, ammo}
    this.power = null; // {key, until, ...}
    this.shieldHits = 0;
    this.boostOn = false;
    this.spawnProtectedUntil = 0;
    this.deadReason = null;
    this.killerName = null;
    this._shedAcc = 0;
    this._fireCd = 0; // ms until can fire again
    this._turretCd = 0;
    this.path = [];
    this._seed(x, y, angle);
  }

  _seed(x, y, angle) {
    const need = SNAKE.START_SEGS * SNAKE.SEG_SPACING + 60;
    const fx = Math.cos(angle), fy = Math.sin(angle);
    this.path = [];
    for (let d = need; d >= 0; d -= 3) this.path.push({ x: x - fx * d, y: y - fy * d });
    this.path.push({ x, y }); // head last
  }

  head() { return this.path[this.path.length - 1]; }
  lenSegs() { return clamp(Math.floor(this.lengthF), SNAKE.MIN_SEGS, SNAKE.MAX_SEGS); }

  radius() {
    // slightly thicker as it grows, capped
    return SNAKE.SEG_RADIUS + Math.min(6, (this.lenSegs() - SNAKE.START_SEGS) * 0.03);
  }

  grow(n) {
    this.lengthF = clamp(this.lengthF + n, SNAKE.MIN_SEGS, SNAKE.MAX_SEGS);
    if (this.lengthF > this.best) this.best = this.lengthF;
  }

  // remove n segments worth of length; returns tail positions to scatter as food
  shrink(n) {
    const before = this.lenSegs();
    this.lengthF = Math.max(SNAKE.MIN_SEGS, this.lengthF - n);
    const after = this.lenSegs();
    const drops = [];
    const segs = this.segments();
    const removed = Math.max(0, before - after);
    for (let i = 0; i < removed; i++) {
      const s = segs[Math.min(segs.length - 1, after + i)];
      if (s) drops.push([s.x, s.y]);
    }
    return drops;
  }

  speedNow() {
    let s = SNAKE.BASE_SPEED;
    const overdrive = this.power && this.power.key === 'speed';
    if (overdrive) s *= POWERS.speed.mult;
    if (this.boostOn && !overdrive && this.lenSegs() > SNAKE.MIN_SEGS) s = SNAKE.BOOST_SPEED;
    return s;
  }

  // advance one tick. returns array of dropped food positions [[x,y],...]
  step(dt) {
    if (!this.alive) return [];
    const maxTurn = SNAKE.TURN_RATE * dt;
    this.angle = turnToward(this.angle, this.input.a, maxTurn);

    const overdrive = this.power && this.power.key === 'speed';
    const boosting = !!this.input.b && !overdrive && this.lenSegs() > SNAKE.MIN_SEGS;
    this.boostOn = boosting || overdrive;
    const speed = this.speedNow();

    const h = this.head();
    const nx = h.x + Math.cos(this.angle) * speed * dt;
    const ny = h.y + Math.sin(this.angle) * speed * dt;
    this.path.push({ x: nx, y: ny });

    const drops = [];
    if (boosting) {
      this._shedAcc += SNAKE.BOOST_DRAIN_SEGS_PER_S * dt;
      while (this._shedAcc >= 1 && this.lenSegs() > SNAKE.MIN_SEGS) {
        this._shedAcc -= 1;
        this.lengthF = Math.max(SNAKE.MIN_SEGS, this.lengthF - 1);
        const tail = this.path[0];
        if (tail) drops.push([tail.x, tail.y]);
      }
    }
    this._trim();
    return drops;
  }

  _trim() {
    const need = this.lenSegs() * SNAKE.SEG_SPACING + SNAKE.SEG_SPACING * 3;
    let acc = 0, cut = 0;
    for (let i = this.path.length - 1; i > 0; i--) {
      acc += dist(this.path[i].x, this.path[i].y, this.path[i - 1].x, this.path[i - 1].y);
      if (acc >= need) { cut = i - 1; break; }
    }
    if (cut > 0) this.path.splice(0, cut);
  }

  // sample path head-first every SEG_SPACING; returns lenSegs points [{x,y}]
  segments() {
    const out = [];
    const n = this.lenSegs();
    const p = this.path;
    if (p.length === 0) return out;
    let idx = p.length - 1;
    let cur = { x: p[idx].x, y: p[idx].y };
    out.push({ x: cur.x, y: cur.y });
    let need = SNAKE.SEG_SPACING;
    while (out.length < n && idx > 0) {
      const nx = p[idx - 1];
      let segLen = dist(cur.x, cur.y, nx.x, nx.y);
      if (segLen < 1e-6) { idx--; cur = { x: nx.x, y: nx.y }; continue; }
      if (segLen >= need) {
        const t = need / segLen;
        cur = { x: cur.x + (nx.x - cur.x) * t, y: cur.y + (nx.y - cur.y) * t };
        out.push({ x: cur.x, y: cur.y });
        need = SNAKE.SEG_SPACING;
      } else {
        need -= segLen;
        idx--;
        cur = { x: nx.x, y: nx.y };
      }
    }
    // pad if path too short (fresh spawn) so body always has full count
    while (out.length < n) out.push({ x: out[out.length - 1].x, y: out[out.length - 1].y });
    return out;
  }
}

// Lightweight world objects ---------------------------------------------------
export function makeFood(x, y, v) { return { id: nextId(), x, y, v: v || 1, born: 0 }; }
export function makeItem(x, y, kind) { return { id: nextId(), x, y, kind }; }
export function makeProjectile(o) {
  return {
    id: nextId(), x: o.x, y: o.y, a: o.a, kind: o.kind, owner: o.owner,
    vx: o.vx, vy: o.vy, segDamage: o.segDamage, born: o.born, life: o.life,
    armed: o.armed !== false, armAt: o.armAt || 0, triggerR: o.triggerR || 0, sitter: !!o.sitter,
  };
}
