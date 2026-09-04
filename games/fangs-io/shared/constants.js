// Fangs.io shared tuning constants — single source of truth for server AND client.
// Client imports via /shared/constants.js (served statically); server via relative path.

export const WORLD = { W: 4200, H: 4200 };

export const TICK = { RATE: 20, SNAPSHOT_HZ: 10 };

export const AOI_RADIUS = 1300;

export const SNAKE = {
  BASE_SPEED: 150,          // px/s
  BOOST_SPEED: 265,
  TURN_RATE: 4.4,           // rad/s
  SEG_SPACING: 14,          // px between segments along path
  SEG_RADIUS: 11,           // collision + draw radius
  HEAD_RADIUS: 13,
  START_SEGS: 12,
  MIN_SEGS: 6,
  MAX_SEGS: 300,
  BOOST_DRAIN_SEGS_PER_S: 1.4,
  EAT_RADIUS: 26,           // head-to-food distance to eat
  SPAWN_PROTECT_MS: 2500,   // no damage/collision-death right after spawn
};

export const FOOD = {
  COUNT: 950,               // world keeps ~this many ambient orbs
  GROW_PER_ORB: 0.5,        // segments per value-1 orb (v scales it)
  DEATH_ORB_VALUE: 2,       // orbs dropped by corpses are richer
};

export const SPAWN = {
  MIN_DIST: 700,            // min distance from any living snake
  CANDIDATES: 14,
  RESPAWN_COOLDOWN_MS: 2500,
};

export const WEAPONS = {
  blaster: { name: 'Blaster', ammo: 30, cooldownMs: 220, projSpeed: 620, segDamage: 2, range: 900, pellets: 1 },
  spread:  { name: 'Spread',  ammo: 18, cooldownMs: 480, projSpeed: 540, segDamage: 2, range: 620, pellets: 4, spreadRad: 0.42 },
  cannon:  { name: 'Cannon',  ammo: 8,  cooldownMs: 900, projSpeed: 480, segDamage: 6, range: 1000, pellets: 1 },
  mine:    { name: 'Mines',   ammo: 5,  cooldownMs: 600, projSpeed: 0,   segDamage: 8, range: 0, pellets: 1,
             armMs: 900, triggerRadius: 70, lifeMs: 25000 },
};

export const POWERS = {
  shield: { name: 'Shield',    durMs: 6000, hits: 3 },     // absorbs 3 hits or 6s
  speed:  { name: 'Overdrive', durMs: 5000, mult: 1.45 },  // free speed, no drain
  magnet: { name: 'Magnet',    durMs: 8000, radius: 240 },
  ghost:  { name: 'Ghost',     durMs: 3500 },              // pass through bodies
  shrink: { name: 'Shrink Ray',shots: 1, projSpeed: 700, pct: 0.30, range: 1100 }, // fired with F like a weapon: one big beam-orb
  turret: { name: 'Tail Turret', durMs: 10000, cooldownMs: 500, range: 520, projSpeed: 560, segDamage: 1 },
};

export const ITEMS = {
  TARGET_COUNT: 46,
  PICKUP_RADIUS: 30,
  // spawn weights
  WEIGHTS: { blaster: 26, spread: 18, cannon: 12, mine: 12, crate: 32 },
};

export const BOTS = {
  COUNT: 16,
  RESPAWN_MS: 3000,
};

export const NET = {
  MAX_PLAYERS: 40,
  INTERP_DELAY_MS: 120,
};

export const SKINS = [
  '#39ff88', // neon green
  '#ff5d5d', // red
  '#5db8ff', // blue
  '#ffd23f', // gold
  '#c77dff', // violet
  '#ff9f45', // orange
  '#4dfff0', // cyan
  '#ff6bd6', // pink
];

export const PROJ_KINDS = ['blaster', 'spread', 'cannon', 'shrink', 'turret'];
