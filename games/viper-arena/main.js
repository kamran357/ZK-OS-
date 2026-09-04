/* VIPER ARENA - browser glue, profile persistence, local leaderboard, loadouts,
   sound modes, responsive controls, HUD, RAF loop, and test surface. */
(function () {
  'use strict';

  const VIPER = window.VIPER;
  const VRender = window.VRender;
  const VAudio = window.VAudio || {
    play: function () {}, unlock: function () {}, setMode: function () { return 'mute'; },
    getMode: function () { return 'mute'; }, cycleMode: function () { return 'mute'; }
  };
  const DT = VIPER.DT, W = VIPER.W, H = VIPER.H;
  const WEAPONS = VIPER.WEAPONS;
  const LOADOUTS = VIPER.LOADOUTS;
  const PROFILE_KEY = 'viper_arena_profile_v3';
  const SCORES_KEY = 'viper_arena_scores_v3';
  const COOKIE_NAME = 'viper_pilot';
  const MAX_STEPS = 6;

  const $ = function (id) { return document.getElementById(id); };
  const canvas = $('game');
  const minimap = $('minimap');
  const el = {
    hud: $('hud'), score: $('hud-score'), wave: $('hud-wave'), combo: $('hud-combo'),
    enemies: $('hud-enemies'), progress: $('hud-progress'), mission: $('hud-mission'),
    player: $('hud-player'), banner: $('wave-banner'), healthFill: $('health-fill'),
    healthNum: $('hud-health-num'), weapon: $('hud-weapon'), ammo: $('hud-ammo'),
    loadout: $('hud-loadout'), bossMeter: $('boss-meter'), bossName: $('boss-name'),
    bossFill: $('boss-fill'), bossHpText: $('boss-hp-text'), soundToggle: $('sound-toggle'),
    title: $('title'), username: $('username'), usernameError: $('username-error'),
    btnStart: $('btn-start'), leaderboard: $('leaderboard'),
    gameover: $('gameover'), deathCause: $('death-cause'), finalPlayer: $('final-player'),
    finalScore: $('final-score'), finalWave: $('final-wave'), finalKills: $('final-kills'),
    rankResult: $('rank-result'), btnRestart: $('btn-restart')
  };

  const renderer = new VRender.Renderer(canvas, minimap);
  const keys = { up: false, down: false, left: false, right: false };
  const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, has: false };
  let profile = loadProfile();
  let leaderboard = loadScores();
  let game = null;
  let running = false;
  let started = false;
  let firing = false;
  let touchMode = false;
  let acc = 0;
  let lastT = 0;
  let waveBannerT = 0;
  let bannerText = '';
  let runSaved = false;

  function safeRead(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeWrite(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (_) { return false; }
  }

  function readCookie(name) {
    const prefix = name + '=';
    const entry = document.cookie.split(';').map(function (part) { return part.trim(); })
      .find(function (part) { return part.indexOf(prefix) === 0; });
    return entry ? decodeURIComponent(entry.slice(prefix.length)) : '';
  }

  function writePilotCookie(name) {
    document.cookie = COOKIE_NAME + '=' + encodeURIComponent(name) +
      '; Max-Age=31536000; Path=/; SameSite=Lax';
  }

  function normalizeName(value) {
    return String(value || '')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 16);
  }

  function loadProfile() {
    let saved = null;
    try { saved = JSON.parse(safeRead(PROFILE_KEY) || 'null'); } catch (_) { saved = null; }
    const cookieName = normalizeName(readCookie(COOKIE_NAME));
    return {
      name: normalizeName(saved && saved.name) || cookieName || '',
      loadout: LOADOUTS[saved && saved.loadout] ? saved.loadout : 'overdrive',
      sound: ['asmr', 'arcade', 'mute'].includes(saved && saved.sound) ? saved.sound : 'asmr'
    };
  }

  function saveProfile() {
    safeWrite(PROFILE_KEY, JSON.stringify(profile));
    writePilotCookie(profile.name);
  }

  function loadScores() {
    try {
      const parsed = JSON.parse(safeRead(SCORES_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (entry) {
        return entry && typeof entry.score === 'number' && normalizeName(entry.name);
      }).map(function (entry) {
        return {
          name: normalizeName(entry.name),
          score: Math.max(0, Math.round(entry.score)),
          wave: Math.max(0, Math.round(entry.wave || 0)),
          kills: Math.max(0, Math.round(entry.kills || 0)),
          loadout: LOADOUTS[entry.loadout] ? entry.loadout : 'overdrive',
          at: Number(entry.at) || 0
        };
      }).sort(scoreSort).slice(0, 10);
    } catch (_) {
      return [];
    }
  }

  function scoreSort(a, b) {
    return b.score - a.score || b.wave - a.wave || b.kills - a.kills || a.at - b.at;
  }

  function archiveRun(state) {
    const entry = {
      name: profile.name,
      score: state.score,
      wave: state.wave,
      kills: game.kills,
      loadout: profile.loadout,
      at: Date.now()
    };
    leaderboard.push(entry);
    leaderboard.sort(scoreSort);
    leaderboard = leaderboard.slice(0, 10);
    safeWrite(SCORES_KEY, JSON.stringify(leaderboard));
    return leaderboard.indexOf(entry) + 1;
  }

  function renderLeaderboard() {
    el.leaderboard.replaceChildren();
    if (!leaderboard.length) {
      const empty = document.createElement('li');
      empty.className = 'leaderboard-empty';
      empty.textContent = 'NO RUNS YET — CLAIM THE BOARD';
      el.leaderboard.appendChild(empty);
      return;
    }
    leaderboard.slice(0, 7).forEach(function (entry, index) {
      const row = document.createElement('li');
      const rank = document.createElement('span');
      const pilot = document.createElement('span');
      const score = document.createElement('strong');
      rank.textContent = String(index + 1).padStart(2, '0');
      pilot.textContent = entry.name;
      score.textContent = entry.score.toLocaleString();
      row.append(rank, pilot, score);
      el.leaderboard.appendChild(row);
    });
  }

  function syncMenu() {
    el.username.value = profile.name;
    document.querySelectorAll('[data-loadout]').forEach(function (button) {
      const selected = button.dataset.loadout === profile.loadout;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    document.querySelectorAll('[data-sound-mode]').forEach(function (button) {
      const selected = button.dataset.soundMode === profile.sound;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    VAudio.setMode(profile.sound);
    updateSoundLabel();
    renderLeaderboard();
  }

  function updateSoundLabel() {
    const mode = (VAudio.getMode ? VAudio.getMode() : profile.sound).toUpperCase();
    el.soundToggle.textContent = 'SOUND · ' + mode;
    el.soundToggle.setAttribute('aria-label', 'Sound mode ' + mode + '. Activate to change.');
  }

  function setKey(code, down) {
    const keymap = {
      KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
      KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right'
    };
    const dir = keymap[code];
    if (dir) { keys[dir] = down; return true; }
    if (code === 'Space') { firing = down; return true; }
    if (code === 'KeyR' && down && started) { restartDirect(); return true; }
    return false;
  }

  window.addEventListener('keydown', function (event) {
    if (setKey(event.code, true)) event.preventDefault();
  });
  window.addEventListener('keyup', function (event) {
    if (setKey(event.code, false)) event.preventDefault();
  });
  window.addEventListener('mousemove', function (event) {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    mouse.has = true;
    touchMode = false;
  });
  window.addEventListener('mousedown', function (event) {
    if (event.button === 0 && !event.target.closest('button, input')) firing = true;
  });
  window.addEventListener('mouseup', function (event) {
    if (event.button === 0) firing = false;
  });
  window.addEventListener('blur', resetInput);
  window.addEventListener('resize', function () { renderer.resize(); });

  function resetInput() {
    keys.up = keys.down = keys.left = keys.right = false;
    firing = false;
  }

  document.querySelectorAll('[data-loadout]').forEach(function (button) {
    button.addEventListener('click', function () {
      profile.loadout = button.dataset.loadout;
      syncMenu();
    });
  });

  document.querySelectorAll('[data-sound-mode]').forEach(function (button) {
    button.addEventListener('click', function () {
      profile.sound = button.dataset.soundMode;
      VAudio.setMode(profile.sound);
      syncMenu();
    });
  });

  el.soundToggle.addEventListener('click', function () {
    profile.sound = VAudio.cycleMode();
    saveProfile();
    syncMenu();
  });

  el.btnStart.addEventListener('click', start);
  el.username.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') start();
  });
  el.btnRestart.addEventListener('click', function () {
    running = false;
    started = false;
    resetInput();
    el.gameover.classList.add('hidden');
    el.hud.classList.add('hidden');
    el.title.classList.remove('hidden');
    renderLeaderboard();
    el.btnStart.focus();
  });

  document.querySelectorAll('[data-touch-key]').forEach(function (button) {
    const dir = button.dataset.touchKey;
    const down = function (event) {
      event.preventDefault();
      touchMode = true;
      keys[dir] = true;
      button.classList.add('pressed');
      if (button.setPointerCapture && event.pointerId !== undefined) button.setPointerCapture(event.pointerId);
    };
    const up = function (event) {
      event.preventDefault();
      keys[dir] = false;
      button.classList.remove('pressed');
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
  });

  const touchFire = document.querySelector('[data-touch-fire]');
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (type) {
    touchFire.addEventListener(type, function (event) {
      event.preventDefault();
      firing = false;
      touchFire.classList.remove('pressed');
    });
  });
  touchFire.addEventListener('pointerdown', function (event) {
    event.preventDefault();
    touchMode = true;
    firing = true;
    touchFire.classList.add('pressed');
    if (touchFire.setPointerCapture && event.pointerId !== undefined) touchFire.setPointerCapture(event.pointerId);
  });

  function currentAimWorld() {
    if (touchMode && game) {
      const head = game.player.pts[0];
      let target = null;
      let best = Infinity;
      game.enemies.forEach(function (enemy) {
        if (!enemy.alive) return;
        const enemyHead = enemy.pts[0];
        const d = Math.hypot(enemyHead.x - head.x, enemyHead.y - head.y);
        if (d < best) { best = d; target = enemyHead; }
      });
      if (target) return { x: target.x, y: target.y };
    }
    const ox = renderer.camX - renderer.vw / 2;
    const oy = renderer.camY - renderer.vh / 2;
    return { x: mouse.x + ox, y: mouse.y + oy };
  }

  function newGame() {
    game = new VIPER.Game((Date.now() & 0xffffff) || 1337, { loadout: profile.loadout });
    renderer.camX = game.player.pts[0].x;
    renderer.camY = game.player.pts[0].y;
    renderer.particles.length = 0;
    renderer.shake = 0;
    renderer.vignette = 0;
    waveBannerT = 0;
    bannerText = '';
    acc = 0;
    runSaved = false;
  }

  function start() {
    const name = normalizeName(el.username.value);
    if (name.length < 2) {
      el.usernameError.textContent = 'ENTER A CALLSIGN WITH AT LEAST 2 CHARACTERS.';
      el.username.focus();
      return false;
    }
    profile.name = name;
    profile.sound = VAudio.getMode ? VAudio.getMode() : profile.sound;
    saveProfile();
    el.usernameError.textContent = '';
    VAudio.setMode(profile.sound);
    VAudio.unlock();
    newGame();
    started = true;
    running = true;
    el.title.classList.add('hidden');
    el.gameover.classList.add('hidden');
    el.hud.classList.remove('hidden');
    lastT = performance.now();
    return true;
  }

  function restartDirect() {
    if (!started) return start();
    VAudio.unlock();
    newGame();
    running = true;
    el.gameover.classList.add('hidden');
    el.hud.classList.remove('hidden');
    lastT = performance.now();
    return true;
  }

  function gameOverScreen() {
    running = false;
    const state = game.getState();
    let rank = 0;
    if (!runSaved) {
      rank = archiveRun(state);
      runSaved = true;
      renderLeaderboard();
    }
    const best = leaderboard.filter(function (entry) { return entry.name === profile.name; })[0];
    const personalBest = best ? best.score : state.score;
    el.finalPlayer.textContent = 'PILOT // ' + profile.name;
    el.deathCause.textContent = 'KILLED BY ' + (game.deathCause || 'THE ARENA');
    el.finalScore.textContent = state.score.toLocaleString();
    el.finalWave.textContent = state.wave;
    el.finalKills.textContent = game.kills;
    el.rankResult.textContent = rank > 0 && rank <= 10
      ? ('LOCAL RANK #' + rank + ' · PERSONAL BEST ' + personalBest.toLocaleString())
      : ('RUN ARCHIVED · PERSONAL BEST ' + personalBest.toLocaleString());
    el.gameover.classList.remove('hidden');
  }

  function processEvents() {
    const events = game.events;
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (event.type === 'sfx') VAudio.play(event.name);
      else if (event.type === 'wave' || event.type === 'bossWave') {
        bannerText = event.title || ('WAVE ' + event.wave);
        waveBannerT = event.type === 'bossWave' ? 2.25 : 1.1;
        VAudio.play(event.type === 'bossWave' ? 'bossWave' : 'wave');
      }
    }
    renderer.consume(events);
    events.length = 0;
  }

  function updateHud() {
    const state = game.getState();
    el.score.textContent = state.score.toLocaleString();
    el.wave.textContent = state.wave || 1;
    el.player.textContent = profile.name.toUpperCase();
    el.progress.textContent = state.waveKills + ' / ' + state.waveGoal;
    el.enemies.textContent = state.enemyCount + (state.enemyCount === 1 ? ' HOSTILE LIVE' : ' HOSTILES LIVE');
    el.mission.textContent = state.missionName;
    el.combo.textContent = game.combo > 1.05 ? ('COMBO x' + game.combo.toFixed(1)) : '';

    const health = Math.max(0, Math.min(100, (state.health / (game.player.maxHp || 100)) * 100));
    el.healthFill.style.width = health + '%';
    el.healthFill.classList.toggle('low', health <= 30);
    el.healthNum.textContent = state.health + ' / ' + game.player.maxHp;
    el.loadout.textContent = LOADOUTS[state.loadout].name;
    el.loadout.style.setProperty('--loadout-color', LOADOUTS[state.loadout].color);

    const weapon = WEAPONS[state.weapon];
    el.weapon.textContent = weapon ? weapon.name : state.weapon.toUpperCase();
    if (state.ammo === Infinity || state.ammo === null) {
      el.ammo.innerHTML = '&#8734;';
      el.ammo.classList.remove('empty');
    } else {
      el.ammo.textContent = state.ammo;
      el.ammo.classList.toggle('empty', state.ammo <= 5);
    }

    if (state.bossName) {
      const ratio = state.bossMaxHp ? Math.max(0, state.bossHp / state.bossMaxHp) : 0;
      el.bossMeter.classList.remove('hidden');
      el.bossName.textContent = state.bossName;
      el.bossHpText.textContent = Math.round(ratio * 100) + '%';
      el.bossFill.style.width = (ratio * 100) + '%';
    } else {
      el.bossMeter.classList.add('hidden');
    }

    if (waveBannerT > 0) {
      el.banner.textContent = bannerText;
      el.banner.classList.remove('hidden');
    } else {
      el.banner.classList.add('hidden');
    }
  }

  function tick() {
    game.applyKeys(keys);
    const aim = currentAimWorld();
    game.setAim(aim.x, aim.y);
    game.setFire(firing);
    game.step();
    processEvents();
    if (waveBannerT > 0) waveBannerT -= DT;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!started || !game) return;
    let delta = (now - lastT) / 1000;
    lastT = now;
    if (delta > 0.25) delta = 0.25;

    if (running && !game.gameOver) {
      acc += delta;
      let steps = 0;
      while (acc >= DT && steps < MAX_STEPS) {
        tick();
        acc -= DT;
        steps++;
      }
      if (steps === MAX_STEPS) acc = 0;
    } else if (running && game.gameOver) {
      game.step();
      processEvents();
      gameOverScreen();
    }

    const head = game.player.pts[0];
    renderer.update(delta, head.x, head.y);
    renderer.draw(game);
    updateHud();
  }

  syncMenu();
  requestAnimationFrame(frame);

  window.__viper = {
    start: start,
    restart: restartDirect,
    state: function () {
      if (!game) return {
        alive: false, score: 0, wave: 0, health: 0, ammo: 0,
        weapon: 'pistol', headX: 0, headY: 0, enemyCount: 0
      };
      return game.getState();
    },
    profile: function () { return Object.assign({}, profile); },
    setProfile: function (name, loadout, sound) {
      profile.name = normalizeName(name);
      if (LOADOUTS[loadout]) profile.loadout = loadout;
      if (['asmr', 'arcade', 'mute'].includes(sound)) profile.sound = sound;
      syncMenu();
      saveProfile();
      return Object.assign({}, profile);
    },
    scores: function () { return leaderboard.slice(); },
    key: function (code, down) { setKey(code, !!down); return Object.assign({}, keys); },
    aim: function (x, y) {
      mouse.x = x; mouse.y = y; mouse.has = true; touchMode = false;
      return { x: x, y: y };
    },
    aimWorld: function (worldX, worldY) {
      const ox = renderer.camX - renderer.vw / 2;
      const oy = renderer.camY - renderer.vh / 2;
      mouse.x = worldX - ox;
      mouse.y = worldY - oy;
      touchMode = false;
      return { x: mouse.x, y: mouse.y };
    },
    fire: function () {
      if (!game) return false;
      firing = true; tick(); firing = false; return true;
    },
    setFire: function (down) { firing = !!down; return firing; },
    spawnCrate: function (type) { return game ? game.spawnCrate(type) : null; },
    spawnEnemy: function () { return game ? game.spawnEnemy() : null; },
    forceWave: function (wave) {
      if (!game || wave < 1) return false;
      game.enemies.forEach(function (enemy) { enemy.alive = false; });
      game.wave = Math.round(wave) - 1;
      game.betweenWaves = true;
      game.waveCountdown = 0;
      tick();
      return game.getState();
    },
    tick: function (count) {
      const steps = Math.max(1, Math.round(count || 1));
      for (let index = 0; index < steps; index++) {
        if (!game || game.gameOver) break;
        tick();
      }
      return game ? game.getState() : null;
    },
    game: function () { return game; },
    renderer: function () { return renderer; }
  };
})();
