// Fangs.io — renderer. World-space draw with camera, fog of vision, screen shake.
import { WORLD, SNAKE, AOI_RADIUS, SKINS } from '../shared/constants.js';
import { clamp, lerp } from './util.js';

function shade(hex, f) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = f > 0 ? 255 : 0, k = Math.min(1, Math.abs(f));
  r = Math.round(r + (t - r) * k); g = Math.round(g + (t - g) * k); b = Math.round(b + (t - b) * k);
  return `rgb(${r},${g},${b})`;
}

export class Renderer {
  constructor(canvas, sprites) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sprites = sprites;
    this.cam = { x: WORLD.W / 2, y: WORLD.H / 2 };
    this.zoom = 1;
    this.shakeMag = 0;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this._skinOutline = SKINS.map((c) => shade(c, -0.55));
    this._skinGloss = SKINS.map((c) => shade(c, 0.4));
    this.resize();
  }

  resize() {
    const dpr = this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
  }

  render(world, dt) {
    const ctx = this.ctx;
    const W = window.innerWidth, H = window.innerHeight;
    const dpr = this.dpr;
    const now = world.now;

    // camera follow
    const target = world.player && world.player.alive ? world.player.head()
      : world.player ? world.player.head() : this.cam;
    const followK = 1 - Math.pow(0.0025, dt);
    this.cam.x = lerp(this.cam.x, target.x, followK);
    this.cam.y = lerp(this.cam.y, target.y, followK);
    // gentle zoom out as you grow
    const len = world.player ? world.player.lenSegs() : SNAKE.START_SEGS;
    const targetZoom = clamp(1.02 - (len - SNAKE.START_SEGS) / 2600, 0.72, 1.02);
    this.zoom = lerp(this.zoom, targetZoom, 0.02);

    // shake
    this.shakeMag = Math.max(this.shakeMag * 0.86, world.shakeReq);
    world.shakeReq = 0;
    const sx = (Math.random() * 2 - 1) * this.shakeMag;
    const sy = (Math.random() * 2 - 1) * this.shakeMag;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#080a10';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2 + sx, H / 2 + sy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);

    // visible world bounds
    const halfW = W / 2 / this.zoom, halfH = H / 2 / this.zoom;
    const vx0 = this.cam.x - halfW - 60, vx1 = this.cam.x + halfW + 60;
    const vy0 = this.cam.y - halfH - 60, vy1 = this.cam.y + halfH + 60;
    const inView = (x, y, pad = 40) => x > vx0 - pad && x < vx1 + pad && y > vy0 - pad && y < vy1 + pad;

    this._drawBg(ctx, vx0, vy0, vx1, vy1);
    this._drawBorder(ctx);
    this._drawFood(ctx, world, inView);
    this._drawItems(ctx, world, inView, now);
    this._drawProjectiles(ctx, world, inView);
    for (const s of world.snakes.values()) if (s.alive) this._drawSnake(ctx, s, vx0, vy0, vx1, vy1, now);
    this._drawParticles(ctx, world);

    ctx.restore();

    // fog of vision (screen space)
    this._drawFog(ctx, W, H);
  }

  _drawBg(ctx, vx0, vy0, vx1, vy1) {
    const tile = this.sprites.get('bg_tile');
    const T = 64;
    const startX = Math.floor(vx0 / T) * T, startY = Math.floor(vy0 / T) * T;
    for (let x = startX; x < vx1; x += T)
      for (let y = startY; y < vy1; y += T) ctx.drawImage(tile, x, y, T, T);
  }

  _drawBorder(ctx) {
    ctx.save();
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#ff3b5c';
    ctx.setLineDash([26, 18]);
    ctx.strokeRect(0, 0, WORLD.W, WORLD.H);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,59,92,0.25)';
    ctx.lineWidth = 40;
    ctx.strokeRect(0, 0, WORLD.W, WORLD.H);
    ctx.restore();
  }

  _drawFood(ctx, world, inView) {
    const t = world.now / 1000;
    for (const f of world.food.values()) {
      if (!inView(f.x, f.y, 20)) continue;
      const spr = this.sprites.get('food_' + (f.v >= 2 ? 2 : 1));
      const sz = (f.v >= 2 ? 12 : 9) + Math.sin(t * 4 + f.id) * 1.2;
      ctx.drawImage(spr, f.x - sz / 2, f.y - sz / 2, sz, sz);
    }
  }

  _drawItems(ctx, world, inView, now) {
    const t = now / 1000;
    for (const it of world.items.values()) {
      if (!inView(it.x, it.y, 40)) continue;
      const bob = Math.sin(t * 3 + it.id) * 3;
      const spr = this.sprites.get('item_' + it.kind);
      const sz = 30;
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = it.kind === 'crate' ? '#39ff88' : '#ffd23f';
      ctx.beginPath();
      ctx.arc(it.x, it.y + bob, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.drawImage(spr, it.x - sz / 2, it.y - sz / 2 + bob, sz, sz);
      ctx.restore();
    }
  }

  _drawProjectiles(ctx, world, inView) {
    for (const p of world.projectiles.values()) {
      if (!inView(p.x, p.y, 20)) continue;
      if (p.kind === 'mine') {
        const spr = this.sprites.get(p.armed ? 'mine_armed' : 'item_mine');
        ctx.drawImage(spr, p.x - 12, p.y - 12, 24, 24);
        continue;
      }
      const spr = this.sprites.get('proj_' + p.kind);
      const sz = p.kind === 'cannon' ? 18 : p.kind === 'shrink' ? 20 : 14;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.drawImage(spr, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }
  }

  _drawSnake(ctx, s, vx0, vy0, vx1, vy1, now) {
    const segs = s.segments();
    if (segs.length === 0) return;
    // bbox cull
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of segs) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y; }
    if (maxx < vx0 || minx > vx1 || maxy < vy0 || miny > vy1) return;

    const r = s.radius();
    const skin = SKINS[s.skin];
    const outline = this._skinOutline[s.skin];
    const gloss = this._skinGloss[s.skin];
    const ghost = s.power && s.power.key === 'ghost';
    const boosting = s.boostOn;

    ctx.save();
    if (ghost) ctx.globalAlpha = 0.4;

    // build path (tail -> head for nicer joins)
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(segs[segs.length - 1].x, segs[segs.length - 1].y);
      for (let i = segs.length - 2; i >= 0; i--) ctx.lineTo(segs[i].x, segs[i].y);
    };
    // boost glow
    if (boosting) {
      trace(); ctx.strokeStyle = skin; ctx.globalAlpha = (ghost ? 0.2 : 0.28);
      ctx.lineWidth = r * 2 + 12; ctx.stroke(); ctx.globalAlpha = ghost ? 0.4 : 1;
    }
    // outline
    trace(); ctx.strokeStyle = outline; ctx.lineWidth = r * 2 + 4; ctx.stroke();
    // base
    trace(); ctx.strokeStyle = skin; ctx.lineWidth = r * 2; ctx.stroke();
    // gloss center line
    trace(); ctx.strokeStyle = gloss; ctx.globalAlpha *= 0.5; ctx.lineWidth = Math.max(2, r * 0.5); ctx.stroke();
    ctx.globalAlpha = ghost ? 0.4 : 1;

    // shield ring
    if (s.shieldHits > 0) {
      const pulse = 1 + Math.sin(now / 120) * 0.06;
      const spr = this.sprites.get('fx_shield');
      const sz = (r * 2 + 22) * pulse;
      const h = segs[0];
      ctx.drawImage(spr, h.x - sz / 2, h.y - sz / 2, sz, sz);
    }

    // head sprite
    const h = segs[0];
    const hd = this.sprites.get('head_' + s.skin);
    const hsz = r * 2.5;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(s.angle);
    ctx.drawImage(hd, -hsz / 2, -hsz / 2, hsz, hsz);
    ctx.restore();
    ctx.restore();

    // nameplate + length (small, above head) — rule: small nameplates
    ctx.save();
    ctx.globalAlpha = ghost ? 0.6 : 0.92;
    ctx.font = '600 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = s.id === (window.__fangsPlayerId || -1) ? '#39ff88' : '#dfe7f5';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 3;
    const label = s.name;
    ctx.strokeText(label, h.x, h.y - r - 10);
    ctx.fillText(label, h.x, h.y - r - 10);
    ctx.restore();
  }

  _drawParticles(ctx, world) {
    for (const p of world.particles) {
      const a = clamp(1 - p.age / p.life, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;
  }

  _drawFog(ctx, W, H) {
    const cx = W / 2, cy = H / 2;
    const r1 = AOI_RADIUS * this.zoom;
    const inner = r1 * 0.5;
    const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, r1);
    g.addColorStop(0, 'rgba(6,8,14,0)');
    g.addColorStop(0.82, 'rgba(6,8,14,0.15)');
    g.addColorStop(1, 'rgba(6,8,14,0.92)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}
