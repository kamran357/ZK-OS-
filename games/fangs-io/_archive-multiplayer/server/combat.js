// server/combat.js (owner: COMBAT)
// Weapons, projectiles, ground items, power crates, tail turret.
// Owns the CONTENTS of world.items and world.projectiles (Maps created by World).
// All tuning comes from shared/constants.js; the few server-only combat internals
// below are intentionally local (the client never needs them).

import { WORLD, SNAKE, WEAPONS, POWERS, ITEMS } from '../shared/constants.js';

// Server-only combat internals (not shared tuning, so not in shared/constants.js).
const PROJ_RADIUS = 6;                // projectile collision radius, px (SPEC combat contract)
const OWNER_GRACE_MS = 300;           // a projectile cannot hit its own owner for this long
const MINE_OWNER_IMMUNITY_MS = 2000;  // a mine cannot trigger on its own owner for this long
const ITEM_MIN_SNAKE_DIST = 400;      // items never spawn within this of a living snake head
const ITEM_EDGE_MARGIN = 120;         // keep item spawns off the killer border
const ITEM_PLACE_ATTEMPTS = 20;       // candidate tries before settling for the best found
const MAX_DT = 0.1;                   // seconds; dt clamp (nominal tick is 0.05 at 20Hz)

let seq = 1;
function nid(prefix) {
  return prefix + (seq++).toString(36);
}

function num(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

// Consistent timebase for calls that do not receive `now` (damageSnake).
// combat.step stashes its tick time on the world; falls back to Date.now().
function worldNow(world) {
  if (world) {
    if (Number.isFinite(world._combatNow)) return world._combatNow;
    if (Number.isFinite(world.now)) return world.now;
  }
  return Date.now();
}

function isProtected(snake, now) {
  return num(snake.spawnProtectedUntil, 0) > now;
}

// Per-client feedback events. Bots have no client, so skip them (keeps the
// world's event buffers from accumulating for ids that are never drained).
function pushTo(world, snake, ev) {
  if (!snake || snake.isBot) return;
  if (world && typeof world.pushEvent === 'function') world.pushEvent(snake.id, ev);
}

function headOf(snake) {
  if (!snake || typeof snake.head !== 'function') return null;
  const h = snake.head();
  if (!h || !Number.isFinite(h.x) || !Number.isFinite(h.y)) return null;
  return h;
}

function tailTip(snake) {
  const segs = typeof snake.segments === 'function' ? snake.segments() : null;
  if (Array.isArray(segs) && segs.length > 0) {
    const t = segs[segs.length - 1];
    if (Array.isArray(t) && Number.isFinite(t[0]) && Number.isFinite(t[1])) {
      return { x: t[0], y: t[1] };
    }
  }
  return headOf(snake);
}

// Fire toward the requested steer angle (mouse aim); fall back to actual heading.
function aimAngle(snake) {
  const ia = snake.input ? snake.input.a : undefined;
  if (Number.isFinite(ia)) return ia;
  return num(snake.angle, 0);
}

function normAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// World-space angle FROM the victim head TO the attacker head (for the HUD
// directional damage arc). Unknown source: point behind the victim.
function angleToAttacker(victim, attacker) {
  const vh = headOf(victim);
  const ah = attacker && attacker !== victim ? headOf(attacker) : null;
  if (vh && ah) {
    const a = Math.atan2(ah.y - vh.y, ah.x - vh.x);
    if (Number.isFinite(a)) return a;
  }
  return normAngle(num(victim.angle, 0) + Math.PI);
}

function clearPower(snake) {
  const p = snake.power;
  if (!p) return;
  if (p.k === 'speed') snake.speedMult = 1; // restore side effect
  snake.power = null;
}

function weightedItemKind() {
  const entries = Object.entries(ITEMS.WEIGHTS);
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = Math.random() * total;
  for (const [kind, w] of entries) {
    r -= w;
    if (r <= 0) return kind;
  }
  return entries[entries.length - 1][0];
}

// ---------------------------------------------------------------------------
// spawnItems: top world.items up to ITEMS.TARGET_COUNT with weighted kinds.
// Never within ITEM_MIN_SNAKE_DIST of a living snake head (best-effort with
// bounded attempts so a crowded world can never infinite-loop the server).
// ---------------------------------------------------------------------------
export function spawnItems(world, now) { // eslint-disable-line no-unused-vars
  if (!world || !world.items) return;
  if (world.items.size >= ITEMS.TARGET_COUNT) return;

  const heads = [];
  if (world.snakes) {
    for (const s of world.snakes.values()) {
      if (!s || !s.alive) continue;
      const h = headOf(s);
      if (h) heads.push(h);
    }
  }
  const minD2 = ITEM_MIN_SNAKE_DIST * ITEM_MIN_SNAKE_DIST;

  while (world.items.size < ITEMS.TARGET_COUNT) {
    const kind = weightedItemKind();
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < ITEM_PLACE_ATTEMPTS; i++) {
      const x = ITEM_EDGE_MARGIN + Math.random() * (WORLD.W - ITEM_EDGE_MARGIN * 2);
      const y = ITEM_EDGE_MARGIN + Math.random() * (WORLD.H - ITEM_EDGE_MARGIN * 2);
      let nearest = Infinity;
      for (const h of heads) {
        const dx = h.x - x;
        const dy = h.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearest) nearest = d2;
      }
      if (nearest >= minD2) {
        best = { x, y };
        break;
      }
      if (nearest > bestScore) {
        bestScore = nearest;
        best = { x, y };
      }
    }
    const id = nid('i');
    world.items.set(id, { id, x: best.x, y: best.y, kind });
  }
}

// ---------------------------------------------------------------------------
// pickupCheck: head within ITEMS.PICKUP_RADIUS of an item picks it up.
// Weapons fill the single slot (replace + full ammo). Crates grant one
// uniformly random power via applyPower. Called by World.step per snake.
// ---------------------------------------------------------------------------
export function pickupCheck(world, snake, now) {
  if (!world || !world.items || world.items.size === 0) return;
  if (!snake || !snake.alive) return;
  now = num(now, worldNow(world));
  const h = headOf(snake);
  if (!h) return;

  const r2 = ITEMS.PICKUP_RADIUS * ITEMS.PICKUP_RADIUS;
  for (const item of world.items.values()) {
    if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.y)) {
      world.items.delete(item && item.id);
      continue;
    }
    const dx = item.x - h.x;
    const dy = item.y - h.y;
    if (dx * dx + dy * dy > r2) continue;

    world.items.delete(item.id);
    if (item.kind === 'crate') {
      const keys = Object.keys(POWERS);
      const key = keys[Math.floor(Math.random() * keys.length)];
      applyPower(world, snake, key, now); // pushes its own {e:'pick'}
    } else if (WEAPONS[item.kind]) {
      snake.weapon = { k: item.kind, ammo: WEAPONS[item.kind].ammo, nextAt: 0 };
      pushTo(world, snake, { e: 'pick', kind: item.kind });
    }
    // Unknown kinds are consumed silently (defensive).
  }
}

// ---------------------------------------------------------------------------
// applyPower: sets snake.power (replacing any old power, restoring its side
// effects first). Timed powers get until = now + durMs. shrink is shot-based
// (no until). speed sets snake.speedMult and restores 1 on expiry/replace.
// ---------------------------------------------------------------------------
export function applyPower(world, snake, key, now) {
  if (!world || !snake || !snake.alive) return;
  const def = POWERS[key];
  if (!def) return;
  now = num(now, worldNow(world));

  clearPower(snake); // restore old side effects before replacing

  const p = { k: key };
  if (Number.isFinite(def.durMs)) p.until = now + def.durMs;
  if (key === 'shield') p.hits = def.hits;
  if (key === 'shrink') p.shots = def.shots; // consumed by the next trigger pull
  if (key === 'turret') p.nextAt = 0;
  if (key === 'speed') snake.speedMult = def.mult;
  snake.power = p;

  pushTo(world, snake, { e: 'pick', kind: key });
}

function spawnProjectile(world, ownerId, x, y, a, kind, speed, segDamage, range, now) {
  a = num(a, 0);
  const id = nid('p');
  world.projectiles.set(id, {
    id,
    x: x + Math.cos(a) * (SNAKE.HEAD_RADIUS + PROJ_RADIUS),
    y: y + Math.sin(a) * (SNAKE.HEAD_RADIUS + PROJ_RADIUS),
    a,
    kind,
    speed: num(speed, 0),
    ownerId,
    segDamage: num(segDamage, 0),
    bornAt: now,
    range: num(range, 0),
    dist: 0,
  });
}

// ---------------------------------------------------------------------------
// fireWeapon: one trigger pull. Gates: alive, weapon present, cooldown, ammo.
// Shrink power hijacks the trigger (one big 'shrink' projectile, no ammo use).
// Mines drop at the tail tip. Ammo hitting 0 clears the weapon slot to null.
// Safe to call every tick while input.f is held, and safe to call from both
// combat.step and NET/CORE in the same tick (same-tick duplicate guard).
// ---------------------------------------------------------------------------
export function fireWeapon(world, snake, now) {
  if (!world || !world.projectiles || !snake || !snake.alive) return false;
  now = num(now, worldNow(world));
  if (snake._lastFireMs === now) return false; // same-tick duplicate call guard

  const h = headOf(snake);
  if (!h) return false;

  // Shrink power consumes the next fire instead of weapon ammo.
  const p = snake.power;
  if (p && p.k === 'shrink' && p.shots > 0) {
    const def = POWERS.shrink;
    // segDamage 0: real amount is computed at hit time from the victim length.
    spawnProjectile(world, snake.id, h.x, h.y, aimAngle(snake), 'shrink', def.projSpeed, 0, def.range, now);
    p.shots -= 1;
    if (p.shots <= 0) snake.power = null; // power cleared after the shot
    snake._lastFireMs = now;
    return true;
  }

  const w = snake.weapon;
  if (!w) return false;
  const def = WEAPONS[w.k];
  if (!def) {
    snake.weapon = null; // corrupt slot, drop it
    return false;
  }
  if (now < num(w.nextAt, 0)) return false;
  if (!(w.ammo > 0)) {
    snake.weapon = null;
    return false;
  }

  if (w.k === 'mine') {
    // Dropped AT the tail tip. Sits still, arms after armMs, expires at lifeMs.
    const t = tailTip(snake) || h;
    const id = nid('p');
    world.projectiles.set(id, {
      id,
      x: t.x,
      y: t.y,
      a: 0,
      kind: 'mine', // flips to 'mine_armed' once armed
      speed: 0,
      ownerId: snake.id,
      segDamage: def.segDamage,
      bornAt: now,
      range: 0,
      dist: 0,
      armAt: now + def.armMs,
      dieAt: now + def.lifeMs,
      armed: false,
    });
  } else {
    const a = aimAngle(snake);
    const pellets = Math.max(1, num(def.pellets, 1) | 0);
    const spread = num(def.spreadRad, 0);
    for (let i = 0; i < pellets; i++) {
      const off = pellets > 1 ? -spread / 2 + (spread * i) / (pellets - 1) : 0;
      spawnProjectile(world, snake.id, h.x, h.y, a + off, w.k, def.projSpeed, def.segDamage, def.range, now);
    }
  }

  w.ammo -= 1;
  w.nextAt = now + def.cooldownMs;
  if (w.ammo <= 0) snake.weapon = null; // unarmed; HUD reads me.wpn === null
  snake._lastFireMs = now;
  return true;
}

// ---------------------------------------------------------------------------
// damageSnake: shield absorb, tail shrink -> food drops, feedback events,
// floor-death. SPEC rule 7: a snake knocked down TO MIN_SEGS survives; a snake
// already at (or below) MIN_SEGS dies to the next hit.
// ---------------------------------------------------------------------------
export function damageSnake(world, victim, attacker, weaponKey, segs) {
  if (!world || !victim || !victim.alive) return;
  const now = worldNow(world);
  if (isProtected(victim, now)) return; // spawn protection: full no-op

  segs = Math.max(0, Math.floor(num(segs, 0)));
  if (segs <= 0) return;

  // Shield absorbs the hit entirely.
  const p = victim.power;
  if (p && p.k === 'shield' && p.hits > 0) {
    p.hits -= 1;
    if (p.hits <= 0) clearPower(victim);
    if (attacker && attacker !== victim) pushTo(world, attacker, { e: 'hit' });
    pushTo(world, victim, { e: 'dmg', a: angleToAttacker(victim, attacker) });
    return;
  }

  const preLen = num(victim.length, 0);
  const dropped = typeof victim.shrink === 'function' ? victim.shrink(segs) : null;
  if (Array.isArray(dropped)) {
    for (const pos of dropped) {
      if (Array.isArray(pos) && Number.isFinite(pos[0]) && Number.isFinite(pos[1])) {
        world.dropFood(pos[0], pos[1], 1);
      }
    }
  }

  pushTo(world, victim, { e: 'dmg', a: angleToAttacker(victim, attacker) });
  if (attacker && attacker !== victim) pushTo(world, attacker, { e: 'hit' });

  const len = num(victim.length, 0);
  if (len < SNAKE.MIN_SEGS || preLen <= SNAKE.MIN_SEGS) {
    world.killSnake(victim, weaponKey, attacker || null);
  }
}

// ---------------------------------------------------------------------------
// step: fire-on-input, turret auto-fire, projectile advance + collisions,
// mine arm/trigger/expiry, power expiry, item top-up. Called by World.step.
// ---------------------------------------------------------------------------
export function step(world, dt, now) {
  if (!world || !world.snakes || !world.projectiles) return;
  dt = Math.min(Math.max(num(dt, 0), 0), MAX_DT);
  now = num(now, Date.now());
  world._combatNow = now; // timebase stash for damageSnake calls this tick

  // 1) Fire while the trigger is held. Idempotent per tick, so it is also
  //    safe if NET/CORE call fireWeapon for the same input themselves.
  for (const s of world.snakes.values()) {
    if (s && s.alive && s.input && s.input.f) fireWeapon(world, s, now);
  }

  // 2) Tail turret auto-fire: nearest enemy head within range of the OWNER'S
  //    TAIL TIP, independent of whatever else the owner is doing.
  const turretDef = POWERS.turret;
  for (const s of world.snakes.values()) {
    if (!s || !s.alive || !s.power || s.power.k !== 'turret') continue;
    const tp = s.power;
    if (now < num(tp.nextAt, 0)) continue;
    const t = tailTip(s);
    if (!t) continue;

    let target = null;
    let bestD2 = turretDef.range * turretDef.range;
    for (const o of world.snakes.values()) {
      if (!o || o === s || !o.alive || isProtected(o, now)) continue;
      const oh = headOf(o);
      if (!oh) continue;
      const dx = oh.x - t.x;
      const dy = oh.y - t.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        target = oh;
      }
    }
    if (!target) continue;

    const a = Math.atan2(target.y - t.y, target.x - t.x);
    const id = nid('p');
    world.projectiles.set(id, {
      id,
      x: t.x + Math.cos(a) * PROJ_RADIUS,
      y: t.y + Math.sin(a) * PROJ_RADIUS,
      a,
      kind: 'turret',
      speed: turretDef.projSpeed,
      ownerId: s.id,
      segDamage: turretDef.segDamage,
      bornAt: now,
      range: turretDef.range,
      dist: 0,
    });
    tp.nextAt = now + turretDef.cooldownMs;
  }

  // 3) Projectiles: mines (arm + proximity trigger + expiry) and movers
  //    (advance, range/world-edge expiry, segment + head collision).
  const segCache = new Map(); // snake.id -> segments() computed once per tick
  const segsOf = (s) => {
    let segs = segCache.get(s.id);
    if (!segs) {
      segs = (typeof s.segments === 'function' && s.segments()) || [];
      segCache.set(s.id, segs);
    }
    return segs;
  };
  const mineDef = WEAPONS.mine;
  const trig2 = mineDef.triggerRadius * mineDef.triggerRadius;
  const headHit2 = (SNAKE.HEAD_RADIUS + PROJ_RADIUS) * (SNAKE.HEAD_RADIUS + PROJ_RADIUS);
  const segHit2 = (SNAKE.SEG_RADIUS + PROJ_RADIUS) * (SNAKE.SEG_RADIUS + PROJ_RADIUS);

  for (const proj of Array.from(world.projectiles.values())) {
    if (!proj) continue;

    if (proj.kind === 'mine' || proj.kind === 'mine_armed') {
      if (now >= num(proj.dieAt, 0)) {
        world.projectiles.delete(proj.id);
        continue;
      }
      if (!proj.armed && now >= num(proj.armAt, Infinity)) {
        proj.armed = true;
        proj.kind = 'mine_armed'; // client renders the armed sprite
      }
      if (!proj.armed) continue;

      for (const s of world.snakes.values()) {
        if (!s || !s.alive || isProtected(s, now)) continue;
        if (s.id === proj.ownerId && now - proj.bornAt < MINE_OWNER_IMMUNITY_MS) continue;
        const sh = headOf(s);
        if (!sh) continue;
        const dx = sh.x - proj.x;
        const dy = sh.y - proj.y;
        if (dx * dx + dy * dy > trig2) continue;
        damageSnake(world, s, world.snakes.get(proj.ownerId) || null, 'mine', proj.segDamage);
        world.projectiles.delete(proj.id);
        break;
      }
      continue;
    }

    // Moving projectile: advance along angle, accumulate distance.
    const stepLen = num(proj.speed, 0) * dt;
    proj.x += Math.cos(proj.a) * stepLen;
    proj.y += Math.sin(proj.a) * stepLen;
    proj.dist = num(proj.dist, 0) + stepLen;
    if (
      !Number.isFinite(proj.x) || !Number.isFinite(proj.y)
      || proj.dist >= num(proj.range, 0)
      || proj.x < 0 || proj.x > WORLD.W || proj.y < 0 || proj.y > WORLD.H
    ) {
      world.projectiles.delete(proj.id);
      continue;
    }

    for (const s of world.snakes.values()) {
      if (!s || !s.alive) continue;
      if (s.id === proj.ownerId && now - proj.bornAt < OWNER_GRACE_MS) continue;
      if (isProtected(s, now)) continue; // bullets pass through protected snakes
      const sh = headOf(s);
      if (!sh) continue;

      // Cheap bounding reject: all segments lie within the path length of the head.
      const dxh = proj.x - sh.x;
      const dyh = proj.y - sh.y;
      const reach = num(s.length, 0) * SNAKE.SEG_SPACING + SNAKE.SEG_RADIUS + PROJ_RADIUS;
      if (dxh * dxh + dyh * dyh > reach * reach) continue;

      let hit = dxh * dxh + dyh * dyh <= headHit2;
      if (!hit) {
        const segs = segsOf(s);
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i];
          const dx = proj.x - seg[0];
          const dy = proj.y - seg[1];
          if (dx * dx + dy * dy <= segHit2) {
            hit = true;
            break;
          }
        }
      }
      if (!hit) continue;

      const attacker = world.snakes.get(proj.ownerId) || null;
      const dmg = proj.kind === 'shrink'
        ? Math.max(1, Math.floor(num(s.length, 0) * POWERS.shrink.pct))
        : proj.segDamage;
      damageSnake(world, s, attacker, proj.kind, dmg);
      world.projectiles.delete(proj.id);
      break;
    }
  }

  // 4) Power expiry (+ defensive cleanup: the dead carry nothing into respawn).
  for (const s of world.snakes.values()) {
    if (!s) continue;
    if (!s.alive) {
      if (s.power) clearPower(s);
      if (s.weapon) s.weapon = null;
      continue;
    }
    const sp = s.power;
    if (!sp) continue;
    if (Number.isFinite(sp.until) && now >= sp.until) clearPower(s);
    else if (sp.k === 'shield' && !(sp.hits > 0)) clearPower(s);
    else if (sp.k === 'shrink' && !(sp.shots > 0)) clearPower(s);
  }

  // 5) Keep the ground stocked.
  spawnItems(world, now);
}
