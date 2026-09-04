/* VIPER ARENA - WebAudio SFX. Oscillators only, no files.
   Autoplay-safe: context created lazily and resumed on first user gesture. */
(function () {
  'use strict';
  let ctx = null, master = null, mode = 'asmr', ready = false;
  const MODE_GAIN = { asmr: 0.13, arcade: 0.28, mute: 0 };

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = MODE_GAIN[mode];
    master.connect(ctx.destination);
    ready = true;
    return ctx;
  }

  // resume on gesture (browsers block audio until then)
  function unlock() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, unlock, { once: false, passive: true }));

  function tone(freq, dur, type, gain, sweep) {
    if (mode === 'mute' || !ready) return;
    const c = ensure(); if (!c || c.state !== 'running') return;
    const o = c.createOscillator();
    const g = c.createGain();
    const requestedType = type || 'square';
    o.type = mode === 'asmr'
      ? (requestedType === 'sawtooth' || requestedType === 'square' ? 'triangle' : requestedType)
      : requestedType;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * sweep), c.currentTime + dur);
    g.gain.setValueAtTime(0.0001, c.currentTime);
    const modeScale = mode === 'asmr' ? 0.58 : 1;
    g.gain.exponentialRampToValueAtTime((gain || 0.3) * modeScale, c.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(c.currentTime + dur + 0.02);
  }

  function noise(dur, gain, filterFreq) {
    if (mode === 'mute' || !ready) return;
    const c = ensure(); if (!c || c.state !== 'running') return;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = (gain || 0.3) * (mode === 'asmr' ? 0.22 : 1);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq || 1800;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }

  const SFX = {
    pistol() { tone(520, 0.09, 'square', 0.22, 0.4); noise(0.05, 0.12, 2600); },
    smg() { tone(420, 0.05, 'square', 0.16, 0.5); noise(0.03, 0.09, 3200); },
    shotgun() { noise(0.18, 0.4, 1200); tone(140, 0.16, 'sawtooth', 0.3, 0.3); },
    railgun: null, rail() { tone(180, 0.35, 'sawtooth', 0.3, 3.2); noise(0.2, 0.18, 4200); },
    flamethrower() { noise(0.09, 0.14, 900); },
    pellet() { tone(880, 0.08, 'sine', 0.22, 1.6); tone(1320, 0.06, 'sine', 0.15, 1.4); },
    pickup() { tone(660, 0.09, 'triangle', 0.25, 1.5); tone(990, 0.11, 'triangle', 0.22, 1.6); },
    tick() { tone(1700, 0.03, 'square', 0.16, 1); },
    kill() { tone(300, 0.12, 'sawtooth', 0.28, 2.4); tone(150, 0.18, 'square', 0.22, 0.5); },
    hurt() { tone(200, 0.14, 'sawtooth', 0.3, 0.4); noise(0.08, 0.16, 800); },
    death() { tone(220, 0.7, 'sawtooth', 0.35, 0.2); noise(0.5, 0.2, 600); },
    wave() { tone(440, 0.12, 'triangle', 0.25, 1.4); setTimeout(() => tone(660, 0.14, 'triangle', 0.25, 1.4), 90); },
    bossWave() {
      tone(110, 0.6, 'sawtooth', 0.34, 2.1);
      setTimeout(() => tone(165, 0.42, 'triangle', 0.28, 1.6), 180);
    },
    bossKill() {
      tone(160, 0.5, 'triangle', 0.35, 3.4);
      setTimeout(() => tone(520, 0.42, 'sine', 0.28, 1.7), 120);
      setTimeout(() => tone(880, 0.5, 'sine', 0.22, 1.25), 250);
    }
  };

  function setMode(nextMode) {
    mode = MODE_GAIN[nextMode] === undefined ? 'asmr' : nextMode;
    unlock();
    if (master && ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(MODE_GAIN[mode], ctx.currentTime, 0.025);
    }
    return mode;
  }

  window.VAudio = {
    play(name) {
      const fn = SFX[name];
      if (typeof fn === 'function') fn();
      else if (name === 'railgun') SFX.rail();
    },
    setMode,
    getMode() { return mode; },
    cycleMode() {
      const modes = ['asmr', 'arcade', 'mute'];
      return setMode(modes[(modes.indexOf(mode) + 1) % modes.length]);
    },
    toggleMute() { return setMode(mode === 'mute' ? 'asmr' : 'mute') === 'mute'; },
    isMuted() { return mode === 'mute'; },
    unlock
  };
})();
