// Fangs.io — sprite prompt pack builder.
// Emits an array of INDIVIDUAL, copy-paste-ready image prompts (one asset each),
// on a flat chroma-green background for clean keying. ChatGPT/GPT-Image generates
// ~10 at a time; you key out the green with tools/key-and-slice.sh and drop the PNGs
// into assets/ (names in `maps_to` auto-replace the procedural sprite via manifest).
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GREEN = 'a perfectly flat, uniform chroma-key green background (#00FF00), edge to edge, no gradient, no vignette, no shadow, no floor, no backdrop art — pure solid green so the asset can be keyed to transparency cleanly';
const WHITE = 'a perfectly flat pure white background (#FFFFFF), no gradient, no shadow, no backdrop art, so the asset can be cut out cleanly';

const STYLE = 'crisp high-contrast 2D game-sprite art in a retro-arcade .io aesthetic: bold chunky readable forms, a clean thick dark outline (about 3 to 5 percent of the sprite width) wrapping the whole shape, flat 3-tone cel shading (one base tone, one lighter top-left highlight plane, one darker bottom-right shadow plane) with hard edges between tones, absolutely no soft gradients and no photorealism, saturated neon-friendly colors, a single hero object centered and unrotated, drawn so it stays instantly readable when scaled down to 32 pixels';

const NEG = 'no text, no letters, no numbers, no captions, no labels, no watermark, no signature, no UI, no border frame, no drop shadow, no cast shadow on the ground, no reflection, no gradient background, no photorealism, no 3D render look, no blurry or soft edges, no motion blur, no lens flare, no busy background, no multiple objects, no duplicated asset, no cropped edges, no object touching the canvas edge, no green spill or green rim light on the subject, no realistic hands, no brand logos, no purple background, no em dash';

const VIEW = 'strict top-down orthographic view (camera directly overhead)';
const CANVAS = '1024x1024, single centered asset with roughly 15 percent empty padding on every side';

function compose(s) {
  const bg = s.bg === 'white' ? WHITE : GREEN;
  const view = s.view || VIEW;
  const parts = [
    `A ${CANVAS}, on ${bg}.`,
    `Subject: ${s.subject}`,
    s.palette ? `Palette: ${s.palette}.` : '',
    s.lighting ? `Lighting and finish: ${s.lighting}.` : '',
    `Rendered in this exact style: ${STYLE}, shown in ${view}.`,
    `Composition: one single centered object, generous padding, nothing touching the edges, no text of any kind.`,
    `Negative prompt: ${NEG}.`,
  ];
  return parts.filter(Boolean).join(' ');
}

function obj(s) {
  return {
    id: s.id,
    category: s.category,
    maps_to: s.maps_to || null, // game sprite name (drop-in) or null = expansion/marketing
    canvas: '1024x1024',
    background: s.bg === 'white' ? 'flat pure white #FFFFFF (key/cutout)' : 'flat chroma green #00FF00 (key to transparency)',
    view: s.view || 'top-down orthographic',
    style_ref: 'shared STYLE_GUIDE (see pack header)',
    subject: s.subject,
    palette: s.palette || '',
    lighting: s.lighting || 'flat 3-tone cel shading, hard highlight top-left, hard shadow bottom-right, thick dark outline',
    negative_prompt: NEG,
    prompt: compose(s),
  };
}

const SKINS = [
  { i: 0, n: 'neon green', base: '#39ff88', hi: '#8dffbd', sh: '#1fa657' },
  { i: 1, n: 'crimson red', base: '#ff5d5d', hi: '#ff9a9a', sh: '#b3383a' },
  { i: 2, n: 'sky blue', base: '#5db8ff', hi: '#9ad4ff', sh: '#3a7fb8' },
  { i: 3, n: 'gold', base: '#ffd23f', hi: '#ffe786', sh: '#b8942a' },
  { i: 4, n: 'violet', base: '#c77dff', hi: '#e0b3ff', sh: '#8c52b8' },
  { i: 5, n: 'orange', base: '#ff9f45', hi: '#ffc487', sh: '#b86e2c' },
  { i: 6, n: 'aqua cyan', base: '#4dfff0', hi: '#93fff7', sh: '#2fb8ac' },
  { i: 7, n: 'hot pink', base: '#ff6bd6', hi: '#ffa3e6', sh: '#b8489a' },
];

const specs = [];

// ---- SNAKE HEADS (drop-in head_0..7) ----
for (const k of SKINS) {
  specs.push({
    id: `snake_head_${k.i}_${k.n.replace(/\s/g, '')}`, category: 'snake_head', maps_to: `head_${k.i}`,
    subject: `a cute but menacing cartoon serpent head for a top-down snake battle game, facing directly to the RIGHT (snout on the right edge of the shape), a rounded wedge silhouette that is wide at the back and tapers to a blunt snout, two large round white eyes with small square dark pupils set near the snout, two tiny sharp white fangs pointing down, a small forked red tongue flicking out from the snout tip, ${k.n} scales`,
    palette: `base ${k.base}, top highlight ${k.hi}, jaw shadow ${k.sh}, white #ffffff eyes, near-black #0b0d12 pupils and outline, red #ff2d55 tongue`,
  });
}
// ---- SNAKE BODY SEGMENTS (drop-in seg_0..7) ----
for (const k of SKINS) {
  specs.push({
    id: `snake_body_${k.i}_${k.n.replace(/\s/g, '')}`, category: 'snake_body', maps_to: `seg_${k.i}`,
    subject: `a single round body segment of a cartoon snake for a top-down game, a plump near-circular scaled disc with a slightly darker belly band across the lower third and a soft round highlight on the upper-left, ${k.n} scales, designed to tile seamlessly when many are chained into a long snake`,
    palette: `base ${k.base}, upper highlight ${k.hi}, belly shadow ${k.sh}, near-black #0b0d12 outline`,
  });
}
// ---- SNAKE TAIL TIPS (expansion) ----
for (const k of SKINS.slice(0, 4)) {
  specs.push({
    id: `snake_tail_${k.i}_${k.n.replace(/\s/g, '')}`, category: 'snake_tail', maps_to: null,
    subject: `the pointed tail tip of a cartoon snake for a top-down game, a short segment tapering to a rounded point facing LEFT, ${k.n} scales, matching the body segments so it caps the end of the snake cleanly`,
    palette: `base ${k.base}, highlight ${k.hi}, shadow ${k.sh}, near-black #0b0d12 outline`,
  });
}
// premium heads
specs.push({ id: 'snake_head_king_gold', category: 'snake_head', maps_to: null,
  subject: 'a premium leaderboard-king serpent head facing RIGHT, same silhouette as the base heads but wearing a tiny chunky golden crown with three points sitting on top of the head, glossy metallic gold scales, confident narrowed eyes',
  palette: 'gold scales #ffd23f with highlight #fff0a8 and shadow #b8892a, crown #ffe37e with #b8892a shade, white eyes, dark #0b0d12 outline' });
specs.push({ id: 'snake_head_galaxy', category: 'snake_head', maps_to: null,
  subject: 'a rare cosmic serpent head facing RIGHT, same silhouette as the base heads, deep space-purple scales speckled with a few tiny white star dots and a faint teal nebula sheen on the crown, glowing cyan eyes',
  palette: 'deep indigo #3a2c66 base, nebula highlight #6b5bd6, shadow #241a44, star dots #ffffff, glowing eyes #4dfff0, dark #0b0d12 outline' });

// ---- FOOD ORBS ----
specs.push({ id: 'food_orb_small_green', category: 'food', maps_to: 'food_1',
  subject: 'a small glowing food pellet for a snake game, a simple round orb with a bright core and a thin darker rim, the most common low-value snack',
  palette: 'mint green orb #6bffab, bright white-green core #dfffee, dark green rim #0f3d26' });
specs.push({ id: 'food_orb_medium_gold', category: 'food', maps_to: 'food_2',
  subject: 'a medium glowing food gem for a snake game, a round faceted orb slightly larger than the common pellet, worth more, with a shiny highlight dot',
  palette: 'gold orb #ffd23f, pale core #fff3bf, brown rim #4d3a08' });
specs.push({ id: 'food_orb_large_orange', category: 'food', maps_to: 'food_3',
  subject: 'a large juicy food orb for a snake game, the biggest common snack, a round glowing sphere with a soft inner glow and a bright highlight',
  palette: 'orange orb #ff9f45, pale core #ffd9a8, dark rim #4a2408' });
specs.push({ id: 'food_gem_blue_xp', category: 'food', maps_to: null,
  subject: 'a rare blue XP crystal for a snake game, a small cut diamond-shaped gem that sparkles, worth a lot of growth',
  palette: 'ice blue #7fd4ff, white sparkle core #eafaff, deep blue rim #16466b' });
specs.push({ id: 'food_diamond_rare', category: 'food', maps_to: null,
  subject: 'a legendary rainbow diamond food gem for a snake game, a chunky faceted diamond with a subtle multi-color sheen, extremely rare and valuable',
  palette: 'white-diamond body #eafffd with faint pink/blue/gold facet tints, bright core #ffffff, dark teal rim #143a3a' });
specs.push({ id: 'food_corpse_chunk', category: 'food', maps_to: null,
  subject: 'a glowing meat chunk dropped when a snake dies, an irregular blobby orb bigger than normal food, richer looking, faintly pulsing',
  palette: 'warm amber #ffb454 with bright core #ffe0a8 and dark rim #4a2a08' });

// ---- WEAPONS (ground pickup icons) ----
const weapons = [
  { id: 'weapon_blaster', map: 'item_blaster', subj: 'a compact sci-fi blaster pistol pickup icon, a short stubby energy pistol seen from a three-quarter top angle with a glowing muzzle tip and a chunky grip', pal: 'gunmetal steel #aeb9cc body, dark #4c566b grip, neon green #39ff88 energy accents, dark #0c0f16 outline' },
  { id: 'weapon_spread', map: 'item_spread', subj: 'a spread-shot / triple-barrel scatter gun pickup icon, a fan of three short barrels splaying outward from a single receiver, aggressive and wide', pal: 'steel #aeb9cc barrels, dark #4c566b receiver, orange #ffb347 muzzle tips, dark #0c0f16 outline' },
  { id: 'weapon_cannon', map: 'item_cannon', subj: 'a heavy cannon pickup icon, one fat wide-bore barrel with a reinforced muzzle ring and a bulky breech block, clearly the hardest-hitting gun', pal: 'dark iron #4c566b body, steel #aeb9cc muzzle ring, neon green #39ff88 power band, dark #0c0f16 outline' },
  { id: 'weapon_mine', map: 'item_mine', subj: 'a naval spike-mine pickup icon, a round dark sphere studded with short trapezoid spikes around its rim and a small red status light in the center', pal: 'dark slate #4a5264 body, steel #7c89a0 spikes, dim red #7a2430 light, dark #0c0f16 outline' },
  { id: 'weapon_minigun', map: null, subj: 'a rotary minigun pickup icon, a cluster of six short rotating barrels on a round hub with a small ammo drum, fast and menacing', pal: 'gunmetal #aeb9cc barrels, dark #4c566b hub, yellow #ffe95d hot tips, dark outline #0c0f16' },
  { id: 'weapon_laser', map: null, subj: 'a laser rifle pickup icon, a sleek long-barrel energy rifle with a glowing focusing crystal near the muzzle and vent slots along the body', pal: 'white-steel #cdd6e3 body, cyan #4dfff0 glowing crystal and vents, dark #0c0f16 outline' },
  { id: 'weapon_rocket', map: null, subj: 'a rocket launcher pickup icon, a shoulder tube launcher with a single fat rocket tip poking out the front and rear exhaust vents', pal: 'olive-steel #8a9678 tube, red #ff5d5d rocket tip, dark #4c566b vents, dark #0c0f16 outline' },
  { id: 'weapon_shotgun', map: null, subj: 'a double-barrel shotgun pickup icon, a stubby side-by-side twin-barrel shotgun with a wooden-look grip, punchy at close range', pal: 'steel #aeb9cc barrels, warm brown #8a5a34 grip, orange #ffb347 muzzle, dark #0c0f16 outline' },
  { id: 'weapon_railgun', map: null, subj: 'a railgun pickup icon, a long slender high-tech rifle with two parallel glowing rails and a charged coil near the stock, precise and powerful', pal: 'white-steel #cdd6e3 body, electric blue #5db8ff glowing rails, dark #0c0f16 outline' },
  { id: 'weapon_flamethrower', map: null, subj: 'a flamethrower pickup icon, a chunky nozzle gun with a small fuel tank and a tiny pilot flame flickering at the nozzle tip', pal: 'red-steel #b34a4a body, orange #ff9f45 nozzle flame, dark #4c566b tank, dark #0c0f16 outline' },
  { id: 'weapon_plasma', map: null, subj: 'a plasma repeater pickup icon, a bulbous energy weapon with a glowing green plasma chamber and a wide emitter mouth', pal: 'steel #aeb9cc shell, neon green #39ff88 plasma glow, dark #4c566b grip, dark #0c0f16 outline' },
  { id: 'weapon_smg', map: null, subj: 'a compact SMG pickup icon, a small rapid-fire submachine gun with a short barrel and a curved magazine, run-and-gun weapon', pal: 'gunmetal #aeb9cc body, dark #4c566b magazine, green #39ff88 sight dot, dark #0c0f16 outline' },
  { id: 'weapon_sniper', map: null, subj: 'a sniper rifle pickup icon, a long precise rifle with a big round scope lens glinting and a bipod folded under the barrel', pal: 'dark steel #7c89a0 body, cyan #4dfff0 scope glint, dark #4c566b scope, dark #0c0f16 outline' },
  { id: 'weapon_grenade', map: null, subj: 'a throwable frag grenade pickup icon, a round segmented pineapple grenade with a top lever and pull ring, small and dangerous', pal: 'army green #5f7a3a body, steel #aeb9cc lever and ring, dark #0c0f16 outline' },
];
for (const w of weapons) specs.push({ id: w.id, category: 'weapon', maps_to: w.map, subject: w.subj, palette: w.pal });

// ---- POWER CRATE + POWER ICONS ----
specs.push({ id: 'power_crate', category: 'power', maps_to: 'item_crate',
  subject: 'a mystery power-up crate for a snake game, a chunky armored metal cube with beveled edges, corner rivets, and a glowing neon question mark on its front face, floating and enticing',
  palette: 'dark navy metal #1b2334 face, steel #2c3a55 bevels, rivets #66738c, neon green #39ff88 question mark, dark #0c0f16 outline' });
const powers = [
  { id: 'power_shield', subj: 'a shield power icon, a rounded bubble-shield emblem with a bright rim ring and a soft protective glow, reads as invulnerability', pal: 'cyan #4dfff0 ring, pale core #eafffd, dark teal #0e3d38 outline' },
  { id: 'power_overdrive', subj: 'an overdrive speed power icon, a bold forward chevron / lightning-speed arrow emblem suggesting a burst of free speed', pal: 'yellow #ffd23f arrow, white #fff6cf core, dark #4d3a08 outline' },
  { id: 'power_magnet', subj: 'a magnet power icon, a classic horseshoe magnet emblem with glowing pole tips that pull food toward the snake', pal: 'red #ff5d5d body, steel #cdd6e3 pole tips, blue #5db8ff pull sparks, dark #0c0f16 outline' },
  { id: 'power_ghost', subj: 'a ghost / phase power icon, a translucent friendly ghost emblem that lets the snake pass through bodies', pal: 'pale ghost white #e8f0ff body, faint blue #9ad4ff shading, dark #2a3550 outline' },
  { id: 'power_shrink', subj: 'a shrink-ray power icon, a small sci-fi ray emitter firing a shrinking violet beam with downward arrows, makes rivals smaller', pal: 'violet #c77dff beam, white #ffffff core spark, dark #3a1259 outline, steel #aeb9cc emitter' },
  { id: 'power_turret', subj: 'a tail-turret power icon, a small auto-cannon turret emblem on a round base that auto-fires at nearby enemies', pal: 'cyan #4dfff0 barrel glow, steel #aeb9cc turret, dark #0e3d38 outline' },
  { id: 'power_freeze', subj: 'a freeze power icon, a crisp ice snowflake / frost emblem that slows enemies caught in it', pal: 'ice blue #9ad4ff crystal, white #eafaff core, deep blue #16466b outline' },
  { id: 'power_double', subj: 'a double-damage power icon, a bold stylized x2 damage sword or fang emblem radiating power (no text numerals, use a doubled-fang motif)', pal: 'red-orange #ff7a3a fangs, yellow #ffd23f glow, dark #4a1a08 outline' },
  { id: 'power_heal', subj: 'a heal power icon, a plump glowing heart emblem with a soft pulse that restores length', pal: 'bright green #39ff88 heart, pale core #c9ffe0, dark #0f3d26 outline' },
  { id: 'power_giant', subj: 'a giant power icon, an upward double-arrow growth emblem with a big bold snake-head silhouette, makes the snake huge', pal: 'orange #ff9f45 arrows, gold #ffd23f glow, dark #4a2408 outline' },
  { id: 'power_lightning', subj: 'a chain-lightning power icon, a forked electric bolt emblem crackling with energy, zaps nearby rivals', pal: 'electric yellow #ffe95d bolt, white #ffffff hot core, blue #5db8ff arc, dark #0c0f16 outline' },
  { id: 'power_cloak', subj: 'a cloak / invisibility power icon, a hooded cloak emblem fading into transparency, hides the snake from the minimap', pal: 'slate blue #4a5a7a cloak, faint #9ad4ff sheen, dark #1a2440 outline' },
  { id: 'power_drill', subj: 'a drill-dash power icon, a spinning conical drill-bit emblem pointing forward, a piercing dash attack', pal: 'steel #aeb9cc drill, orange #ff9f45 tip glow, dark #4c566b outline' },
];
for (const p of powers) specs.push({ id: p.id, category: 'power', maps_to: p.id === 'power_shield' ? null : null, subject: p.subj, palette: p.pal });

// ---- PROJECTILES ----
const projs = [
  { id: 'proj_blaster', map: 'proj_blaster', subj: 'a small energy bolt projectile facing RIGHT, a short glowing bullet of light with a hot bright tip and a faint tail', pal: 'yellow #ffe95d bolt, white-hot #fffbe0 tip, dark #4a3d07 rim' },
  { id: 'proj_spread', map: 'proj_spread', subj: 'a small round scatter pellet projectile, a compact glowing ball of shot', pal: 'orange #ff9f45 ball, pale core #ffe4c4, dark #4a2408 rim' },
  { id: 'proj_cannon', map: 'proj_cannon', subj: 'a heavy iron cannonball projectile, a chunky dark metal sphere with a metallic highlight, clearly weighty', pal: 'iron grey #5b6478 ball, steel highlight #9aa5b8, dark #0e1118 rim' },
  { id: 'proj_shrink', map: 'proj_shrink', subj: 'a violet shrink-ray energy orb projectile facing RIGHT, a glowing purple plasma ball crackling with tiny sparks', pal: 'violet #c77dff orb, white #ffffff core, pink #e9c8ff sparks, dark #3a1259 rim' },
  { id: 'proj_turret', map: 'proj_turret', subj: 'a small cyan turret bolt projectile facing RIGHT, a thin glowing teal energy dart with a bright tip', pal: 'cyan #4dfff0 bolt, pale #eafffd tip, dark #0e3d38 rim' },
  { id: 'proj_rocket', map: null, subj: 'a small rocket projectile facing RIGHT, a pointed missile with fins and a bright exhaust flame at the back', pal: 'red #ff5d5d body, steel #aeb9cc nose, orange #ff9f45 exhaust, dark #0c0f16 outline' },
  { id: 'proj_laser', map: null, subj: 'a short horizontal laser beam segment facing RIGHT, a bright cyan energy line with a glowing core, tileable end to end', pal: 'cyan #4dfff0 beam, white #eafffd core, dark #0e3d38 rim' },
  { id: 'proj_fireball', map: null, subj: 'a small fireball projectile, a round ball of orange flame with a lighter hot center and a wispy tail', pal: 'orange #ff9f45 flame, yellow #ffe95d core, dark #4a2408 rim' },
];
for (const p of projs) specs.push({ id: p.id, category: 'projectile', maps_to: p.map, subject: p.subj, palette: p.pal });
specs.push({ id: 'mine_armed', category: 'projectile', maps_to: 'mine_armed',
  subject: 'an ARMED spike mine sitting on the ground, a round dark sphere studded with short spikes around its rim and a hot glowing RED status light pulsing in the center, clearly dangerous and live',
  palette: 'dark slate #4a5264 body, steel #7c89a0 spikes, hot red #ff3b3b light with #ffd0d0 glint, dark #0c0f16 outline' });

// ---- VFX (single frames) ----
const vfx = [
  { id: 'fx_shield', map: 'fx_shield', subj: 'a hexagonal energy shield bubble ring, a glowing translucent protective ring with bright cardinal glints at top, bottom, left and right, hollow in the center so it wraps a snake head', pal: 'cyan #4dfff0 ring, bright #eafffd glints, transparent center' },
  { id: 'fx_muzzle_flash', map: null, subj: 'a muzzle flash burst facing RIGHT, a short spiky star-shaped flash of white-yellow fire, the instant a gun fires', pal: 'white #ffffff core, yellow #ffe95d flare, orange #ff9f45 edges' },
  { id: 'fx_explosion_small', map: null, subj: 'a small explosion puff, a compact round burst of orange fire and smoke with a few spark bits flying out', pal: 'orange #ff9f45 fire, yellow #ffe95d core, dark grey #3a3f4a smoke' },
  { id: 'fx_explosion_big', map: null, subj: 'a big dramatic explosion, a large round fireball with a bright white core, billowing smoke, and many spark shards blasting outward', pal: 'white #ffffff core, orange #ff7a3a fire, red #ff3b3b edges, dark #2a2f38 smoke' },
  { id: 'fx_hit_spark', map: null, subj: 'a bullet hit spark, a tiny four-point white-hot spark burst where a shot lands', pal: 'white #ffffff core, pale yellow #ffe4c4 rays' },
  { id: 'fx_boost_flame', map: null, subj: 'a boost afterburner flame facing LEFT (trails behind a moving snake), a tapered teardrop of blue-white flame', pal: 'white #ffffff core, cyan #4dfff0 flame, blue #5db8ff edge' },
  { id: 'fx_death_burst', map: null, subj: 'a death explosion of food, a round burst of scattering glowing food orbs and a soft shockwave ring, what a snake becomes when it dies', pal: 'green #6bffab and gold #ffd23f orbs, white #ffffff ring' },
  { id: 'fx_poison_cloud', map: null, subj: 'a poison gas cloud, a soft round puff of translucent green vapor with a few bubbles', pal: 'toxic green #7bff8a vapor, pale #d0ffcf highlights, dark #1f4a26 core' },
  { id: 'fx_electric_zap', map: null, subj: 'an electric zap burst, a jagged star of forked white-blue lightning arcs radiating from a center point', pal: 'white #ffffff core, electric blue #5db8ff arcs, yellow #ffe95d tips' },
  { id: 'fx_shockwave_ring', map: null, subj: 'a shockwave ring, a single thin expanding circular blast ring, brightest on its leading edge', pal: 'white #ffffff ring, cyan #4dfff0 inner glow' },
  { id: 'fx_pickup_sparkle', map: null, subj: 'a pickup sparkle burst, a small cheerful ring of green stars and sparkles, plays when you grab an item', pal: 'neon green #39ff88 stars, white #ffffff sparkles' },
  { id: 'fx_speed_streak', map: null, subj: 'a set of three short horizontal speed streaks facing LEFT, thin tapered motion lines that trail a boosting snake', pal: 'white #ffffff to cyan #4dfff0 streaks' },
];
for (const f of vfx) specs.push({ id: f.id, category: 'vfx', maps_to: f.map, subject: f.subj, palette: f.pal });

// ---- ENVIRONMENT ----
specs.push({ id: 'bg_tile', category: 'environment', maps_to: 'bg_tile', view: 'flat top-down, seamlessly tileable',
  subject: 'a seamlessly tileable dark arena floor tile for a top-down snake game, a near-black panel with a faint thin grid line along the top and left edges and a tiny dim stud in the center, subtle and non-distracting so sprites pop on top',
  palette: 'near-black #0b0e14 base, faint grid line #141a28, dim stud #10141d', bg: 'none' });
const env = [
  { id: 'env_bg_tile_variant', subj: 'a seamlessly tileable dark arena floor tile, a slightly different variant of the base tile with a faint diagonal circuit trace, still very subtle and dark', pal: 'near-black #0a0d13 base, faint #16203a trace' },
  { id: 'env_nebula_patch', subj: 'a seamlessly tileable deep-space nebula background patch, soft dark clouds of blue and teal with a few tiny star dots, very dark and low contrast', pal: 'dark navy #0a1020, teal cloud #163a44, star dots #ffffff' },
  { id: 'env_border_wall', subj: 'a danger border wall segment for the arena edge, a chunky hazard-striped barrier with a red warning glow, tileable horizontally', pal: 'dark steel #2a3040 wall, red #ff3b5c hazard stripes, glow #ff6b7f' },
  { id: 'env_rock_1', subj: 'a top-down asteroid rock obstacle, a lumpy dark grey boulder with a few lighter facets and craters, blocks movement', pal: 'grey #4a5060 rock, light facet #6a7180, dark #23272f outline' },
  { id: 'env_rock_2', subj: 'a top-down cluster of three small asteroid rocks grouped together, dark grey with facets', pal: 'grey #4a5060 rocks, light #6a7180 facets, dark #23272f outline' },
  { id: 'env_rock_3', subj: 'a top-down jagged crystal rock formation, dark base with glowing teal crystal shards poking up', pal: 'dark grey #3a4050 base, teal #4dfff0 crystals, dark #1a1f28 outline' },
  { id: 'env_mushroom', subj: 'a top-down glowing decorative mushroom cluster, a few small round caps with a soft bioluminescent glow, pure decoration', pal: 'violet #c77dff caps, pale #e0b3ff glow, dark #3a1259 stems' },
  { id: 'env_pylon', subj: 'a top-down energy pylon decoration, a small hexagonal tech base with a glowing green energy column, pure decoration', pal: 'steel #4c566b base, neon green #39ff88 column, dark #0c0f16 outline' },
  { id: 'env_crater', subj: 'a top-down shallow crater decal on the floor, a dark ring depression with a slightly lighter rim, flat decal', pal: 'dark #0a0d13 pit, dim rim #1a2030' },
];
for (const e of env) specs.push({ id: e.id, category: 'environment', maps_to: null, view: 'flat top-down', subject: e.subj, palette: e.pal });

// ---- UI / MARKETING (white background, cutout) ----
const ui = [
  { id: 'ui_logo_lockup', subj: 'the game logo lockup wordmark for "FANGS.io" — a bold rounded heavy sans-serif wordmark where FANGS is in near-black and the ".io" is in neon green, with a small cute green snake mascot coiling around the F, chunky and playful, arcade energy (spell it exactly FANGS.io)', pal: 'near-black #0b0e14 letters, neon green #39ff88 .io and snake, white bg', view: 'flat front view' },
  { id: 'ui_snake_mascot', subj: 'a cute chunky green cartoon snake mascot character coiled into a friendly S-curve, big round eyes, tiny fangs, a little forked tongue, mascot pose for the site and favicon, three-quarter friendly view', pal: 'neon green #39ff88 body, highlight #8dffbd, shadow #1fa657, white eyes, dark #0b0d12 outline', view: 'three-quarter view' },
  { id: 'ui_btn_start', subj: 'a big juicy green START game button, a rounded-rectangle glossy button with a soft top highlight and a subtle bottom bevel, empty face ready for a text label to be added later, inviting and clickable', pal: 'neon green #39ff88 to #12b981 gradient face, dark green #0e9d6e bevel, white top gloss', view: 'flat front view' },
  { id: 'ui_btn_play_round', subj: 'a round green play button with a bold triangular play arrow in the center, glossy and chunky, for mobile', pal: 'neon green #39ff88 button, white #ffffff play arrow, dark #0e9d6e edge', view: 'flat front view' },
  { id: 'ui_crown', subj: 'a small chunky golden crown icon for the leaderboard number-one spot, three points with round jewel tips', pal: 'gold #ffd23f crown, highlight #ffe786, jewels #ff5d5d, dark #b8892a outline', view: 'flat front view' },
  { id: 'ui_skull', subj: 'a small cute cartoon skull icon for the kill feed, rounded friendly skull with dark eye sockets', pal: 'off-white #eef2f7 skull, dark #2a3550 sockets and outline', view: 'flat front view' },
  { id: 'ui_heart', subj: 'a plump glossy green heart icon for health/length, with a bright top highlight', pal: 'neon green #39ff88 heart, highlight #c9ffe0, dark #0f3d26 outline', view: 'flat front view' },
  { id: 'ui_coin', subj: 'a shiny round score coin icon with a fang emboss on its face, gold and glossy', pal: 'gold #ffd23f coin, highlight #ffe786, dark #b8892a rim', view: 'flat front view' },
  { id: 'ui_joystick', subj: 'a mobile virtual joystick control, a translucent ring base with a round knob in the center, clean and modern', pal: 'dark translucent #1a2333 ring, neon green #39ff88 knob, white rim', view: 'flat front view' },
  { id: 'ui_btn_boost', subj: 'a round mobile BOOST button, a glowing circular button with a bold upward speed chevron in the center, empty of text', pal: 'dark #10141d base, neon green #39ff88 chevron and rim glow', view: 'flat front view' },
  { id: 'ui_btn_fire', subj: 'a round mobile FIRE button, a circular red button with a bold target/reticle motif in the center', pal: 'red #ff5d5d button, white #ffffff reticle, dark #b3383a edge', view: 'flat front view' },
  { id: 'ui_gear', subj: 'a clean settings gear icon, a chunky cog wheel with a round center hole', pal: 'steel grey #aeb9cc gear, dark #4c566b hole and outline', view: 'flat front view' },
  { id: 'ui_sound_on', subj: 'a sound-on speaker icon with two curved sound waves', pal: 'near-black #0b0e14 speaker, neon green #39ff88 waves', view: 'flat front view' },
  { id: 'ui_sound_off', subj: 'a sound-off muted speaker icon with a small x mark beside it', pal: 'near-black #0b0e14 speaker, red #ff5d5d x mark', view: 'flat front view' },
  { id: 'ui_crosshair', subj: 'a clean aiming crosshair / cursor reticle, four short ticks around a center dot, minimal', pal: 'neon green #39ff88 reticle, white #ffffff center dot', view: 'flat front view' },
  { id: 'ui_dmg_arrow', subj: 'a bold red damage-direction arrow, a fat triangular chevron pointing toward the threat, used to show where you got hit from', pal: 'red #ff3b5c arrow, darker #b3283f edge', view: 'flat front view' },
  { id: 'ui_kill_ribbon', subj: 'an elimination banner ribbon shape (no text), a sleek angled banner plate that a "ELIMINATED" label will sit on, dark with a neon green top edge', pal: 'dark navy #10182a plate, neon green #39ff88 top edge glow', view: 'flat front view' },
  { id: 'ui_trophy', subj: 'a small gold trophy cup icon for wins, a classic two-handled cup on a base', pal: 'gold #ffd23f cup, highlight #ffe786, dark #b8892a base', view: 'flat front view' },
  { id: 'ui_minimap_frame', subj: 'a square HUD minimap frame, a rounded dark glass panel border with a thin neon green corner accent, hollow center for the map', pal: 'dark glass #0b0e14 border, neon green #39ff88 corner ticks', view: 'flat front view' },
  { id: 'ui_panel', subj: 'a generic HUD stat panel plate, a small rounded dark glass rectangle with a thin steel border, empty for stats', pal: 'dark glass #0e1320 fill, steel #223052 border', view: 'flat front view' },
];
for (const u of ui) specs.push({ id: u.id, category: 'ui', maps_to: null, subject: u.subj, palette: u.pal, lighting: 'clean flat game-UI shading with a soft top highlight and thick dark outline', bg: 'white', view: u.view });

// ---- BUILD ----
const pack = {
  _pack: 'Fangs.io sprite prompt pack',
  _generated_by: 'tools/build-prompts.mjs',
  _how_to_use: 'These are INDIVIDUAL prompts — paste each `prompt` into ChatGPT / GPT-Image (it can do ~10 at once). Generate on the green (or white for UI) background. Then run tools/key-and-slice.sh <image> <name> to key the green to transparency, trim, resize, and register it in assets/manifest.json. Any sprite whose `maps_to` is set will instantly replace the built-in procedural sprite in the game once its PNG is in assets/. `maps_to: null` items are expansion weapons/powers/decor and marketing/UI art.',
  _style_guide: STYLE,
  _background_key: 'green #00FF00 for game sprites, white #FFFFFF for UI/marketing',
  _negative_prompt: NEG,
  _count: specs.length,
  sprites: specs.map(obj),
};

const outRepo = join(dirname(fileURLToPath(import.meta.url)), 'sprite-prompts.json');
writeFileSync(outRepo, JSON.stringify(pack, null, 2));
const outDl = join(homedir(), 'Downloads', 'fangs-io-sprite-prompts.json');
writeFileSync(outDl, JSON.stringify(pack, null, 2));
console.log(`Wrote ${specs.length} sprite prompts to:\n  ${outRepo}\n  ${outDl}`);
// category tally
const tally = {};
for (const s of specs) tally[s.category] = (tally[s.category] || 0) + 1;
console.log('By category:', JSON.stringify(tally));
const dropIns = specs.filter((s) => s.maps_to).length;
console.log(`Drop-in (replace game sprite): ${dropIns}, expansion/marketing: ${specs.length - dropIns}`);
