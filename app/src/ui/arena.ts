// The arena: a canvas 2D world you steer your bag through with your thumb.
// Every holder is a body. Movement and positions are local and free; contact
// is the controller, and the page (play.ts) decides what a touch means and
// fires the real chain call. Nothing here invents money.

import { hash32 } from "./names";
import { reducedMotion } from "./dom";

export type BodyState = "open" | "rest" | "busy" | "small" | "down" | "idle" | "frozen";
export interface ArenaBody {
  id: string;
  name: string;
  bag: string; // "548k"
  kind: "exposed" | "vault";
  balance: number; // whole coins, for size
  state: BodyState;
  shieldBps: number;
  immune: boolean;
  npc: "" | "shor" | "grover" | "qubit";
  hunting: boolean; // an NPC that is coming for you
  raidingMe: boolean; // a real open raid on you by this body
  raidedByMe: boolean; // your open raid on it
  until?: number; // deadline of that raid (chain ms)
  svg: string; // portrait
}
export interface ArenaMe {
  kind: "none" | "exposed" | "vault";
  bag: string;
  balance: number;
  shieldBps: number;
  raidsLeft: number;
  maxRaids: number;
  inFlight: string; // "" or the text under the spinner
  svg: string;
}
export interface ArenaPlaces {
  gate: "hidden" | "open" | "home";
  boss: { visible: boolean; ready: boolean; hp: number };
}
export interface ArenaCallbacks {
  onTouch(id: string, body: ArenaBody): void;
  onGate(): void;
  onBoss(): void;
  onPulse(): void;
  chainNow(): number;
}

interface Sim {
  id: string;
  x: number; y: number; vx: number; vy: number; r: number;
  hx: number; hy: number; // home
  seed: number;
  speed: number; // current chase speed
  lastTouch: number;
  tunnel: number; // flicker time left after a tunnel jump
  trail: { x: number; y: number }[];
  bounce: number; // visual squash after a bounce
}
interface Particle { x: number; y: number; vx: number; vy: number; t: number; life: number; c: string; s: number; tx?: number; ty?: number }
interface Bubble { id: string; el: HTMLElement; until: number }

const ME = "__me__";
const ME_SPEED = 200;
const DASH_SPEED = 640;
const DASH_MS = 320;
const DASH_COOL = 3000;
const CHASE = { qubit: 150, shor: 165, grover: 140, charge: 185, flee: 130, follow: 120 };
const TUNNEL_FROM = 720;
const TUNNEL_TO = 460;
const TOUCH_GAP = 3200;
const GOLD = "#ffd60a", RED = "#ff3d2e", CYAN = "#27f0ff";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rnd = (seed: number, k: number) => ((hash32(`${seed}:${k}`) % 10000) / 10000);

/** Body radius from the bag: log scale, clamped. */
export function radiusFor(balance: number): number {
  if (balance <= 0) return 16;
  return clamp(12 + Math.log10(balance) * 4.2, 15, 36);
}

export class Arena {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private over: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private w = 1; private h = 1; private dpr = 1;
  W = 1400; H = 1400;
  private cam = { x: 0, y: 0 };
  private me: Sim;
  private meInfo: ArenaMe = { kind: "none", bag: "0", balance: 0, shieldBps: 0, raidsLeft: 0, maxRaids: 0, inFlight: "", svg: "" };
  private bodies = new Map<string, Sim>();
  private info = new Map<string, ArenaBody>();
  private order: string[] = [];
  private places: ArenaPlaces = { gate: "hidden", boss: { visible: true, ready: false, hp: 1 } };
  gate = { x: 0, y: 0 };
  boss = { x: 0, y: 0, angle: 0 };
  private imgs = new Map<string, HTMLImageElement>();
  private particles: Particle[] = [];
  private bubbles: Bubble[] = [];
  private stick: { id: number; ox: number; oy: number; dx: number; dy: number } | null = null;
  private mouse: { id: number; x: number; y: number } | null = null;
  private keys = new Set<string>();
  private dashT = 0; private dashCool = 0; private dashDir = { x: 0, y: -1 };
  private facing = { x: 0, y: -1 };
  private lastGate = 0; private lastBoss = 0; private lastPulse = 0;
  private raf = 0; private last = 0; private t = 0;
  private alive = true;
  private colors = { field: "#070910", grid: "rgba(39,240,255,0.07)", ink: "#e8eaf2", dim: "#8b90a3", line: "#2a2e3d", bg: "#05060a" };
  private colorT = 0;
  private shakeT = 0;
  private flashT = 0; private flashC = RED;
  fps = 60;
  ready = false;
  onDash: ((cool: number) => void) | null = null;

  constructor(host: HTMLElement, private cb: ArenaCallbacks) {
    this.el = document.createElement("div");
    this.el.className = "arena";
    this.el.innerHTML = `<canvas aria-label="The arena"></canvas><div class="ar-over" aria-hidden="true"></div>`;
    host.appendChild(this.el);
    this.canvas = this.el.querySelector("canvas")!;
    this.over = this.el.querySelector(".ar-over")!;
    this.ctx = this.canvas.getContext("2d", { alpha: false })!;
    this.me = this.sim(ME, 0, 0, 18);
    this.resize(true);
    new ResizeObserver(() => this.resize(false)).observe(this.el);
    this.readColors();
    document.fonts?.load("700 16px 'QDAY Display'").catch(() => {});

    this.canvas.addEventListener("pointerdown", this.onDown, { passive: false });
    this.canvas.addEventListener("pointermove", this.onMove, { passive: false });
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onUp);
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- public

  setMe(m: ArenaMe) {
    const was = this.meInfo.kind;
    this.meInfo = m;
    this.me.r = m.kind === "none" ? 18 : radiusFor(m.balance);
    if (m.svg) this.img(ME, m.svg);
    if (was === "none" && m.kind !== "none") this.spawn();
    this.ready = true;
  }

  setPlaces(p: ArenaPlaces) { this.places = p; }

  setBodies(list: ArenaBody[]) {
    const seen = new Set<string>();
    for (const b of list) {
      seen.add(b.id);
      this.info.set(b.id, b);
      this.img(b.id, b.svg);
      let s = this.bodies.get(b.id);
      if (!s) {
        const seed = hash32(b.id);
        // homes spread over the world, away from the spawn corner and Satoshi
        let hx = 0, hy = 0;
        for (let k = 0; k < 8; k++) {
          hx = lerp(this.W * 0.08, this.W * 0.92, rnd(seed, 10 + k));
          hy = lerp(this.H * 0.08, this.H * 0.92, rnd(seed, 30 + k));
          const nearSpawn = Math.hypot(hx - this.W * 0.14, hy - this.H * 0.86) < this.W * 0.22;
          const nearBoss = Math.hypot(hx - this.W / 2, hy - this.H / 2) < 220;
          if (!nearSpawn && !nearBoss) break;
        }
        s = this.sim(b.id, hx, hy, radiusFor(b.balance));
        s.hx = hx; s.hy = hy;
        this.bodies.set(b.id, s);
      }
      s.r = radiusFor(b.balance);
    }
    for (const id of [...this.bodies.keys()]) if (!seen.has(id)) { this.bodies.delete(id); this.info.delete(id); }
    this.order = list.map((b) => b.id);
  }

  /** A speech bubble over a body ("me" for you, "satoshi" for the boss). */
  say(id: string, text: string, ms = 3600) {
    if (!text) return;
    const key = id === "me" ? ME : id;
    this.bubbles = this.bubbles.filter((b) => { if (b.id === key) { b.el.remove(); return false; } return true; });
    const el = document.createElement("span");
    el.className = "bp-say ar-say";
    el.textContent = text;
    this.over.appendChild(el);
    this.bubbles.push({ id: key, el, until: performance.now() + ms });
  }

  /** Where a body is on screen, in percent of the arena (for fx). */
  screenOf(id: string): { x: number; y: number } | null {
    const s = id === "me" ? this.me : id === "satoshi" ? { x: this.boss.x, y: this.boss.y } : id === "gate" ? this.gate : this.bodies.get(id);
    if (!s) return null;
    const p = this.toScreen(s.x, s.y);
    return { x: (p.x / this.w) * 100, y: (p.y / this.h) * 100 };
  }

  /** Coins burst from a body. */
  burst(id: string, color = GOLD, n = 14) {
    const s = this.simOf(id); if (!s) return;
    if (reducedMotion()) n = Math.min(n, 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 90 + Math.random() * 160;
      this.particles.push({ x: s.x, y: s.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, t: 0, life: 0.7 + Math.random() * 0.4, c: color, s: 5 });
    }
  }
  /** Coins fly from one body to another. */
  fly(from: string, to: string, color = GOLD, n = 10) {
    const a = this.simOf(from), b = this.simOf(to); if (!a || !b) return;
    if (reducedMotion()) n = 2;
    for (let i = 0; i < n; i++) this.particles.push({ x: a.x + (Math.random() - 0.5) * 20, y: a.y + (Math.random() - 0.5) * 20, vx: 0, vy: 0, t: -i * 0.04, life: 0.6, c: color, s: 5, tx: b.x, ty: b.y });
  }
  shake() { if (!reducedMotion()) this.shakeT = 0.45; }
  flash(c = RED) { if (!reducedMotion()) { this.flashT = 0.25; this.flashC = c; } }

  dash() {
    if (this.dashCool > 0 || this.meInfo.kind === "none") return false;
    const d = this.inputDir();
    const m = Math.hypot(d.x, d.y);
    this.dashDir = m > 0.1 ? { x: d.x / m, y: d.y / m } : { ...this.facing };
    this.dashT = DASH_MS / 1000;
    this.dashCool = DASH_COOL / 1000;
    for (let i = 0; i < (reducedMotion() ? 2 : 8); i++) this.particles.push({ x: this.me.x, y: this.me.y, vx: -this.dashDir.x * 160 + (Math.random() - 0.5) * 80, vy: -this.dashDir.y * 160 + (Math.random() - 0.5) * 80, t: 0, life: 0.35, c: this.colors.ink, s: 4 });
    return true;
  }
  get dashReady() { return this.dashCool <= 0; }
  get hunters() { return this.order.filter((id) => this.info.get(id)?.hunting || this.info.get(id)?.raidingMe); }
  /** Distance from you to a body, in world px. */
  distTo(id: string) { const s = this.simOf(id); return s ? Math.hypot(s.x - this.me.x, s.y - this.me.y) : Infinity; }

  destroy() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    this.el.remove();
  }

  // ---------------------------------------------------------------- setup

  private sim(id: string, x: number, y: number, r: number): Sim {
    return { id, x, y, vx: 0, vy: 0, r, hx: x, hy: y, seed: hash32(id), speed: 0, lastTouch: 0, tunnel: 0, trail: [], bounce: 0 };
  }
  private simOf(id: string): Sim | { x: number; y: number } | null {
    if (id === "me" || id === ME) return this.me;
    if (id === "satoshi") return this.boss;
    if (id === "gate") return this.gate;
    return this.bodies.get(id) || null;
  }
  private img(id: string, svg: string) {
    if (this.imgs.has(id) && this.imgs.get(id)!.dataset.svg === svg) return;
    const im = new Image();
    im.dataset.svg = svg;
    // an SVG needs an intrinsic size before a canvas will draw it
    im.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/<svg /, `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" `))}`;
    this.imgs.set(id, im);
  }
  private resize(first: boolean) {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.w = Math.round(r.width); this.h = Math.round(r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${this.h}px`;
    if (first || this.W === 1400) {
      // about three screens each way; a desktop screen is already big
      this.W = clamp(Math.round(this.w * 3), 1100, 2600);
      this.H = clamp(Math.round(this.h * 3), 1100, 2600);
      this.boss = { x: this.W / 2, y: this.H / 2, angle: 0 };
      this.gate = { x: this.W * 0.84, y: this.H * 0.17 };
      this.me.x = this.W * 0.14; this.me.y = this.H * 0.86;
      this.cam = { x: this.boss.x - this.w / 2, y: this.boss.y - this.h / 2 };
    }
  }
  private spawn() {
    this.me.x = this.W * 0.14; this.me.y = this.H * 0.86; this.me.vx = this.me.vy = 0;
    this.burst("me", RED, 12);
  }
  private readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (k: string, d: string) => cs.getPropertyValue(k).trim() || d;
    this.colors = { field: v("--field", "#070910"), grid: v("--grid", "rgba(39,240,255,0.07)"), ink: v("--ink", "#e8eaf2"), dim: v("--dim", "#8b90a3"), line: v("--line2", "#2a2e3d"), bg: v("--bg", "#05060a") };
  }

  // ---------------------------------------------------------------- input

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (e.pointerType === "mouse") { this.mouse = { id: e.pointerId, x, y }; return; }
    if (y < this.h * 0.4 || this.stick) return; // the upper arena is for looking; the lower 60% is the thumb zone
    this.stick = { id: e.pointerId, ox: x, oy: y, dx: 0, dy: 0 };
  };
  private onMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (this.mouse && this.mouse.id === e.pointerId) { this.mouse.x = x; this.mouse.y = y; return; }
    if (!this.stick || this.stick.id !== e.pointerId) return;
    e.preventDefault();
    const R = 52;
    let dx = x - this.stick.ox, dy = y - this.stick.oy;
    const m = Math.hypot(dx, dy);
    if (m > R) { // the base follows the thumb when it runs away
      this.stick.ox = x - (dx / m) * R; this.stick.oy = y - (dy / m) * R;
      dx = (dx / m) * R; dy = (dy / m) * R;
    }
    this.stick.dx = dx / R; this.stick.dy = dy / R;
  };
  private onUp = (e: PointerEvent) => {
    if (this.stick && this.stick.id === e.pointerId) this.stick = null;
    if (this.mouse && this.mouse.id === e.pointerId) this.mouse = null;
  };
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift"].includes(k)) {
      if (k === " " || k === "arrowup" || k === "arrowdown") e.preventDefault();
      if (e.type === "keydown") { this.keys.add(k); if (k === " " || k === "shift") this.dash(); }
      else this.keys.delete(k);
    }
  };
  private inputDir(): { x: number; y: number } {
    if (this.stick) return { x: this.stick.dx, y: this.stick.dy };
    let x = 0, y = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) y -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) y += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) x -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) x += 1;
    if (x || y) { const m = Math.hypot(x, y); return { x: x / m, y: y / m }; }
    if (this.mouse) {
      const p = this.toScreen(this.me.x, this.me.y);
      const dx = this.mouse.x - p.x, dy = this.mouse.y - p.y, m = Math.hypot(dx, dy);
      if (m < 10) return { x: 0, y: 0 };
      const k = clamp(m / 90, 0.3, 1);
      return { x: (dx / m) * k, y: (dy / m) * k };
    }
    return { x: 0, y: 0 };
  }

  // ---------------------------------------------------------------- simulation

  private frame = (now: number) => {
    if (!this.alive) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1; // tab was hidden: don't leap
    if (dt > 0) this.fps = lerp(this.fps, 1 / dt, 0.05);
    this.t += dt;
    this.colorT += dt;
    if (this.colorT > 2) { this.colorT = 0; this.readColors(); }
    this.step(dt);
    this.draw(now);
  };

  private step(dt: number) {
    const me = this.me;
    const playing = this.meInfo.kind !== "none";
    // you
    if (playing) {
      const d = this.inputDir();
      const k = 1 - Math.exp(-dt * 9);
      me.vx = lerp(me.vx, d.x * ME_SPEED, k);
      me.vy = lerp(me.vy, d.y * ME_SPEED, k);
      if (Math.hypot(d.x, d.y) > 0.2) { const m = Math.hypot(d.x, d.y); this.facing = { x: d.x / m, y: d.y / m }; }
      if (this.dashT > 0) {
        const f = this.dashT / (DASH_MS / 1000);
        me.vx += this.dashDir.x * DASH_SPEED * f * dt * 6;
        me.vy += this.dashDir.y * DASH_SPEED * f * dt * 6;
        this.dashT -= dt;
      }
      if (this.dashCool > 0) { this.dashCool -= dt; this.onDash?.(clamp(1 - this.dashCool / (DASH_COOL / 1000), 0, 1)); }
      me.x = clamp(me.x + me.vx * dt, me.r, this.W - me.r);
      me.y = clamp(me.y + me.vy * dt, me.r, this.H - me.r);
      if (!reducedMotion() && Math.hypot(me.vx, me.vy) > 60) { me.trail.push({ x: me.x, y: me.y }); if (me.trail.length > 6) me.trail.shift(); } else me.trail.length = 0;
    }
    // bodies
    const nowMs = performance.now();
    for (const id of this.order) {
      const s = this.bodies.get(id)!, b = this.info.get(id)!;
      if (!s || !b) continue;
      const dx = me.x - s.x, dy = me.y - s.y, dist = Math.hypot(dx, dy) || 1;
      let tx = 0, ty = 0, want = 0;
      if (b.hunting && playing) {
        if (dist > TUNNEL_FROM && s.tunnel <= 0) {
          // a far hunter tunnels in: flicker, then it is close
          s.x = me.x - (dx / dist) * TUNNEL_TO; s.y = me.y - (dy / dist) * TUNNEL_TO; s.tunnel = 0.6; s.speed = 40;
        }
        want = b.npc === "shor" ? CHASE.shor : b.npc === "grover" ? CHASE.grover : CHASE.qubit;
        s.speed = Math.min(want, s.speed + dt * 110);
        tx = dx / dist; ty = dy / dist;
      } else if (b.raidingMe && playing) {
        if (this.meInfo.kind === "vault") { want = CHASE.charge; s.speed = Math.min(want, s.speed + dt * 160); tx = dx / dist; ty = dy / dist; }
        else { // latched on: follows at a short leash
          want = dist > 110 ? CHASE.follow : 0; s.speed = want; tx = dx / dist; ty = dy / dist;
        }
      } else if (b.raidedByMe && b.kind === "exposed" && playing) {
        want = dist < 520 ? CHASE.flee : 0; s.speed = want; tx = -dx / dist; ty = -dy / dist;
      } else {
        // wander on a seeded path around home
        s.speed = 0;
        const a = 50 + rnd(s.seed, 1) * 70, f1 = 0.12 + rnd(s.seed, 2) * 0.12, f2 = 0.09 + rnd(s.seed, 3) * 0.1, ph = rnd(s.seed, 4) * 6.28;
        const gx = s.hx + Math.sin(this.t * f1 + ph) * a, gy = s.hy + Math.cos(this.t * f2 + ph) * a;
        s.vx = lerp(s.vx, (gx - s.x) * 1.4, 1 - Math.exp(-dt * 3));
        s.vy = lerp(s.vy, (gy - s.y) * 1.4, 1 - Math.exp(-dt * 3));
      }
      if (want || s.speed) {
        s.vx = lerp(s.vx, tx * s.speed, 1 - Math.exp(-dt * 5));
        s.vy = lerp(s.vy, ty * s.speed, 1 - Math.exp(-dt * 5));
      }
      s.x = clamp(s.x + s.vx * dt, s.r, this.W - s.r);
      s.y = clamp(s.y + s.vy * dt, s.r, this.H - s.r);
      if (s.tunnel > 0) s.tunnel -= dt;
      if (s.bounce > 0) s.bounce -= dt;
      if ((b.hunting || b.raidingMe) && !reducedMotion()) { s.trail.push({ x: s.x, y: s.y }); if (s.trail.length > 9) s.trail.shift(); } else s.trail.length = 0;
      // keep bodies off Satoshi
      const bx = s.x - this.boss.x, by = s.y - this.boss.y, bd = Math.hypot(bx, by) || 1;
      if (bd < 70 + s.r) { s.x = this.boss.x + (bx / bd) * (70 + s.r); s.y = this.boss.y + (by / bd) * (70 + s.r); }
      // contact with you
      if (playing) {
        const d2 = Math.hypot(me.x - s.x, me.y - s.y) || 1;
        const min = me.r + s.r;
        if (d2 < min) {
          const nx = (me.x - s.x) / d2, ny = (me.y - s.y) / d2;
          const push = (min - d2) / 2 + 1;
          me.x += nx * push; me.y += ny * push; s.x -= nx * push; s.y -= ny * push;
          const imp = 160;
          me.vx += nx * imp; me.vy += ny * imp; s.vx -= nx * imp * 0.6; s.vy -= ny * imp * 0.6;
          s.bounce = 0.3; me.bounce = 0.3;
          if (nowMs - s.lastTouch > TOUCH_GAP) { s.lastTouch = nowMs; this.cb.onTouch(id, b); }
        }
      }
    }
    // the gate
    if (playing && this.places.gate !== "hidden") {
      const d = Math.hypot(me.x - this.gate.x, me.y - this.gate.y);
      if (d < 44 + me.r * 0.5 && nowMs - this.lastGate > 4000) { this.lastGate = nowMs; this.cb.onGate(); }
    }
    // Satoshi: the pulse ring and the core
    this.boss.angle += dt * (reducedMotion() ? 0.25 : 0.55);
    if (playing && this.places.boss.visible) {
      const bx = me.x - this.boss.x, by = me.y - this.boss.y, bd = Math.hypot(bx, by) || 1;
      const R = 128, half = 0.95;
      const ang = Math.atan2(by, bx);
      let diff = Math.abs(((ang - this.boss.angle) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (Math.abs(bd - R) < 14 + me.r && diff < half) {
        me.vx += (bx / bd) * 520; me.vy += (by / bd) * 520;
        if (nowMs - this.lastPulse > 1500) { this.lastPulse = nowMs; this.cb.onPulse(); this.shake(); }
      }
      if (bd < 50 + me.r) {
        me.x = this.boss.x + (bx / bd) * (50 + me.r); me.y = this.boss.y + (by / bd) * (50 + me.r);
        me.vx += (bx / bd) * 120; me.vy += (by / bd) * 120;
        if (nowMs - this.lastBoss > 4000) { this.lastBoss = nowMs; this.cb.onBoss(); }
      }
    }
    if (me.bounce > 0) me.bounce -= dt;
    // camera
    const k = 1 - Math.exp(-dt * 6);
    const look = playing ? me : this.boss; // before you have a bag the camera rests on Satoshi
    this.cam.x = clamp(lerp(this.cam.x, look.x - this.w / 2, k), 0, Math.max(0, this.W - this.w));
    this.cam.y = clamp(lerp(this.cam.y, look.y - this.h / 2, k), 0, Math.max(0, this.H - this.h));
    // particles
    for (const p of this.particles) {
      p.t += dt;
      if (p.t < 0) continue;
      if (p.tx !== undefined) {
        const f = clamp(p.t / p.life, 0, 1), e = f * f * (3 - 2 * f);
        p.x = lerp(p.x, p.tx, e * 0.25 + 0.05); p.y = lerp(p.y, p.ty!, e * 0.25 + 0.05);
      } else { p.vy += 420 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    }
    this.particles = this.particles.filter((p) => p.t < p.life);
    if (this.shakeT > 0) this.shakeT -= dt;
    if (this.flashT > 0) this.flashT -= dt;
  }

  // ---------------------------------------------------------------- drawing

  private toScreen(x: number, y: number) { return { x: x - this.cam.x, y: y - this.cam.y }; }

  private draw(now: number) {
    const c = this.ctx, C = this.colors;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    c.fillStyle = C.field;
    c.fillRect(0, 0, this.w, this.h);
    c.save();
    if (this.shakeT > 0) { const a = this.shakeT * 14; c.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a); }
    const ox = Math.round(this.cam.x), oy = Math.round(this.cam.y);
    c.translate(-ox, -oy);

    // grid and stars
    c.strokeStyle = C.grid; c.lineWidth = 1;
    const g = 48;
    c.beginPath();
    for (let x = Math.floor(ox / g) * g; x < ox + this.w + g; x += g) { c.moveTo(x + 0.5, oy); c.lineTo(x + 0.5, oy + this.h); }
    for (let y = Math.floor(oy / g) * g; y < oy + this.h + g; y += g) { c.moveTo(ox, y + 0.5); c.lineTo(ox + this.w, y + 0.5); }
    c.stroke();
    c.fillStyle = C.dim; c.globalAlpha = 0.35;
    for (let i = 0; i < 90; i++) {
      const sx = rnd(7, i) * this.W, sy = rnd(8, i) * this.H;
      if (sx < ox - 4 || sx > ox + this.w + 4 || sy < oy - 4 || sy > oy + this.h + 4) continue;
      const tw = 0.5 + 0.5 * Math.sin(this.t * (1 + rnd(9, i) * 2) + i);
      c.globalAlpha = 0.15 + 0.3 * tw;
      c.fillRect(Math.round(sx), Math.round(sy), 2, 2);
    }
    c.globalAlpha = 1;
    // the edge of the world
    c.strokeStyle = C.line; c.lineWidth = 3;
    c.strokeRect(1.5, 1.5, this.W - 3, this.H - 3);
    c.setLineDash([8, 8]); c.strokeStyle = RED; c.globalAlpha = 0.35; c.strokeRect(1.5, 1.5, this.W - 3, this.H - 3); c.setLineDash([]); c.globalAlpha = 1;

    this.drawGate(c);
    this.drawBoss(c);
    this.drawLines(c);
    // bodies, far to near
    const ids = [...this.order].sort((a, b) => (this.bodies.get(a)?.y || 0) - (this.bodies.get(b)?.y || 0));
    for (const id of ids) this.drawBody(c, this.bodies.get(id)!, this.info.get(id)!);
    if (this.meInfo.kind !== "none") this.drawMe(c, now);
    this.drawParticles(c);
    c.restore();

    // screen space: flash, joystick, minimap
    if (this.flashT > 0) { c.globalAlpha = this.flashT * 1.6; c.fillStyle = this.flashC; c.fillRect(0, 0, this.w, this.h); c.globalAlpha = 1; }
    this.drawStick(c);
    this.drawMinimap(c);
    this.placeBubbles(now);
  }

  private font(px: number, weight = 700) { return `${weight} ${px}px 'QDAY Display', monospace`; }
  private mono(px: number) { return `500 ${px}px 'IBM Plex Mono', monospace`; }

  private frame8(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, w = 2) {
    // a pixel frame: square with notched corners
    c.fillStyle = color;
    const s = r * 2, n = Math.max(2, Math.round(r * 0.22));
    c.fillRect(x - r + n, y - r, s - n * 2, w); c.fillRect(x - r + n, y + r - w, s - n * 2, w);
    c.fillRect(x - r, y - r + n, w, s - n * 2); c.fillRect(x + r - w, y - r + n, w, s - n * 2);
    c.fillRect(x - r + n - w, y - r + n - w, w, w); c.fillRect(x + r - n, y - r + n - w, w, w);
    c.fillRect(x - r + n - w, y + r - n, w, w); c.fillRect(x + r - n, y + r - n, w, w);
  }

  private portrait(c: CanvasRenderingContext2D, id: string, x: number, y: number, r: number) {
    const im = this.imgs.get(id);
    const s = Math.round(r * 2 - 8);
    c.fillStyle = "#191815";
    c.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
    if (im && im.complete && im.naturalWidth) c.drawImage(im, Math.round(x - s / 2), Math.round(y - s / 2), s, s);
  }

  private drawBody(c: CanvasRenderingContext2D, s: Sim, b: ArenaBody) {
    const { x, y, r } = s;
    if (x < this.cam.x - 80 || x > this.cam.x + this.w + 80 || y < this.cam.y - 80 || y > this.cam.y + this.h + 80) return;
    const dimmed = b.state === "rest" || b.state === "busy" || b.state === "down" || b.state === "small" || b.state === "frozen" || b.immune;
    const color = b.kind === "vault" ? GOLD : RED;
    c.save();
    if (s.tunnel > 0 && Math.floor(s.tunnel * 20) % 2 === 0) c.globalAlpha = 0.25;
    // trail
    if (s.trail.length > 1) {
      for (let i = 0; i < s.trail.length; i++) {
        const p = s.trail[i], f = (i + 1) / s.trail.length;
        c.globalAlpha = f * 0.3; c.fillStyle = RED;
        const q = Math.max(2, Math.round(r * 0.45 * f));
        c.fillRect(Math.round(p.x - q / 2), Math.round(p.y - q / 2), q, q);
      }
      c.globalAlpha = s.tunnel > 0 && Math.floor(s.tunnel * 20) % 2 === 0 ? 0.25 : 1;
    }
    if (dimmed) c.globalAlpha *= 0.5;
    const sq = s.bounce > 0 ? 1 + Math.sin(s.bounce * 20) * 0.08 : 1;
    c.translate(Math.round(x), Math.round(y)); c.scale(sq, 2 - sq); c.translate(-Math.round(x), -Math.round(y));
    // exposed: dripping pixels
    if (b.kind === "exposed" && !dimmed) {
      c.fillStyle = RED;
      for (let i = 0; i < 3; i++) {
        const ph = (this.t * 0.9 + rnd(s.seed, 50 + i)) % 1;
        c.globalAlpha = (1 - ph) * 0.9;
        c.fillRect(Math.round(x - r + 4 + rnd(s.seed, 60 + i) * (r * 2 - 10)), Math.round(y + r + ph * 16), 3, 3);
      }
      c.globalAlpha = 1;
    }
    this.frame8(c, x, y, r, color, b.hunting || b.raidingMe ? 3 : 2);
    this.portrait(c, b.id, x, y, r);
    // shield rings, one per 10%
    if (b.shieldBps > 0) {
      const n = Math.min(3, Math.ceil(b.shieldBps / 1000));
      c.strokeStyle = CYAN; c.lineWidth = 2; c.globalAlpha *= 0.8;
      for (let i = 0; i < n; i++) { c.beginPath(); c.arc(x, y, r + 5 + i * 5, 0, Math.PI * 2); c.stroke(); }
    }
    c.restore();
    // badges
    c.save();
    const bx = x + r - 4, by = y - r - 4;
    if (b.immune || b.state === "rest") { c.fillStyle = C_DIM(this.colors.dim); this.moon(c, bx, by); }
    else if (b.state === "down" || b.state === "small") { this.lock(c, bx, by, this.colors.dim); }
    else if (b.state === "busy") { this.cross(c, bx, by, RED); }
    if (b.kind === "vault") { c.fillStyle = GOLD; c.fillRect(x - r + 3, y + r - 7, 5, 4); c.fillStyle = "#0b0b0b"; c.fillRect(x - r + 6, y + r - 6, 1, 2); }
    if (b.state === "open" && !b.hunting && !b.raidingMe) { // raidable: a soft pulse ring
      c.strokeStyle = color; c.globalAlpha = 0.35 + 0.25 * Math.sin(this.t * 4 + s.seed); c.lineWidth = 2;
      c.strokeRect(x - r - 5 + 0.5, y - r - 5 + 0.5, r * 2 + 10, r * 2 + 10);
    }
    c.restore();
    // labels
    c.save();
    c.textAlign = "center"; c.textBaseline = "top";
    c.font = this.font(13);
    c.fillStyle = b.hunting || b.raidingMe ? RED : this.colors.ink;
    c.globalAlpha = dimmed ? 0.6 : 1;
    this.label(c, b.name, x, y + r + 6);
    c.font = this.font(11); c.fillStyle = this.colors.dim;
    this.label(c, b.bag, x, y + r + 20);
    c.restore();
  }
  private label(c: CanvasRenderingContext2D, text: string, x: number, y: number) {
    const w = c.measureText(text).width;
    const fill = c.fillStyle;
    c.fillStyle = this.colors.field; c.globalAlpha *= 0.8;
    c.fillRect(Math.round(x - w / 2 - 3), Math.round(y - 1), Math.round(w + 6), 14);
    c.globalAlpha /= 0.8; c.fillStyle = fill;
    c.fillText(text, Math.round(x), Math.round(y));
  }
  private moon(c: CanvasRenderingContext2D, x: number, y: number) {
    c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
    c.fillStyle = this.colors.field; c.beginPath(); c.arc(x + 3, y - 2, 4.2, 0, Math.PI * 2); c.fill();
  }
  private lock(c: CanvasRenderingContext2D, x: number, y: number, col: string) {
    c.fillStyle = col; c.fillRect(x - 5, y - 2, 10, 8); c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.arc(x, y - 3, 3.5, Math.PI, 0); c.stroke();
    c.fillStyle = this.colors.field; c.fillRect(x - 1, y + 1, 2, 3);
  }
  private cross(c: CanvasRenderingContext2D, x: number, y: number, col: string) {
    c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.moveTo(x - 7, y); c.lineTo(x + 7, y); c.moveTo(x, y - 7); c.lineTo(x, y + 7); c.stroke();
  }

  private drawMe(c: CanvasRenderingContext2D, now: number) {
    const m = this.me, info = this.meInfo;
    const color = info.kind === "vault" ? GOLD : RED;
    c.save();
    if (m.trail.length > 1 && this.dashT > 0) {
      for (let i = 0; i < m.trail.length; i++) { const p = m.trail[i], f = (i + 1) / m.trail.length; c.globalAlpha = f * 0.5; c.fillStyle = this.colors.ink; const q = Math.round(m.r * 1.2 * f); c.fillRect(Math.round(p.x - q / 2), Math.round(p.y - q / 2), q, q); }
      c.globalAlpha = 1;
    }
    const sq = m.bounce > 0 ? 1 + Math.sin(m.bounce * 20) * 0.08 : 1;
    c.translate(Math.round(m.x), Math.round(m.y)); c.scale(sq, 2 - sq); c.translate(-Math.round(m.x), -Math.round(m.y));
    // exposed glow / drips
    if (info.kind === "exposed") {
      c.fillStyle = RED; c.globalAlpha = 0.12 + 0.08 * Math.sin(this.t * 3); c.fillRect(m.x - m.r - 10, m.y - m.r - 10, m.r * 2 + 20, m.r * 2 + 20); c.globalAlpha = 1;
      for (let i = 0; i < 4; i++) { const ph = (this.t * 1.1 + i * 0.27) % 1; c.globalAlpha = 1 - ph; c.fillRect(Math.round(m.x - m.r + 5 + i * ((m.r * 2 - 10) / 3.2)), Math.round(m.y + m.r + ph * 18), 3, 3); }
      c.globalAlpha = 1;
    } else {
      c.fillStyle = GOLD; c.globalAlpha = 0.1 + 0.06 * Math.sin(this.t * 2); c.fillRect(m.x - m.r - 10, m.y - m.r - 10, m.r * 2 + 20, m.r * 2 + 20); c.globalAlpha = 1;
    }
    this.frame8(c, m.x, m.y, m.r + 3, this.colors.ink, 2);
    this.frame8(c, m.x, m.y, m.r, color, 3);
    this.portrait(c, ME, m.x, m.y, m.r);
    if (info.shieldBps > 0) {
      const n = Math.min(3, Math.ceil(info.shieldBps / 1000));
      c.strokeStyle = CYAN; c.lineWidth = 2; c.globalAlpha = 0.85;
      for (let i = 0; i < n; i++) { c.beginPath(); c.arc(m.x, m.y, m.r + 9 + i * 5, 0, Math.PI * 2); c.stroke(); }
      c.globalAlpha = 1;
    }
    c.restore();
    // raids left as pips
    if (info.kind === "vault" && info.maxRaids > 0) {
      for (let i = 0; i < info.maxRaids; i++) { c.fillStyle = i < info.raidsLeft ? RED : this.colors.line; c.fillRect(Math.round(m.x - (info.maxRaids * 7) / 2 + i * 7), Math.round(m.y - m.r - 12), 5, 4); }
    }
    // facing tick
    c.fillStyle = this.colors.ink; c.fillRect(Math.round(m.x + this.facing.x * (m.r + 8)) - 2, Math.round(m.y + this.facing.y * (m.r + 8)) - 2, 4, 4);
    // labels
    c.textAlign = "center"; c.textBaseline = "top";
    c.font = this.font(13); c.fillStyle = color;
    this.label(c, "YOU", m.x, m.y + m.r + 8);
    c.font = this.font(11); c.fillStyle = this.colors.ink;
    this.label(c, info.bag, m.x, m.y + m.r + 22);
    // in flight: spinner and text
    if (info.inFlight) {
      const q = Math.floor(now / 110) % 4, sx = m.x - 8, sy = m.y - m.r - 36;
      c.fillStyle = this.colors.ink;
      [[0, 0], [8, 0], [8, 8], [0, 8]].forEach(([dx, dy], i) => { c.globalAlpha = i === q ? 1 : 0.3; c.fillRect(sx + dx, sy + dy, 6, 6); });
      c.globalAlpha = 1;
      c.font = this.mono(10.5); c.fillStyle = this.colors.ink; c.textBaseline = "bottom";
      this.label(c, info.inFlight, m.x, m.y - m.r - 44);
    }
  }

  private drawGate(c: CanvasRenderingContext2D) {
    if (this.places.gate === "hidden") return;
    const { x, y } = this.gate, open = this.places.gate === "open";
    c.save();
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 3);
    // beacon rings
    c.strokeStyle = GOLD; c.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const ph = ((this.t * 0.6 + i / 3) % 1);
      c.globalAlpha = (open ? 0.5 : 0.2) * (1 - ph);
      const R = 44 + ph * 70;
      c.strokeRect(x - R + 0.5, y - R + 0.5, R * 2, R * 2);
    }
    c.globalAlpha = 1;
    c.fillStyle = GOLD; c.globalAlpha = open ? 0.1 + pulse * 0.1 : 0.06; c.fillRect(x - 46, y - 46, 92, 92); c.globalAlpha = 1;
    this.frame8(c, x, y, 44, GOLD, 3);
    const im = this.imgs.get("__gate__");
    if (im && im.complete && im.naturalWidth) c.drawImage(im, x - 34, y - 34, 68, 68);
    c.textAlign = "center"; c.textBaseline = "top"; c.font = this.font(13); c.fillStyle = GOLD;
    this.label(c, open ? "VAULT GATE" : "YOUR VAULT", x, y + 50);
    if (open) { c.font = this.mono(10); c.fillStyle = this.colors.ink; this.label(c, "run here to get safe", x, y + 64); }
    c.restore();
  }
  setGateArt(svg: string) { this.img("__gate__", svg); }
  setBossArt(svg: string) { this.img("__boss__", svg); }

  private drawBoss(c: CanvasRenderingContext2D) {
    if (!this.places.boss.visible) return;
    const { x, y, angle } = this.boss;
    c.save();
    // the slow pulse ring: an arc that rotates; touching it knocks you back
    const R = 128;
    c.strokeStyle = GOLD; c.globalAlpha = 0.12; c.lineWidth = 26; c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = 0.85; c.lineWidth = 26; c.lineCap = "butt";
    c.strokeStyle = GOLD; c.beginPath(); c.arc(x, y, R, angle - 0.95, angle + 0.95); c.stroke();
    c.globalAlpha = 1; c.lineWidth = 3; c.strokeStyle = "#8a6d00"; c.beginPath(); c.arc(x, y, R, angle - 0.95, angle + 0.95); c.stroke();
    // core
    c.fillStyle = this.colors.bg; c.fillRect(x - 52, y - 52, 104, 104);
    this.frame8(c, x, y, 52, this.places.boss.ready ? GOLD : this.colors.line, 3);
    const im = this.imgs.get("__boss__");
    const bob = Math.sin(this.t * 2) * 2;
    if (im && im.complete && im.naturalWidth) c.drawImage(im, x - 44, y - 44 + bob, 88, 88);
    // health bar: his stash
    const bw = 120, bh = 10;
    c.fillStyle = this.colors.bg; c.fillRect(x - bw / 2 - 2, y - 76, bw + 4, bh + 4);
    c.fillStyle = this.colors.line; c.fillRect(x - bw / 2, y - 74, bw, bh);
    c.fillStyle = GOLD; c.fillRect(x - bw / 2, y - 74, Math.round(bw * clamp(this.places.boss.hp, 0, 1)), bh);
    c.textAlign = "center"; c.textBaseline = "bottom"; c.font = this.font(14); c.fillStyle = GOLD;
    this.label(c, "SATOSHI", x, y - 80);
    c.textBaseline = "top"; c.font = this.mono(10); c.fillStyle = this.places.boss.ready ? GOLD : this.colors.dim;
    this.label(c, this.places.boss.ready ? "touch the core to hit" : "dodge the pulse", x, y + 60);
    c.restore();
  }

  private drawLines(c: CanvasRenderingContext2D) {
    const me = this.me, now = this.cb.chainNow();
    for (const id of this.order) {
      const b = this.info.get(id)!, s = this.bodies.get(id)!;
      if (!b || !s || !(b.raidingMe || b.raidedByMe)) continue;
      const out = b.raidedByMe && !b.raidingMe;
      c.save();
      c.strokeStyle = out ? CYAN : RED; c.lineWidth = 2.5; c.setLineDash([7, 6]); c.lineDashOffset = -((this.t * 40) % 13);
      c.globalAlpha = 0.9;
      c.beginPath(); c.moveTo(me.x, me.y); c.lineTo(s.x, s.y); c.stroke();
      c.setLineDash([]);
      // coins dripping along the tether while you are exposed and raided
      if (b.raidingMe && this.meInfo.kind === "exposed") {
        c.fillStyle = RED;
        for (let i = 0; i < 4; i++) { const f = (this.t * 0.5 + i / 4) % 1; c.globalAlpha = 0.9 - f * 0.5; c.fillRect(Math.round(lerp(me.x, s.x, f)) - 2, Math.round(lerp(me.y, s.y, f)) - 2, 4, 4); }
      }
      if (b.until) {
        const left = b.until - now;
        const sec = Math.max(0, Math.ceil(left / 1000));
        const txt = left > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : "settling";
        const mx = lerp(me.x, s.x, 0.5), my = lerp(me.y, s.y, 0.5);
        c.globalAlpha = 1; c.textAlign = "center"; c.textBaseline = "middle"; c.font = this.font(13);
        const w = c.measureText(txt).width + 10;
        c.fillStyle = this.colors.bg; c.fillRect(Math.round(mx - w / 2), Math.round(my - 9), Math.round(w), 18);
        c.strokeStyle = out ? CYAN : RED; c.lineWidth = 2; c.strokeRect(Math.round(mx - w / 2) + 0.5, Math.round(my - 9) + 0.5, Math.round(w), 18);
        c.fillStyle = out ? CYAN : RED; c.fillText(txt, Math.round(mx), Math.round(my) + 1);
      }
      c.restore();
    }
  }

  private drawParticles(c: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      if (p.t < 0) continue;
      c.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
      c.fillStyle = p.c;
      c.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
      c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(Math.round(p.x) + p.s - 2, Math.round(p.y) + 1, 2, p.s - 1);
    }
    c.globalAlpha = 1;
  }

  private drawStick(c: CanvasRenderingContext2D) {
    if (!this.stick) return;
    const { ox, oy, dx, dy } = this.stick;
    c.save();
    c.globalAlpha = 0.35; c.strokeStyle = this.colors.ink; c.lineWidth = 2;
    c.beginPath(); c.arc(ox, oy, 52, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = 0.9; c.fillStyle = this.colors.ink;
    const kx = ox + dx * 52, ky = oy + dy * 52;
    c.fillRect(Math.round(kx) - 14, Math.round(ky) - 14, 28, 28);
    c.fillStyle = this.colors.bg; c.fillRect(Math.round(kx) - 5, Math.round(ky) - 5, 10, 10);
    c.restore();
  }

  private drawMinimap(c: CanvasRenderingContext2D) {
    if (this.meInfo.kind === "none") return;
    const R = 36, cx = this.w - R - 10, cy = R + 10;
    const sx = (R * 1.8) / Math.max(this.W, this.H);
    const map = (x: number, y: number) => ({ x: cx + (x - this.W / 2) * sx, y: cy + (y - this.H / 2) * sx });
    c.save();
    c.fillStyle = this.colors.bg; c.globalAlpha = 0.82; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1; c.strokeStyle = this.colors.line; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(cx, cy, R - 1, 0, Math.PI * 2); c.clip();
    c.fillStyle = this.colors.dim; c.globalAlpha = 0.6;
    for (const id of this.order) { const s = this.bodies.get(id)!; const b = this.info.get(id)!; if (!s || !b || b.hunting || b.raidingMe) continue; const p = map(s.x, s.y); c.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2); }
    c.globalAlpha = 1;
    for (const id of this.order) { const s = this.bodies.get(id)!; const b = this.info.get(id)!; if (!s || !b || !(b.hunting || b.raidingMe)) continue; const p = map(s.x, s.y); c.fillStyle = RED; c.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 5, 5); }
    const g = map(this.gate.x, this.gate.y); if (this.places.gate !== "hidden") { c.fillStyle = GOLD; c.fillRect(Math.round(g.x) - 3, Math.round(g.y) - 3, 6, 6); }
    const bp = map(this.boss.x, this.boss.y); c.strokeStyle = GOLD; c.lineWidth = 1.5; c.beginPath(); c.arc(bp.x, bp.y, 4, 0, Math.PI * 2); c.stroke();
    const mp = map(this.me.x, this.me.y); c.fillStyle = this.colors.ink; if (Math.floor(this.t * 4) % 2 === 0) c.fillRect(Math.round(mp.x) - 2, Math.round(mp.y) - 2, 5, 5);
    c.restore();
  }

  private placeBubbles(now: number) {
    for (const b of [...this.bubbles]) {
      const s = this.simOf(b.id === ME ? "me" : b.id);
      if (!s || now > b.until) { b.el.classList.add("out"); setTimeout(() => b.el.remove(), 220); this.bubbles = this.bubbles.filter((x) => x !== b); continue; }
      const r = "r" in s ? (s as Sim).r : 50;
      const p = this.toScreen(s.x, s.y);
      const left = p.x > this.w * 0.62;
      b.el.classList.toggle("left", left);
      b.el.classList.toggle("below", p.y < 70);
      b.el.style.left = `${Math.round(p.x)}px`;
      b.el.style.top = `${Math.round(p.y < 70 ? p.y + r + 34 : p.y - r - 16)}px`;
    }
  }
}

const C_DIM = (c: string) => c;
