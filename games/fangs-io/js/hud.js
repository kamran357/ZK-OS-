// Fangs.io — in-game HUD: score, weapon, power, leaderboard, killfeed, minimap,
// and the non-negotiable combat feedback (hitmarker, damage direction, banners).
import { WORLD, WEAPONS, POWERS } from '../shared/constants.js';
import { clamp } from './util.js';

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <canvas id="fx"></canvas>
      <div id="stats">
        <div class="stat"><span class="lab">LENGTH</span><b id="stLen">0</b></div>
        <div class="stat"><span class="lab">KILLS</span><b id="stKills">0</b></div>
        <div class="stat"><span class="lab">BEST</span><b id="stBest">0</b></div>
      </div>
      <div id="board"><div class="btitle">LEADERBOARD</div><ol id="boardList"></ol></div>
      <div id="feed"></div>
      <div id="gear">
        <div id="powerWrap" class="hidden"><span id="powerName">—</span><div id="powerBar"><i id="powerFill"></i></div></div>
        <div id="weaponWrap"><span id="weaponName">UNARMED</span><div id="ammo"></div></div>
      </div>
      <canvas id="minimap" width="164" height="164"></canvas>
      <div id="banner" class="hidden"></div>
      <div id="toast" class="hidden"></div>
      <div id="hint">move: mouse &nbsp;•&nbsp; boost: hold click / space &nbsp;•&nbsp; weapons auto-fire</div>
    `;
    this.fx = root.querySelector('#fx');
    this.fxc = this.fx.getContext('2d');
    this.mini = root.querySelector('#minimap');
    this.minic = this.mini.getContext('2d');
    this.el = {
      len: root.querySelector('#stLen'), kills: root.querySelector('#stKills'), best: root.querySelector('#stBest'),
      board: root.querySelector('#boardList'), feed: root.querySelector('#feed'),
      powerWrap: root.querySelector('#powerWrap'), powerName: root.querySelector('#powerName'), powerFill: root.querySelector('#powerFill'),
      weaponName: root.querySelector('#weaponName'), ammo: root.querySelector('#ammo'),
      banner: root.querySelector('#banner'), toast: root.querySelector('#toast'), hint: root.querySelector('#hint'),
    };
    this._hitAt = 0;
    this._dmg = []; // {a, at}
    this._bannerUntil = 0;
    this._toastUntil = 0;
    this._feedRows = [];
    this._hintUntil = performance.now() + 9000;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.fx.width = Math.floor(window.innerWidth * dpr);
    this.fx.height = Math.floor(window.innerHeight * dpr);
    this.fx.style.width = window.innerWidth + 'px';
    this.fx.style.height = window.innerHeight + 'px';
    this._dpr = dpr;
  }

  event(ev, now) {
    if (ev.e === 'hit') this._hitAt = now;
    else if (ev.e === 'dmg') this._dmg.push({ a: ev.a, at: now });
    else if (ev.e === 'kill') { this.el.banner.textContent = 'ELIMINATED ' + ev.v; this.el.banner.classList.remove('hidden'); this._bannerUntil = now + 1600; }
    else if (ev.e === 'pick') { this._toast('picked up ' + labelFor(ev.kind)); }
    else if (ev.e === 'feed') { this._addFeed(ev, now); }
  }

  _toast(txt) {
    this.el.toast.textContent = txt;
    this.el.toast.classList.remove('hidden');
    this._toastUntil = performance.now() + 1400;
  }

  _addFeed(ev, now) {
    const row = document.createElement('div');
    row.className = 'feedRow';
    const w = ev.w && WEAPONS[ev.w] ? WEAPONS[ev.w].name : ev.w === 'border' ? 'wall' : ev.w === 'mine' ? 'Mine' : ev.w === 'shrink' ? 'Shrink' : 'body';
    row.innerHTML = `<span class="k">${esc(ev.k)}</span> <span class="v">☠ ${esc(ev.v)}</span> <span class="wn">${esc(w)}</span>`;
    this.el.feed.prepend(row);
    this._feedRows.push({ el: row, until: now + 5200 });
    while (this._feedRows.length > 6) { const r = this._feedRows.shift(); r.el.remove(); }
  }

  // per-frame overlay + pruning
  tick(now, player) {
    const dpr = this._dpr;
    const ctx = this.fxc;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = window.innerWidth, H = window.innerHeight;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;

    // low-health vignette (short snake = fragile)
    if (player && player.alive) {
      const frac = clamp((player.lenSegs() - 6) / 10, 0, 1);
      if (frac < 1) {
        ctx.save();
        const g = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.7);
        g.addColorStop(0, 'rgba(255,40,60,0)');
        g.addColorStop(1, `rgba(255,40,60,${(1 - frac) * 0.33})`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }

    // hitmarker
    if (now - this._hitAt < 130) {
      const a = 1 - (now - this._hitAt) / 130;
      ctx.save();
      ctx.globalAlpha = a; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      for (const [dx, dy] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) {
        ctx.beginPath(); ctx.moveTo(cx + dx * 9, cy + dy * 9); ctx.lineTo(cx + dx * 18, cy + dy * 18); ctx.stroke();
      }
      ctx.restore();
    }

    // damage direction arrows (world angle == screen angle, camera unrotated)
    const R = Math.min(W, H) * 0.38;
    for (let i = this._dmg.length - 1; i >= 0; i--) {
      const d = this._dmg[i];
      const age = now - d.at;
      if (age > 800) { this._dmg.splice(i, 1); continue; }
      const a = 1 - age / 800;
      ctx.save();
      ctx.translate(cx + Math.cos(d.a) * R, cy + Math.sin(d.a) * R);
      ctx.rotate(d.a);
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = '#ff3b5c';
      ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-10, -14); ctx.lineTo(-10, 14); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // prune banner/toast/feed
    if (this._bannerUntil && now > this._bannerUntil) { this.el.banner.classList.add('hidden'); this._bannerUntil = 0; }
    if (this._toastUntil && performance.now() > this._toastUntil) { this.el.toast.classList.add('hidden'); this._toastUntil = 0; }
    for (let i = this._feedRows.length - 1; i >= 0; i--) {
      if (now > this._feedRows[i].until) { this._feedRows[i].el.classList.add('fade'); }
    }
    if (this._hintUntil && performance.now() > this._hintUntil) { this.el.hint.classList.add('fade'); this._hintUntil = 0; }
  }

  update(world) {
    const me = world.player;
    if (me) {
      this.el.len.textContent = me.lenSegs();
      this.el.kills.textContent = me.kills;
      this.el.best.textContent = Math.floor(me.best);
      // weapon
      if (me.power && me.power.key === 'shrink') {
        this.el.weaponName.textContent = 'SHRINK RAY';
        this._renderAmmo(me.power.shots, POWERS.shrink.shots);
      } else if (me.weapon) {
        const def = WEAPONS[me.weapon.key];
        this.el.weaponName.textContent = def.name.toUpperCase();
        this._renderAmmo(me.weapon.ammo, def.ammo);
      } else {
        this.el.weaponName.textContent = 'UNARMED';
        this.el.ammo.innerHTML = '';
      }
      // power timer
      if (me.power && me.power.until && me.power.key !== 'shrink') {
        const def = POWERS[me.power.key];
        this.el.powerWrap.classList.remove('hidden');
        this.el.powerName.textContent = def.name;
        const total = def.durMs;
        const left = clamp((me.power.until - world.now) / total, 0, 1);
        this.el.powerFill.style.width = (left * 100) + '%';
      } else this.el.powerWrap.classList.add('hidden');
    }
    // leaderboard
    const lb = world.leaderboard();
    let html = '';
    for (let i = 0; i < lb.length; i++) {
      const s = lb[i];
      const meCls = s.id === world.playerId ? ' class="me"' : '';
      html += `<li${meCls}><span>${esc(s.name)}</span><b>${s.lenSegs()}</b></li>`;
    }
    this.el.board.innerHTML = html;
    this._minimap(world);
  }

  _renderAmmo(cur, max) {
    const pips = clamp(max, 0, 30);
    let h = '';
    for (let i = 0; i < pips; i++) h += `<i class="${i < cur ? 'on' : ''}"></i>`;
    this.el.ammo.innerHTML = h;
  }

  _minimap(world) {
    const c = this.minic, S = 164, pad = 8, w = S - pad * 2;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(8,11,18,0.72)'; c.fillRect(0, 0, S, S);
    c.strokeStyle = '#243049'; c.lineWidth = 1; c.strokeRect(pad, pad, w, w);
    const sx = (x) => pad + (x / WORLD.W) * w, sy = (y) => pad + (y / WORLD.H) * w;
    // crates only
    c.fillStyle = '#39ff88';
    for (const it of world.items.values()) if (it.kind === 'crate') { c.fillRect(sx(it.x) - 1.5, sy(it.y) - 1.5, 3, 3); }
    // self
    if (world.player && world.player.alive) {
      const h = world.player.head();
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(sx(h.x), sy(h.y), 3, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#39ff88'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(sx(h.x), sy(h.y), 5, 0, Math.PI * 2); c.stroke();
    }
  }
}

function labelFor(kind) {
  if (kind && kind.startsWith('power:')) { const k = kind.slice(6); return POWERS[k] ? POWERS[k].name : k; }
  return WEAPONS[kind] ? WEAPONS[kind].name : kind;
}
function esc(s) { return String(s).replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m])); }
