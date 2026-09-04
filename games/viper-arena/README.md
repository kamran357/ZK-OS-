# VIPER ARENA

A neon top-down arena shooter where you pilot a growing viper. Eat pellets to
grow, grab weapon crates, and annihilate rival snakes wave after wave. Pure
vanilla JavaScript + Canvas 2D + WebAudio — no build step, no dependencies.

This Raj OS edition adds a persistent pilot profile, local high-score archive,
three equipment loadouts, explicit boss missions, escalating clearance goals,
ASMR/arcade/mute sound modes, and touch controls with nearest-hostile auto-aim.

## Play

Open `index.html` in any modern browser and press **START**. That's it.

```
# or serve it locally if your browser blocks file:// scripts
python3 -m http.server 8000    # then visit http://localhost:8000
```

## Controls

| Action        | Keys / Mouse                     |
| ------------- | -------------------------------- |
| Steer         | **WASD** or **Arrow keys**       |
| Aim           | **Mouse**                        |
| Fire          | **Left click** or **Space**      |
| Restart       | **R**                            |
| Mobile steer  | **On-screen directional pad**    |
| Mobile fire   | **FIRE** (nearest-hostile aim)    |

Your viper turns smoothly toward the pressed direction and always aims at the
cursor. Eating glowing green pellets grows your tail and nudges your health up.
Running your head into your own tail, an enemy body, or a head-on collision is
fatal — so is losing all your health.

## Weapons

Pick up floating crates (colour-coded, with a per-weapon icon) to swap your gun.
Running out of ammo drops you back to the infinite Pistol.

| Weapon      | Colour  | Ammo | Feel                                                    |
| ----------- | ------- | ---- | ------------------------------------------------------- |
| **PISTOL**  | Cyan    | ∞    | Reliable single shots. Your fallback.                   |
| **SHOTGUN** | Amber   | 18   | 9-pellet spread, huge knockback, short range.           |
| **SMG**     | Green   | 90   | Rapid-fire hose with light recoil.                      |
| **RAILGUN** | Red     | 6    | Charge-up hitscan beam that pierces everything.         |
| **FLAME**   | Orange  | 200  | Short-range cone of piercing fire particles.            |

## Scoring & Waves

- Killing an enemy scores points scaled by your **combo** multiplier (builds up
  to x8 on quick chains, decays if you stop killing).
- Each wave has an explicit clearance target. Enemy count, health, speed, and
  weapon quality escalate rather than repeating a fixed encounter.
- Boss protocols trigger on wave 3 (**Venom Titan**), wave 6 (**Rail Wyrm**),
  and wave 9 (**Inferno Hydra**), with unique health, speed, weapon, scale, and
  score rewards.
- Pellets are worth points too and keep your tail growing.

## Pilot profile and loadouts

- Callsign is required before launch, normalized to 2–16 safe characters, and
  persisted in both `localStorage` and a one-year `SameSite=Lax` cookie.
- The ten best local runs persist with score, wave, kills, loadout, and pilot.
- **Overdrive Fins:** +10% movement speed, SMG start, cyan fin geometry.
- **Bulwark Plating:** 140 HP, 28% damage reduction, visible gold body armour.
- **Arc Coil:** railgun start, 88 HP, visible magenta energy coil.
- Sound mode persists per pilot: soft **ASMR**, punchier **Arcade**, or **Mute**.

## Files

| File         | Role                                                               |
| ------------ | ------------------------------------------------------------------ |
| `index.html` | Markup: canvas, HUD, title & game-over overlays.                   |
| `style.css`  | Neon dark styling.                                                 |
| `sim.js`     | Deterministic fixed-step simulation (no DOM — node-testable).      |
| `render.js`  | Canvas 2D renderer: camera, snakes, FX, minimap.                   |
| `audio.js`   | WebAudio SFX (oscillators only, no asset files).                   |
| `main.js`    | Glue: input, RAF loop, HUD, screens, debug hook.                   |
| `DESIGN.md`  | Visual/interaction contract for the vendored Raj OS edition.       |

## Debug hook

`main.js` exposes `window.__viper` for scripted/headless testing:

```js
__viper.start();                 // begin a fresh game
__viper.tick(60);                // advance 60 fixed sim steps
__viper.state();                 // { alive, score, wave, health, ammo,
                                 //   weapon, headX, headY, enemyCount }
__viper.key('KeyD', true);       // press/release a key by code
__viper.aim(x, y);               // set aim to a screen coord
__viper.fire();                  // fire one deterministic shot
__viper.spawnCrate('railgun');   // drop a weapon crate
__viper.spawnEnemy();            // spawn one enemy
```
