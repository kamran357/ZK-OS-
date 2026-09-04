# 🐍 Fangs.io

A free, instant-play browser **.io game**: grow your snake, grab weapons and power-ups off the ground, and blast rivals to bits in a giant top-down free-for-all arena.

**Play:** open `index.html` (double-click) or host the folder anywhere static.

## Features

- **Slither-style growth** — eat glowing orbs to get longer; length is your health.
- **Weapons on the ground** — blaster, spread, cannon, mines. Slither over one to equip it; it auto-fires toward your heading.
- **Power crates** (Beach-Buggy style) — shield, overdrive, magnet, ghost, shrink-ray, tail-turret, and more, granted at random.
- **Classic kill rule** — ram your head into a rival's body and they explode into food. A fresh snake can take down the #1.
- **Limited vision** — fog of war beyond your view keeps every encounter tense.
- **Full game feel** — hitmarkers, damage-direction arrows, kill banners, killfeed, death screen with respawn, screen shake, minimap, live leaderboard.
- **Smart bots** — the arena is always full and dangerous. No server needed.

## Tech

Pure HTML + Canvas 2D + ES modules. No framework, no build step, no runtime dependencies, no backend. The whole simulation runs client-side, which is why it loads instantly and hosts for free.

## Controls

- **Move:** mouse (or drag on touch)
- **Boost:** hold left-click / space (or the mobile boost button)
- **Fire:** automatic while a weapon is equipped

## Custom art

The game ships with procedural pixel sprites and supports drop-in PNG art:

1. Generate sprites from `tools/sprite-prompts.json` (107 ready-to-run prompts, green-screen background).
2. `./tools/key-and-slice.sh <image> <sprite_name>` — keys the green out and installs it into `assets/`.
3. Reload. See `CLAUDE.md` for the full pipeline.

## License

Hobby project. Do what you like with it.
