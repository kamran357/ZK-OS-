# Viper Arena — Raj OS Edition Design Contract

## Direction

Operational neon arena interface: black-blue field, cyan player signal, amber
mission signal, red danger, and magenta boss protocol. The UI stays sharp,
technical, and compact; no ornamental gradients outside status glows.

## Tokens

- Background: `#04070a`
- Surface: `rgba(6, 12, 16, .72)`
- Player / focus: `#7cf9ff`
- Mission: `#ffc24b`
- Damage: `#ff4d6d`
- Boss: `#ff4d9d`
- Text: `#dff6f8`
- Muted text: `#5c7378`
- Radius: 2–4px for interface panels; circular only for game controls.

## Typography

System sans, heavy uppercase display, compact tracked labels. Numeric HUD values
use tabular figures. Body and helper copy remain at least 10px on the smallest
supported viewport.

## Primitives

- `LoadoutCard`: default, hover, selected, focus-visible.
- `SoundMode`: ASMR, arcade, mute; selected state is filled cyan.
- `PilotField`: normal, focus, invalid with adjacent text error.
- `LeaderboardRow`: rank, safe pilot text, tabular score; explicit empty state.
- `BossMeter`: boss name, percentage, continuous health bar.
- `TouchControl`: idle and pressed; large enough for coarse pointers.

## Motion and audio

Only transform/opacity/filter UI transitions. Canvas simulation remains
fixed-step. Reduced-motion users receive near-zero UI transition duration.
Audio never starts before a user gesture. ASMR is the default and softens
waveforms, noise, and master gain; mute is a real zero-gain state.

## Responsive behavior

- Desktop: two-column launcher with leaderboard.
- Tablet: stacked launcher and score archive.
- Phone/coarse pointer: compact HUD, touch d-pad and fire, nearest-hostile
  auto-aim, reduced minimap, and safe bottom clearance for controls.

## Accessibility and safety

All controls are native buttons/inputs with visible keyboard focus. Callsigns
are normalized before persistence and rendered only through `textContent`.
Storage and cookie access fail gracefully. No backend or personal data leaves
the browser.
