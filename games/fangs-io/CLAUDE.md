# Fangs.io

2D top-down .io game: slither-style snake free-for-all with weapons, auto-turret power, and random Beach-Buggy-style power crates. Hobby project + content play for @AIwithShreyasRaj ("I built an addictive .io game with Claude Code"). Monetized by paid ads (Google AdSense).

## Architecture — CLIENT-ONLY (single-player vs smart bots)

The whole game runs in the browser. There is NO server. Bots are local AI snakes in the same in-browser world, so it feels like a live free-for-all but hosts as pure static files (free hosting = pure ad profit, instant load, zero netcode). Real multiplayer is a future Phase 3 — the old authoritative-ws scaffold is parked in `_archive-multiplayer/` for reference.

- Plain HTML + ES modules + Canvas 2D. No framework, no bundler, no build step. Opens by double-click or any static host.
- Relative imports everywhere (`./`, `../shared/…`) so it works on GitHub Pages project subpaths.
- Zero runtime dependencies.

## Structure

- `index.html` — landing/menu (clean WHITE, per Shreyas's pref) + game canvas + death screen + AdSense slots
- `css/style.css` — white premium menu; dark arcade in-game HUD
- `shared/constants.js` — ALL tuning (speeds, weapons, powers, bots, skins). Never hardcode a number that belongs here.
- `js/`
  - `game.js` — orchestrator: fixed-timestep loop, state machine (menu/playing/dead), event→HUD routing, auto-fire, `window.__fangs` debug hook (incl. `advance(ms)` for headless testing)
  - `world.js` — local World: sim tick, spawns (spread, never overlap), collisions, food/items, killSnake
  - `entities.js` — Snake (path-based slither movement, grow/shrink), food/item/projectile factories
  - `combat.js` — items, weapons, powers, projectiles, mines, tail-turret, damage
  - `bots.js` — BotController: border-safe brain (avoid/flee/grab/fight/seek/wander), respawn to keep the arena full
  - `render.js` — camera, fog of vision, screen shake, neon stroked bodies + pixel sprites
  - `hud.js` — score/leaderboard/killfeed/minimap + hitmarker, damage-direction, banners (all non-negotiable feedback)
  - `sprites.js` — procedural pixel-art atlas + PNG drop-in via `assets/manifest.json` (never a broken image)
  - `input.js` — steer to pointer, hold to boost; weapons auto-fire
- `assets/` — drop-in PNG sprite overrides + `manifest.json` (array of names). Missing → procedural fallback.
- `tools/` — `build-prompts.mjs` (generates the sprite prompt pack), `sprite-prompts.json` (107 individual green-screen prompts), `key_sprite.py` + `key-and-slice.sh` (chroma-key green → transparent, autocrop, resize, register in manifest)
- `SPEC.md` — original design bible (still canonical for game rules/tuning; ignore its client/server protocol section — superseded by client-only)

## Asset pipeline (ChatGPT → game)

1. Shreyas generates each sprite from `tools/sprite-prompts.json` in ChatGPT (green `#00FF00` bg, ~10 at a time).
2. `./tools/key-and-slice.sh <image> <sprite_name>` keys the green out, autocrops, resizes, writes `assets/<name>.png`, registers it in `manifest.json`.
3. `maps_to` in the pack tells you which name replaces which built-in sprite (`head_0`, `item_blaster`, `proj_cannon`, `fx_shield`, `bg_tile`, …). Reload → the game uses the art.

## Dev / run

- Serve: `python3 -m http.server 8123` in this dir (or any static host). Preview launch config: project `.claude/launch.json` → "fangs-io".
- Regenerate prompt pack: `node tools/build-prompts.mjs`.

## Rules for this repo

- Playtesting means DRIVING gameplay via `window.__fangs` (`play`, `setInput`, `advance`, `giveWeapon`, `spawnBotNear`, `getMe`, `state`) — never menu screenshots. rAF pauses when the tab is hidden, so use `__fangs.advance(ms)` to step the sim deterministically in headless/preview.
- Death feedback, hitmarkers, damage direction, respawn countdown, spread spawns are FEATURES, not polish.
- Menu/landing stays clean white with a green accent; the arena is dark by genre necessity.
- Instant-load: no heavy deps, keep total JS tiny. Google Fonts on the menu only, non-blocking.
- Monetization = AdSense: slots are in `index.html` (top banner, side box, death interstitial). Paste `ca-pub-…`, un-comment, add `/ads.txt`.
