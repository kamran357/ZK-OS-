// Fangs.io — client input (owner: CLIENTNET)
// Mouse steer (angle from canvas center), Space/RMB boost, LMB fire,
// touch drag steering, debug override hook. Browser ES module — no Node APIs.

// True while the user is typing in a form control (start-screen name input!).
function isTyping() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;

    this._mx = null; // last pointer clientX (null until first move)
    this._my = null;
    this._angle = 0; // last computed steer angle, kept when pointer is idle

    this._boostKey = false; // Space held
    this._boostBtn = false; // RMB held
    this._fire = false;     // LMB held

    this._override = null; // {a,b,f} — debug hook takes full priority

    this._bind();
  }

  // -> {a, b, f}  a = angle (rad) from canvas center to pointer;
  //               b = 1 while Space or RMB held; f = 1 while LMB held.
  state() {
    if (this._override) {
      return { a: this._override.a, b: this._override.b, f: this._override.f };
    }
    if (this._mx !== null && this.canvas) {
      const r = this.canvas.getBoundingClientRect();
      const dx = this._mx - (r.left + r.width / 2);
      const dy = this._my - (r.top + r.height / 2);
      if (dx !== 0 || dy !== 0) {
        const a = Math.atan2(dy, dx);
        if (Number.isFinite(a)) this._angle = a;
      }
    }
    return {
      a: Number.isFinite(this._angle) ? this._angle : 0,
      b: this._boostKey || this._boostBtn ? 1 : 0,
      f: this._fire ? 1 : 0,
    };
  }

  // Debug hook (window.__fangs.setInput routes here via main.js).
  // setOverride(null) clears, matching the __fangs contract.
  setOverride(a, b, f) {
    if (a === null || a === undefined) {
      this.clearOverride();
      return;
    }
    const na = +a;
    this._override = {
      a: Number.isFinite(na) ? na : 0,
      b: b ? 1 : 0,
      f: f ? 1 : 0,
    };
  }

  clearOverride() {
    this._override = null;
  }

  destroy() {
    for (const [target, type, fn, opts] of this._listeners) {
      target.removeEventListener(type, fn, opts);
    }
    this._listeners = [];
  }

  // ---- internals ----------------------------------------------------------

  _bind() {
    this._listeners = [];
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._listeners.push([target, type, fn, opts]);
    };
    const canvas = this.canvas;

    // Steering: track the pointer anywhere in the window so leaving the
    // canvas never freezes the steer angle mid-fight.
    on(window, 'mousemove', (e) => {
      this._mx = e.clientX;
      this._my = e.clientY;
    });

    // Buttons: press must START on the canvas (HUD is pointer-events:none in
    // game, so clicks land here; start/death screen buttons never register as
    // fire). Release is captured window-wide so buttons can't stick.
    on(canvas, 'mousedown', (e) => {
      if (e.button === 0) this._fire = true;
      else if (e.button === 2) this._boostBtn = true;
      e.preventDefault();
    });
    on(window, 'mouseup', (e) => {
      if (e.button === 0) this._fire = false;
      else if (e.button === 2) this._boostBtn = false;
    });
    on(canvas, 'contextmenu', (e) => e.preventDefault());

    // Space = boost. Ignored while typing in the start-screen name input.
    on(window, 'keydown', (e) => {
      if (e.code === 'Space' || e.key === ' ') {
        if (isTyping()) return;
        this._boostKey = true;
        e.preventDefault(); // stop page scroll / focused-button activation
      }
    });
    // keyup always clears, even if focus moved into an input mid-hold,
    // so boost can never stick on.
    on(window, 'keyup', (e) => {
      if (e.code === 'Space' || e.key === ' ') this._boostKey = false;
    });

    // Tab-away / app switch: drop every held state.
    on(window, 'blur', () => {
      this._boostKey = false;
      this._boostBtn = false;
      this._fire = false;
    });

    // Touch: drag steers. No boost, no fire (desktop-first per SPEC).
    // preventDefault suppresses synthetic mouse events (no phantom fire)
    // and page scrolling.
    const touchSteer = (e) => {
      const t = e.touches && e.touches[0];
      if (t) {
        this._mx = t.clientX;
        this._my = t.clientY;
      }
      e.preventDefault();
    };
    on(canvas, 'touchstart', touchSteer, { passive: false });
    on(canvas, 'touchmove', touchSteer, { passive: false });
    on(canvas, 'touchend', (e) => e.preventDefault(), { passive: false });
  }
}
