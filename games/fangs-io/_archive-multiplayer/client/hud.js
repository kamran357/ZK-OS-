// Fangs.io — HUD module (owner: HUD)
// Builds ALL HUD DOM inside #hud. Browser ES module only — no Node APIs.
// Contract per SPEC.md: showStart, hideStart, showDeath, hideDeath, update, event, minimap.

import { SKINS, WEAPONS, POWERS, WORLD } from '/shared/constants.js';

const NAME_KEY = 'fangs_name';
const SKIN_KEY = 'fangs_skin';

const KILLFEED_MAX = 6;
const KILLFEED_MS = 5000;   // killfeed row lifetime (CSS feed-life must match)
const BANNER_MS = 1400;     // 'ELIMINATED' banner lifetime (CSS banner-life must match)
const HITMARKER_MS = 120;   // hitmarker flash (CSS hit-flash must match)
const DMG_ARC_MS = 700;     // damage arc lifetime (CSS dmg-life must match)
const TOAST_MS = 1500;      // pickup toast lifetime (CSS toast-life must match)
const MAX_PIPS = 40;        // hard cap on ammo pip elements
const NAME_MAX = 16;
const MINIMAP_SIZE = 160;

// killfeed weapon token, ASCII-safe for the monospace stack
const FEED_TOKEN = {
  blaster: '>',
  spread: '}',
  cannon: 'O',
  mine: '*',
  shrink: '~',
  turret: 'T',
  body: 'X',
  border: '#',
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function fin(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lsGet(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function lsSet(key, val) {
  try { window.localStorage.setItem(key, val); } catch { /* storage unavailable (private mode) */ }
}

function cleanName(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export class HUD {
  constructor(root) {
    if (typeof root === 'string') root = document.querySelector(root);
    this.root = root instanceof HTMLElement ? root : document.getElementById('hud');
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.id = 'hud';
      document.body.appendChild(this.root);
    }

    this.el = {};
    this.playerName = '';        // used to highlight "me" in leaderboard/killfeed; main.js may overwrite after welcome
    this.skin = 0;

    // caches so update() only touches the DOM when something changed
    this._c = Object.create(null);
    this._lbFp = null;
    this._lbRows = [];
    this._pips = [];
    this._wpnKind = null;
    this._wpnAmmo = -1;
    this._pwOff = true;
    this._pwFrac = -1;
    this._boostOn = null;

    this._deathTimer = null;
    this._hitT = null;
    this._playLock = false;
    this._onPlay = null;
    this._onRespawn = null;

    this._buildGame();
    this._buildStart();
    this._buildDeath();
  }

  // ------------------------------------------------------------ DOM builders

  _buildGame() {
    const g = el('div', 'hud-game off');

    // top-left stats
    const stats = el('div', 'panel stats');
    const mkStat = (label) => {
      const row = el('div', 'stat');
      row.appendChild(el('span', 'stat-l', label));
      const v = el('span', 'stat-v', '0');
      row.appendChild(v);
      stats.appendChild(row);
      return v;
    };
    this.el.score = mkStat('SCORE');
    this.el.len = mkStat('LENGTH');
    this.el.ping = mkStat('PING');
    this.el.fps = mkStat('FPS');

    // top-right leaderboard (10 rows + 1 "me outside top10" row)
    const lb = el('div', 'panel leaderboard');
    lb.appendChild(el('div', 'lb-title', 'TOP SNAKES'));
    this._lbRows = [];
    for (let i = 0; i < 11; i++) {
      const row = el('div', 'lb-row off');
      const rank = el('span', 'lb-rank', '');
      const name = el('span', 'lb-name', '');
      const score = el('span', 'lb-score', '');
      row.append(rank, name, score);
      lb.appendChild(row);
      this._lbRows.push({ row, rank, name, score });
    }

    // bottom-center stack: toasts above boost tag above power bar above weapon card
    const bc = el('div', 'bottom-center');
    const toasts = el('div', 'toasts');
    const boostTag = el('div', 'boost-tag off', '>> BOOST >>');
    const power = el('div', 'power off');
    const pwName = el('span', 'power-name', '');
    const pwBar = el('div', 'power-bar');
    const pwFill = el('div', 'power-fill');
    pwBar.appendChild(pwFill);
    power.append(pwName, pwBar);
    const wpnCard = el('div', 'panel weapon unarmed');
    const wpnName = el('div', 'weapon-name', 'UNARMED');
    const pips = el('div', 'pips off');
    wpnCard.append(wpnName, pips);
    bc.append(toasts, boostTag, power, wpnCard);

    // bottom-left killfeed
    const feed = el('div', 'killfeed');

    // bottom-right minimap
    const mm = document.createElement('canvas');
    mm.className = 'minimap';
    mm.width = MINIMAP_SIZE;
    mm.height = MINIMAP_SIZE;
    this._mmCtx = mm.getContext('2d');

    // center-top kill banners, center hitmarker, damage-arc layer
    const banners = el('div', 'banners');
    const hitmarker = el('div', 'hitmarker');
    hitmarker.append(el('i', 'hx a'), el('i', 'hx b'));
    const dmgLayer = el('div', 'dmg-layer');

    g.append(stats, lb, bc, feed, mm, banners, hitmarker, dmgLayer);
    this.root.appendChild(g);

    Object.assign(this.el, {
      game: g, lb, toasts, boostTag, power, pwName, pwFill,
      wpnCard, wpnName, pips, feed, minimapCanvas: mm,
      banners, hitmarker, dmgLayer,
    });
  }

  _buildStart() {
    const s = el('div', 'screen start off');
    const inner = el('div', 'screen-inner');

    inner.appendChild(el('h1', 'title', 'FANGS.IO'));
    inner.appendChild(el('p', 'tagline', 'eat. shoot. grow.'));

    const input = el('input', 'name-input');
    input.type = 'text';
    input.maxLength = NAME_MAX;
    input.placeholder = 'YOUR NAME';
    input.spellcheck = false;
    input.autocomplete = 'off';

    const skins = el('div', 'skins');
    this._skinBtns = SKINS.map((color, i) => {
      const b = el('button', 'skin');
      b.type = 'button';
      b.style.background = color;
      b.setAttribute('aria-label', 'skin ' + (i + 1));
      b.addEventListener('click', () => this._selectSkin(i));
      skins.appendChild(b);
      return b;
    });

    const play = el('button', 'btn play', 'PLAY');
    play.type = 'button';

    inner.append(input, skins, play,
      el('p', 'hint', 'MOUSE steer / HOLD LMB fire / SPACE boost'));
    s.appendChild(inner);
    this.root.appendChild(s);

    play.addEventListener('click', () => this._play());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._play(); });

    this.el.start = s;
    this.el.nameInput = input;
    this.el.playBtn = play;
  }

  _buildDeath() {
    const s = el('div', 'screen death off');
    const inner = el('div', 'screen-inner');
    const title = el('h2', 'death-title', 'EATEN');
    const sub = el('div', 'death-sub off', '');
    const stats = el('div', 'death-stats', '');
    const btn = el('button', 'btn respawn', 'RESPAWN');
    btn.type = 'button';
    btn.disabled = true;
    inner.append(title, sub, stats, btn);
    s.appendChild(inner);
    this.root.appendChild(s);

    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const cb = this._onRespawn;
      if (typeof cb === 'function') {
        try { cb(); } catch (err) { console.error('[hud] onRespawn handler failed', err); }
      }
    });

    this.el.death = s;
    this.el.deathTitle = title;
    this.el.deathSub = sub;
    this.el.deathStats = stats;
    this.el.respawnBtn = btn;
  }

  // ------------------------------------------------------------ start screen

  showStart(onPlay) {
    this._onPlay = onPlay;
    this._playLock = false;
    const saved = lsGet(NAME_KEY);
    if (saved) this.el.nameInput.value = cleanName(saved);
    const savedSkin = parseInt(lsGet(SKIN_KEY) ?? '0', 10);
    this._selectSkin(Number.isFinite(savedSkin) ? savedSkin : 0);
    this.el.start.classList.remove('off');
    this.el.game.classList.add('off');
    setTimeout(() => { try { this.el.nameInput.focus(); } catch { /* ignore */ } }, 0);
  }

  hideStart() {
    try { this.el.nameInput.blur(); } catch { /* ignore */ }
    this.el.start.classList.add('off');
    this.el.game.classList.remove('off');
  }

  _selectSkin(i) {
    const idx = Math.max(0, Math.min(SKINS.length - 1, fin(i, 0) | 0));
    this.skin = idx;
    this._skinBtns.forEach((b, j) => b.classList.toggle('sel', j === idx));
    lsSet(SKIN_KEY, String(idx));
  }

  _play() {
    if (this._playLock) return;
    const name = cleanName(this.el.nameInput.value) || 'anon';
    this.playerName = name;
    lsSet(NAME_KEY, name);
    this._playLock = true;
    const cb = this._onPlay;
    if (typeof cb === 'function') {
      try {
        cb(name, this.skin);
      } catch (err) {
        console.error('[hud] onPlay handler failed', err);
        this._playLock = false;
      }
    }
  }

  // ------------------------------------------------------------ death screen

  showDeath(info, onRespawn) {
    info = info && typeof info === 'object' ? info : {};
    this._onRespawn = onRespawn;

    const killer = (cleanName(info.k) || '???').toUpperCase();
    const w = info.w;
    let title;
    let sub = '';
    if (w === 'border') {
      title = 'THE WALL';
      sub = 'you touched the border';
    } else if (w === 'body' || w === undefined || w === null) {
      title = 'EATEN BY ' + killer;
    } else {
      title = 'SHOT DOWN BY ' + killer;
      const def = WEAPONS[w] || POWERS[w];
      sub = '[' + (FEED_TOKEN[w] || '>') + '] ' + (def && def.name ? def.name : String(w)).toUpperCase();
    }
    this.el.deathTitle.textContent = title;
    this.el.deathSub.textContent = sub;
    this.el.deathSub.classList.toggle('off', !sub);
    this.el.deathStats.textContent =
      'FINAL SCORE ' + (fin(info.score) | 0) + '  /  LENGTH ' + (fin(info.len) | 0);

    this.el.death.classList.remove('off');

    // respawn countdown on the button itself
    if (this._deathTimer) { clearInterval(this._deathTimer); this._deathTimer = null; }
    const deadline = Date.now() + Math.max(0, fin(info.ms, 0));
    const btn = this.el.respawnBtn;
    const tick = () => {
      const left = deadline - Date.now();
      if (left <= 0) {
        if (this._deathTimer) { clearInterval(this._deathTimer); this._deathTimer = null; }
        btn.disabled = false;
        btn.textContent = 'RESPAWN';
      } else {
        btn.disabled = true;
        btn.textContent = 'RESPAWN IN ' + (left / 1000).toFixed(1) + 's';
      }
    };
    tick();
    if (deadline > Date.now()) this._deathTimer = setInterval(tick, 100);
  }

  hideDeath() {
    if (this._deathTimer) { clearInterval(this._deathTimer); this._deathTimer = null; }
    this.el.death.classList.add('off');
  }

  // ------------------------------------------------------------ per-frame update (cheap)

  update(s) {
    s = s && typeof s === 'object' ? s : {};
    const me = s.me && typeof s.me === 'object' ? s.me : null;

    if (me) {
      this._set('score', this.el.score, String(fin(me.score) | 0));
      this._set('len', this.el.len, String(fin(me.len) | 0));
      this._updateWeapon(me);
      this._updatePower(me);
      const boost = !!me.boost;
      if (boost !== this._boostOn) {
        this._boostOn = boost;
        this.el.boostTag.classList.toggle('off', !boost);
      }
    }
    this._set('ping', this.el.ping, String(Math.max(0, fin(s.ping) | 0)) + 'ms');
    this._set('fps', this.el.fps, String(Math.max(0, fin(s.fps) | 0)));
    this._updateLeaderboard(Array.isArray(s.lb) ? s.lb : [], me);
  }

  _set(key, node, text) {
    if (this._c[key] !== text) {
      this._c[key] = text;
      node.textContent = text;
    }
  }

  _updateWeapon(me) {
    const wpn = me.wpn && typeof me.wpn === 'object' ? me.wpn : null;
    const kind = wpn ? String(wpn.k || '') : '';
    const def = WEAPONS[kind];

    if (kind !== this._wpnKind) {
      this._wpnKind = kind;
      this._wpnAmmo = -1;
      if (!def) {
        this._set('wpnName', this.el.wpnName, 'UNARMED');
        this.el.wpnCard.classList.add('unarmed');
        this.el.pips.classList.add('off');
        this.el.pips.textContent = '';
        this._pips = [];
      } else {
        this._set('wpnName', this.el.wpnName, String(def.name).toUpperCase());
        this.el.wpnCard.classList.remove('unarmed');
        this.el.pips.classList.remove('off');
        this.el.pips.textContent = '';
        this._pips = [];
        const max = Math.max(1, Math.min(MAX_PIPS, fin(def.ammo, 1) | 0));
        for (let i = 0; i < max; i++) {
          const p = el('i', 'pip');
          this._pips.push(p);
          this.el.pips.appendChild(p);
        }
      }
    }

    if (def && wpn) {
      const ammo = Math.max(0, fin(wpn.ammo) | 0);
      if (ammo !== this._wpnAmmo) {
        this._wpnAmmo = ammo;
        for (let i = 0; i < this._pips.length; i++) {
          this._pips[i].classList.toggle('spent', i >= ammo);
        }
      }
    }
  }

  _updatePower(me) {
    const pw = me.pw && typeof me.pw === 'object' && me.pw.k ? me.pw : null;
    if (!pw) {
      if (!this._pwOff) {
        this._pwOff = true;
        this.el.power.classList.add('off');
        this._pwFrac = -1;
      }
      return;
    }
    if (this._pwOff) {
      this._pwOff = false;
      this.el.power.classList.remove('off');
    }
    const def = POWERS[pw.k];
    this._set('pwName', this.el.pwName, String(def && def.name ? def.name : pw.k).toUpperCase());

    // remaining-time fill; powers without durMs (shrink) show a full "ready" bar.
    // pw.until is assumed comparable to Date.now() (epoch ms).
    let frac = 1;
    const until = Number(pw.until);
    if (def && Number.isFinite(def.durMs) && def.durMs > 0 && Number.isFinite(until)) {
      frac = clamp01((until - Date.now()) / def.durMs);
    }
    if (Math.abs(frac - this._pwFrac) > 0.004) {
      this._pwFrac = frac;
      this.el.pwFill.style.transform = 'scaleX(' + frac.toFixed(3) + ')';
    }
  }

  _updateLeaderboard(lb, me) {
    const myName = this.playerName;
    const n = Math.min(lb.length, 10);
    let meIn = false;
    let fp = '';
    for (let i = 0; i < n; i++) {
      const r = Array.isArray(lb[i]) ? lb[i] : ['?', 0];
      fp += String(r[0]) + '' + String(r[1]) + '';
      if (myName && String(r[0]) === myName) meIn = true;
    }
    let extra = null;
    if (!meIn && myName && me) {
      extra = [myName, fin(me.score) | 0];
      fp += '+' + extra[0] + '' + extra[1];
    }
    if (fp === this._lbFp) return;
    this._lbFp = fp;

    let ri = 0;
    for (let i = 0; i < n; i++, ri++) {
      const r = Array.isArray(lb[i]) ? lb[i] : ['?', 0];
      this._paintLbRow(ri, String(i + 1), r[0], r[1], myName !== '' && String(r[0]) === myName);
    }
    if (extra) {
      this._paintLbRow(ri, '--', extra[0], extra[1], true);
      ri++;
    }
    for (; ri < this._lbRows.length; ri++) this._lbRows[ri].row.classList.add('off');
  }

  _paintLbRow(i, rank, name, score, isMe) {
    const r = this._lbRows[i];
    if (!r) return;
    r.row.classList.remove('off');
    r.row.classList.toggle('me', !!isMe);
    r.rank.textContent = rank;
    r.name.textContent = cleanName(name) || '?';
    r.score.textContent = String(fin(score) | 0);
  }

  // ------------------------------------------------------------ events

  // toScreenAngle: optional converter fn (world angle rad -> screen angle rad),
  // passed by main.js so the damage arc respects the camera transform.
  event(ev, now, toScreenAngle) {
    if (!ev || typeof ev !== 'object') return;
    switch (ev.e) {
      case 'hit':
        this._hitmarker();
        break;
      case 'dmg':
        this._damageArc(ev.a, toScreenAngle);
        break;
      case 'kill':
        this._banner('ELIMINATED ' + (cleanName(ev.v) || '???').toUpperCase());
        break;
      case 'feed':
        this._feed(ev);
        break;
      case 'pick':
        this._toast(ev.kind);
        break;
      default:
        break;
    }
  }

  _hitmarker() {
    const h = this.el.hitmarker;
    h.classList.remove('on');
    void h.offsetWidth; // restart CSS animation
    h.classList.add('on');
    if (this._hitT) clearTimeout(this._hitT);
    this._hitT = setTimeout(() => h.classList.remove('on'), HITMARKER_MS + 40);
  }

  _damageArc(a, toScreenAngle) {
    let ang = fin(a, 0);
    if (typeof toScreenAngle === 'function') {
      try {
        const c = Number(toScreenAngle(ang));
        if (Number.isFinite(c)) ang = c;
      } catch { /* fall back to world angle */ }
    }
    const R = Math.max(120, Math.min(window.innerWidth, window.innerHeight) / 2 - 70);
    const arc = el('div', 'dmg-arc');
    arc.style.transform =
      'rotate(' + ang.toFixed(4) + 'rad) translateX(' + Math.round(R) + 'px) translate(-50%,-50%)';
    this.el.dmgLayer.appendChild(arc);
    setTimeout(() => arc.remove(), DMG_ARC_MS + 60);
  }

  _banner(text) {
    const b = el('div', 'banner', text);
    this.el.banners.appendChild(b);
    while (this.el.banners.children.length > 4) this.el.banners.firstChild.remove();
    setTimeout(() => b.remove(), BANNER_MS);
  }

  _feed(ev) {
    const k = cleanName(ev.k) || '?';
    const v = cleanName(ev.v) || '?';
    const tok = FEED_TOKEN[ev.w] || FEED_TOKEN.body;
    const row = el('div', 'feed-row');
    const kEl = el('span', 'feed-k', k);
    const tEl = el('span', 'feed-w', '[' + tok + ']');
    const vEl = el('span', 'feed-v', v);
    if (this.playerName && k === this.playerName) kEl.classList.add('me');
    if (this.playerName && v === this.playerName) vEl.classList.add('me');
    row.append(kEl, tEl, vEl);
    this.el.feed.appendChild(row);
    while (this.el.feed.children.length > KILLFEED_MAX) this.el.feed.firstChild.remove();
    setTimeout(() => row.remove(), KILLFEED_MS);
  }

  _toast(kind) {
    const t = el('div', 'toast', '+ ' + this._kindLabel(kind));
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
    setTimeout(() => t.remove(), TOAST_MS);
  }

  _kindLabel(kind) {
    const k = String(kind ?? '');
    if (WEAPONS[k] && WEAPONS[k].name) return String(WEAPONS[k].name).toUpperCase();
    if (POWERS[k] && POWERS[k].name) return String(POWERS[k].name).toUpperCase();
    if (k === 'crate') return 'POWER CRATE';
    return (k || 'ITEM').toUpperCase();
  }

  // ------------------------------------------------------------ minimap

  // me: {x, y, a}; crates: array of [id,x,y,kind] tuples OR {x,y,kind} objects.
  // Non-crate item entries are skipped, so main.js may pass the raw `it` array.
  minimap(me, crates) {
    const ctx = this._mmCtx;
    if (!ctx) return;
    const S = MINIMAP_SIZE;
    const inset = 4;
    const sx = (S - inset * 2) / (WORLD.W || 1);
    const sy = (S - inset * 2) / (WORLD.H || 1);

    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(7, 9, 14, 0.92)';
    ctx.fillRect(0, 0, S, S);

    // world border
    ctx.strokeStyle = 'rgba(57, 255, 136, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(inset - 2, inset - 2, S - (inset - 2) * 2, S - (inset - 2) * 2);

    // gold crate dots
    if (Array.isArray(crates)) {
      ctx.fillStyle = '#ffd23f';
      for (let i = 0; i < crates.length; i++) {
        const c = crates[i];
        let x, y, kind;
        if (Array.isArray(c)) { x = c[1]; y = c[2]; kind = c[3]; }
        else if (c && typeof c === 'object') { x = c.x; y = c.y; kind = c.kind; }
        else continue;
        if (kind !== undefined && kind !== 'crate') continue;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        ctx.fillRect(Math.round(inset + x * sx) - 1, Math.round(inset + y * sy) - 1, 3, 3);
      }
    }

    // self: green dot + heading tick
    if (me && Number.isFinite(me.x) && Number.isFinite(me.y)) {
      const px = inset + me.x * sx;
      const py = inset + me.y * sy;
      const a = fin(me.a, 0);
      ctx.fillStyle = '#39ff88';
      ctx.fillRect(Math.round(px) - 2, Math.round(py) - 2, 4, 4);
      ctx.strokeStyle = '#39ff88';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * 8, py + Math.sin(a) * 8);
      ctx.stroke();
    }
  }
}
