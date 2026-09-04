# Fangs.io — Build Spec (source of truth)

2D top-down pixel .io game: snake free-for-all with weapons. Slither.io movement/growth + Diep-style shooting + Beach-Buggy random power crates. Phase 1+2 scope: fully playable vs bots, all combat + feedback systems in.

## Stack (hard requirements)

- Plain web client: HTML + ES modules + Canvas 2D. NO framework, NO bundler, NO build step.
- Server: Node.js (v22, ESM `"type":"module"`), `ws` package only. Serves the client statics AND the websocket on ONE port (8787).
- Shared code in `/shared` (imported by both server and client via relative / static paths).
- Repo layout (each file has ONE owner; never edit a file you don't own):

```
fangs-io/
  package.json            (root, done)
  SPEC.md                 (this file)
  shared/constants.js     (done — read it, all tuning lives there)
  server/index.js         (owner: NET)   entry: http+ws, sessions, tick loop, snapshots
  server/world.js         (owner: CORE)  World class: state, food, collisions, spawns
  server/snake.js         (owner: CORE)  Snake class: path movement, grow/shrink
  server/combat.js        (owner: COMBAT) weapons, projectiles, items, powers, turret
  server/bots.js          (owner: BOTS)  BotController
  client/index.html       (done — skeleton, do not restructure; HUD may fill #hud)
  client/main.js          (owner: INTEGRATOR, written last)
  client/renderer.js      (owner: RENDER)
  client/sprites.js       (owner: RENDER)
  client/net.js           (owner: CLIENTNET)
  client/input.js         (owner: CLIENTNET)
  client/hud.js           (owner: HUD)
  client/styles.css       (owner: HUD)
  assets/                 (png overrides + manifest.json; empty ok)
  tools/                  (owner: TOOLS) sprite prompt pack + sheet slicer
```

## Game rules (canonical)

1. World is `WORLD.W x WORLD.H` px, bordered. Touching the border kills you (classic).
2. Snake = head + segments spaced `SNAKE.SEG_SPACING` along a recorded path. Steering: head turns toward requested angle at max `SNAKE.TURN_RATE` rad/s. Speed `BASE_SPEED`, boost `BOOST_SPEED`.
3. Boost drains: `BOOST_DRAIN_SEGS_PER_S` segments/s (dropped behind as food). Cannot boost below `MIN_SEGS`.
4. Eating food orbs grows the snake (`FOOD.GROW_PER_ORB` segments per orb). Score = total segments grown lifetime; length = current segments.
5. HEAD touching another snake's BODY segment = instant death (unless ghost). Head-vs-head: the shorter snake dies (both die if within 3 segs).
6. Death → entire body converts to food orbs (value-dense), a `kill` event fires.
7. Projectile hit → victim loses `weapon.segDamage` tail segments (dropped as food at tail), hit + damage events fire. If victim length <= MIN_SEGS and takes another hit → dies.
8. Items spawn on the ground, maintained at `ITEMS.TARGET_COUNT`: weapons (blaster/spread/mine/cannon) and power crates. Slither over to pick up (head within pickup radius).
9. One weapon slot (new pickup replaces). Weapons have ammo; at 0 you're unarmed. Fire toward current steer angle.
10. Power crates grant ONE random power on pickup: shield / speed / magnet / shrink / ghost / turret (see constants; turret = auto-fires at nearest enemy within range for its duration; shrink = one big projectile that removes 30% of target's length).
11. Bots: `BOTS.COUNT` bots always alive (respawn 3s after death), human-looking names, seek food, avoid bodies/border, grab items, fight when armed, flee bigger snakes.
12. Spawns: pick candidate points, choose the one farthest from all living snakes, never closer than `SPAWN.MIN_DIST` to anyone. NEVER random-overlap spawns.
13. Limited vision: server only sends entities within `AOI_RADIUS` of the player's head. Client renders a fog vignette at the same radius. The minimap shows self + world border + power crates only (no enemy wallhack).

## Protocol (JSON text frames over ws)

Client→Server:
- `{t:'join', name, skin}` name: 1-16 chars sanitized server-side; skin: 0..7
- `{t:'input', a, b, f}` a=steer angle rad; b=1 boosting; f=1 fire held. Send on change, max 30Hz.
- `{t:'respawn'}`
- `{t:'ping', id}` → `{t:'pong', id}`

Server→Client:
- `{t:'welcome', id, w, h}`
- `{t:'snap', tk, me, sn, fd, it, pj, ev, lb}` at `TICK.SNAPSHOT_HZ`:
  - `me`: `{x, y, a, len, score, hp, wpn:{k,ammo}|null, pw:{k,until}|null, boost}` (always present while alive)
  - `sn`: array of AOI snakes incl. self: `{id, n, sk, x, y, a, segs:[[x,y],...(every 2nd seg)], boost, len, fx:[...active power keys]}`
  - `fd`: `[[id,x,y,v],...]` food in AOI (v=value tier 1|2|3 for size)
  - `it`: `[[id,x,y,kind],...]` kind: 'blaster'|'spread'|'mine'|'cannon'|'crate'
  - `pj`: `[[id,x,y,a,kind],...]` projectiles in AOI ('mine' sits still)
  - `ev`: events for THIS client this frame, each `{e, ...}`:
    - `{e:'hit'}` your shot landed (hitmarker)
    - `{e:'dmg', a}` you took damage from world-angle a (directional indicator)
    - `{e:'kill', v}` you eliminated snake named v (banner)
    - `{e:'feed', k, v, w}` global killfeed entry: killer k, victim v, weapon w
    - `{e:'pick', kind}` you picked up kind
  - `lb`: top 10 `[[name,score],...]`
- `{t:'dead', k, w, score, len, ms}` you died: killer name k, weapon/cause w ('body'|'border'|weapon key), respawn cooldown ms
- `{t:'full'}` server full

## Module contracts (implement EXACTLY these exports)

### server/snake.js (CORE)
```js
export class Snake {
  constructor(id, name, skin, x, y, angle, isBot)
  // fields: id, name, skin, isBot, alive, dead(reason), score, spawnProtectedUntil
  // input: {a, b, f} set externally
  head()               // {x,y}
  angle
  length               // current segment count
  segments()           // [[x,y],...] spaced SEG_SPACING, length entries
  step(dt)             // turn toward input.a (TURN_RATE cap), advance, record path, boost drain -> returns droppedFood [[x,y],...]
  grow(n)              // n may be fractional; accumulate
  shrink(n)            // returns [[x,y],...] positions removed from tail (for food drops)
}
```

### server/world.js (CORE)
```js
export class World {
  constructor()                       // seeds FOOD.COUNT food, initial items via combat.spawnItems
  snakes                              // Map id->Snake
  food                                // Map id->{id,x,y,v}
  items                               // Map id->{id,x,y,kind}   (combat owns contents)
  projectiles                         // Map id->proj             (combat owns contents)
  addPlayer(id, name, skin, isBot)    // spawns at spawnPoint(), returns Snake
  removePlayer(id)
  respawn(id)
  setInput(id, {a,b,f})
  step(dt, now)                       // full sim tick; calls combat.step(this, dt, now)
  spawnPoint()                        // farthest-from-others candidate, >= SPAWN.MIN_DIST
  dropFood(x, y, v)                   // scatter helper (small jitter)
  killSnake(snake, reason, killerSnake|null)  // body->food, events, marks dead
  queryAOI(x, y, r)                   // {sn:[Snake], fd:[food], it:[item], pj:[proj]}
  pushEvent(snakeId|null, ev)         // null = broadcast event (killfeed)
  drainEvents(snakeId)                // -> array (this client's events + broadcast), clears
  leaderboard()                       // [[name,score] x10]
}
```
World.step order: snakes step -> food eat (head within EAT_RADIUS, magnet pulls food in MAGNET_RADIUS) -> combat.step -> collisions (head vs bodies, border) -> item pickup via combat.pickupCheck.

### server/combat.js (COMBAT)
```js
export function spawnItems(world, now)                 // top up to ITEMS.TARGET_COUNT, weighted kinds
export function pickupCheck(world, snake, now)         // head vs items; weapon swap / applyPower; 'pick' event
export function applyPower(world, snake, key, now)     // sets snake.power={k,until}; instant effects handled here
export function fireWeapon(world, snake, now)          // respects weapon.cooldown + ammo; spawns projectile(s)
export function step(world, dt, now)                   // projectiles move+collide (skip owner 300ms), mines arm+proximity-explode, turret auto-fire, power expiry
export function damageSnake(world, victim, attacker, weaponKey, segs)  // shield absorb; shrink logic; events (hit to attacker, dmg to victim); death if at floor
```

### server/bots.js (BOTS)
```js
export class BotController {
  constructor(world)      // adds BOTS.COUNT bots with names from a 40-name pool
  step(dt, now)           // steer via world.setInput; respawn dead bots after BOTS.RESPAWN_MS
}
```
Bot brain (priority): avoid border/bodies (raycast ahead of head) > flee longer snake within 500px > grab item within 400px > if armed & enemy within 600px: aim + fire > seek nearest food cluster. Boost only when fleeing or chasing a kill.

### server/index.js (NET)
- `http.createServer` serving `client/` at `/`, plus `/shared/*` and `/assets/*` (correct MIME: js, css, html, png, json). Port `process.env.PORT || 8787`.
- `WebSocketServer({server})`. Per-connection: expects `join` first → `addPlayer` → `welcome`. Rate-limit input msgs (drop >60/s). Sanitize name. Max `NET.MAX_PLAYERS` humans → else `full`.
- Sim loop: `TICK.RATE` Hz (setInterval, dt clamped). Snapshot loop `TICK.SNAPSHOT_HZ` Hz: per human client, `queryAOI(head, AOI_RADIUS)` → compact snap per protocol (segs decimated 2x), `drainEvents`, leaderboard.
- On snake death: send `dead` msg (humans). On `respawn` msg after cooldown: `world.respawn`.
- Creates `World` + `BotController`. Log one line per join/leave/kill to stdout.

### client/sprites.js (RENDER)
```js
export async function loadSprites()  // -> Sprites
// Sprites.get(name) -> HTMLCanvasElement
```
Procedurally draws crisp PIXEL-ART sprites on offscreen canvases at 3x scale, palette from constants SKINS (8 snake hues). Names: `head_0..7`, `seg_0..7`, `food_1|2|3`, `item_blaster|spread|mine|cannon|crate`, `proj_blaster|spread|cannon|shrink`, `mine_armed`, `fx_shield`, `bg_tile` (64px tileable dark grid). Style: chunky 1-bit-outline pixel sprites, dark arcade palette, readable at 100% zoom.
FIRST tries `fetch('/assets/manifest.json')`; any name present in the manifest loads its PNG from `/assets/` and REPLACES the procedural version (this is the ChatGPT-art drop-in path). Missing/failed → procedural fallback. Never a broken image.

### client/renderer.js (RENDER)
```js
export class Renderer {
  constructor(canvas, sprites)
  resize()
  render(view, myId, now)  // view = interpolated {sn, fd, it, pj, me}
}
```
Camera centered on me (lerp). Draw: bg tiles + world border (danger stripes), food (pulse), items (bob+glow), snakes (segments tail→head, head rotated to angle, boost trail, shield ring / ghost alpha 0.45 / speed streaks from fx), projectiles, mines. Fog of vision: radial gradient to near-black past `AOI_RADIUS*0.92`. Screen shake hook: `renderer.shake(px)`. Pixelated rendering (`imageSmoothingEnabled=false`, integer scale).

### client/input.js (CLIENTNET)
```js
export class Input {
  constructor(canvas)
  state()   // {a, b, f} a=angle from screen center to mouse; b: Space or RMB held; f: LMB held
}
```
Prevent context menu. Touch: drag steers, is boost=false, fire button not needed (desktop-first).

### client/net.js (CLIENTNET)
```js
export class Net {
  constructor(handlers) // {onWelcome, onSnap, onDead, onClose}
  connect(name, skin)   // ws(s)://location.host
  sendInput(s)          // throttle: only on change or every 100ms
  respawn()
  view(now)             // interpolated render-state from snap buffer (100ms delay, lerp positions+segs; keep last snap entities if gap)
  ping                  // rolling ms
}
```

### client/hud.js (HUD) + styles.css
```js
export class HUD {
  constructor(root)                       // builds all DOM inside #hud
  showStart(onPlay)                       // title 'FANGS.IO', name input (persist localStorage), 8-skin picker, PLAY btn; tips line
  hideStart()
  showDeath({k,w,score,len,ms}, onRespawn) // 'EATEN BY <k>' / weapon icon+name, score, respawn countdown auto-enables button
  hideDeath()
  update({me, lb, ping, fps})             // score/length, weapon+ammo pips, power timer bar, leaderboard top10 (me highlighted), ping/fps
  event(ev, now)                          // hitmarker flash (X at crosshair 120ms), dmg: red directional arc at screen edge toward ev.a, kill: 'ELIMINATED <v>' banner, feed: killfeed row (5s fade, max 6), pick: toast
  minimap(me, crates)                     // 160px canvas: border, self dot, crate dots
}
```
Aesthetic: pixel/arcade — 'Press Start 2P'-style system stack (`font-family: 'Courier New', monospace` + letterspacing; NO external fonts), dark #0b0e14 bg, neon green #39ff88 accent, hard 2px borders, no blur. All HUD pointer-events:none except start/death screens.

### client/main.js (INTEGRATOR — written after all modules exist)
Wires everything: loadSprites → HUD start → Net connect → rAF loop (net.view → renderer.render → hud.update) → input send loop → events → death/respawn. MUST expose the debug hook:
```js
window.__fangs = {
  getMe: () => latest me {x,y,a,len,score,alive},
  setInput: (a,b,f) => force input override (null clears),
  state: () => {snakes:n, food:n, items:n, projs:n, ping},
  events: [] // last 50 events received
}
```

## Feedback requirements (non-negotiable, from enforcement rules)

Death screen w/ killer+weapon, respawn countdown, hitmarkers, damage direction, kill banner, killfeed, pickup toasts, boost/weapon state visible. Spawns spread (rule 12). All verified by DRIVING the game via the debug hook, not screenshots.

## Acceptance checklist (integration + playtest must pass)

1. `node server/index.js` boots clean; page loads at :8787 with zero console errors.
2. Join with a name → snake spawns, bots visible/moving, world populated.
3. `__fangs.setInput(0,0,0)` then sample `getMe().x` — position advances (movement).
4. Steer full circle; boost drains length; can't boost at MIN_SEGS.
5. Eat food → len increases. Pick up weapon → HUD shows it; fire → ammo decrements, projectile visible, bot hit → hitmarker + bot loses tail segs.
6. Get shot (stand near armed bot) → dmg arc + len drops. Die (hit bot body) → death screen w/ killer name, countdown, respawn works, spawn is far from others.
7. Kill a bot (shoot to floor or make it hit you) → banner + killfeed + its body becomes food.
8. Crate pickup → power applies visibly (shield ring etc.), expires.
9. Walk into border → die w/ 'border' cause. Cannot leave world.
10. Fog: entities beyond AOI not in snap. Minimap shows self moving.
11. 10 min soak: no crash, no NaN positions, bots stay in-bounds, food count stable.
