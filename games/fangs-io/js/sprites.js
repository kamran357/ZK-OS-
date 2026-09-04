// Fangs.io — procedural crisp pixel-art sprites drawn on offscreen canvases.
// Every sprite is designed on a small logical pixel grid and rendered at 3x
// integer scale with a 1px dark-outline aesthetic and an arcade palette.
// PNG overrides: fetch ./assets/manifest.json; any matching name replaces the
// procedural canvas. Any failure falls back to procedural. Never a broken image.
import { SKINS } from '../shared/constants.js';

const SCALE = 3;
const INK = '#0c0f16';
const STEEL = '#aeb9cc';
const STEEL_D = '#7c89a0';
const STEEL_XD = '#4c566b';
const ACCENT = '#39ff88';

function hexToRgb(hex) {
  if (typeof hex !== 'string') return [255, 0, 255];
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return [255, 0, 255];
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return [255, 0, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex);
  const t = f > 0 ? 255 : 0;
  const k = Math.min(1, Math.abs(Number(f) || 0));
  return rgbToHex(r + (t - r) * k, g + (t - g) * k, b + (t - b) * k);
}

function paintGrid(size, painter) {
  const c = document.createElement('canvas');
  c.width = c.height = size * SCALE;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const px = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    ctx.fillStyle = color;
    ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
  };
  const rect = (x, y, w, h, color) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(xx, yy, color);
  };
  painter(px, rect);
  return c;
}
function paintMask(px, size, inside, colorFor) {
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
      px(x, y, colorFor(x, y, edge));
    }
}

function drawHead(skin) {
  const outline = shade(skin, -0.7), belly = shade(skin, -0.32), hi = shade(skin, 0.45);
  return paintGrid(12, (px) => {
    const inside = (x, y) => Math.abs(x - 5.5) + Math.abs(y - 5.5) <= 6.1;
    paintMask(px, 12, inside, (x, y, edge) => {
      if (edge) return outline;
      if (x >= 2 && x <= 4 && y >= 2 && y <= 3) return hi;
      if (y >= 8) return belly;
      return skin;
    });
    for (const ey of [2, 7]) { px(7, ey, '#0b0d12'); px(7, ey + 1, '#0b0d12'); px(7, ey + 2, '#0b0d12'); }
    px(11, 5, '#ff5d7a'); px(11, 6, '#ff2d55');
  });
}
function drawSeg(skin) {
  const outline = shade(skin, -0.7), belly = shade(skin, -0.3), hi = shade(skin, 0.5);
  return paintGrid(12, (px) => {
    const inside = (x, y) => { const dx = x - 5.5, dy = y - 5.5; return dx * dx + dy * dy <= 32.5; };
    paintMask(px, 12, inside, (x, y, edge) => (edge ? outline : y >= 8 ? belly : skin));
    px(3, 3, hi); px(4, 3, hi); px(3, 4, hi);
  });
}

const FOOD_CFG = {
  1: { r: 2.3, base: '#6bffab', core: '#dfffee', out: '#0f3d26' },
  2: { r: 3.0, base: '#ffd23f', core: '#fff3bf', out: '#4d3a08' },
  3: { r: 3.8, base: '#ff9f45', core: '#ffd9a8', out: '#4a2408' },
};
function drawFood(tier) {
  const cfg = FOOD_CFG[tier] || FOOD_CFG[1];
  return paintGrid(8, (px) => {
    const rr = cfg.r * cfg.r + 0.4;
    const inside = (x, y) => { const dx = x - 3.5, dy = y - 3.5; return dx * dx + dy * dy <= rr; };
    paintMask(px, 8, inside, (x, y, edge) => (edge ? cfg.out : cfg.base));
    px(3, 3, cfg.core);
    if (tier >= 2) px(4, 3, cfg.core);
    if (tier >= 3) px(3, 4, cfg.core);
  });
}

function drawBlaster() {
  return paintGrid(14, (px, rect) => {
    rect(3, 3, 11, 4, INK); rect(4, 4, 9, 2, STEEL); px(12, 4, '#e6ecf5');
    rect(2, 6, 5, 7, INK); rect(3, 7, 3, 5, STEEL_D);
    px(4, 2, ACCENT); px(11, 2, ACCENT); px(7, 7, INK); px(7, 8, INK);
  });
}
function drawSpread() {
  return paintGrid(14, (px, rect) => {
    rect(4, 1, 9, 3, INK); rect(5, 2, 7, 1, STEEL);
    rect(3, 5, 11, 3, INK); rect(4, 6, 9, 1, STEEL);
    rect(4, 9, 9, 3, INK); rect(5, 10, 7, 1, STEEL);
    rect(1, 3, 4, 7, INK); rect(2, 4, 2, 5, STEEL_D);
    px(12, 2, '#ffb347'); px(13, 6, '#ffb347'); px(12, 10, '#ffb347');
  });
}
function drawCannon() {
  return paintGrid(14, (px, rect) => {
    rect(3, 4, 10, 6, INK); rect(4, 5, 8, 4, STEEL_XD);
    rect(10, 4, 3, 6, INK); rect(11, 5, 1, 4, STEEL);
    rect(1, 3, 4, 8, INK); rect(2, 4, 2, 6, STEEL_D);
    px(6, 5, '#9aa5b8'); px(7, 5, '#9aa5b8'); px(5, 7, ACCENT); px(5, 8, ACCENT);
  });
}
function drawMine(armed) {
  return paintGrid(14, (px, rect) => {
    const spike = STEEL_D;
    rect(6, 1, 2, 2, spike); rect(6, 11, 2, 2, spike); rect(1, 6, 2, 2, spike); rect(11, 6, 2, 2, spike);
    px(2, 2, spike); px(3, 3, spike); px(11, 2, spike); px(10, 3, spike);
    px(2, 11, spike); px(3, 10, spike); px(11, 11, spike); px(10, 10, spike);
    const inside = (x, y) => { const dx = x - 6.5, dy = y - 6.5; return dx * dx + dy * dy <= 12.5; };
    paintMask(px, 14, inside, (x, y, edge) => (edge ? INK : '#4a5264'));
    px(5, 5, '#6d7891');
    px(6, 6, armed ? '#ff3b3b' : '#7a2430'); px(7, 6, armed ? '#ff3b3b' : '#7a2430');
    px(6, 7, armed ? '#ff6b6b' : '#5a1c26'); px(7, 7, armed ? '#ff6b6b' : '#5a1c26');
    if (armed) px(6, 5, '#ffd0d0');
  });
}
function drawCrate() {
  return paintGrid(14, (px, rect) => {
    rect(1, 1, 12, 12, INK); rect(2, 2, 10, 10, '#1b2334');
    rect(2, 2, 10, 1, '#2c3a55'); rect(2, 3, 1, 8, '#2c3a55'); rect(3, 11, 9, 1, '#12161f');
    px(2, 2, '#66738c'); px(11, 2, '#66738c'); px(2, 11, '#66738c'); px(11, 11, '#66738c');
    const q = [[6, 3], [7, 3], [5, 4], [8, 4], [8, 5], [7, 6], [7, 7]];
    for (let i = 0; i < q.length; i++) px(q[i][0], q[i][1], ACCENT);
    px(7, 9, '#b6ffd6');
  });
}
function drawShield() {
  return paintGrid(16, (px) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5, d = Math.sqrt(dx * dx + dy * dy);
      if (d >= 5.6 && d <= 7.1) px(x, y, '#4dfff0');
    }
    for (const [x, y] of [[7, 1], [8, 1], [7, 14], [8, 14], [1, 7], [1, 8], [14, 7], [14, 8]]) px(x, y, '#eafffd');
  });
}
function drawProjBlaster() {
  return paintGrid(8, (px, rect) => { rect(0, 2, 8, 4, '#4a3d07'); rect(1, 3, 6, 2, '#ffe95d'); rect(5, 3, 2, 2, '#fffbe0'); });
}
function drawProjSpread() {
  return paintGrid(8, (px) => {
    const inside = (x, y) => { const dx = x - 3.5, dy = y - 3.5; return dx * dx + dy * dy <= 5.7; };
    paintMask(px, 8, inside, (x, y, edge) => (edge ? '#4a2408' : '#ff9f45')); px(3, 3, '#ffe4c4');
  });
}
function drawProjCannon() {
  return paintGrid(8, (px) => {
    const inside = (x, y) => { const dx = x - 3.5, dy = y - 3.5; return dx * dx + dy * dy <= 12.0; };
    paintMask(px, 8, inside, (x, y, edge) => (edge ? '#0e1118' : '#5b6478')); px(2, 2, '#9aa5b8'); px(3, 2, '#9aa5b8');
  });
}
function drawProjShrink() {
  return paintGrid(8, (px) => {
    const inside = (x, y) => { const dx = x - 3.5, dy = y - 3.5; return dx * dx + dy * dy <= 10.6; };
    paintMask(px, 8, inside, (x, y, edge) => (edge ? '#3a1259' : '#c77dff'));
    px(3, 3, '#ffffff'); px(4, 3, '#ffffff');
    px(0, 3, '#e9c8ff'); px(7, 4, '#e9c8ff'); px(3, 0, '#e9c8ff'); px(4, 7, '#e9c8ff');
  });
}
function drawProjTurret() {
  return paintGrid(8, (px, rect) => { rect(1, 2, 6, 4, '#0e3d38'); rect(2, 3, 4, 2, '#4dfff0'); px(5, 3, '#eafffd'); px(5, 4, '#eafffd'); });
}
function drawBgTile() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#141a28'; ctx.fillRect(0, 0, 64, 1); ctx.fillRect(0, 0, 1, 64);
  ctx.fillStyle = '#10141d'; ctx.fillRect(32, 32, 1, 1);
  return c;
}

async function applyManifestOverrides(map) {
  let manifest = null;
  try {
    const res = await fetch('./assets/manifest.json', { cache: 'no-cache' });
    if (!res || !res.ok) return;
    manifest = await res.json();
  } catch (_) { return; }
  let entries;
  if (Array.isArray(manifest)) entries = manifest.map((n) => [n, null]);
  else if (manifest && typeof manifest === 'object') entries = Object.entries(manifest);
  else return;
  await Promise.all(entries.map(async ([name, file]) => {
    if (typeof name !== 'string' || !name) return;
    let src = typeof file === 'string' && file ? file : name + '.png';
    if (!src.startsWith('/') && !/^https?:/i.test(src) && !src.startsWith('./')) src = './assets/' + src;
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      await img.decode();
      const w = img.naturalWidth | 0, h = img.naturalHeight | 0;
      if (w < 1 || h < 1) return;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cctx = c.getContext('2d');
      cctx.imageSmoothingEnabled = false;
      cctx.drawImage(img, 0, 0);
      map.set(name, c);
    } catch (_) { /* keep procedural */ }
  }));
}

class Sprites {
  constructor(map) {
    this._map = map;
    const f = document.createElement('canvas');
    f.width = f.height = SCALE;
    this._fallback = f;
  }
  get(name) { return this._map.get(name) || this._fallback; }
  has(name) { return this._map.has(name); }
}

export async function loadSprites() {
  const map = new Map();
  const skins = Array.isArray(SKINS) && SKINS.length ? SKINS : ['#39ff88'];
  for (let i = 0; i < skins.length; i++) {
    map.set('head_' + i, drawHead(skins[i]));
    map.set('seg_' + i, drawSeg(skins[i]));
  }
  map.set('food_1', drawFood(1)); map.set('food_2', drawFood(2)); map.set('food_3', drawFood(3));
  map.set('item_blaster', drawBlaster()); map.set('item_spread', drawSpread());
  map.set('item_cannon', drawCannon()); map.set('item_mine', drawMine(false));
  map.set('item_crate', drawCrate()); map.set('mine_armed', drawMine(true));
  map.set('proj_blaster', drawProjBlaster()); map.set('proj_spread', drawProjSpread());
  map.set('proj_cannon', drawProjCannon()); map.set('proj_shrink', drawProjShrink());
  map.set('proj_turret', drawProjTurret());
  map.set('fx_shield', drawShield()); map.set('bg_tile', drawBgTile());
  await applyManifestOverrides(map);
  return new Sprites(map);
}
