// Fangs.io — bot AI. Local snakes that keep the arena alive and dangerous.
import { WORLD, SNAKE, BOTS } from '../shared/constants.js';
import { dist, angDiff, rand, randInt, pick, TAU } from './util.js';
import { fireWeapon } from './combat.js';

const NAMES = [
  'Viper', 'Kaa', 'Slynk', 'Rattlr', 'NoodleKing', 'Danger', 'Zephyr', 'Coilz', 'MambaX',
  'HissMe', 'Fang', 'PythonPro', 'Sidewind', 'Venom', 'Sir Slither', 'Boa', 'Cobra', 'Nyx',
  'Slitherin', 'GreenGhost', 'TailGunz', 'Ouro', 'Basilisk', 'Adder', 'Wriggle', 'Slink',
  'Copperhead', 'DrBite', 'Serpentine', 'Slippy', 'Krait', 'Anaconda', 'Snek', 'Ziggy',
  'Toxin', 'Reaper', 'Whiplash', 'Loop', 'Diablo', 'Mercury',
];

export class BotController {
  constructor(world) {
    this.world = world;
    this._respawnQueue = 0; // ms accumulator gate
    for (let i = 0; i < BOTS.COUNT; i++) this.spawnBot();
  }

  spawnBot() {
    const name = pick(NAMES) + (Math.random() < 0.3 ? randInt(1, 99) : '');
    const skin = randInt(0, 7);
    this.world.addSnake(name, skin, true);
  }

  countBots() {
    let n = 0;
    for (const s of this.world.snakes.values()) if (s.isBot && s.alive) n++;
    return n;
  }

  step(dt) {
    const w = this.world;
    // refill dead bots (respawn cadence)
    this._respawnQueue -= dt * 1000;
    if (this.countBots() < BOTS.COUNT && this._respawnQueue <= 0) {
      this.spawnBot();
      this._respawnQueue = BOTS.RESPAWN_MS / 2;
    }
    for (const s of w.snakes.values()) {
      if (!s.isBot || !s.alive) continue;
      this.brain(s, dt);
    }
  }

  brain(s, dt) {
    const w = this.world;
    const h = s.head();
    let targetA = s.angle;
    let boost = false;
    let fire = 0;

    // 1) border avoidance (highest priority) — steer toward center
    const margin = 320;
    const nearBorder = h.x < margin || h.y < margin || h.x > WORLD.W - margin || h.y > WORLD.H - margin;
    if (nearBorder) {
      targetA = Math.atan2(WORLD.H / 2 - h.y, WORLD.W / 2 - h.x);
      s.input.a = targetA; s.input.b = 0; s.input.f = 0;
      return;
    }

    // gather nearby snakes once
    let flee = null, fleeD = 520, enemy = null, enemyD = 640, bodyThreat = null;
    const look = h.x + Math.cos(s.angle) * 90;
    const looky = h.y + Math.sin(s.angle) * 90;
    for (const o of w.snakes.values()) {
      if (o === s || !o.alive) continue;
      const oh = o.head();
      const d = dist(h.x, h.y, oh.x, oh.y);
      if (o.lenSegs() > s.lenSegs() * 1.12 && d < fleeD) { fleeD = d; flee = o; }
      if (d < enemyD) { enemyD = d; enemy = o; }
      // body-ahead threat: is our look point near this snake's body?
      if (d < 400) {
        const segs = o.segments();
        for (let i = 0; i < segs.length; i += 3) {
          if (dist(look, looky, segs[i].x, segs[i].y) < s.radius() + 26) { bodyThreat = segs[i]; break; }
        }
      }
      if (bodyThreat) break;
    }

    if (bodyThreat) {
      // veer away from the body point ahead
      const away = Math.atan2(h.y - bodyThreat.y, h.x - bodyThreat.x);
      const side = angDiff(s.angle, away) >= 0 ? 1 : -1;
      targetA = s.angle + side * 1.1;
      s.input.a = targetA; s.input.b = 1; s.input.f = 0;
      return;
    }

    if (flee) {
      const fh = flee.head();
      targetA = Math.atan2(h.y - fh.y, h.x - fh.x);
      boost = s.lenSegs() > SNAKE.MIN_SEGS + 2 && fleeD < 340;
      s.input.a = targetA; s.input.b = boost ? 1 : 0; s.input.f = 0;
      return;
    }

    // 2) armed + enemy in range → aim & fire (lead the target a touch)
    const armed = (s.weapon && s.weapon.ammo > 0) || (s.power && s.power.key === 'shrink');
    if (armed && enemy && enemyD < 620) {
      const eh = enemy.head();
      const lead = Math.min(0.25, enemyD / 2600);
      const ex = eh.x + Math.cos(enemy.angle) * enemy.speedNow() * lead;
      const ey = eh.y + Math.sin(enemy.angle) * enemy.speedNow() * lead;
      targetA = Math.atan2(ey - h.y, ex - h.x);
      if (Math.abs(angDiff(s.angle, targetA)) < 0.35) fire = 1;
      boost = enemy.lenSegs() < s.lenSegs() && enemyD > 260;
      s.input.a = targetA; s.input.b = boost ? 1 : 0; s.input.f = fire;
      if (fire) fireWeapon(w, s);
      return;
    }

    // 3) grab nearby item (weapon/crate)
    let item = null, itemD = 440;
    for (const it of w.items.values()) {
      const d = dist(h.x, h.y, it.x, it.y);
      if (d < itemD) { itemD = d; item = it; }
    }
    if (item && (!s.weapon || item.kind === 'crate' || Math.random() < 0.5)) {
      targetA = Math.atan2(item.y - h.y, item.x - h.x);
      s.input.a = targetA; s.input.b = 0; s.input.f = 0;
      return;
    }

    // 4) seek nearest food
    let food = null, foodD = 520;
    for (const f of w.food.values()) {
      const d = dist(h.x, h.y, f.x, f.y);
      if (d < foodD) { foodD = d; food = f; }
    }
    if (food) {
      targetA = Math.atan2(food.y - h.y, food.x - h.x);
      s.input.a = targetA; s.input.b = 0; s.input.f = 0;
      return;
    }

    // 5) wander
    if (!s._wanderT || w.now > s._wanderT) {
      s._wanderTarget = s.angle + rand(-1.2, 1.2);
      s._wanderT = w.now + rand(900, 2200);
    }
    s.input.a = s._wanderTarget;
    s.input.b = 0; s.input.f = 0;
  }
}
