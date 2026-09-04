// Fangs.io — combat: items, weapons, powers, projectiles, mines, turret, damage.
import { WORLD, WEAPONS, POWERS, ITEMS, SNAKE } from '../shared/constants.js';
import { makeItem, makeProjectile } from './entities.js';
import { dist, rand, pick, weightedPick, nextId } from './util.js';

const POWER_KEYS = ['shield', 'speed', 'magnet', 'ghost', 'shrink', 'turret'];

export function spawnItems(world) {
  let guard = 0;
  while (world.items.size < ITEMS.TARGET_COUNT && guard++ < 200) {
    const kind = weightedPick(ITEMS.WEIGHTS);
    const x = rand(120, WORLD.W - 120);
    const y = rand(120, WORLD.H - 120);
    const it = makeItem(x, y, kind);
    world.items.set(it.id, it);
  }
}

export function applyPower(world, snake, key) {
  const now = world.now;
  const def = POWERS[key];
  if (!def) return;
  if (key === 'shield') { snake.power = { key, until: now + def.durMs }; snake.shieldHits = def.hits; }
  else if (key === 'speed') snake.power = { key, until: now + def.durMs };
  else if (key === 'magnet') snake.power = { key, until: now + def.durMs, radius: def.radius };
  else if (key === 'ghost') snake.power = { key, until: now + def.durMs };
  else if (key === 'turret') { snake.power = { key, until: now + def.durMs }; snake._turretCd = 0; }
  else if (key === 'shrink') snake.power = { key, until: now + 20000, shots: def.shots }; // fire with F
  world.event({ e: 'pick', who: snake.id, kind: 'power:' + key });
}

export function pickupCheck(world, snake) {
  const h = snake.head();
  for (const it of world.items.values()) {
    if (dist(h.x, h.y, it.x, it.y) > ITEMS.PICKUP_RADIUS + snake.radius()) continue;
    if (it.kind === 'crate') {
      applyPower(world, snake, pick(POWER_KEYS));
    } else {
      const def = WEAPONS[it.kind];
      if (def) {
        snake.weapon = { key: it.kind, ammo: def.ammo };
        world.event({ e: 'pick', who: snake.id, kind: it.kind });
      }
    }
    world.items.delete(it.id);
    world.spark(it.x, it.y, '#39ff88', 8);
  }
}

function spawnProj(world, snake, a, kind, def) {
  const h = snake.head();
  const r = snake.radius() + 8;
  const speed = def.projSpeed;
  const p = makeProjectile({
    x: h.x + Math.cos(a) * r, y: h.y + Math.sin(a) * r, a, kind,
    owner: snake.id, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
    segDamage: def.segDamage, born: world.now, life: def.lifeMs || 2200,
  });
  world.projectiles.set(p.id, p);
}

export function fireWeapon(world, snake) {
  if (snake._fireCd > 0) return;
  const now = world.now;
  // shrink power fires like a weapon
  if (snake.power && snake.power.key === 'shrink' && snake.power.shots > 0) {
    const def = POWERS.shrink;
    spawnProj(world, snake, snake.angle, 'shrink', { projSpeed: def.projSpeed, segDamage: 0, lifeMs: 1800 });
    snake.power.shots--;
    snake._fireCd = 700;
    if (snake.power.shots <= 0) snake.power = null;
    if (!snake.isBot) { world.requestShake(6); }
    world.spark(snake.head().x, snake.head().y, '#c77dff', 10);
    return;
  }
  const w = snake.weapon;
  if (!w || w.ammo <= 0) return;
  const def = WEAPONS[w.key];
  if (!def) return;

  if (w.key === 'mine') {
    const h = snake.head();
    const bx = h.x - Math.cos(snake.angle) * (snake.radius() + 10);
    const by = h.y - Math.sin(snake.angle) * (snake.radius() + 10);
    const p = makeProjectile({
      x: bx, y: by, a: 0, kind: 'mine', owner: snake.id, vx: 0, vy: 0,
      segDamage: def.segDamage, born: now, life: def.lifeMs, armed: false,
      armAt: now + def.armMs, triggerR: def.triggerRadius, sitter: true,
    });
    world.projectiles.set(p.id, p);
  } else if (w.key === 'spread') {
    for (let i = 0; i < def.pellets; i++) {
      const off = (i - (def.pellets - 1) / 2) * (def.spreadRad / Math.max(1, def.pellets - 1)) * 2;
      spawnProj(world, snake, snake.angle + off, w.key, def);
    }
  } else {
    spawnProj(world, snake, snake.angle, w.key, def);
  }
  w.ammo--;
  snake._fireCd = def.cooldownMs;
  world.spark(snake.head().x, snake.head().y, '#ffe95d', 5);
  if (!snake.isBot) world.requestShake(w.key === 'cannon' ? 7 : 3);
  if (w.ammo <= 0) snake.weapon = null;
}

export function damageSnake(world, victim, attacker, weaponKey, segs) {
  if (!victim.alive) return;
  if (world.now < victim.spawnProtectedUntil) return;
  // shield absorbs
  if (victim.shieldHits > 0) {
    victim.shieldHits--;
    if (victim.shieldHits <= 0 && victim.power && victim.power.key === 'shield') victim.power = null;
    if (attacker) world.event({ e: 'hit', who: attacker.id });
    world.spark(victim.head().x, victim.head().y, '#4dfff0', 10);
    return;
  }
  let removeSegs = segs;
  if (weaponKey === 'shrink') removeSegs = Math.max(6, Math.floor(victim.lenSegs() * POWERS.shrink.pct));
  const drops = victim.shrink(removeSegs);
  for (const d of drops) world.dropFood(d[0], d[1], 1);
  if (attacker) world.event({ e: 'hit', who: attacker.id });
  const h = victim.head();
  const ah = attacker ? attacker.head() : { x: h.x - 1, y: h.y };
  world.event({ e: 'dmg', who: victim.id, a: Math.atan2(ah.y - h.y, ah.x - h.x) });
  world.spark(h.x, h.y, '#ff5d5d', 8);
  if (victim.lenSegs() <= SNAKE.MIN_SEGS) {
    world.killSnake(victim, weaponKey, attacker || null);
  }
}

// projectile step + mine + turret. dt seconds.
export function stepCombat(world, dt) {
  const now = world.now;
  // turret auto-fire
  for (const s of world.snakes.values()) {
    if (!s.alive || !s.power || s.power.key !== 'turret') continue;
    s._turretCd -= dt * 1000;
    if (s._turretCd > 0) continue;
    const def = POWERS.turret;
    const target = nearestEnemy(world, s, def.range);
    if (target) {
      const th = target.head(), sh = s.head();
      const a = Math.atan2(th.y - sh.y, th.x - sh.x);
      spawnProj(world, s, a, 'turret', { projSpeed: def.projSpeed, segDamage: def.segDamage, lifeMs: 1400 });
      s._turretCd = def.cooldownMs;
    } else s._turretCd = 200;
  }

  for (const p of world.projectiles.values()) {
    const age = now - p.born;
    if (age > p.life) { world.projectiles.delete(p.id); continue; }
    if (p.kind === 'mine') {
      if (now < p.armAt) continue;
      p.armed = true;
      let boom = false;
      for (const s of world.snakes.values()) {
        if (!s.alive || s.id === p.owner) continue;
        if (now < s.spawnProtectedUntil) continue;
        const segs = s.segments();
        for (let i = 0; i < segs.length; i += 2) {
          if (dist(p.x, p.y, segs[i].x, segs[i].y) < p.triggerR) {
            damageSnake(world, s, world.snakes.get(p.owner) || null, 'mine', p.segDamage);
            boom = true; break;
          }
        }
        if (boom) break;
      }
      if (boom) { world.boom(p.x, p.y, '#ff9f45'); world.projectiles.delete(p.id); }
      continue;
    }
    // moving projectile
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < 0 || p.y < 0 || p.x > WORLD.W || p.y > WORLD.H) { world.projectiles.delete(p.id); continue; }
    if (age < 90) continue; // grace so you don't hit your own head
    // shoot the mines: a bullet that hits a mine detonates it and both are destroyed
    let hitMine = false;
    for (const m of world.projectiles.values()) {
      if (m.kind !== 'mine' || m.id === p.id) continue;
      if (dist(p.x, p.y, m.x, m.y) < 18) {
        world.boom(m.x, m.y, '#ff9f45');
        world.spark(m.x, m.y, '#ffd27a', 14);
        // the blast still hurts any snake caught in it (except the shooter's teammates = everyone here is fair game)
        for (const s of world.snakes.values()) {
          if (!s.alive || (now < s.spawnProtectedUntil)) continue;
          const segs = s.segments();
          for (let i = 0; i < segs.length; i += 2) {
            if (dist(m.x, m.y, segs[i].x, segs[i].y) < (m.triggerR || 42)) {
              damageSnake(world, s, world.snakes.get(m.owner) || null, 'mine', m.segDamage);
              break;
            }
          }
        }
        world.projectiles.delete(m.id);
        hitMine = true;
        break;
      }
    }
    if (hitMine) { world.projectiles.delete(p.id); continue; }
    let hit = false;
    for (const s of world.snakes.values()) {
      if (!s.alive || s.id === p.owner) continue;
      if (now < s.spawnProtectedUntil) continue;
      const hd = s.head();
      if (dist(p.x, p.y, hd.x, hd.y) > 600) continue; // broad phase
      const segs = s.segments();
      const rr = s.radius() + 6;
      for (let i = 0; i < segs.length; i++) {
        if (dist(p.x, p.y, segs[i].x, segs[i].y) <= rr) {
          damageSnake(world, s, world.snakes.get(p.owner) || null, p.kind, p.segDamage);
          hit = true; break;
        }
      }
      if (hit) break;
    }
    if (hit) { world.spark(p.x, p.y, '#ffe4c4', 6); world.projectiles.delete(p.id); }
  }
}

export function nearestEnemy(world, s, range) {
  const h = s.head();
  let best = null, bestD = range * range;
  for (const o of world.snakes.values()) {
    if (o === s || !o.alive) continue;
    const oh = o.head();
    const d = (oh.x - h.x) ** 2 + (oh.y - h.y) ** 2;
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}
