/* VIPER ARENA - Canvas 2D renderer. Camera follows the player head; draws arena
   grid + border glow, snakes as glowing segmented bodies (head->tail gradient),
   pellets, weapon crates with per-weapon icons, projectiles with tracers, muzzle
   flash, particle bursts, screen shake, floating damage numbers, hitmarker, red
   damage vignette, and a corner minimap. Browser-only but node --check safe. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VRender = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const S = (typeof VIPER !== 'undefined') ? VIPER : (typeof require !== 'undefined' ? require('./sim.js') : {});
  const W = S.W || 2400, H = S.H || 1600;
  const HEAD_R = S.HEAD_R || 12, BODY_R = S.BODY_R || 9;
  const WEAPONS = S.WEAPONS || {};
  const TAU = Math.PI * 2;

  // per-weapon crate colours (fallback to weapon color)
  const CRATE_COL = {
    pistol: '#7CF9FF', shotgun: '#FFC24B', smg: '#8CFF6B',
    railgun: '#FF4D6D', flamethrower: '#FF8A2B'
  };

  function Renderer(canvas, minimap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mini = minimap || null;
    this.mctx = minimap ? minimap.getContext('2d') : null;
    this.vw = 0; this.vh = 0; this.dpr = 1;
    this.camX = W / 2; this.camY = H / 2;
    this.shake = 0; this.shakeX = 0; this.shakeY = 0;  // screen shake
    this.vignette = 0;            // red damage flash 0..1
    this.particles = [];          // {x,y,vx,vy,life,max,r,color,kind}
    this.hitmarkerT = 0;
    this.time = 0;
    this.resize();
  }

  Renderer.prototype.resize = function () {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.canvas.width = Math.floor(this.vw * dpr);
    this.canvas.height = Math.floor(this.vh * dpr);
    this.canvas.style.width = this.vw + 'px';
    this.canvas.style.height = this.vh + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.mini) {
      const mw = this.mini.clientWidth || 180, mh = this.mini.clientHeight || 120;
      this.mini.width = Math.floor(mw * dpr);
      this.mini.height = Math.floor(mh * dpr);
      this.mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.miniW = mw; this.miniH = mh;
    }
  };

  // ---- particle spawners, fed from game.events ----
  Renderer.prototype.addShake = function (amt) { if (amt > this.shake) this.shake = amt; };
  Renderer.prototype.flashDamage = function () { this.vignette = 1; };
  Renderer.prototype.hitmarker = function () { this.hitmarkerT = 0.14; };

  Renderer.prototype.burst = function (x, y, color, n, speed, life) {
    n = n || 10; speed = speed || 220; life = life || 0.6;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = (0.4 + Math.random()) * speed;
      this.particles.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: life * (0.6 + Math.random() * 0.7), max: life,
        r: 2 + Math.random() * 3, color: color || '#7CF9FF', kind: 'spark'
      });
    }
  };

  Renderer.prototype.muzzle = function (x, y, ang, power, color, kind) {
    const n = 5 + power * 5, flame = kind === 'flame';
    for (let i = 0; i < n; i++) {
      const a = ang + (Math.random() - 0.5) * (flame ? 0.9 : 0.5);
      const sp = 200 + Math.random() * 340 * power;
      this.particles.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.12 + Math.random() * 0.12, max: 0.24, r: 2 + Math.random() * 3.5,
        color: color || '#FFC24B', kind: flame ? 'flame' : 'muzzle'
      });
    }
    // bright flash blob at the muzzle
    this.particles.push({ x: x, y: y, vx: 0, vy: 0, life: 0.06, max: 0.06, r: 10 + power * 8, color: color || '#FFF', kind: 'flash' });
  };

  // ---- drain events emitted by the sim ----
  Renderer.prototype.consume = function (events) {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case 'shake': this.addShake(e.amt); break;
        case 'muzzle': this.muzzle(e.x, e.y, e.ang, e.power || 1, e.color, e.kind); break;
        case 'spark': this.burst(e.x, e.y, e.color, 4, 160, 0.4); break;
        case 'blood': this.burst(e.x, e.y, e.color, e.n || 6, 200, 0.5); break;
        case 'burst': this.burst(e.x, e.y, e.color, 14, 300, 0.8); break;
        case 'pop': this.burst(e.x, e.y, '#9CFFB0', 8, 180, 0.5); break;
        case 'pickup': this.burst(e.x, e.y, CRATE_COL[e.weapon] || '#FFF', 18, 260, 0.7); break;
        case 'kill': this.burst(e.x, e.y, '#FFE45E', 20, 340, 0.9); break;
        case 'bossKill':
          this.burst(e.x, e.y, '#FF4D9D', 48, 520, 1.3);
          this.addShake(30);
          break;
        case 'hitmarker': this.hitmarker(); break;
        case 'death': this.addShake(26); break;
        default: break;
      }
    }
  };

  // ---- per-frame update of visual state ----
  Renderer.prototype.update = function (dt, headX, headY) {
    this.time += dt;
    this.camX += (headX - this.camX) * Math.min(1, dt * 8);
    this.camY += (headY - this.camY) * Math.min(1, dt * 8);
    // clamp the camera inside the arena so the view never shows dead space
    // outside the border (only clamp on an axis where the arena is bigger
    // than the viewport, otherwise centre it).
    const hw = this.vw / 2, hh = this.vh / 2;
    this.camX = this.vw >= W ? W / 2 : Math.max(hw, Math.min(W - hw, this.camX));
    this.camY = this.vh >= H ? H / 2 : Math.max(hh, Math.min(H - hh, this.camY));
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 42);
      this.shakeX = (Math.random() - 0.5) * this.shake * 2;
      this.shakeY = (Math.random() - 0.5) * this.shake * 2;
    } else { this.shakeX = 0; this.shakeY = 0; }
    if (this.vignette > 0) this.vignette = Math.max(0, this.vignette - dt * 1.8);
    if (this.hitmarkerT > 0) this.hitmarkerT -= dt;
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.90; p.vy *= 0.90;
      if (p.kind === 'flame') p.vy -= 40 * dt; // flame rises
    }
  };

  Renderer.prototype._originX = function () { return this.camX - this.vw / 2 + this.shakeX; };
  Renderer.prototype._originY = function () { return this.camY - this.vh / 2 + this.shakeY; };

  // ---- main draw ----
  Renderer.prototype.draw = function (game) {
    const ctx = this.ctx;
    const ox = this._originX(), oy = this._originY();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#04070a';
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.save();
    ctx.translate(-ox, -oy);   // -> world space
    this._drawGrid(ctx, ox, oy);
    this._drawBorder(ctx);
    this._drawPellets(ctx, game.pellets);
    this._drawCrates(ctx, game.crates);
    this._drawBeams(ctx, game.beams);
    this._drawProjectiles(ctx, game.projectiles);
    for (const e of game.enemies) if (e.alive) this._drawSnake(ctx, e, false);
    if (game.player.alive) this._drawSnake(ctx, game.player, true);
    this._drawParticles(ctx);
    this._drawFloaters(ctx, game.floaters);
    ctx.restore();             // -> screen space
    this._drawVignette(ctx, game.player);
    this._drawHitmarker(ctx);
    this._drawMinimap(game);
  };

  Renderer.prototype._drawGrid = function (ctx, ox, oy) {
    const step = 80;
    const x1 = ox + this.vw, y1 = oy + this.vh;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(124,249,255,0.05)';
    ctx.beginPath();
    for (let x = Math.floor(ox / step) * step; x <= x1; x += step) {
      if (x < 0 || x > W) continue;
      ctx.moveTo(x, Math.max(0, oy)); ctx.lineTo(x, Math.min(H, y1));
    }
    for (let y = Math.floor(oy / step) * step; y <= y1; y += step) {
      if (y < 0 || y > H) continue;
      ctx.moveTo(Math.max(0, ox), y); ctx.lineTo(Math.min(W, x1), y);
    }
    ctx.stroke();
  };

  Renderer.prototype._drawBorder = function (ctx) {
    ctx.save();
    ctx.shadowColor = '#7CF9FF'; ctx.shadowBlur = 26;
    ctx.strokeStyle = 'rgba(124,249,255,0.75)'; ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, W, H);
    ctx.restore();
  };

  Renderer.prototype._drawSnake = function (ctx, s, isPlayer) {
    const pts = s.pts, n = pts.length;
    if (n < 2) return;
    const scale = s.scale || 1;
    const head = pts[0];
    const flash = s.hitFlash > 0;
    const base = flash ? '#ffffff' : s.color;
    const tail = isPlayer ? '#0e6b46' : '#5a1414';
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = isPlayer ? '#39FF9E' : '#FF5A5A';
    ctx.shadowBlur = 18;
    // tapered, gradiented segments from tail up to the head
    for (let i = n - 1; i >= 1; i--) {
      const a = pts[i], b = pts[i - 1], t = i / n;
      ctx.strokeStyle = mix(base, tail, t);
      ctx.lineWidth = Math.max(2, BODY_R * scale * (1 - t * 0.55) * 2);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // head
    ctx.fillStyle = flash ? '#fff' : (isPlayer ? '#8BFFD0' : '#FF9A9A');
    ctx.beginPath(); ctx.arc(head.x, head.y, HEAD_R * scale, 0, TAU); ctx.fill();
    // eye pointing at the aim
    const ax = Math.cos(s.aimAng), ay = Math.sin(s.aimAng);
    if (isPlayer) this._drawEquipment(ctx, s, head, ax, ay);
    ctx.fillStyle = '#04070a';
    ctx.beginPath(); ctx.arc(head.x + ax * 4 * scale, head.y + ay * 4 * scale, 3.4 * scale, 0, TAU); ctx.fill();
    // recoil flash line
    const rk = s.recoil / 320;
    if (rk > 0.02) {
      ctx.strokeStyle = isPlayer ? '#39FF9E' : '#FF5A5A';
      ctx.globalAlpha = rk; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(head.x + ax * HEAD_R * scale, head.y + ay * HEAD_R * scale);
      ctx.lineTo(head.x + ax * (HEAD_R * scale + 16 * rk), head.y + ay * (HEAD_R * scale + 16 * rk));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // enemy health pip
    if (!isPlayer && (s.hp < s.maxHp || s.boss)) {
      const w = s.boss ? 92 : 34, hpr = Math.max(0, s.hp / s.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(head.x - w / 2, head.y - HEAD_R * scale - 17, w, s.boss ? 6 : 4);
      ctx.fillStyle = s.boss ? s.color : (hpr > 0.4 ? '#8CFF6B' : '#FF4D6D');
      ctx.fillRect(head.x - w / 2, head.y - HEAD_R * scale - 17, w * hpr, s.boss ? 6 : 4);
      if (s.boss) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '800 11px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = s.color;
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 8;
        ctx.fillText(s.name, head.x, head.y - HEAD_R * scale - 23);
        ctx.restore();
      }
    }
  };

  Renderer.prototype._drawEquipment = function (ctx, s, head, ax, ay) {
    const color = s.equipmentColor || '#7CF9FF';
    const px = -ay, py = ax;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    if (s.loadout === 'bulwark') {
      ctx.globalAlpha = 0.82;
      ctx.lineWidth = 3;
      for (let i = 2; i < Math.min(s.pts.length, 11); i += 2) {
        const p = s.pts[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, BODY_R + 3, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(head.x, head.y, HEAD_R + 5, -0.9, 0.9);
      ctx.stroke();
    } else if (s.loadout === 'arc') {
      const pulse = 18 + Math.sin(this.time * 8) * 2;
      ctx.globalAlpha = 0.72;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(head.x, head.y, pulse, this.time * 2, this.time * 2 + Math.PI * 1.55);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(head.x + px * 7, head.y + py * 7);
      ctx.lineTo(head.x - ax * 12, head.y - ay * 12);
      ctx.lineTo(head.x - px * 7, head.y - py * 7);
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.88;
      ctx.beginPath();
      ctx.moveTo(head.x - ax * 4 + px * 8, head.y - ay * 4 + py * 8);
      ctx.lineTo(head.x - ax * 18 + px * 15, head.y - ay * 18 + py * 15);
      ctx.lineTo(head.x - ax * 13 + px * 3, head.y - ay * 13 + py * 3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(head.x - ax * 4 - px * 8, head.y - ay * 4 - py * 8);
      ctx.lineTo(head.x - ax * 18 - px * 15, head.y - ay * 18 - py * 15);
      ctx.lineTo(head.x - ax * 13 - px * 3, head.y - ay * 13 - py * 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };

  Renderer.prototype._drawPellets = function (ctx, pellets) {
    ctx.save();
    ctx.shadowColor = '#9CFFB0'; ctx.shadowBlur = 12;
    for (const p of pellets) {
      const pr = p.r * (0.85 + Math.sin(p.ph) * 0.18);
      ctx.fillStyle = '#9CFFB0';
      ctx.beginPath(); ctx.arc(p.x, p.y, pr, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(p.x - pr * 0.3, p.y - pr * 0.3, pr * 0.35, 0, TAU); ctx.fill();
    }
    ctx.restore();
  };

  Renderer.prototype._drawCrates = function (ctx, crates) {
    for (const c of crates) {
      const col = CRATE_COL[c.type] || (WEAPONS[c.type] && WEAPONS[c.type].color) || '#FFF';
      const r = c.r;
      ctx.save();
      ctx.translate(c.x, c.y + Math.sin(c.ph) * 3);
      ctx.rotate(Math.sin(c.ph * 0.5) * 0.12);
      ctx.shadowColor = col; ctx.shadowBlur = 20;
      ctx.fillStyle = 'rgba(6,12,16,0.9)'; ctx.strokeStyle = col; ctx.lineWidth = 3;
      roundRect(ctx, -r, -r, r * 2, r * 2, 5);
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = col; ctx.strokeStyle = col;
      drawWeaponIcon(ctx, c.type, r);
      ctx.restore();
    }
  };

  Renderer.prototype._drawProjectiles = function (ctx, projs) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const p of projs) {
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const tl = Math.min(26, sp * 0.02);
      const bx = p.x - (p.vx / sp) * tl, by = p.y - (p.vy / sp) * tl;
      ctx.shadowColor = p.color; ctx.shadowBlur = 12;
      const grad = ctx.createLinearGradient(bx, by, p.x, p.y);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, p.color);
      ctx.strokeStyle = grad; ctx.lineWidth = p.r * 1.6;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.fillStyle = p.kind === 'flame' ? p.color : '#ffffff';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + (p.kind === 'flame' ? 3 : 0.5), 0, TAU); ctx.fill();
    }
    ctx.restore();
  };

  Renderer.prototype._drawBeams = function (ctx, beams) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const b of beams) {
      const a = Math.max(0, b.life / 0.16);
      ctx.globalAlpha = a;
      ctx.shadowColor = b.color; ctx.shadowBlur = 30;
      ctx.strokeStyle = b.color; ctx.lineWidth = 6 * a + 2;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * a;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  Renderer.prototype._drawParticles = function (ctx) {
    ctx.save();
    for (const p of this.particles) {
      const a = Math.max(0, Math.min(1, p.life / p.max));
      ctx.globalAlpha = a;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = p.kind === 'flash' ? 24 : 8;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (p.kind === 'flame' ? (0.5 + a) : 1), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  Renderer.prototype._drawFloaters = function (ctx, floaters) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '900 22px "Segoe UI", Arial, sans-serif';
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
      ctx.shadowColor = f.color; ctx.shadowBlur = 10;
      ctx.fillStyle = f.color;
      ctx.fillText(f.txt, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  Renderer.prototype._drawVignette = function (ctx, player) {
    const dmg = player.damageFlash > 0 ? player.damageFlash : 0;
    const v = Math.max(this.vignette, dmg * 1.4);
    // ambient pulse when health is low
    const lowHp = player.hp / (player.maxHp || 100);
    const amb = lowHp < 0.3 ? (0.18 + Math.sin(this.time * 6) * 0.06) * (1 - lowHp / 0.3) : 0;
    const strength = Math.max(v * 0.6, amb);
    if (strength <= 0.001) return;
    const g = ctx.createRadialGradient(
      this.vw / 2, this.vh / 2, Math.min(this.vw, this.vh) * 0.35,
      this.vw / 2, this.vh / 2, Math.max(this.vw, this.vh) * 0.72);
    g.addColorStop(0, 'rgba(255,40,70,0)');
    g.addColorStop(1, 'rgba(255,30,60,' + Math.min(0.7, strength).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.vw, this.vh);
  };

  Renderer.prototype._drawHitmarker = function (ctx) {
    if (this.hitmarkerT <= 0) return;
    const cx = this.vw / 2, cy = this.vh / 2;
    ctx.save();
    ctx.globalAlpha = this.hitmarkerT / 0.14;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
    for (let k = 0; k < 4; k++) {
      const ang = Math.PI / 4 + k * Math.PI / 2;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      ctx.beginPath();
      ctx.moveTo(cx + dx * 6, cy + dy * 6);
      ctx.lineTo(cx + dx * 14, cy + dy * 14);
      ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype._drawMinimap = function (game) {
    if (!this.mctx) return;
    const ctx = this.mctx, mw = this.miniW, mh = this.miniH;
    const sx = mw / W, sy = mh / H;
    ctx.clearRect(0, 0, mw, mh);
    ctx.fillStyle = 'rgba(156,255,176,0.6)';
    for (const p of game.pellets) ctx.fillRect(p.x * sx - 0.5, p.y * sy - 0.5, 1.5, 1.5);
    for (const c of game.crates) {
      ctx.fillStyle = CRATE_COL[c.type] || '#FFF';
      ctx.fillRect(c.x * sx - 1.5, c.y * sy - 1.5, 3, 3);
    }
    ctx.fillStyle = '#FF5A5A';
    for (const e of game.enemies) {
      if (!e.alive) continue;
      const h = e.pts[0];
      ctx.beginPath(); ctx.arc(h.x * sx, h.y * sy, 2.4, 0, TAU); ctx.fill();
    }
    if (game.player.alive) {
      const h = game.player.pts[0];
      ctx.fillStyle = '#39FF9E';
      ctx.shadowColor = '#39FF9E'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(h.x * sx, h.y * sy, 3, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(124,249,255,0.5)'; ctx.lineWidth = 1;
      const rw = this.vw * sx, rh = this.vh * sy;
      ctx.strokeRect(this.camX * sx - rw / 2, this.camY * sy - rh / 2, rw, rh);
    }
  };

  // ---------- helpers ----------
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // simple per-weapon glyphs, centered in the crate
  function drawWeaponIcon(ctx, type, r) {
    const s = r * 0.62;
    ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath();
    switch (type) {
      case 'pistol':
        ctx.moveTo(-s, -s * 0.3); ctx.lineTo(s * 0.6, -s * 0.3);
        ctx.lineTo(s * 0.6, s * 0.1); ctx.lineTo(-s * 0.2, s * 0.1);
        ctx.lineTo(-s * 0.4, s * 0.7); ctx.lineTo(-s * 0.7, s * 0.7);
        ctx.lineTo(-s * 0.5, s * 0.1); ctx.lineTo(-s, s * 0.1); ctx.closePath();
        ctx.stroke();
        break;
      case 'smg':
        ctx.rect(-s, -s * 0.35, s * 1.7, s * 0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s * 0.2, s * 0.15); ctx.lineTo(-s * 0.2, s * 0.8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s * 0.6, s * 0.15); ctx.lineTo(-s * 0.6, s * 0.6); ctx.stroke();
        break;
      case 'shotgun':
        ctx.moveTo(-s, -s * 0.15); ctx.lineTo(s, -s * 0.15);
        ctx.moveTo(-s, s * 0.15); ctx.lineTo(s, s * 0.15); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s * 0.5, s * 0.15); ctx.lineTo(-s * 0.8, s * 0.75); ctx.stroke();
        break;
      case 'railgun':
        ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke();
        ctx.beginPath();
        for (let i = -1; i <= 1; i++) { ctx.moveTo(i * s * 0.5, -s * 0.6); ctx.lineTo(i * s * 0.5, s * 0.6); }
        ctx.stroke();
        break;
      case 'flamethrower':
        ctx.moveTo(-s * 0.8, s * 0.6);
        ctx.quadraticCurveTo(-s * 1.1, -s * 0.2, -s * 0.2, -s * 0.7);
        ctx.quadraticCurveTo(0, 0, s * 0.4, -s * 0.3);
        ctx.quadraticCurveTo(s, s * 0.2, s * 0.4, s * 0.6);
        ctx.closePath(); ctx.fill();
        break;
      default:
        ctx.arc(0, 0, s * 0.6, 0, TAU); ctx.stroke();
    }
  }

  // color parsing + mixing (cached, gradient tail colours)
  function hexToRgb(h) {
    if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const _mixCache = {};
  function mix(a, b, t) {
    const key = a + b + (t * 16 | 0);
    if (_mixCache[key]) return _mixCache[key];
    const ca = hexToRgb(a), cb = hexToRgb(b);
    const out = 'rgb(' +
      Math.round(ca[0] + (cb[0] - ca[0]) * t) + ',' +
      Math.round(ca[1] + (cb[1] - ca[1]) * t) + ',' +
      Math.round(ca[2] + (cb[2] - ca[2]) * t) + ')';
    _mixCache[key] = out;
    return out;
  }

  return { Renderer };
});
