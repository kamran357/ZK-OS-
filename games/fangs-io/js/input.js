// Fangs.io — input. Steer toward pointer; hold LMB / Space / 2nd touch to boost.
// Equipped weapons AUTO-FIRE toward heading (game loop drives it) — one-handed play.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.mx = window.innerWidth / 2;
    this.my = window.innerHeight / 2 - 120; // point "up" until the mouse moves
    this.boostKey = false;
    this.boostMouse = false;
    this.boostTouch = false;
    this.enabled = false;

    const onMove = (e) => { this.mx = e.clientX; this.my = e.clientY; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', (e) => { if (e.button === 0) this.boostMouse = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.boostMouse = false; });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => { if (e.code === 'Space') { this.boostKey = true; e.preventDefault(); } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.boostKey = false; });
    window.addEventListener('blur', () => { this.boostKey = this.boostMouse = this.boostTouch = false; });

    const touch = (e) => {
      if (!e.touches || e.touches.length === 0) return;
      const t = e.touches[0];
      this.mx = t.clientX; this.my = t.clientY;
      this.boostTouch = e.touches.length >= 2;
      e.preventDefault();
    };
    canvas.addEventListener('touchstart', touch, { passive: false });
    canvas.addEventListener('touchmove', touch, { passive: false });
    canvas.addEventListener('touchend', (e) => { this.boostTouch = (e.touches && e.touches.length >= 2); }, { passive: false });
  }

  setBoost(v) { this.boostTouch = !!v; } // for on-screen mobile button

  state() {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const a = Math.atan2(this.my - cy, this.mx - cx);
    const b = this.boostKey || this.boostMouse || this.boostTouch ? 1 : 0;
    return { a, b, f: 1 };
  }
}
