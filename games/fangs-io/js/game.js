// Fangs.io — main orchestrator. Client-only local sim + render + HUD.
import { loadSprites } from './sprites.js';
import { World } from './world.js';
import { BotController } from './bots.js';
import { Renderer } from './render.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { fireWeapon, applyPower } from './combat.js';
import { WEAPONS, POWERS, SPAWN } from '../shared/constants.js';

const STEP = 1 / 60;

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.state = 'loading';
    this.simNow = 0;
    this.acc = 0;
    this.last = performance.now();
    this.fps = 60;
    this._inputOverride = null;
    this._events = [];
    this._respawnReadyAt = 0;
  }

  async boot() {
    this.sprites = await loadSprites();
    this.world = new World();
    this.world.bots = new BotController(this.world);
    this.world.onPlayerDead = (s) => this.onDeath(s);
    this.renderer = new Renderer(this.canvas, this.sprites);
    this.input = new Input(this.canvas);
    this.hud = new HUD(document.getElementById('hud'));

    window.addEventListener('resize', () => { this.renderer.resize(); this.hud.resize(); });
    this.wireUI();
    this.renderHighScores();
    this.exposeDebug();

    this.state = 'menu';
    document.body.classList.add('menu-open');
    document.getElementById('boot').classList.add('hidden');
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  wireUI() {
    const menu = document.getElementById('menu');
    const nameInput = document.getElementById('nameInput');
    const saved = localStorage.getItem('fangs_name');
    if (saved) nameInput.value = saved;
    this.skin = parseInt(localStorage.getItem('fangs_skin') || '0', 10) || 0;
    const dots = [...document.querySelectorAll('.skinDot')];
    const setSkin = (i) => { this.skin = i; dots.forEach((d, j) => d.classList.toggle('sel', j === i)); localStorage.setItem('fangs_skin', i); };
    dots.forEach((d, i) => d.addEventListener('click', () => setSkin(i)));
    setSkin(this.skin);

    document.getElementById('playBtn').addEventListener('click', () => {
      const name = (nameInput.value || '').trim().slice(0, 16) || 'Player';
      localStorage.setItem('fangs_name', name);
      this.play(name, this.skin);
    });
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('playBtn').click(); });

    document.getElementById('respawnBtn').addEventListener('click', () => this.respawn());
    document.getElementById('menuBtn').addEventListener('click', () => this.toMenu());
    // mobile boost button
    const bb = document.getElementById('boostBtn');
    if (bb) {
      const on = (v) => (e) => { this.input.setBoost(v); e.preventDefault(); };
      bb.addEventListener('touchstart', on(true), { passive: false });
      bb.addEventListener('touchend', on(false), { passive: false });
      bb.addEventListener('mousedown', on(true));
      bb.addEventListener('mouseup', on(false));
    }
  }

  play(name, skin) {
    if (this.state === 'playing') return;
    if (!this.world.player) this.world.addPlayer(name, skin);
    else { this.world.player.name = name; this.world.player.skin = skin & 7; this.world.respawnPlayer(); }
    window.__fangsPlayerId = this.world.playerId;
    this.renderer.cam.x = this.world.player.head().x;
    this.renderer.cam.y = this.world.player.head().y;
    this.state = 'playing';
    document.body.classList.remove('menu-open');
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('death').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
  }

  onDeath(snake) {
    this.state = 'dead';
    const d = document.getElementById('death');
    document.getElementById('deathKiller').textContent =
      snake.deadReason === 'border' ? 'You hit the wall' : 'Eaten by ' + (snake.killerName || 'a snake');
    document.getElementById('deathLen').textContent = snake.lenSegs();
    document.getElementById('deathKills').textContent = snake.kills;
    document.getElementById('deathBest').textContent = Math.floor(snake.best);
    const rank = this.saveHighScore(snake);
    const rankLabel = document.getElementById('deathRank');
    if (rankLabel) rankLabel.textContent = rank ? `LOCAL LEADERBOARD · RANK #${rank}` : 'RUN SAVED TO LOCAL LEADERBOARD';
    d.classList.remove('hidden');
    this._respawnReadyAt = performance.now() + SPAWN.RESPAWN_COOLDOWN_MS;
    const btn = document.getElementById('respawnBtn');
    btn.disabled = true;
  }

  highScores() {
    try {
      const scores = JSON.parse(localStorage.getItem('fangs_high_scores') || '[]');
      return Array.isArray(scores) ? scores.filter(s => s && Number.isFinite(Number(s.score))).slice(0, 8) : [];
    } catch (_) {
      return [];
    }
  }

  saveHighScore(snake) {
    const name = String(snake.name || localStorage.getItem('fangs_name') || 'Player').slice(0, 16);
    const length = Math.floor(snake.best);
    const kills = Math.max(0, Math.floor(snake.kills || 0));
    const entry = { name, length, kills, score: length + kills * 25, at: Date.now() };
    const scores = [...this.highScores(), entry].sort((a, b) => b.score - a.score || b.kills - a.kills || b.length - a.length).slice(0, 8);
    localStorage.setItem('fangs_high_scores', JSON.stringify(scores));
    this.renderHighScores(scores);
    return scores.indexOf(entry) + 1;
  }

  renderHighScores(scores = this.highScores()) {
    const list = document.getElementById('scoreList');
    if (!list) return;
    list.replaceChildren();
    if (!scores.length) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      const score = document.createElement('b');
      span.textContent = 'NO RUNS YET';
      score.textContent = '0000';
      li.append(span, score);
      list.append(li);
      return;
    }
    scores.slice(0, 5).forEach((entry, index) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      const score = document.createElement('b');
      span.textContent = `${index + 1}. ${entry.name}`;
      score.textContent = String(entry.score).padStart(4, '0');
      li.append(span, score);
      list.append(li);
    });
  }

  respawn() {
    if (performance.now() < this._respawnReadyAt) return;
    this.world.respawnPlayer();
    this.renderer.cam.x = this.world.player.head().x;
    this.renderer.cam.y = this.world.player.head().y;
    this.state = 'playing';
    document.getElementById('death').classList.add('hidden');
  }

  toMenu() {
    this.state = 'menu';
    document.body.classList.add('menu-open');
    document.getElementById('death').classList.add('hidden');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
  }

  loop(t) {
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (dt > 0.1) dt = 0.1;
    this.fps = this.fps * 0.9 + (1 / Math.max(1e-3, dt)) * 0.1;

    this.acc += dt;
    let iters = 0;
    while (this.acc >= STEP && iters++ < 5) {
      this.simulate(STEP);
      this.acc -= STEP;
    }

    this.renderer.render(this.world, dt);
    const now = performance.now();
    if (this.state === 'playing' || this.state === 'dead') {
      this.hud.tick(now, this.world.player);
      if (!this._lastHudUpd || now - this._lastHudUpd > 80) { this.hud.update(this.world); this._lastHudUpd = now; }
    }
    // respawn countdown
    if (this.state === 'dead') {
      const left = Math.max(0, this._respawnReadyAt - now);
      const btn = document.getElementById('respawnBtn');
      if (left > 0) btn.textContent = 'RESPAWN IN ' + (left / 1000).toFixed(1) + 's';
      else { btn.textContent = 'RESPAWN'; btn.disabled = false; }
    }

    requestAnimationFrame((tt) => this.loop(tt));
  }

  simulate(dt) {
    this.simNow += dt * 1000;
    const p = this.world.player;
    if (this.state === 'playing' && p && p.alive) {
      const inp = this._inputOverride || this.input.state();
      p.input.a = inp.a; p.input.b = inp.b; p.input.f = inp.f;
      // weapons auto-fire toward heading
      if (p.weapon || (p.power && p.power.key === 'shrink')) fireWeapon(this.world, p);
    }
    this.world.step(dt, this.simNow);

    // route events to HUD (player-relevant + global killfeed)
    const evs = this.world.drainEvents();
    for (const ev of evs) {
      if (ev.e === 'feed') { this.hud && this.hud.event(ev, this.simNow); this._pushEv(ev); }
      else if (ev.who === this.world.playerId) { this.hud && this.hud.event(ev, this.simNow); this._pushEv(ev); }
    }
  }

  _pushEv(ev) { this._events.push(ev); if (this._events.length > 50) this._events.shift(); }

  // ---- debug hook for Playwright playtesting ----
  exposeDebug() {
    const g = this;
    window.__fangs = {
      getMe() {
        const p = g.world.player;
        if (!p) return null;
        const h = p.head();
        return { x: h.x, y: h.y, a: p.angle, len: p.lenSegs(), best: Math.floor(p.best), kills: p.kills, alive: p.alive,
          weapon: p.weapon ? p.weapon.key : null, ammo: p.weapon ? p.weapon.ammo : 0, power: p.power ? p.power.key : null, boost: p.boostOn };
      },
      state() {
        return { state: g.state, snakes: g.world.snakes.size, food: g.world.food.size, items: g.world.items.size,
          projs: g.world.projectiles.size, fps: Math.round(g.fps) };
      },
      setInput(a, b, f) { g._inputOverride = (a === null || a === undefined) ? null : { a, b: b || 0, f: f == null ? 1 : f }; },
      play(name, skin) { g.play(name || 'Tester', skin || 0); },
      respawn() { g._respawnReadyAt = 0; g.respawn(); },
      giveWeapon(k) { const key = WEAPONS[k] ? k : 'blaster'; if (g.world.player) g.world.player.weapon = { key, ammo: WEAPONS[key].ammo }; },
      givePower(k) { if (g.world.player && POWERS[k]) applyPower(g.world, g.world.player, k); },
      spawnBotNear(dist = 200) {
        const p = g.world.player; if (!p) return;
        const h = p.head(); const s = g.world.addSnake('Dummy', 1, true);
        s._seed(h.x + dist, h.y, Math.PI); s.spawnProtectedUntil = 0; return s.id;
      },
      get events() { return g._events.slice(); },
      // deterministic stepping for headless/tabbed-out testing (rAF pauses when hidden)
      advance(ms) {
        const frames = Math.max(1, Math.round((ms || 1000) / 1000 * 60));
        for (let i = 0; i < frames; i++) g.simulate(STEP);
        try {
          g.renderer.render(g.world, STEP);
          if (g.hud && (g.state === 'playing' || g.state === 'dead')) { g.hud.tick(performance.now(), g.world.player); g.hud.update(g.world); }
        } catch (e) {}
        return { simNow: g.simNow, worldNow: g.world.now, frames };
      },
      world: g.world,
    };
  }
}

const game = new Game();
window.__game = game;
game.boot().catch((e) => {
  console.error('boot failed', e);
  const b = document.getElementById('boot');
  if (b) b.textContent = 'Failed to load: ' + e.message;
});
