// Fangs.io — local authoritative World. Runs the whole sim in the browser.
import { WORLD, SNAKE, FOOD, SPAWN } from '../shared/constants.js';
import { Snake, makeFood } from './entities.js';
import { spawnItems, pickupCheck, stepCombat } from './combat.js';
import { dist, dist2, rand, nextId, clamp } from './util.js';

const FOOD_CAP = 2800;

export class World {
  constructor() {
    this.snakes = new Map();
    this.food = new Map();
    this.items = new Map();
    this.projectiles = new Map();
    this.particles = [];
    this.events = [];
    this.now = 0;
    this.shakeReq = 0;
    this.playerId = null;
    this.player = null;
    this.bots = null;
    this.onPlayerDead = null;
    for (let i = 0; i < FOOD.COUNT; i++) {
      const f = makeFood(rand(80, WORLD.W - 80), rand(80, WORLD.H - 80), 1);
      this.food.set(f.id, f);
    }
    spawnItems(this);
  }

  // -------- spawning --------
  spawnPoint() {
    let best = null, bestD = -1;
    for (let i = 0; i < SPAWN.CANDIDATES; i++) {
      const x = rand(300, WORLD.W - 300), y = rand(300, WORLD.H - 300);
      let nd = Infinity;
      for (const s of this.snakes.values()) {
        if (!s.alive) continue;
        const h = s.head();
        const d = dist2(x, y, h.x, h.y);
        if (d < nd) nd = d;
      }
      if (nd > bestD) { bestD = nd; best = { x, y }; }
    }
    return best || { x: WORLD.W / 2, y: WORLD.H / 2 };
  }

  addSnake(name, skin, isBot) {
    const p = this.spawnPoint();
    const a = rand(0, Math.PI * 2);
    const s = new Snake(nextId(), name, skin, p.x, p.y, a, isBot);
    s.spawnProtectedUntil = this.now + SNAKE.SPAWN_PROTECT_MS;
    this.snakes.set(s.id, s);
    return s;
  }

  addPlayer(name, skin) {
    const s = this.addSnake(name, skin, false);
    this.player = s;
    this.playerId = s.id;
    return s;
  }

  respawnPlayer() {
    const s = this.player;
    if (!s) return;
    const p = this.spawnPoint();
    s.alive = true;
    s.deadReason = null;
    s.killerName = null;
    s.lengthF = SNAKE.START_SEGS;
    s.best = SNAKE.START_SEGS;
    s.kills = 0;
    s.weapon = null;
    s.power = null;
    s.shieldHits = 0;
    s._fireCd = 0;
    s.angle = rand(0, Math.PI * 2);
    s.input = { a: s.angle, b: 0, f: 0 };
    s.spawnProtectedUntil = this.now + SNAKE.SPAWN_PROTECT_MS;
    s._seed(p.x, p.y, s.angle);
  }

  // -------- helpers used by combat/bots --------
  event(o) { this.events.push(o); if (this.events.length > 400) this.events.splice(0, 200); }
  requestShake(px) { if (px > this.shakeReq) this.shakeReq = px; }

  dropFood(x, y, v) {
    if (this.food.size >= FOOD_CAP) return;
    const f = makeFood(x + rand(-6, 6), y + rand(-6, 6), v || 1);
    f.born = this.now;
    this.food.set(f.id, f);
  }
  spark(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(30, 140);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.25, 0.55), age: 0, color, r: rand(1.5, 3) });
    }
    if (this.particles.length > 800) this.particles.splice(0, 300);
  }
  boom(x, y, color) {
    this.requestShake(6);
    for (let i = 0; i < 22; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(60, 260);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.7), age: 0, color, r: rand(2, 4) });
    }
  }

  killSnake(snake, reason, killer) {
    if (!snake.alive) return;
    snake.alive = false;
    snake.deadReason = reason;
    snake.killerName = killer ? killer.name : reason;
    // body -> food (subsampled so it's rich but not spammy)
    const segs = snake.segments();
    const stride = segs.length > 120 ? 3 : 2;
    for (let i = 0; i < segs.length; i += stride) this.dropFood(segs[i].x, segs[i].y, FOOD.DEATH_ORB_VALUE);
    this.boom(snake.head().x, snake.head().y, '#ff6b6b');
    // killfeed + credit
    this.event({ e: 'feed', k: killer ? killer.name : (reason === 'border' ? 'the wall' : 'the arena'), v: snake.name, w: reason });
    if (killer && killer !== snake && killer.alive) {
      killer.kills++;
      this.event({ e: 'kill', who: killer.id, v: snake.name });
    }
    if (snake.id === this.playerId) {
      if (this.onPlayerDead) this.onPlayerDead(snake);
    } else {
      // bots vacate the map; controller refills
      this.snakes.delete(snake.id);
    }
  }

  // -------- main tick --------
  step(dt, now) {
    this.now = now;
    if (this.bots) this.bots.step(dt);

    // move
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      const drops = s.step(dt);
      for (const d of drops) this.dropFood(d[0], d[1], 1);
      // power expiry
      if (s.power && s.power.until && now > s.power.until) {
        if (s.power.key === 'shield') s.shieldHits = 0;
        s.power = null;
      }
      if (s._fireCd > 0) s._fireCd -= dt * 1000;
      if (!s.isBot && s.input.f) {} // fire handled in game via fireWeapon
    }

    // eat food (+ magnet)
    const eaten = [];
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      const h = s.head();
      const magnet = s.power && s.power.key === 'magnet';
      const eatR = SNAKE.EAT_RADIUS + s.radius() - SNAKE.SEG_RADIUS;
      const magR = magnet ? s.power.radius : 0;
      for (const f of this.food.values()) {
        const d = dist(h.x, h.y, f.x, f.y);
        if (d <= eatR) { s.grow(FOOD.GROW_PER_ORB * f.v); eaten.push(f.id); }
        else if (magnet && d <= magR) {
          const t = clamp(1 - d / magR, 0, 1) * 0.35;
          f.x += (h.x - f.x) * t; f.y += (h.y - f.y) * t;
        }
      }
    }
    for (const id of eaten) this.food.delete(id);

    // weapons/projectiles/mines/turret + damage
    stepCombat(this, dt);

    // pickups
    for (const s of this.snakes.values()) if (s.alive) pickupCheck(this, s);

    // collisions -> collect then apply
    const deaths = [];
    const done = new Set();
    for (const a of this.snakes.values()) {
      if (!a.alive) continue;
      const ah = a.head();
      const ar = a.radius();
      // border
      if (ah.x < ar || ah.y < ar || ah.x > WORLD.W - ar || ah.y > WORLD.H - ar) {
        deaths.push({ s: a, reason: 'border', killer: null });
        continue;
      }
      if (now < a.spawnProtectedUntil) continue;
      const ghost = a.power && a.power.key === 'ghost';
      if (ghost) continue;
      for (const b of this.snakes.values()) {
        if (b === a || !b.alive) continue;
        const bh = b.head();
        if (dist2(ah.x, ah.y, bh.x, bh.y) > 700 * 700) continue; // broad phase
        // head vs head
        const hh = dist(ah.x, ah.y, bh.x, bh.y);
        if (hh <= ar + b.radius() + 2) {
          const key = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
          if (!done.has(key)) {
            done.add(key);
            const la = a.lenSegs(), lb = b.lenSegs();
            if (Math.abs(la - lb) <= 3) {
              deaths.push({ s: a, reason: 'body', killer: b });
              deaths.push({ s: b, reason: 'body', killer: a });
            } else if (la < lb) deaths.push({ s: a, reason: 'body', killer: b });
            else deaths.push({ s: b, reason: 'body', killer: a });
          }
          continue;
        }
        // head vs body segments
        const segs = b.segments();
        const rr = ar + b.radius();
        let crashed = false;
        for (let i = 2; i < segs.length; i++) {
          if (dist2(ah.x, ah.y, segs[i].x, segs[i].y) <= rr * rr) { crashed = true; break; }
        }
        if (crashed) { deaths.push({ s: a, reason: 'body', killer: b }); break; }
      }
    }
    const killedThisFrame = new Set();
    for (const d of deaths) {
      if (killedThisFrame.has(d.s.id)) continue;
      killedThisFrame.add(d.s.id);
      this.killSnake(d.s, d.reason, d.killer);
    }

    // top up food + items
    if (this.food.size < FOOD.COUNT) {
      const add = Math.min(24, FOOD.COUNT - this.food.size);
      for (let i = 0; i < add; i++) {
        const f = makeFood(rand(80, WORLD.W - 80), rand(80, WORLD.H - 80), 1);
        this.food.set(f.id, f);
      }
    }
    spawnItems(this);

    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.9; p.vy *= 0.9;
    }
  }

  leaderboard() {
    const arr = [];
    for (const s of this.snakes.values()) if (s.alive) arr.push(s);
    arr.sort((a, b) => b.lenSegs() - a.lenSegs());
    return arr.slice(0, 10);
  }
  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
