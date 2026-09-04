// server/bots.js — Fangs.io bot AI (owner: BOTS)
//
// Contract (SPEC):
//   export class BotController {
//     constructor(world)   // adds BOTS.COUNT bots with names from a 40-name pool
//     step(dt, now)        // steer via world.setInput; respawn dead bots after BOTS.RESPAWN_MS
//   }
//
// Brain priority: avoid border/bodies (3-ray probe) > flee longer snake within 500px
// > grab item within 400px > armed + enemy within 600px: aim/lead + fire > seek food
// > wander (smooth heading drift). Boost only when fleeing or chasing a kill.
//
// Bots interact with the world ONLY through world.setInput / world.respawn /
// world.addPlayer. Everything else is read-only perception (bots run server-side,
// no AOI cost). Fields owned by other modules (snake.weapon, snake.power) are read
// defensively so this file never throws regardless of their exact shape.

import { WORLD, SNAKE, WEAPONS, POWERS, BOTS, SKINS } from '../shared/constants.js';

// ---------------------------------------------------------------------------
// Bot-brain tuning. These numbers come from the SPEC bot brief (AI behavior
// only); shared gameplay tuning stays in shared/constants.js.
// ---------------------------------------------------------------------------
const PROBE_LEN = 180;            // avoidance ray length (px)
const PROBE_SPREAD = 0.5;         // side ray offset (rad)
const FLEE_RADIUS = 500;          // flee any longer snake whose head is inside this
const ITEM_RADIUS = 400;          // grab nearest item inside this (when not fleeing)
const FIGHT_RADIUS = 600;         // armed: engage enemy head inside this
const FOOD_RADIUS = 700;          // seek nearest food inside this
const AIM_CONE = 0.25;            // fire only when aimed within this (rad)
const SCAN_MS = 200;              // heavy nearest-scans at 5Hz, staggered per bot
const WALL_PANIC_DIST = 110;      // inside this from a wall: hard steer to center
const HARD_TURN = 1.35;           // rad offset for hard avoidance steer
const SOFT_TURN = 0.6;            // rad offset when only a side ray is blocked
const MINE_DROP_DIST = 250;       // mines: "fire" (drop) when enemy this close
const CHASE_BOOST_DIST = 320;     // boost toward fight targets farther than this
const FLEE_BOOST_MIN_SEGS = SNAKE.MIN_SEGS + 6; // boost only above this length
const WANDER_MIN_MS = 2000;       // re-pick wander heading every 2-4s
const WANDER_MAX_MS = 4000;
const EDGE_ZONE_FRAC = 0.15;      // outer band of the world where wander biases to center
const MAX_DT = 0.1;               // dt clamp (s)
const RESPAWN_RETRY_MS = 500;     // retry cadence if world.respawn didn't take
const RAY_HIT_RADIUS = SNAKE.SEG_RADIUS + SNAKE.HEAD_RADIUS + 4; // body clearance
const WALL_MARGIN = SNAKE.HEAD_RADIUS + 8; // treat walls as this much closer

// 40 human-ish gamer tags. Uniqueness among living bots is guaranteed because
// each bot keeps its pool name for its whole lifetime (respawns reuse it) and
// the pool is drawn without replacement.
const NAME_POOL = [
  'Kai', 'xX_Venom_Xx', 'noodle', 'SirHiss', 'anaconda_dan',
  'Milo', 'ZigZag', 'wormlord', 'Nagini', 'slipperyjim',
  'Fangz', 'KobraKid', 'Sssarah', 'BigWyrm', 'TailGunner',
  'Vex', 'mamba_mike', 'NoodleKing', 'Hissteria', 'Danger_Dave',
  'Peppino', 'sn4ke_eyes', 'LordSlither', 'Twisty', 'GhostViper',
  'ropeboy', 'QueenCobra', 'Zed', 'diet_snake', 'Boop',
  'VenomVicky', 'Slinky', 'Kaa', 'turbo_taipan', 'NopeRope',
  'Wiggles', 'xSidewinderx', 'Basilisk99', 'Loopz', 'MrCoils',
];

const TAU = Math.PI * 2;

function norm(a) {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

function angleDiff(a, b) {
  return norm(a - b);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function fin(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

function rand(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

// Distance along a ray (unit dir dx,dy from px,py) to the world border walls,
// with walls pulled in by WALL_MARGIN. Infinity if the ray never reaches a wall
// within any finite t (parallel + inside).
function wallHitT(px, py, dx, dy) {
  let best = Infinity;
  if (dx < -1e-9) {
    const t = (WALL_MARGIN - px) / dx;
    if (t >= 0 && t < best) best = t;
  } else if (dx > 1e-9) {
    const t = (WORLD.W - WALL_MARGIN - px) / dx;
    if (t >= 0 && t < best) best = t;
  }
  if (dy < -1e-9) {
    const t = (WALL_MARGIN - py) / dy;
    if (t >= 0 && t < best) best = t;
  } else if (dy > 1e-9) {
    const t = (WORLD.H - WALL_MARGIN - py) / dy;
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

// Defensive readers for fields owned by COMBAT/CORE ------------------------

function weaponOf(snake) {
  const w = snake && (snake.weapon || snake.wpn);
  if (!w || typeof w !== 'object') return null;
  return w;
}

function weaponKey(w) {
  const k = w && (w.k ?? w.kind ?? w.key);
  return typeof k === 'string' ? k : null;
}

function powerOf(snake, now) {
  const p = snake && (snake.power || snake.pw);
  if (!p || typeof p !== 'object') return null;
  const k = p.k ?? p.kind ?? p.key;
  if (typeof k !== 'string') return null;
  // Duration powers expire at .until; shot powers (shrink) live until spent.
  if (Number.isFinite(p.until) && p.until <= now && k !== 'shrink') return null;
  return { k, until: p.until, shots: p.shots };
}

function isSpawnProtected(snake, now) {
  return Number.isFinite(snake.spawnProtectedUntil) && snake.spawnProtectedUntil > now;
}

// "Armed" = holding a weapon with ammo, or carrying an unspent shrink shot.
// Returns {key, projSpeed, isMine} or null.
function armedState(snake, now) {
  const w = weaponOf(snake);
  if (w) {
    const key = weaponKey(w);
    const spec = key ? WEAPONS[key] : null;
    const ammo = Number.isFinite(w.ammo) ? w.ammo : 1; // unknown ammo: assume usable
    if (spec && ammo > 0) {
      return { key, projSpeed: fin(spec.projSpeed, WEAPONS.blaster.projSpeed), isMine: !(spec.projSpeed > 0) };
    }
  }
  const p = powerOf(snake, now);
  if (p && p.k === 'shrink' && (!Number.isFinite(p.shots) || p.shots > 0)) {
    return { key: 'shrink', projSpeed: fin(POWERS.shrink.projSpeed, WEAPONS.blaster.projSpeed), isMine: false };
  }
  return null;
}

// ---------------------------------------------------------------------------

export class BotController {
  constructor(world) {
    this.world = world;
    this.bots = new Map(); // id -> brain state
    this.seq = 0;
    // Draw names without replacement from a shuffled copy of the pool.
    this.namePool = [...NAME_POOL];
    for (let i = this.namePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.namePool[i], this.namePool[j]] = [this.namePool[j], this.namePool[i]];
    }
    this.nameCursor = 0;

    const now = Date.now();
    for (let i = 0; i < BOTS.COUNT; i++) this.#addBot(i, now);
  }

  #nextName() {
    if (this.nameCursor < this.namePool.length) return this.namePool[this.nameCursor++];
    // Pool exhausted (only possible if BOTS.COUNT > 40): synthesize a unique tag.
    return `Snek${++this.seq}${Math.floor(Math.random() * 90) + 10}`.slice(0, 16);
  }

  #addBot(index, now) {
    const id = `bot_${++this.seq}`;
    const name = this.#nextName();
    const skin = Math.floor(Math.random() * SKINS.length) % SKINS.length;
    try {
      this.world.addPlayer(id, name, skin, true);
    } catch {
      // World rejected the spawn this tick; step() re-adds missing bots later.
    }
    const st = {
      id,
      name,
      skin,
      respawnDueAt: null,
      nextScanAt: now + ((index * 40) % SCAN_MS), // stagger 5Hz scans across bots
      cache: { threat: null, enemy: null, itemId: null, foodId: null },
      wanderTarget: rand(-Math.PI, Math.PI),
      wanderUntil: now + rand(WANDER_MIN_MS, WANDER_MAX_MS),
      wobblePhase: rand(0, TAU),
      wobbleFreq: rand(0.5, 1.5),
    };
    this.bots.set(id, st);
    return st;
  }

  #resetBrain(st, now) {
    st.cache.threat = null;
    st.cache.enemy = null;
    st.cache.itemId = null;
    st.cache.foodId = null;
    st.nextScanAt = now + rand(0, SCAN_MS);
    st.wanderTarget = rand(-Math.PI, Math.PI);
    st.wanderUntil = now + rand(WANDER_MIN_MS, WANDER_MAX_MS);
    st.respawnDueAt = null;
  }

  step(dt, now) {
    dt = clamp(fin(dt, 0), 0, MAX_DT);
    now = fin(now, Date.now());
    const world = this.world;
    if (!world || !world.snakes) return;

    // Maintain exactly BOTS.COUNT bots even if something external removed one.
    while (this.bots.size < BOTS.COUNT) this.#addBot(this.bots.size, now);

    // Per-tick memoized segment lists (one segments() call per snake per tick).
    const segCache = new Map();
    const getSegs = (snake) => {
      let segs = segCache.get(snake);
      if (segs === undefined) {
        try {
          segs = snake.segments() || [];
        } catch {
          segs = [];
        }
        segCache.set(snake, segs);
      }
      return segs;
    };

    for (const st of this.bots.values()) {
      try {
        this.#stepBot(st, now, getSegs);
      } catch {
        // A single bot must never take down the sim tick.
      }
    }
  }

  #stepBot(st, now, getSegs) {
    const world = this.world;
    let s = world.snakes.get(st.id);

    if (!s) {
      // Snake object vanished (external removePlayer). Re-add with same identity.
      try {
        world.addPlayer(st.id, st.name, st.skin, true);
      } catch {
        /* retry next tick */
      }
      this.#resetBrain(st, now);
      return;
    }

    // -- Dead: schedule / execute respawn ----------------------------------
    if (!s.alive) {
      if (st.respawnDueAt === null) {
        st.respawnDueAt = now + BOTS.RESPAWN_MS;
      } else if (now >= st.respawnDueAt) {
        try {
          world.respawn(st.id);
        } catch {
          /* retry below */
        }
        s = world.snakes.get(st.id);
        if (s && s.alive) this.#resetBrain(st, now);
        else st.respawnDueAt = now + RESPAWN_RETRY_MS;
      }
      return;
    }
    st.respawnDueAt = null;

    // -- Perception ---------------------------------------------------------
    const headObj = s.head() || {};
    const px = fin(headObj.x, WORLD.W / 2);
    const py = fin(headObj.y, WORLD.H / 2);
    const myA = fin(s.angle, 0);
    const myLen = fin(s.length, SNAKE.START_SEGS);

    if (now >= st.nextScanAt) {
      this.#scan(st, s, px, py, myLen, now);
      st.nextScanAt = now + SCAN_MS;
    }

    // -- Decide (priority order) --------------------------------------------
    let desired = null;
    let boost = false;
    let fire = false;

    // 2) Flee a longer snake within FLEE_RADIUS (revalidated live each tick).
    const threat = this.#liveThreat(st, s, px, py, myLen);
    if (threat) {
      const th = threat.head() || {};
      desired = Math.atan2(py - fin(th.y, py), px - fin(th.x, px));
      boost = myLen > FLEE_BOOST_MIN_SEGS;
    } else {
      // 3) Grab nearest item within ITEM_RADIUS.
      const item = st.cache.itemId !== null ? world.items.get(st.cache.itemId) : null;
      if (item && Number.isFinite(item.x) && Number.isFinite(item.y)
        && (item.x - px) ** 2 + (item.y - py) ** 2 <= ITEM_RADIUS * ITEM_RADIUS) {
        desired = Math.atan2(item.y - py, item.x - px);
      } else {
        if (item === null) st.cache.itemId = null;

        // 4) Fight: armed + enemy head within FIGHT_RADIUS.
        const armed = armedState(s, now);
        const enemy = this.#liveEnemy(st, s, px, py, now);
        if (armed && enemy) {
          const eh = enemy.head() || {};
          const ex = fin(eh.x, px);
          const ey = fin(eh.y, py);
          const dist = Math.hypot(ex - px, ey - py);

          // Simple projectile lead: aim where the target will be in dist/projSpeed s.
          let aimX = ex;
          let aimY = ey;
          if (!armed.isMine && armed.projSpeed > 0 && dist > 1) {
            const ea = fin(enemy.angle, 0);
            const eBoost = !!(enemy.input && enemy.input.b);
            const eSpeed = eBoost ? SNAKE.BOOST_SPEED : SNAKE.BASE_SPEED;
            const tLead = dist / armed.projSpeed;
            aimX = ex + Math.cos(ea) * eSpeed * tLead;
            aimY = ey + Math.sin(ea) * eSpeed * tLead;
          }
          desired = Math.atan2(aimY - py, aimX - px);

          if (armed.isMine) {
            fire = dist < MINE_DROP_DIST; // mines: drop when they get close
          } else {
            fire = Math.abs(angleDiff(desired, myA)) < AIM_CONE;
          }
          boost = dist > CHASE_BOOST_DIST && myLen > FLEE_BOOST_MIN_SEGS;
        } else {
          // 5) Feed: nearest food within FOOD_RADIUS.
          const food = st.cache.foodId !== null ? world.food.get(st.cache.foodId) : null;
          if (food && Number.isFinite(food.x) && Number.isFinite(food.y)) {
            desired = Math.atan2(food.y - py, food.x - px);
          } else {
            if (food === null) st.cache.foodId = null;
            // 6) Wander: smooth heading drift, re-pick every 2-4s.
            desired = this.#wander(st, px, py, now);
          }
        }
      }
    }

    // 1) Avoidance override: 3-ray probe against border + snake bodies.
    // Runs last so it beats every other intent. Highest priority.
    const p = powerOf(s, now);
    const ghosted = !!(p && p.k === 'ghost');

    const distToWall = Math.min(px, py, WORLD.W - px, WORLD.H - py);
    if (distToWall < WALL_PANIC_DIST) {
      desired = Math.atan2(WORLD.H / 2 - py, WORLD.W / 2 - px);
      boost = false;
      fire = false;
    } else {
      const hits = this.#probe(s, px, py, myA, ghosted, getSegs);
      const cBlocked = hits.c < PROBE_LEN;
      const mBlocked = hits.m < PROBE_LEN; // minus-side ray (myA - PROBE_SPREAD)
      const pBlocked = hits.p < PROBE_LEN; // plus-side ray  (myA + PROBE_SPREAD)

      if (cBlocked) {
        if (mBlocked && pBlocked) {
          desired = norm(myA + Math.PI); // boxed in: turn around
        } else {
          // Steer hard toward the side with more clearance.
          desired = norm(myA + (hits.p > hits.m ? HARD_TURN : -HARD_TURN));
        }
        boost = false;
        fire = false;
      } else if (mBlocked !== pBlocked) {
        // Only one side ray blocked: ease away from it.
        desired = norm(myA + (mBlocked ? SOFT_TURN : -SOFT_TURN));
        boost = false;
      }
    }

    // -- Emit input (the ONLY mutation path) --------------------------------
    let a = fin(desired, myA);
    a = norm(fin(a, 0));
    try {
      world.setInput(st.id, { a, b: boost ? 1 : 0, f: fire ? 1 : 0 });
    } catch {
      /* never throw out of the bot tick */
    }
  }

  // 5Hz heavy scan: nearest food / item / enemy / longer-threat by head distance.
  #scan(st, s, px, py, myLen, now) {
    const world = this.world;

    let threat = null;
    let threatD2 = FLEE_RADIUS * FLEE_RADIUS;
    let enemy = null;
    let enemyD2 = FIGHT_RADIUS * FIGHT_RADIUS;

    for (const other of world.snakes.values()) {
      if (other === s || !other || !other.alive) continue;
      const oh = other.head && other.head();
      if (!oh || !Number.isFinite(oh.x) || !Number.isFinite(oh.y)) continue;
      const d2 = (oh.x - px) ** 2 + (oh.y - py) ** 2;
      if (d2 <= threatD2 && fin(other.length, 0) > myLen) {
        threat = other;
        threatD2 = d2;
      }
      if (d2 <= enemyD2 && !isSpawnProtected(other, now)) {
        enemy = other;
        enemyD2 = d2;
      }
    }
    st.cache.threat = threat;
    st.cache.enemy = enemy;

    let itemId = null;
    let itemD2 = ITEM_RADIUS * ITEM_RADIUS;
    if (world.items) {
      for (const it of world.items.values()) {
        if (!it || !Number.isFinite(it.x) || !Number.isFinite(it.y)) continue;
        const d2 = (it.x - px) ** 2 + (it.y - py) ** 2;
        if (d2 <= itemD2) {
          itemId = it.id;
          itemD2 = d2;
        }
      }
    }
    st.cache.itemId = itemId;

    let foodId = null;
    let foodD2 = FOOD_RADIUS * FOOD_RADIUS;
    if (world.food) {
      for (const fd of world.food.values()) {
        if (!fd || !Number.isFinite(fd.x) || !Number.isFinite(fd.y)) continue;
        const d2 = (fd.x - px) ** 2 + (fd.y - py) ** 2;
        if (d2 <= foodD2) {
          foodId = fd.id;
          foodD2 = d2;
        }
      }
    }
    st.cache.foodId = foodId;
  }

  // Revalidate the cached flee threat against live state (it moves between scans).
  #liveThreat(st, s, px, py, myLen) {
    const t = st.cache.threat;
    if (!t || t === s || !t.alive || fin(t.length, 0) <= myLen) {
      if (t && (!t.alive || fin(t.length, 0) <= myLen)) st.cache.threat = null;
      return null;
    }
    const th = t.head && t.head();
    if (!th || !Number.isFinite(th.x) || !Number.isFinite(th.y)) return null;
    const d2 = (th.x - px) ** 2 + (th.y - py) ** 2;
    return d2 <= FLEE_RADIUS * FLEE_RADIUS ? t : null;
  }

  // Revalidate the cached fight target (alive, in range, not spawn-protected).
  #liveEnemy(st, s, px, py, now) {
    const e = st.cache.enemy;
    if (!e || e === s || !e.alive) {
      if (e && !e.alive) st.cache.enemy = null;
      return null;
    }
    if (isSpawnProtected(e, now)) return null;
    const eh = e.head && e.head();
    if (!eh || !Number.isFinite(eh.x) || !Number.isFinite(eh.y)) return null;
    const d2 = (eh.x - px) ** 2 + (eh.y - py) ** 2;
    return d2 <= FIGHT_RADIUS * FIGHT_RADIUS ? e : null;
  }

  // 3 rays (heading, +-PROBE_SPREAD) of PROBE_LEN px vs border walls and every
  // other living snake's body segments. Returns nearest hit distance per ray
  // (Infinity = clear). Keys: c=center, m=minus side, p=plus side.
  #probe(s, px, py, myA, ghosted, getSegs) {
    const angles = [myA, myA - PROBE_SPREAD, myA + PROBE_SPREAD];
    const dirs = angles.map((a) => [Math.cos(a), Math.sin(a)]);
    const hit = [Infinity, Infinity, Infinity];

    // Border.
    for (let i = 0; i < 3; i++) {
      const t = wallHitT(px, py, dirs[i][0], dirs[i][1]);
      if (t < hit[i]) hit[i] = t;
    }

    // Snake bodies (skipped entirely while ghosted: bodies can't kill us).
    if (!ghosted) {
      for (const other of this.world.snakes.values()) {
        if (other === s || !other || !other.alive) continue;
        const oh = other.head && other.head();
        if (!oh || !Number.isFinite(oh.x) || !Number.isFinite(oh.y)) continue;
        // Prefilter: every segment lies within pathLength of the other head.
        const reach = fin(other.length, 0) * SNAKE.SEG_SPACING + PROBE_LEN + RAY_HIT_RADIUS + 50;
        if ((oh.x - px) ** 2 + (oh.y - py) ** 2 > reach * reach) continue;

        const segs = getSegs(other);
        for (let j = 0; j < segs.length; j += 2) { // every 2nd segment is enough
          const seg = segs[j];
          if (!seg) continue;
          const relX = fin(seg[0], NaN) - px;
          const relY = fin(seg[1], NaN) - py;
          if (!Number.isFinite(relX) || !Number.isFinite(relY)) continue;
          // Cheap reject: segment farther than probe length + clearance.
          if (relX * relX + relY * relY > (PROBE_LEN + RAY_HIT_RADIUS) ** 2) continue;
          for (let i = 0; i < 3; i++) {
            const t = relX * dirs[i][0] + relY * dirs[i][1];
            if (t < -RAY_HIT_RADIUS || t > PROBE_LEN) continue;
            const perp = Math.abs(relX * dirs[i][1] - relY * dirs[i][0]);
            if (perp < RAY_HIT_RADIUS) {
              const tc = clamp(t, 0, PROBE_LEN);
              if (tc < hit[i]) hit[i] = tc;
            }
          }
        }
      }
    }

    return { c: hit[0], m: hit[1], p: hit[2] };
  }

  // Smooth "perlin-ish" wander: eased random target heading re-picked every
  // 2-4s plus a slow sinusoidal wobble; biases toward world center near edges.
  #wander(st, px, py, now) {
    if (now >= st.wanderUntil) {
      const edgeX = WORLD.W * EDGE_ZONE_FRAC;
      const edgeY = WORLD.H * EDGE_ZONE_FRAC;
      const nearEdge = px < edgeX || px > WORLD.W - edgeX || py < edgeY || py > WORLD.H - edgeY;
      if (nearEdge) {
        const toCenter = Math.atan2(WORLD.H / 2 - py, WORLD.W / 2 - px);
        st.wanderTarget = norm(toCenter + rand(-0.6, 0.6));
      } else {
        st.wanderTarget = rand(-Math.PI, Math.PI);
      }
      st.wanderUntil = now + rand(WANDER_MIN_MS, WANDER_MAX_MS);
    }
    const wobble = Math.sin(now * 0.001 * st.wobbleFreq + st.wobblePhase) * 0.35;
    return norm(st.wanderTarget + wobble);
  }
}
