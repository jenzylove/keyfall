// The arena: a canvas 2D world you steer your bag through with your thumb.
// Every holder is a chunky pixel character. Movement and positions are local
// and free; contact is the controller, and the page (play.ts) decides what a
// touch means and fires the real chain call. Nothing here invents money.

import { hash32 } from "./names";
import { reducedMotion } from "./dom";
import { grid } from "./pixels";

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
  focus?: boolean; // part of what matters right now; everyone else is a bystander
  showBag?: boolean; // bag number drawn (you, your target, your hunter)
  hint?: string; // why you cannot raid it, in a few words; shown as you come close
}
/** What the guide points at in the world. */
export type GuideTarget = { kind: "me" | "gate" | "boss" | "body"; id?: string } | null;
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
  /** hp 0..1 from the chain; hpText "843k / 1.1M"; badge pulses when your hit is ready ("SHOOT HIM · +~1,090"); line otherwise ("next hit in 9:12"). */
  boss: { visible: boolean; ready: boolean; hp: number; hint?: boolean; line?: string; hpText?: string; badge?: string };
}
export interface ArenaCallbacks {
  /** A hunter body bumped into you (the server decides whether that is a raid). */
  onTouch(id: string, body: ArenaBody): void;
  onGate(): void;
  /** Your shot landed on a body ("satoshi" for the core). Return the outcome: ok, or why it deflected. */
  onShot(id: string): { ok: boolean; why?: string };
  onPulse(): void;
  chainNow(): number;
}
interface Shot { x: number; y: number; vx: number; vy: number; t: number; from: "me" | string; target: string | null; mine: boolean; sure?: boolean; quiet?: boolean }
interface Badge { text: string; until: number; color: string; big: boolean }

interface Sim {
  id: string;
  x: number; y: number; vx: number; vy: number; r: number;
  hx: number; hy: number; // home
  seed: number;
  speed: number; // current chase speed
  lastTouch: number;
  tunnel: number; // flicker time left after a tunnel jump
  trail: { x: number; y: number }[];
  bounce: number; // squash after a bounce
  face: 1 | -1;
  lock: number; // "!" time left when a hunt starts
}
interface Particle { x: number; y: number; vx: number; vy: number; t: number; life: number; c: string; s: number; tx?: number; ty?: number; g?: number }
interface Bubble { id: string; el: HTMLElement; until: number }
interface Block { x: number; y: number; w: number; h: number; kind: "rack" | "pillar" | "crate"; seed: number }

const ME = "__me__";
const ME_SPEED = 190;
const DASH_SPEED = 620;
const DASH_MS = 320;
const DASH_COOL = 3000;
const CHASE = { qubit: 145, shor: 160, grover: 135, charge: 180, flee: 125, follow: 115 };
const TUNNEL_FROM = 640;
const TUNNEL_TO = 420;
const TOUCH_GAP = 3200;
const SHOT_SPEED = 820;
const SHOT_LIFE = 1.35; // seconds: about one screen of range
const SHOT_COOL = 0.6;
const AIM_HALF = (13 * Math.PI) / 180; // a cone of about 25 degrees
const TILE = 48;
const GOLD = "#ffd60a", RED = "#ff3d2e", CYAN = "#27f0ff", GOLD2 = "#d9b000", GOLD3 = "#8a6d00";

/** A phone, a small screen or a weak CPU: start in low power mode. Measured frame time can switch it on later. */
function detectLowPower(): boolean {
  try {
    if (matchMedia("(pointer: coarse)").matches) return true;
    if (Math.min(innerWidth, innerHeight) <= 500) return true;
    if ((navigator.hardwareConcurrency || 8) <= 4) return true;
  } catch {}
  return false;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rnd = (seed: number, k: number) => ((hash32(`${seed}:${k}`) % 10000) / 10000);

/** Body radius from the bag: about 44 to 56 px wide, the bag changes it only a little. */
export function radiusFor(balance: number): number {
  if (balance <= 0) return 23;
  return clamp(22 + (Math.log10(balance) - 4.5) * 2.2, 22, 28);
}

// your coin sack, with eyes. Red while exposed, gold once safe.
const SACK = (body: string, dark: string, tie: string) => grid(
  [
    "....####....",
    "...#tttt#...",
    "..##tttt##..",
    ".#bbbbbbbb#.",
    "#bbbbbbbbbb#",
    "#bbwwbbbwwb#",
    "#bbwkbbbwkb#",
    "#bbbbbbbbbb#",
    "#bbbbddbbbb#",
    "#bdbbbbbbdb#",
    ".#bbddddbb#.",
    "..########..",
  ],
  { "#": "#0c0c0b", t: tie, b: body, d: dark, w: "#ffffff", k: "#0c0c0b" },
);
const SACK_RED = SACK(RED, "#b32416", "#ff9b91");
const SACK_GOLD = SACK(GOLD, GOLD2, "#fff1a8");

export class Arena {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private over: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private w = 1; private h = 1; private dpr = 1;
  W = 1000; H = 1000;
  private cam = { x: 0, y: 0 };
  private me: Sim;
  private meInfo: ArenaMe = { kind: "none", bag: "0", balance: 0, shieldBps: 0, raidsLeft: 0, maxRaids: 0, inFlight: "", svg: "" };
  private bodies = new Map<string, Sim>();
  private info = new Map<string, ArenaBody>();
  private order: string[] = [];
  private places: ArenaPlaces = { gate: "hidden", boss: { visible: true, ready: false, hp: 1 } };
  gate = { x: 0, y: 0 };
  boss = { x: 0, y: 0, angle: 0 };
  blocks: Block[] = [];
  private imgs = new Map<string, HTMLImageElement>();
  private greys = new Map<string, HTMLCanvasElement>();
  private tiles: HTMLCanvasElement | null = null;
  private particles: Particle[] = [];
  private motes: { x: number; y: number; s: number; p: number }[] = [];
  private bubbles: Bubble[] = [];
  private stick: { id: number; ox: number; oy: number; dx: number; dy: number } | null = null;
  private mouse: { id: number; x: number; y: number } | null = null;
  private keys = new Set<string>();
  private dashT = 0; private dashCool = 0; private dashDir = { x: 0, y: -1 };
  private facing = { x: 0, y: -1 };
  private lastGate = 0; private lastPulse = 0;
  private raf = 0; private last = 0; private t = 0;
  private alive = true;
  private colors = { field: "#070910", grid: "rgba(39,240,255,0.07)", ink: "#e8eaf2", dim: "#8b90a3", line: "#2a2e3d", bg: "#05060a" };
  private colorT = 0;
  private shakeT = 0;
  private flashT = 0; private flashC = RED;
  private stopT = 0; // hit stop
  fps = 60;
  ready = false;
  onDash: ((cool: number) => void) | null = null;
  /** Space on desktop: the page decides whether a shot may go (gold only). */
  onShootKey: (() => void) | null = null;
  /** Auto fire at the locked target: the page runs the same checks as the SHOOT button. */
  onAutoFire: (() => void) | null = null;
  /** You tapped a body (or Satoshi, or empty floor: null). */
  onLock: ((id: string | null) => void) | null = null;
  /** A raider's shot just landed on you (from, counter shot?). The page pins the strip. */
  onHitMe: ((from: string, counter: boolean) => void) | null = null;
  /** The body you tapped: shots go to it, and while it can be raided they fire on their own. */
  lockId: string | null = null;
  private tap: { id: number; x: number; y: number; t: number; moved: number } | null = null;
  private autoCool = 0;
  private leakT = 0;
  private incomeT = 0;
  /** World distance you have steered since the last spawn (the guide's first step). */
  travelled = 0;
  private guide: GuideTarget = null;
  /** Phone or low power mode: fewer pixels, fewer bodies, no per frame gradients, cached floor. */
  lowPower = false;
  /** Measurement only: stops the frame time check from switching low power on. */
  powerLocked = false;
  /** Frames still over 20 ms in low power mode: draw at 1x. */
  slowDevice = false;
  private slowFrames = 0;
  private shots: Shot[] = [];
  private shotCool = 0;
  private ringHit = new Map<string, number>(); // shield ring flash per body ("me" for you)
  private badges = new Map<string, Badge>(); // HIT, BLOCKED and such, over a body for a moment
  private shattered = new Map<string, number>(); // a robbed body in pieces, reforming (seconds left)
  private hintPointer: { id: string; until: number } | null = null; // an edge pointer asked for by the page
  private hintIds = new Set<string>(); // bodies whose reason line is drawn this frame
  /** Which bodies a shot may snap to right now (set by the page: raidable, the raider, Satoshi when ready). */
  targets = new Set<string>();
  private labelCache = new Map<string, { cv: HTMLCanvasElement; w: number; h: number }>();
  private floorCache: HTMLCanvasElement | null = null;
  private floorKey = "";

  constructor(host: HTMLElement, private cb: ArenaCallbacks) {
    this.el = document.createElement("div");
    this.el.className = "arena";
    this.el.innerHTML = `<canvas aria-label="The arena"></canvas><div class="ar-over" aria-hidden="true"></div>`;
    host.appendChild(this.el);
    this.canvas = this.el.querySelector("canvas")!;
    this.over = this.el.querySelector(".ar-over")!;
    this.ctx = this.canvas.getContext("2d", { alpha: false })!;
    this.lowPower = detectLowPower();
    this.me = this.sim(ME, 0, 0, 24);
    this.img("__sack_red__", SACK_RED);
    this.img("__sack_gold__", SACK_GOLD);
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
    this.me.r = m.kind === "none" ? 24 : radiusFor(m.balance) + 2;
    if (was === "none" && m.kind !== "none") this.spawn();
    this.ready = true;
  }

  setPlaces(p: ArenaPlaces) { this.places = p; }
  /** The guide's arrow: what to touch next (null hides it). */
  setGuide(g: GuideTarget) { this.guide = g; }
  /** True while a guide card covers the top of the arena (the minimap steps aside). */
  cardOn = false;
  /** Screen px at the top that a card covers: edge pointers and labels stay below it. */
  topInset = 0;
  /** How many bodies the page should hand over: fewer on a phone. */
  get bodyCap() { return this.lowPower ? 25 : 60; }

  setBodies(list: ArenaBody[]) {
    const seen = new Set<string>();
    for (const b of list) {
      seen.add(b.id);
      const prev = this.info.get(b.id);
      this.info.set(b.id, b);
      this.img(b.id, b.svg);
      let s = this.bodies.get(b.id);
      if (!s) {
        const seed = hash32(b.id);
        let hx = 0, hy = 0;
        for (let k = 0; k < 12; k++) {
          hx = lerp(this.W * 0.08, this.W * 0.92, rnd(seed, 10 + k));
          hy = lerp(this.H * 0.08, this.H * 0.92, rnd(seed, 30 + k));
          const nearSpawn = Math.hypot(hx - this.w * 0.6, hy - (this.H - this.h * 0.6)) < this.W * 0.3;
          const nearBoss = Math.hypot(hx - this.W / 2, hy - this.H / 2) < 200;
          const nearGate = Math.hypot(hx - this.gate.x, hy - this.gate.y) < 140;
          if (!nearSpawn && !nearBoss && !nearGate && !this.inBlock(hx, hy, 30)) break;
        }
        s = this.sim(b.id, hx, hy, radiusFor(b.balance));
        s.hx = hx; s.hy = hy;
        this.bodies.set(b.id, s);
      }
      s.r = radiusFor(b.balance);
      if (b.hunting && !(prev && prev.hunting)) s.lock = 1.4;
    }
    for (const id of [...this.bodies.keys()]) if (!seen.has(id)) { this.bodies.delete(id); this.info.delete(id); }
    this.order = list.map((b) => b.id);
  }

  /** A speech bubble over a body ("me" for you, "satoshi" for the boss). */
  /** Set by the page: true while another text (the strip, a toast) is on screen. */
  quiet: () => boolean = () => false;
  say(id: string, text: string, ms = 3600, force = false) {
    if (!text) return;
    if (this.quiet() && !force) return; // one message at a time (a shot's answer always shows, at the body)
    if (!force && id !== "me" && id !== "satoshi" && this.info.get(id) && !this.info.get(id)!.focus) return; // bystanders keep quiet
    if (id !== "me" && id !== "satoshi" && !this.bodies.has(id)) return;
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
    const s = this.simOf(id);
    if (!s) return null;
    const p = this.toScreen(s.x, s.y);
    return { x: (p.x / this.w) * 100, y: (p.y / this.h) * 100 };
  }

  burst(id: string, color = GOLD, n = 14) {
    const s = this.simOf(id); if (!s) return;
    if (reducedMotion()) n = Math.min(n, 4);
    else if (this.lowPower) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 90 + Math.random() * 160;
      this.particles.push({ x: s.x, y: s.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, t: 0, life: 0.7 + Math.random() * 0.4, c: color, s: 5, g: 420 });
    }
  }
  fly(from: string, to: string, color = GOLD, n = 10) {
    const a = this.simOf(from), b = this.simOf(to); if (!a || !b) return;
    if (reducedMotion()) n = 2;
    else if (this.lowPower) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) this.particles.push({ x: a.x + (Math.random() - 0.5) * 20, y: a.y + (Math.random() - 0.5) * 20, vx: 0, vy: 0, t: -i * 0.04, life: 0.6, c: color, s: 5, tx: b.x, ty: b.y });
  }
  shake() { if (!reducedMotion()) this.shakeT = 0.4; }
  flash(c = RED) { if (!reducedMotion()) { this.flashT = 0.22; this.flashC = c; } }
  /** A short freeze frame on a big contact. */
  hitstop(ms = 90) { if (!reducedMotion()) this.stopT = ms / 1000; }

  dash() {
    if (this.dashCool > 0 || this.meInfo.kind === "none") return false;
    const d = this.inputDir();
    const m = Math.hypot(d.x, d.y);
    this.dashDir = m > 0.1 ? { x: d.x / m, y: d.y / m } : { ...this.facing };
    this.dashT = DASH_MS / 1000;
    this.dashCool = DASH_COOL / 1000;
    // dust puffs
    for (let i = 0; i < (reducedMotion() ? 2 : this.lowPower ? 5 : 10); i++) this.particles.push({ x: this.me.x - this.dashDir.x * this.me.r * 0.6, y: this.me.y + this.me.r * 0.6, vx: -this.dashDir.x * (60 + Math.random() * 90) + (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 40, t: 0, life: 0.45 + Math.random() * 0.2, c: "rgba(200,200,210,0.5)", s: 4 + Math.round(Math.random() * 4), g: -40 });
    return true;
  }
  get dashReady() { return this.dashCool <= 0; }
  get shootReady() { return this.shotCool <= 0 && this.meInfo.kind !== "none"; }

  /** Fire where you face, snapping to the nearest target in the aim cone. Local and free; the hit decides. */
  shoot(): boolean {
    if (!this.shootReady) return false;
    this.shotCool = SHOT_COOL;
    const d = this.inputDir();
    const m = Math.hypot(d.x, d.y);
    let dir = m > 0.1 ? { x: d.x / m, y: d.y / m } : { ...this.facing };
    const aim = this.aimTarget(dir);
    if (aim) { const s = this.simOf(aim)!; const dx = s.x - this.me.x, dy = s.y - this.me.y, l = Math.hypot(dx, dy) || 1; dir = { x: dx / l, y: dy / l }; }
    this.shots.push({ x: this.me.x + dir.x * (this.me.r + 6), y: this.me.y + dir.y * (this.me.r + 6) - 6, vx: dir.x * SHOT_SPEED, vy: dir.y * SHOT_SPEED, t: 0, from: "me", target: aim, mine: true });
    this.me.vx -= dir.x * 60; this.me.vy -= dir.y * 60; // recoil
    this.facing = dir;
    if (!reducedMotion()) for (let i = 0; i < (this.lowPower ? 2 : 4); i++) this.particles.push({ x: this.me.x + dir.x * (this.me.r + 8), y: this.me.y + dir.y * (this.me.r + 8) - 6, vx: dir.x * 120 + (Math.random() - 0.5) * 120, vy: dir.y * 120 + (Math.random() - 0.5) * 120, t: 0, life: 0.18, c: "#fff", s: 3, g: 0 });
    return true;
  }
  /** The target your next shot would snap to, or null. */
  aimTarget(dir = this.facing): string | null {
    // what you tapped comes first
    if (this.lockId && this.targets.has(this.lockId) && this.distTo(this.lockId) <= this.viewSpan) return this.lockId;
    // then the tight cone; when nothing is in it, a wider one; then the nearest target on screen (a thumb is not a crosshair)
    return this.aimIn(dir, AIM_HALF) ?? this.aimIn(dir, AIM_HALF * 2.6) ?? this.nearestTarget();
  }
  /** The closest body a shot may go to within about a screen; the one charging you comes first. */
  private nearestTarget(): string | null {
    let best: string | null = null, bd = Infinity;
    const range = this.viewSpan * 0.7;
    for (const id of this.targets) {
      const d = this.distTo(id);
      if (d > range) continue;
      const score = id !== "satoshi" && this.info.get(id)?.raidingMe ? d - 10000 : d;
      if (score < bd) { bd = score; best = id; }
    }
    return best;
  }
  /** Lock onto a body from the page (the raider when a raid on your vault opens). */
  lockOn(id: string | null) { this.lockId = id; }
  /** What a tap at this screen point hits: the nearest body, Satoshi, or nothing. */
  private pick(sx: number, sy: number): string | null {
    const x = sx + this.cam.x, y = sy + this.cam.y;
    let best: string | null = null, bd = Infinity;
    for (const [id, s] of this.bodies) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < s.r + 26 && d < bd) { bd = d; best = id; }
    }
    if (!best && this.places.boss.visible && Math.hypot(this.boss.x - x, this.boss.y - y) < 86) best = "satoshi";
    return best;
  }
  private tapAt(sx: number, sy: number) {
    if (this.meInfo.kind === "none") return;
    const id = this.pick(sx, sy);
    this.lockId = id;
    if (id) { const s = this.simOf(id); if (s) this.deflectAt(s.x, s.y, GOLD); }
    this.autoCool = 0;
    this.onLock?.(id);
  }
  private aimIn(dir: { x: number; y: number }, half0: number): string | null {
    let best: string | null = null, bd = Infinity;
    const range = this.viewSpan;
    for (const id of this.targets) {
      const s = this.simOf(id); if (!s) continue;
      const dx = s.x - this.me.x, dy = s.y - this.me.y, dist = Math.hypot(dx, dy);
      if (dist > range || dist < 1) continue;
      const ang = Math.acos(clamp((dx * dir.x + dy * dir.y) / dist, -1, 1));
      const half = id === "satoshi" ? half0 * 1.5 : half0; // the boss is a big target
      if (ang > half) continue;
      const raider = id !== "satoshi" && !!this.info.get(id)?.raidingMe; // the one charging you comes first
      const score = raider ? dist - 10000 : dist;
      if (score < bd) { bd = score; best = id; }
    }
    return best;
  }
  /** A raider fires at you: the picture of a raid the chain already confirmed. It starts at the raider's body, or from the
   * screen edge in its real direction when it is off screen, and it always lands. `quiet`: a counter shot (the page labels it). */
  npcShot(from: string, quiet = false) {
    const s = this.bodies.get(from);
    let sx: number, sy: number;
    if (s) { sx = s.x; sy = s.y; }
    else { // not drawn right now: come in from the top edge of the view
      sx = this.cam.x + this.w * 0.5; sy = this.cam.y - 40;
    }
    const dx = this.me.x - sx, dy = this.me.y - sy, l = Math.hypot(dx, dy) || 1;
    const r0 = s ? s.r + 6 : 0;
    this.shots.push({ x: sx + (dx / l) * r0, y: sy + (dy / l) * r0 - 6, vx: (dx / l) * SHOT_SPEED * 0.8, vy: (dy / l) * SHOT_SPEED * 0.8, t: 0, from, target: ME, mine: false, sure: true, quiet });
  }
  /** A word over a body for a moment: HIT, BLOCKED, a number. "me" for you. */
  badge(id: string, text: string, color = "#fff", ms = 1600, big = true) {
    this.badges.set(id === "me" ? ME : id, { text, until: performance.now() + ms, color, big });
  }
  /** A robbed body flies apart (shards in its colour, coins scatter and stream to you), then reforms: it is still a holder. */
  shatter(id: string, toMe = true) {
    const s = this.bodies.get(id); if (!s) return;
    const b = this.info.get(id);
    const col = b?.kind === "vault" ? GOLD : RED;
    this.shattered.set(id, 1.1);
    const n = reducedMotion() ? 4 : this.lowPower ? 12 : 22;
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 220; this.particles.push({ x: s.x + (Math.random() - 0.5) * s.r, y: s.y + (Math.random() - 0.5) * s.r, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, t: 0, life: 0.6 + Math.random() * 0.5, c: i % 3 === 0 ? "#0c0c0b" : col, s: 4 + Math.round(Math.random() * 4), g: 520 }); }
    const coins = reducedMotion() ? 3 : this.lowPower ? 8 : 14;
    for (let i = 0; i < coins; i++) { const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 140; this.particles.push({ x: s.x, y: s.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 160, t: 0, life: 0.5 + Math.random() * 0.3, c: GOLD, s: 6, g: 600 }); }
    if (toMe) for (let i = 0; i < coins; i++) this.particles.push({ x: s.x + (Math.random() - 0.5) * 40, y: s.y + (Math.random() - 0.5) * 40, vx: 0, vy: 0, t: -0.35 - i * 0.05, life: 0.7, c: GOLD, s: 6, tx: this.me.x, ty: this.me.y });
    this.hitstop(90);
  }
  /** Point at a body from the screen edge for a moment (SHOOT with nothing in range). */
  pointAt(id: string, ms = 3000) { this.hintPointer = { id, until: performance.now() + ms }; }
  /** The shield ring takes a hit: flash and cyan shards. */
  shieldHit(id: string) {
    const key = id === "me" ? ME : id;
    this.ringHit.set(key, 0.5);
    const s = this.simOf(id); if (!s) return;
    const n = reducedMotion() ? 2 : this.lowPower ? 5 : 10;
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2; this.particles.push({ x: s.x + Math.cos(a) * 30, y: s.y + Math.sin(a) * 30, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, t: 0, life: 0.4, c: CYAN, s: 3, g: 0 }); }
  }
  private deflectAt(x: number, y: number, color = "#fff") {
    const n = reducedMotion() ? 2 : this.lowPower ? 4 : 7;
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2; this.particles.push({ x, y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, t: 0, life: 0.3, c: color, s: 3, g: 0 }); }
  }
  /** The longer side of the view, in world px (one screen). */
  get viewSpan() { return Math.max(this.w, this.h); }
  /** Where Satoshi stands, relative to you. */
  get bossDist() { return Math.hypot(this.boss.x - this.me.x, this.boss.y - this.me.y); }
  /** Whether a bubble is showing on you right now. */
  get meSpeaking() { return this.bubbles.some((b) => b.id === ME); }
  get hunters() { return this.order.filter((id) => this.info.get(id)?.hunting || this.info.get(id)?.raidingMe); }
  distTo(id: string) { const s = this.simOf(id); return s ? Math.hypot(s.x - this.me.x, s.y - this.me.y) : Infinity; }
  setGateArt(svg: string) { this.img("__gate__", svg); }
  setBossArt(svg: string) { this.img("__boss__", svg); }

  destroy() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    this.el.remove();
  }

  // ---------------------------------------------------------------- setup

  private sim(id: string, x: number, y: number, r: number): Sim {
    return { id, x, y, vx: 0, vy: 0, r, hx: x, hy: y, seed: hash32(id), speed: 0, lastTouch: 0, tunnel: 0, trail: [], bounce: 0, face: 1, lock: 0 };
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
    this.greys.delete(id);
  }
  private resize(first: boolean) {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.w = Math.round(r.width); this.h = Math.round(r.height);
    this.dpr = Math.min(this.slowDevice ? 1 : this.lowPower ? 1.5 : 2, window.devicePixelRatio || 1);
    this.floorCache = null; this.floorKey = "";
    this.labelCache.clear();
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${this.h}px`;
    if (first || this.W === 1000) {
      // about 1.6 x 2.2 phone screens: never empty, always somewhere to run
      this.W = clamp(Math.round(this.w * 1.6), 620, 2000);
      this.H = clamp(Math.round(this.h * 2.2), 900, 2000);
      this.boss = { x: Math.round(this.W / 2), y: Math.round(this.H / 2), angle: 0 };
      this.gate = { x: Math.round(this.W * 0.8), y: Math.round(this.H * 0.21) }; // low enough that you stay clear of the top strip when you reach it
      this.me.x = Math.round(this.w * 0.6); this.me.y = Math.round(this.H - this.h * 0.6);
      this.cam = { x: this.boss.x - this.w / 2, y: this.boss.y - this.h / 2 };
      this.buildWorld();
    }
    this.tiles = null;
  }
  private buildWorld() {
    // obstacles: server racks, pillars and crates, placed off the spawn, gate and boss
    this.blocks = [];
    const seed = 4242;
    for (let i = 0; i < 14; i++) {
      const kind: Block["kind"] = i % 3 === 0 ? "pillar" : i % 3 === 1 ? "rack" : "crate";
      const w = kind === "rack" ? 44 : kind === "pillar" ? 40 : 56, h = kind === "rack" ? 88 : kind === "pillar" ? 40 : 44;
      for (let k = 0; k < 20; k++) {
        const x = Math.round(lerp(60, this.W - 60 - w, rnd(seed, i * 40 + k)) / 8) * 8;
        const y = Math.round(lerp(60, this.H - 60 - h, rnd(seed, i * 40 + 20 + k)) / 8) * 8;
        const cx = x + w / 2, cy = y + h / 2;
        if (Math.hypot(cx - this.w * 0.6, cy - (this.H - this.h * 0.6)) < 190) continue;
        if (Math.hypot(cx - this.gate.x, cy - this.gate.y) < 170) continue;
        if (Math.hypot(cx - this.boss.x, cy - this.boss.y) < 230) continue;
        if (this.blocks.some((b) => Math.abs(b.x + b.w / 2 - cx) < (b.w + w) / 2 + 70 && Math.abs(b.y + b.h / 2 - cy) < (b.h + h) / 2 + 70)) continue;
        this.blocks.push({ x, y, w, h, kind, seed: hash32(`b${i}`) });
        break;
      }
    }
    this.motes = Array.from({ length: 14 }, (_, i) => ({ x: rnd(9, i) * this.W, y: rnd(10, i) * this.H, s: 1 + Math.round(rnd(11, i) * 2), p: rnd(12, i) * 6.28 }));
  }
  private inBlock(x: number, y: number, pad: number) {
    return this.blocks.some((b) => x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad);
  }
  /** Push a circle out of every block it overlaps. */
  private collide(s: { x: number; y: number; vx: number; vy: number; r: number }) {
    for (const b of this.blocks) {
      const cx = clamp(s.x, b.x, b.x + b.w), cy = clamp(s.y, b.y, b.y + b.h);
      const dx = s.x - cx, dy = s.y - cy, d = Math.hypot(dx, dy);
      const rr = s.r * 0.8;
      if (d >= rr) continue;
      if (d === 0) { s.y = b.y - rr; s.vy = 0; continue; }
      const push = rr - d;
      s.x += (dx / d) * push; s.y += (dy / d) * push;
      const dot = s.vx * (dx / d) + s.vy * (dy / d);
      if (dot < 0) { s.vx -= (dx / d) * dot; s.vy -= (dy / d) * dot; }
    }
  }
  private spawn() {
    this.me.x = Math.round(this.w * 0.6); this.me.y = Math.round(this.H - this.h * 0.6); this.me.vx = this.me.vy = 0;
    this.travelled = 0;
    this.burst("me", RED, 12);
  }
  private readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (k: string, d: string) => cs.getPropertyValue(k).trim() || d;
    const next = { field: v("--field", "#070910"), grid: v("--grid", "rgba(39,240,255,0.07)"), ink: v("--ink", "#e8eaf2"), dim: v("--dim", "#8b90a3"), line: v("--line2", "#2a2e3d"), bg: v("--bg", "#05060a") };
    if (next.field !== this.colors.field) this.tiles = null;
    if (next.bg !== this.colors.bg || next.ink !== this.colors.ink) this.labelCache.clear();
    this.colors = next;
  }
  /** Pre-render the floor tiles: 6 variants of a 48 px circuit floor. */
  private tileAtlas(): HTMLCanvasElement {
    if (this.tiles) return this.tiles;
    const n = 6, c = document.createElement("canvas");
    c.width = TILE * n * this.dpr; c.height = TILE * this.dpr;
    const g = c.getContext("2d")!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    const light = document.documentElement.getAttribute("data-theme") === "light" || (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: light)").matches);
    const base = this.colors.field, seam = light ? "rgba(0,0,0,0.055)" : "rgba(255,255,255,0.03)", trace = light ? "rgba(10,143,156,0.15)" : "rgba(39,240,255,0.09)", bolt = light ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.06)";
    for (let i = 0; i < n; i++) {
      const ox = i * TILE;
      g.fillStyle = base; g.fillRect(ox, 0, TILE, TILE);
      g.fillStyle = seam; g.fillRect(ox, 0, TILE, 1); g.fillRect(ox, 0, 1, TILE);
      g.fillStyle = bolt;
      [[3, 3], [TILE - 6, 3], [3, TILE - 6], [TILE - 6, TILE - 6]].forEach(([x, y]) => g.fillRect(ox + x, y, 2, 2));
      g.fillStyle = trace;
      if (i === 1) { g.fillRect(ox + 10, 23, 28, 2); g.fillRect(ox + 36, 12, 2, 13); g.fillRect(ox + 35, 9, 4, 4); }
      if (i === 2) { g.fillRect(ox + 23, 8, 2, 32); g.fillRect(ox + 12, 30, 13, 2); g.fillRect(ox + 10, 29, 4, 4); }
      if (i === 3) { for (let y = 12; y < 36; y += 6) g.fillRect(ox + 14, y, 20, 2); }
      if (i === 4) { g.fillRect(ox + 8, 8, 2, 2); g.fillRect(ox + 38, 38, 2, 2); g.fillRect(ox + 8, 38, 2, 2); g.fillRect(ox + 38, 8, 2, 2); g.fillRect(ox + 10, 9, 28, 1); g.fillRect(ox + 10, 39, 28, 1); }
      if (i === 5) { g.fillRect(ox + 20, 20, 8, 8); g.fillStyle = base; g.fillRect(ox + 22, 22, 4, 4); }
    }
    this.tiles = c;
    return c;
  }

  // ---------------------------------------------------------------- input

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    this.tap = { id: e.pointerId, x, y, t: performance.now(), moved: 0 };
    if (e.pointerType === "mouse") { this.mouse = { id: e.pointerId, x, y }; return; }
    if (y < this.h * 0.4 || this.stick) return; // the lower 60% is the thumb zone
    this.stick = { id: e.pointerId, ox: x, oy: y, dx: 0, dy: 0 };
  };
  private onMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (this.tap && this.tap.id === e.pointerId) this.tap.moved = Math.max(this.tap.moved, Math.hypot(x - this.tap.x, y - this.tap.y));
    if (this.mouse && this.mouse.id === e.pointerId) { this.mouse.x = x; this.mouse.y = y; return; }
    if (!this.stick || this.stick.id !== e.pointerId) return;
    e.preventDefault();
    const R = 52;
    let dx = x - this.stick.ox, dy = y - this.stick.oy;
    const m = Math.hypot(dx, dy);
    if (m > R) { this.stick.ox = x - (dx / m) * R; this.stick.oy = y - (dy / m) * R; dx = (dx / m) * R; dy = (dy / m) * R; }
    this.stick.dx = dx / R; this.stick.dy = dy / R;
  };
  private onUp = (e: PointerEvent) => {
    // a quick touch that barely moved is a tap: lock onto what it touched
    const tp = this.tap;
    if (tp && tp.id === e.pointerId) {
      this.tap = null;
      if (e.type === "pointerup" && tp.moved < 14 && performance.now() - tp.t < 350) this.tapAt(tp.x, tp.y);
    }
    if (this.stick && this.stick.id === e.pointerId) this.stick = null;
    if (this.mouse && this.mouse.id === e.pointerId) this.mouse = null;
  };
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift"].includes(k)) {
      if (k === " " || k === "arrowup" || k === "arrowdown") e.preventDefault();
      if (e.type === "keydown") { this.keys.add(k); if (k === "shift") this.dash(); if (k === " " && !e.repeat) this.onShootKey?.(); }
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
    if (dt > 0.1) dt = 0.1;
    if (dt > 0) this.fps = lerp(this.fps, 1 / dt, 0.05);
    // a frame over 20 ms for two seconds running: this device wants the low power path
    if (!this.powerLocked && !document.hidden && !(this.lowPower && this.slowDevice)) {
      this.slowFrames = dt > 0.02 ? this.slowFrames + dt : 0;
      if (this.slowFrames > 2) {
        this.slowFrames = 0;
        if (!this.lowPower) this.lowPower = true; // first tier: fewer bodies, no gradients, cached floor, 1.5x pixels
        else this.slowDevice = true; // second tier: 1x pixels
        this.resize(false);
      }
    }
    this.colorT += dt;
    if (this.colorT > 2) { this.colorT = 0; this.readColors(); }
    if (this.stopT > 0) { this.stopT -= dt; this.draw(now); return; }
    this.t += dt;
    this.step(dt);
    this.draw(now);
  };

  private step(dt: number) {
    const me = this.me;
    const playing = this.meInfo.kind !== "none";
    if (playing) {
      const d = this.inputDir();
      const k = 1 - Math.exp(-dt * 9);
      me.vx = lerp(me.vx, d.x * ME_SPEED, k);
      me.vy = lerp(me.vy, d.y * ME_SPEED, k);
      if (Math.hypot(d.x, d.y) > 0.2) { const m = Math.hypot(d.x, d.y); this.facing = { x: d.x / m, y: d.y / m }; if (Math.abs(d.x) > 0.2) me.face = d.x > 0 ? 1 : -1; }
      if (this.dashT > 0) {
        const f = this.dashT / (DASH_MS / 1000);
        me.vx += this.dashDir.x * DASH_SPEED * f * dt * 6;
        me.vy += this.dashDir.y * DASH_SPEED * f * dt * 6;
        this.dashT -= dt;
      }
      if (this.dashCool > 0) { this.dashCool -= dt; this.onDash?.(clamp(1 - this.dashCool / (DASH_COOL / 1000), 0, 1)); }
      me.x += me.vx * dt; me.y += me.vy * dt;
      if (this.dashT <= 0) this.travelled += Math.hypot(me.vx, me.vy) * dt;
      this.collide(me);
      me.x = clamp(me.x, me.r, this.W - me.r); me.y = clamp(me.y, me.r, this.H - me.r);
      if (!reducedMotion() && Math.hypot(me.vx, me.vy) > 50) { me.trail.push({ x: me.x, y: me.y + me.r * 0.5 }); if (me.trail.length > 7) me.trail.shift(); } else if (me.trail.length) me.trail.shift();
    }
    // bodies never sit on top of each other: push overlapping pairs apart (cheap at 60 bodies)
    {
      const list = this.order.map((id) => this.bodies.get(id)).filter(Boolean) as { x: number; y: number; r: number }[];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], c = list[j];
        const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = (a.r + c.r) * 1.05;
        if (d >= min) continue;
        const push = Math.min((min - d) / 2, 120 * dt + 1), nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push;
      }
    }
    const nowMs = performance.now();
    for (const id of this.order) {
      const s = this.bodies.get(id)!, b = this.info.get(id)!;
      if (!s || !b) continue;
      const dx = me.x - s.x, dy = me.y - s.y, dist = Math.hypot(dx, dy) || 1;
      let tx = 0, ty = 0, want = 0;
      if (b.hunting && playing) {
        if (dist > TUNNEL_FROM && s.tunnel <= 0) { s.x = me.x - (dx / dist) * TUNNEL_TO; s.y = me.y - (dy / dist) * TUNNEL_TO; s.tunnel = 0.6; s.speed = 40; }
        want = b.npc === "shor" ? CHASE.shor : b.npc === "grover" ? CHASE.grover : CHASE.qubit;
        s.speed = Math.min(want, s.speed + dt * 110);
        tx = dx / dist; ty = dy / dist;
      } else if (b.raidingMe && playing) {
        if (this.meInfo.kind === "vault") { want = CHASE.charge; s.speed = Math.min(want, s.speed + dt * 160); tx = dx / dist; ty = dy / dist; }
        else { want = dist > 110 ? CHASE.follow : 0; s.speed = want; tx = dx / dist; ty = dy / dist; }
      } else if (b.raidedByMe && b.kind === "exposed" && playing) {
        want = dist < 480 ? CHASE.flee : 0; s.speed = want; tx = -dx / dist; ty = -dy / dist;
      } else if (this.meInfo.kind === "vault" && b.kind === "exposed" && b.state === "open" && dist < 280) {
        // a red bag you can rob runs when a gold hunter comes close (slower than you: you can catch it)
        want = CHASE.flee * 0.85; s.speed = Math.min(want, s.speed + dt * 140); tx = -dx / dist; ty = -dy / dist;
      } else {
        s.speed = 0;
        const a = 40 + rnd(s.seed, 1) * 60, f1 = 0.12 + rnd(s.seed, 2) * 0.12, f2 = 0.09 + rnd(s.seed, 3) * 0.1, ph = rnd(s.seed, 4) * 6.28;
        const gx = s.hx + Math.sin(this.t * f1 + ph) * a, gy = s.hy + Math.cos(this.t * f2 + ph) * a;
        s.vx = lerp(s.vx, (gx - s.x) * 1.4, 1 - Math.exp(-dt * 3));
        s.vy = lerp(s.vy, (gy - s.y) * 1.4, 1 - Math.exp(-dt * 3));
      }
      if (want || s.speed) {
        // steer around blocks: if the straight line hits one, slide along it
        s.vx = lerp(s.vx, tx * s.speed, 1 - Math.exp(-dt * 5));
        s.vy = lerp(s.vy, ty * s.speed, 1 - Math.exp(-dt * 5));
      }
      s.x += s.vx * dt; s.y += s.vy * dt;
      this.collide(s);
      s.x = clamp(s.x, s.r, this.W - s.r); s.y = clamp(s.y, s.r, this.H - s.r);
      if (Math.abs(s.vx) > 12) s.face = s.vx > 0 ? 1 : -1;
      if (s.tunnel > 0) s.tunnel -= dt;
      if (s.bounce > 0) s.bounce -= dt;
      if (s.lock > 0) s.lock -= dt;
      if ((b.hunting || b.raidingMe) && !reducedMotion() && Math.hypot(s.vx, s.vy) > 40) { s.trail.push({ x: s.x, y: s.y }); if (s.trail.length > 8) s.trail.shift(); } else if (s.trail.length) s.trail.shift();
      const bx = s.x - this.boss.x, by = s.y - this.boss.y, bd = Math.hypot(bx, by) || 1;
      if (bd < 80 + s.r) { s.x = this.boss.x + (bx / bd) * (80 + s.r); s.y = this.boss.y + (by / bd) * (80 + s.r); }
      if (playing) {
        const d2 = Math.hypot(me.x - s.x, me.y - s.y) || 1;
        const min = (me.r + s.r) * 0.9;
        if (d2 < min) {
          const nx = (me.x - s.x) / d2, ny = (me.y - s.y) / d2;
          const push = (min - d2) / 2 + 1;
          me.x += nx * push; me.y += ny * push; s.x -= nx * push; s.y -= ny * push;
          const imp = 150;
          me.vx += nx * imp; me.vy += ny * imp; s.vx -= nx * imp * 0.6; s.vy -= ny * imp * 0.6;
          s.bounce = 0.3; me.bounce = 0.3;
          // only a hunter's touch means anything (the server decides); your own contact fires nothing
          if ((b.hunting || b.raidingMe) && nowMs - s.lastTouch > TOUCH_GAP) { s.lastTouch = nowMs; this.hitstop(70); this.cb.onTouch(id, b); }
        }
      }
    }
    this.stepShots(dt);
    this.stepLock(dt);
    if (playing) this.stepCoins(dt);
    if (playing && this.places.gate !== "hidden") {
      const d = Math.hypot(me.x - this.gate.x, me.y - this.gate.y);
      if (d < 50 + me.r * 0.5 && nowMs - this.lastGate > 4000) { this.lastGate = nowMs; this.cb.onGate(); }
    }
    this.boss.angle += dt * (reducedMotion() ? 0.25 : 0.55);
    if (playing && this.places.boss.visible) {
      const bx = me.x - this.boss.x, by = me.y - this.boss.y, bd = Math.hypot(bx, by) || 1;
      const R = 90, half = 0.95;
      const ang = Math.atan2(by, bx);
      const diff = Math.abs(((ang - this.boss.angle) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (Math.abs(bd - R) < 14 + me.r && diff < half) {
        me.vx += (bx / bd) * 520; me.vy += (by / bd) * 520;
        if (nowMs - this.lastPulse > 1500) { this.lastPulse = nowMs; this.cb.onPulse(); this.shake(); }
      }
      if (bd < 74 + me.r) {
        me.x = this.boss.x + (bx / bd) * (74 + me.r); me.y = this.boss.y + (by / bd) * (74 + me.r);
        me.vx += (bx / bd) * 120; me.vy += (by / bd) * 120;
      }
    }
    if (me.bounce > 0) me.bounce -= dt;
    const k = 1 - Math.exp(-dt * 6);
    const look = playing ? me : this.boss;
    // the world edge may show a little (hazard border) rather than push you into a corner:
    // you stay at least a quarter screen from any edge
    const cx0 = clamp(lerp(this.cam.x, look.x - this.w / 2, k), -this.w * 0.25, this.W - this.w * 0.75);
    const cy0 = clamp(lerp(this.cam.y, look.y - this.h / 2, k), -this.h * 0.25, this.H - this.h * 0.75);
    this.cam.x = playing ? clamp(cx0, look.x - this.w * 0.75, look.x - this.w * 0.25) : cx0;
    this.cam.y = playing ? clamp(cy0, look.y - this.h * 0.75, look.y - this.h * 0.25) : cy0;
    // the guide card covers the top: what the step points at must sit in the clear area below it
    if (playing && this.cardOn && this.guide && this.guide.kind !== "me") {
      const g = this.guide;
      const s = g.kind === "gate" ? this.gate : g.kind === "boss" ? this.boss : g.id ? this.bodies.get(g.id) : null;
      if (s) {
        const clearTop = this.topInset + (g.kind === "boss" ? 110 : 70);
        if (s.y - this.cam.y < clearTop) this.cam.y = Math.max(s.y - clearTop, me.y - (this.h - 80)); // pan up, but keep you on screen
      }
    }
    for (const p of this.particles) {
      p.t += dt;
      if (p.t < 0) continue;
      if (p.tx !== undefined) {
        const f = clamp(p.t / p.life, 0, 1), e = f * f * (3 - 2 * f);
        p.x = lerp(p.x, p.tx, e * 0.25 + 0.05); p.y = lerp(p.y, p.ty!, e * 0.25 + 0.05);
      } else { p.vy += (p.g ?? 420) * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    }
    this.particles = this.particles.filter((p) => p.t < p.life);
    if (!this.lowPower) for (const m of this.motes) { m.y -= dt * (6 + m.s * 3); m.x += Math.sin(this.t * 0.5 + m.p) * dt * 8; if (m.y < -4) { m.y = this.H + 4; m.x = Math.random() * this.W; } }
    if (this.shakeT > 0) this.shakeT -= dt;
    if (this.flashT > 0) this.flashT -= dt;
  }

  /** The tapped target: drop it when it is gone or your raid on it is on; fire on your own while it can be raided. */
  private stepLock(dt: number) {
    if (this.autoCool > 0) this.autoCool -= dt;
    const id = this.lockId;
    if (!id) return;
    if (id !== "satoshi") {
      const b = this.info.get(id);
      if (!b || !this.bodies.has(id) || (b.raidedByMe && !b.raidingMe)) { this.lockId = null; return; }
    }
    if (this.meInfo.kind !== "vault" || this.autoCool > 0 || !this.shootReady) return;
    if (!this.targets.has(id) || this.distTo(id) > this.viewSpan * 0.6) return;
    this.autoCool = 1.1; // one try a second: the page refuses while a move is signing
    this.onAutoFire?.();
  }

  /** Coins you can see: an exposed bag leaks behind you; a vault draws a thin stream from the exposed bags around it.
   * A picture of the harvest rule (2.5% of every exposed bag each epoch, half to vaults), not money: the HUD numbers come from the chain. */
  private stepCoins(dt: number) {
    if (reducedMotion()) return;
    const me = this.me;
    if (this.meInfo.kind === "exposed" && this.meInfo.balance > 0) {
      this.leakT += dt;
      const every = this.lowPower ? 0.4 : 0.22;
      if (this.leakT > every) {
        this.leakT = 0;
        this.particles.push({ x: me.x + (Math.random() - 0.5) * me.r, y: me.y + me.r * 0.7, vx: -me.vx * 0.25 + (Math.random() - 0.5) * 50, vy: -70 - Math.random() * 50, t: 0, life: 1.2, c: GOLD, s: 6, g: 300 });
      }
    }
    if (this.meInfo.kind === "vault") {
      this.incomeT += dt;
      const every = this.lowPower ? 1.1 : 0.55;
      if (this.incomeT > every) {
        this.incomeT = 0;
        const span = this.viewSpan;
        const from = this.order.filter((id) => { const b = this.info.get(id); return b && b.kind === "exposed" && b.state !== "frozen" && b.balance > 0 && this.distTo(id) < span; });
        if (from.length) {
          const s = this.bodies.get(from[Math.floor(Math.random() * from.length)])!;
          for (let i = 0; i < 2; i++) this.particles.push({ x: s.x, y: s.y, vx: 0, vy: 0, t: -i * 0.08, life: 1.4, c: GOLD, s: 5, tx: me.x, ty: me.y });
        }
      }
    }
  }

  /** Projectiles: fly, home a little onto their snapped target, stop on blocks, land on bodies. */
  private stepShots(dt: number) {
    if (this.shotCool > 0) this.shotCool -= dt;
    for (const [k, v] of this.ringHit) { if (v - dt <= 0) this.ringHit.delete(k); else this.ringHit.set(k, v - dt); }
    const me = this.me;
    const keep: Shot[] = [];
    for (const [k, v] of this.shattered) { if (v - dt <= 0) this.shattered.delete(k); else this.shattered.set(k, v - dt); }
    for (const p of this.shots) {
      p.t += dt;
      if (p.target) {
        const s = this.simOf(p.target === ME ? "me" : p.target);
        // a shot that must land (a raid already on chain) steers hard; yours steers a little
        if (s) { const dx = s.x - p.x, dy = s.y - p.y, l = Math.hypot(dx, dy) || 1, sp = Math.hypot(p.vx, p.vy); const k = 1 - Math.exp(-dt * (p.sure ? 16 : 6)); p.vx = lerp(p.vx, (dx / l) * sp, k); p.vy = lerp(p.vy, (dy / l) * sp, k); }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      // shots fly over blocks: cover cannot change the chain
      if (!p.sure && (p.t > SHOT_LIFE || p.x < 0 || p.y < 0 || p.x > this.W || p.y > this.H)) { this.deflectAt(p.x, p.y, this.colors.dim); continue; }
      let hit = false;
      if (p.mine) {
        // Satoshi's core
        if (this.places.boss.visible && Math.hypot(p.x - this.boss.x, p.y - this.boss.y) < 60) {
          const r = this.cb.onShot("satoshi");
          if (r.ok) { this.hitstop(110); this.burst("satoshi", GOLD, 12); } else { this.deflectAt(p.x, p.y, GOLD); this.say("satoshi", r.why || "", 2600, true); }
          hit = true;
        }
        if (!hit) for (const id of this.order) {
          const s = this.bodies.get(id)!, b = this.info.get(id)!;
          if (!s || !b) continue;
          if (Math.hypot(p.x - s.x, p.y - s.y) > s.r * (b.raidingMe ? 1.3 : 0.95)) continue; // a charging raider is a generous target
          const r = this.cb.onShot(id);
          if (b.shieldBps > 0) this.shieldHit(id);
          if (r.ok) { this.hitstop(80); s.bounce = 0.3; s.vx += p.vx * 0.15; s.vy += p.vy * 0.15; this.burst(id, b.kind === "vault" ? GOLD : RED, 8); }
          else { this.deflectAt(p.x, p.y, this.colors.dim); if (r.why) this.say(id, r.why, 2600, true); }
          hit = true;
          break;
        }
      } else if (Math.hypot(p.x - me.x, p.y - me.y) < me.r * 1.1 || (p.sure && p.t > 2.5)) {
        // a raider's shot lands on you (always: the raid is real)
        if (this.meInfo.shieldBps > 0) this.shieldHit("me"); else this.burst("me", RED, 8);
        me.bounce = 0.3; this.shake(); this.flash(); this.hitstop(70);
        if (!p.quiet) this.badge("me", "HIT", RED, 1400);
        this.onHitMe?.(p.from, !!p.quiet);
        hit = true;
      }
      if (!hit) keep.push(p);
    }
    this.shots = keep;
  }

  // ---------------------------------------------------------------- drawing

  private toScreen(x: number, y: number) { return { x: x - this.cam.x, y: y - this.cam.y }; }
  private font(px: number, weight = 700) { return `${weight} ${px}px 'QDAY Display', monospace`; }
  private mono(px: number) { return `500 ${px}px 'IBM Plex Mono', monospace`; }

  private draw(now: number) {
    const c = this.ctx, C = this.colors;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    c.fillStyle = C.bg;
    c.fillRect(0, 0, this.w, this.h);
    c.save();
    if (this.shakeT > 0) { const a = this.shakeT * 14; c.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a); }
    const ox = Math.round(this.cam.x), oy = Math.round(this.cam.y);
    c.translate(-ox, -oy);

    this.drawFloor(c, ox, oy);
    // motes
    c.fillStyle = C.ink;
    if (!this.lowPower) for (const m of this.motes) { if (m.x < ox - 4 || m.x > ox + this.w + 4 || m.y < oy - 4 || m.y > oy + this.h + 4) continue; c.globalAlpha = 0.12 + 0.12 * Math.sin(this.t * 1.5 + m.p); c.fillRect(Math.round(m.x), Math.round(m.y), m.s, m.s); }
    c.globalAlpha = 1;
    // the edge of the world
    c.fillStyle = C.line; c.fillRect(0, 0, this.W, 4); c.fillRect(0, this.H - 4, this.W, 4); c.fillRect(0, 0, 4, this.H); c.fillRect(this.W - 4, 0, 4, this.H);
    c.fillStyle = RED; c.globalAlpha = 0.5;
    for (let x = 0; x < this.W; x += 24) { c.fillRect(x, 0, 12, 4); c.fillRect(x + 12, this.H - 4, 12, 4); }
    for (let y = 0; y < this.H; y += 24) { c.fillRect(0, y + 12, 4, 12); c.fillRect(this.W - 4, y, 4, 12); }
    c.globalAlpha = 1;

    this.drawGate(c);
    for (const b of this.blocks) this.drawBlock(c, b, ox, oy);
    this.drawBoss(c);
    this.drawAim(c);
    this.drawLock(c);
    // reason lines: the nearest two bodies with a reason, and the one your aim is on
    this.hintIds.clear();
    if (this.meInfo.kind === "vault") {
      const near = this.order.filter((id) => this.info.get(id)?.hint).map((id) => ({ id, d: this.distTo(id) })).sort((a, b) => a.d - b.d).slice(0, 2);
      for (const n of near) if (n.d < 230) this.hintIds.add(n.id);
      const aim = this.aimTarget(); if (aim && aim !== "satoshi") this.hintIds.add(aim);
    }
    const ids = [...this.order].sort((a, b) => (this.bodies.get(a)?.y || 0) - (this.bodies.get(b)?.y || 0));
    const meDrawn = this.meInfo.kind !== "none";
    let drewMe = false;
    for (const id of ids) {
      const s = this.bodies.get(id)!;
      if (meDrawn && !drewMe && s.y > this.me.y) { this.drawMe(c, now); drewMe = true; }
      this.drawBody(c, s, this.info.get(id)!);
    }
    if (meDrawn && !drewMe) this.drawMe(c, now);
    this.flushLabels(c);
    this.drawRaidBadges(c);
    this.drawShots(c);
    this.drawParticles(c);
    this.drawGuideArrow(c);
    c.restore();

    if (this.flashT > 0) { c.globalAlpha = this.flashT * 1.6; c.fillStyle = this.flashC; c.fillRect(0, 0, this.w, this.h); c.globalAlpha = 1; }
    this.drawPointers(c);
    this.drawStick(c);
    this.drawMinimap(c);
    this.placeBubbles(now);
  }

  private drawFloor(c: CanvasRenderingContext2D, ox: number, oy: number) {
    const atlas = this.tileAtlas();
    const x0 = Math.max(0, Math.floor(ox / TILE)), x1 = Math.min(Math.ceil(this.W / TILE), Math.ceil((ox + this.w) / TILE) + 1);
    const y0 = Math.max(0, Math.floor(oy / TILE)), y1 = Math.min(Math.ceil(this.H / TILE), Math.ceil((oy + this.h) / TILE) + 1);
    if (this.lowPower) {
      // the floor is static: redraw the visible tile window only when the camera crosses a tile edge
      const key = `${x0},${y0},${x1},${y1},${this.colors.field}`;
      if (!this.floorCache || this.floorKey !== key) {
        const cw = (x1 - x0) * TILE, ch = (y1 - y0) * TILE;
        if (!this.floorCache || this.floorCache.width !== Math.round(cw * this.dpr) || this.floorCache.height !== Math.round(ch * this.dpr)) {
          this.floorCache = document.createElement("canvas");
          this.floorCache.width = Math.round(cw * this.dpr); this.floorCache.height = Math.round(ch * this.dpr);
        }
        const g = this.floorCache.getContext("2d")!;
        g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        g.imageSmoothingEnabled = false;
        for (let ty = y0; ty < y1; ty++)
          for (let tx = x0; tx < x1; tx++) {
            const r = hash32(`t${tx},${ty}`) % 10;
            const v = r < 5 ? 0 : r - 4;
            g.drawImage(atlas, v * TILE * this.dpr, 0, TILE * this.dpr, TILE * this.dpr, (tx - x0) * TILE, (ty - y0) * TILE, TILE, TILE);
          }
        this.floorKey = key;
      }
      c.drawImage(this.floorCache, 0, 0, this.floorCache.width, this.floorCache.height, x0 * TILE, y0 * TILE, (x1 - x0) * TILE, (y1 - y0) * TILE);
      return;
    }
    for (let ty = y0; ty < y1; ty++)
      for (let tx = x0; tx < x1; tx++) {
        const r = hash32(`t${tx},${ty}`) % 10;
        const v = r < 5 ? 0 : r - 4; // half the tiles are plain
        c.drawImage(atlas, v * TILE * this.dpr, 0, TILE * this.dpr, TILE * this.dpr, tx * TILE, ty * TILE, TILE, TILE);
      }
  }

  private drawBlock(c: CanvasRenderingContext2D, b: Block, ox: number, oy: number) {
    if (b.x + b.w < ox - 20 || b.x > ox + this.w + 20 || b.y + b.h < oy - 20 || b.y > oy + this.h + 20) return;
    const { x, y, w, h } = b;
    // shadow
    c.fillStyle = "rgba(0,0,0,0.45)"; c.fillRect(x + 4, y + 6, w, h);
    if (b.kind === "rack") {
      c.fillStyle = "#1a1d27"; c.fillRect(x, y, w, h);
      c.fillStyle = "#2a2e3d"; c.fillRect(x, y, w, 3); c.fillRect(x, y, 3, h);
      c.fillStyle = "#0c0e15"; c.fillRect(x + w - 3, y, 3, h); c.fillRect(x, y + h - 3, w, 3);
      for (let i = 0; i < Math.floor((h - 10) / 12); i++) {
        const yy = y + 6 + i * 12;
        c.fillStyle = "#11141d"; c.fillRect(x + 6, yy, w - 12, 8);
        const on = Math.floor(this.t * 3 + i + b.seed) % 5 !== 0;
        c.fillStyle = on ? (i % 3 === 0 ? GOLD : CYAN) : "#2a2e3d"; c.fillRect(x + w - 12, yy + 3, 3, 2);
        c.fillStyle = "#2a2e3d"; c.fillRect(x + 8, yy + 2, 10, 1); c.fillRect(x + 8, yy + 5, 14, 1);
      }
    } else if (b.kind === "pillar") {
      c.fillStyle = "#23262f"; c.fillRect(x, y, w, h);
      c.fillStyle = "#353947"; c.fillRect(x, y, w, 4); c.fillRect(x, y, 4, h);
      c.fillStyle = "#121419"; c.fillRect(x + w - 4, y, 4, h); c.fillRect(x, y + h - 4, w, 4);
      c.fillStyle = GOLD3; c.fillRect(x + 8, y + 8, w - 16, 4); c.fillRect(x + 8, y + h - 12, w - 16, 4);
    } else {
      c.fillStyle = "#3a2d12"; c.fillRect(x, y, w, h);
      c.fillStyle = "#54421c"; c.fillRect(x, y, w, 3); c.fillRect(x, y, 3, h);
      c.fillStyle = "#231a09"; c.fillRect(x + w - 3, y, 3, h); c.fillRect(x, y + h - 3, w, 3);
      c.fillStyle = "#54421c"; c.fillRect(x + 4, y + Math.floor(h / 2) - 1, w - 8, 2); c.fillRect(x + Math.floor(w / 2) - 1, y + 4, 2, h - 8);
      c.fillStyle = GOLD3; c.fillRect(x + 6, y + 6, 3, 3); c.fillRect(x + w - 9, y + h - 9, 3, 3);
    }
  }

  /** A desaturated copy of a portrait, made once (no per frame filter). */
  private grey(id: string): HTMLCanvasElement | null {
    const g = this.greys.get(id);
    if (g) return g;
    const im = this.imgs.get(id);
    if (!im || !im.complete || !im.naturalWidth) return null;
    const cv = document.createElement("canvas");
    cv.width = 96; cv.height = 96;
    const g2 = cv.getContext("2d")!;
    g2.imageSmoothingEnabled = false;
    g2.drawImage(im, 0, 0, 96, 96);
    const d = g2.getImageData(0, 0, 96, 96), px = d.data;
    for (let i = 0; i < px.length; i += 4) { const l = Math.round(px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11); px[i] = px[i + 1] = px[i + 2] = l; }
    g2.putImageData(d, 0, 0);
    this.greys.set(id, cv);
    return cv;
  }
  private sprite(c: CanvasRenderingContext2D, id: string, x: number, y: number, r: number, face: 1 | -1, bob: number, wobble: number, up = 1) {
    const im = this.imgs.get(id);
    const s = Math.round(r * 2);
    c.save();
    // facing is a lean, never a mirror: portraits carry digits
    c.translate(Math.round(x) + face * 2, Math.round(y + bob));
    if (!this.lowPower) { c.rotate(face * 0.05); c.scale(1 + wobble, 1 - wobble); } // axis aligned draws are far cheaper on a phone
    const ok = im && im.complete && im.naturalWidth;
    const gr = up < 1 ? this.grey(id) : null;
    if (gr) { c.drawImage(gr, -Math.round(s / 2), -Math.round(s / 2), s, s); if (up > 0.02 && ok) { const a = c.globalAlpha; c.globalAlpha = a * up; c.drawImage(im!, -Math.round(s / 2), -Math.round(s / 2), s, s); c.globalAlpha = a; } }
    else if (ok) c.drawImage(im!, -Math.round(s / 2), -Math.round(s / 2), s, s);
    else { c.fillStyle = "#191815"; c.fillRect(-Math.round(s / 2), -Math.round(s / 2), s, s); }
    c.restore();
  }
  private outline(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, w = 2) {
    const s = Math.round(r * 2);
    c.fillStyle = color;
    c.fillRect(Math.round(x - s / 2) - w, Math.round(y - s / 2) - w, s + w * 2, w);
    c.fillRect(Math.round(x - s / 2) - w, Math.round(y + s / 2), s + w * 2, w);
    c.fillRect(Math.round(x - s / 2) - w, Math.round(y - s / 2), w, s);
    c.fillRect(Math.round(x + s / 2), Math.round(y - s / 2), w, s);
  }
  private shadow(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
    c.fillStyle = "rgba(0,0,0,0.45)";
    c.fillRect(Math.round(x - r * 0.8), Math.round(y + r * 0.95), Math.round(r * 1.6), 4);
  }
  private blinkAt(seed: number) { return ((this.t * 1000 + seed) % 3400) < 110; }

  private drawBody(c: CanvasRenderingContext2D, s: Sim, b: ArenaBody) {
    const { x, y, r } = s;
    if (x < this.cam.x - 90 || x > this.cam.x + this.w + 90 || y < this.cam.y - 90 || y > this.cam.y + this.h + 90) return;
    // robbed: in pieces for a moment, then it reforms from small to full
    const sh = this.shattered.get(b.id);
    if (sh !== undefined) {
      if (sh > 0.5) return;
      const f = 1 - sh / 0.5;
      c.save(); c.translate(x, y); c.scale(0.2 + 0.8 * f, 0.2 + 0.8 * f); c.translate(-x, -y); c.globalAlpha = 0.4 + 0.6 * f;
      this.sprite(c, b.id, x, y, r, s.face, 0, 0);
      c.restore();
      return;
    }
    const dimmed = b.state === "busy" || b.state === "down" || b.state === "small" || b.state === "frozen";
    // bystanders are small, faint and quiet; they come up to full only right next to you
    const near = Math.hypot(x - this.me.x, y - this.me.y);
    const up = b.focus ? 1 : this.meInfo.kind === "none" ? 0.5 : clamp(1 - (near - 120) / 140, 0, 1);
    const draw = { r: r * (0.6 + 0.4 * up), alpha: 0.35 + 0.65 * up };
    const color = b.kind === "vault" ? GOLD : RED;
    const moving = Math.hypot(s.vx, s.vy) > 20;
    const hot = b.hunting || b.raidingMe;
    const bob = Math.sin(this.t * 3.2 + s.seed) * 1.5;
    const wobble = moving ? Math.sin(this.t * 14 + s.seed) * 0.06 : 0;
    c.save();
    if (s.tunnel > 0 && Math.floor(s.tunnel * 20) % 2 === 0) c.globalAlpha = 0.25;
    // trail and speed lines for hunters
    if (s.trail.length > 1) {
      for (let i = 0; i < s.trail.length; i++) { const p = s.trail[i], f = (i + 1) / s.trail.length; c.globalAlpha = f * 0.25; c.fillStyle = RED; const q = Math.max(2, Math.round(r * 0.5 * f)); c.fillRect(Math.round(p.x - q / 2), Math.round(p.y - q / 2), q, q); }
      c.globalAlpha = 1;
    }
    if (hot && moving) {
      c.strokeStyle = RED; c.globalAlpha = 0.6; c.lineWidth = 2;
      const nx = -s.vx / (Math.hypot(s.vx, s.vy) || 1), ny = -s.vy / (Math.hypot(s.vx, s.vy) || 1);
      for (let i = -1; i <= 1; i++) { const px = x + ny * i * r * 0.6, py = y - nx * i * r * 0.6; const len = 10 + ((this.t * 40 + i * 7) % 12); c.beginPath(); c.moveTo(px + nx * (r + 4), py + ny * (r + 4)); c.lineTo(px + nx * (r + 4 + len), py + ny * (r + 4 + len)); c.stroke(); }
      c.globalAlpha = 1;
    }
    if (dimmed || b.state === "rest") c.globalAlpha *= 0.6;
    c.globalAlpha *= draw.alpha;
    const r0 = r; const rr = draw.r;
    this.shadow(c, x, y + bob, rr);
    // exposed: dripping pixels
    if (b.kind === "exposed" && !dimmed && up > 0.5) {
      c.fillStyle = RED;
      const a0 = c.globalAlpha;
      for (let i = 0; i < 3; i++) { const ph = (this.t * 0.9 + rnd(s.seed, 50 + i)) % 1; c.globalAlpha = a0 * (1 - ph) * 0.9; c.fillRect(Math.round(x - rr + 4 + rnd(s.seed, 60 + i) * (rr * 2 - 10)), Math.round(y + rr + ph * 14), 3, 3); }
      c.globalAlpha = a0;
    }
    this.outline(c, x, y + bob, rr, up < 1 ? this.colors.dim : color, hot ? 3 : 2);
    this.sprite(c, b.id, x, y, rr, s.face, bob, wobble, up);
    const r1 = rr; void r0; // the badges below use the drawn size
    const rB = r1;
    // blink
    if (this.blinkAt(s.seed)) { c.fillStyle = "#0c0c0b"; c.fillRect(Math.round(x - rB * 0.7), Math.round(y + bob - rB * 0.35), Math.round(rB * 1.4), 3); }
    // hunters: red eyes
    if (hot) { c.fillStyle = RED; c.fillRect(Math.round(x - rB * 0.42), Math.round(y + bob - rB * 0.3), 4, 3); c.fillRect(Math.round(x + rB * 0.18), Math.round(y + bob - rB * 0.3), 4, 3); }
    this.shieldRing(c, b.id, x, y + bob, rr, b.shieldBps);
    c.restore();
    const close = near < (b.focus ? 230 : 150); // close enough to read the rule before you bump
    if (!b.focus && !close) return; // far bystanders: no badges, no labels
    c.save();
    const bx = x + rB + 2, by = y + bob - rB - 2;
    const iVault = this.meInfo.kind === "vault";
    // why you cannot raid it, as an icon: lock = out of your band, moon = resting, hourglass = already being raided
    if (iVault && (b.state === "down" || b.state === "small")) this.lock(c, bx, by, this.colors.dim);
    else if (iVault && b.state === "rest") this.moon(c, bx, by, this.colors.dim);
    else if (iVault && b.state === "busy") this.hourglass(c, bx, by, this.colors.dim);
    // what you can raid right now: a red target mark that pulses
    if (iVault && b.state === "open" && !hot) {
      const p = 0.5 + 0.5 * Math.sin(this.t * 5 + s.seed);
      const R2 = r + 9 + p * 3, L = 11;
      c.fillStyle = RED; c.globalAlpha = 0.75 + 0.25 * p;
      const corners: [number, number, number, number][] = [[-1, -1, 1, 1], [1, -1, -1, 1], [-1, 1, 1, -1], [1, 1, -1, -1]];
      for (const [sx, sy, dx, dy] of corners) {
        const cx = Math.round(x + sx * R2), cy = Math.round(y + bob + sy * R2);
        c.fillRect(dx > 0 ? cx : cx - L + 2, cy - 1, L, 3);
        c.fillRect(cx - 1, dy > 0 ? cy : cy - L + 2, 3, L);
      }
      c.fillRect(Math.round(x) - 1, Math.round(y + bob - R2) - 6, 3, 4); // the top tick
      c.globalAlpha = 1;
    }
    if (b.focus) {
      if (b.kind === "vault") { c.fillStyle = GOLD; c.fillRect(Math.round(x - r - 1), Math.round(y + bob + r - 7), 7, 6); c.fillStyle = "#0b0b0b"; c.fillRect(Math.round(x - r + 3), Math.round(y + bob + r - 5), 1, 2); }
      // vault sparkle
      if (b.kind === "vault" && !dimmed && ((this.t * 1000 + s.seed) % 2600) < 160) { c.fillStyle = "#fff"; const sx = x - r + rnd(s.seed, 70) * r * 2, sy = y - r + rnd(s.seed, 71) * r * 2; c.fillRect(Math.round(sx) - 1, Math.round(sy) - 3, 2, 6); c.fillRect(Math.round(sx) - 3, Math.round(sy) - 1, 6, 2); }
      // lock on "!"
      if (s.lock > 0) { c.font = this.font(22); c.textAlign = "center"; c.textBaseline = "bottom"; c.fillStyle = RED; const jump = Math.abs(Math.sin(s.lock * 9)) * 6; c.fillText("!", Math.round(x), Math.round(y - r - 8 - jump)); }
    }
    c.restore();
    c.save();
    c.textAlign = "center"; c.textBaseline = "top";
    const ry = r1; // labels hang under the drawn size
    if (b.focus) {
      c.font = this.font(12);
      c.fillStyle = hot ? RED : this.colors.ink;
      c.globalAlpha = dimmed ? 0.6 : 1;
      this.label(c, b.name, x, y + ry + 7, hot ? 3 : 2);
      if (b.showBag) { c.font = this.font(10.5); c.fillStyle = this.colors.dim; this.label(c, b.bag, x, y + ry + 24, 1); }
    }
    // the rule in words as you come close, before you bump
    if (iVault && b.hint && close && !hot && this.hintIds.has(b.id)) { c.font = this.mono(10); c.fillStyle = b.state === "open" ? RED : this.colors.dim; c.globalAlpha = 1; this.label(c, b.hint, x, y + ry + (b.focus ? (b.showBag ? 39 : 24) : 7), 3); }
    c.restore();
  }
  /** Labels are queued and decluttered: a label that would sit in the top UI
   * band is dropped, one that overlaps a higher priority label is nudged down
   * once and dropped if it still overlaps. Drawn at the end of the world pass. */
  private labels: { text: string; x: number; y: number; w: number; h: number; font: string; color: string; alpha: number; pri: number; base: "top" | "bottom" | "middle" }[] = [];
  private label(c: CanvasRenderingContext2D, text: string, x: number, y: number, pri = 1) {
    const { w, h } = this.labelTile(c, text, c.font, String(c.fillStyle));
    this.labels.push({ text, x, y, w, h, font: c.font, color: String(c.fillStyle), alpha: c.globalAlpha, pri, base: c.textBaseline as any });
  }
  /** A label rendered once (text is the costliest thing a canvas draws): box, text, size. */
  private labelTile(c: CanvasRenderingContext2D, text: string, font: string, color: string) {
    const key = `${font}|${color}|${text}`;
    let t = this.labelCache.get(key);
    if (t) return t;
    if (this.labelCache.size > 400) this.labelCache.clear();
    c.save(); c.font = font;
    const w = Math.ceil(c.measureText(text).width + 6);
    c.restore();
    const px = /(\d+(?:\.\d+)?)px/.exec(font); // the font string starts with its weight, not its size
    const h = Math.ceil((px ? Number(px[1]) : 12) * 1.15 + 2);
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w * this.dpr)); cv.height = Math.max(1, Math.round(h * this.dpr));
    const g = cv.getContext("2d")!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 0.75; g.fillStyle = this.colors.bg; g.fillRect(0, 0, w, h);
    g.globalAlpha = 1; g.font = font; g.textAlign = "center"; g.textBaseline = "top"; g.fillStyle = color;
    g.fillText(text, Math.round(w / 2), 1);
    t = { cv, w, h };
    this.labelCache.set(key, t);
    return t;
  }
  private flushLabels(c: CanvasRenderingContext2D) {
    const band = this.cam.y + Math.max(112, this.topInset); // under the HUD strip and pills, or the guide card
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const list = [...this.labels].sort((a, b) => b.pri - a.pri);
    this.labels = [];
    const hit = (a: { x: number; y: number; w: number; h: number }) => placed.some((p) => Math.abs(p.x - a.x) * 2 < p.w + a.w && Math.abs(p.y - a.y) * 2 < p.h + a.h);
    for (const l of list) {
      let top = l.base === "bottom" ? l.y - l.h : l.base === "middle" ? l.y - l.h / 2 : l.y;
      if (top < band) continue;
      let box = { x: l.x, y: top + l.h / 2, w: l.w, h: l.h };
      if (hit(box)) { top += l.h + 1; box = { ...box, y: top + l.h / 2 }; if (hit(box) || l.pri < 2) continue; }
      placed.push(box);
      const t = this.labelTile(c, l.text, l.font, l.color);
      c.globalAlpha = l.alpha;
      c.drawImage(t.cv, Math.round(l.x - t.w / 2), Math.round(top), t.w, t.h);
      c.globalAlpha = 1;
    }
  }
  private lock(c: CanvasRenderingContext2D, x: number, y: number, col: string) {
    c.fillStyle = col; c.fillRect(x - 5, y - 2, 10, 8); c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.arc(x, y - 3, 3.5, Math.PI, 0); c.stroke();
    c.fillStyle = this.colors.field; c.fillRect(x - 1, y + 1, 2, 3);
  }
  private moon(c: CanvasRenderingContext2D, x: number, y: number, col: string) {
    c.fillStyle = col; c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = this.colors.field; c.beginPath(); c.arc(x + 3, y - 2, 5, 0, Math.PI * 2); c.fill();
  }
  private hourglass(c: CanvasRenderingContext2D, x: number, y: number, col: string) {
    c.fillStyle = col;
    c.fillRect(x - 5, y - 7, 10, 2); c.fillRect(x - 5, y + 5, 10, 2);
    c.fillRect(x - 4, y - 5, 8, 2); c.fillRect(x - 2, y - 3, 4, 2); c.fillRect(x - 1, y - 1, 2, 2); c.fillRect(x - 2, y + 1, 4, 2); c.fillRect(x - 4, y + 3, 8, 2);
    c.fillStyle = this.colors.field; c.fillRect(x - 2, y - 5, 4, 1); c.fillRect(x - 1, y + 3, 2, 1);
  }
  /** The guide's arrow: a bouncing pixel chevron over what to touch next. */
  private drawGuideArrow(c: CanvasRenderingContext2D) {
    const g = this.guide;
    if (!g) return;
    const s = g.kind === "me" ? this.me : g.kind === "gate" ? this.gate : g.kind === "boss" ? this.boss : g.id ? this.bodies.get(g.id) : null;
    if (!s) return;
    const r = g.kind === "boss" ? 100 : g.kind === "gate" ? 60 : ("r" in s ? (s as Sim).r : 24) + 8;
    const bounce = reducedMotion() ? 0 : Math.abs(Math.sin(this.t * 4)) * 8;
    const ax = Math.round(s.x), ay = Math.round(s.y - r - 14 - bounce);
    const col = g.kind === "body" ? RED : g.kind === "me" ? CYAN : GOLD;
    c.save();
    c.fillStyle = "#0c0c0b";
    c.fillRect(ax - 14, ay - 30, 28, 6); c.fillRect(ax - 10, ay - 24, 20, 6); c.fillRect(ax - 6, ay - 18, 12, 6); c.fillRect(ax - 2, ay - 12, 4, 6);
    c.fillRect(ax - 8, ay - 38, 16, 8);
    c.fillStyle = col;
    c.fillRect(ax - 12, ay - 28, 24, 4); c.fillRect(ax - 8, ay - 24, 16, 4); c.fillRect(ax - 4, ay - 20, 8, 4); c.fillRect(ax - 1, ay - 16, 2, 4);
    c.fillRect(ax - 6, ay - 36, 12, 8);
    c.restore();
  }

  private drawMe(c: CanvasRenderingContext2D, now: number) {
    const m = this.me, info = this.meInfo;
    const color = info.kind === "vault" ? GOLD : RED;
    const moving = Math.hypot(m.vx, m.vy) > 20;
    const bob = Math.sin(this.t * 4) * 1.5;
    const wobble = moving ? Math.sin(this.t * 16) * 0.07 : 0;
    c.save();
    // trail
    for (let i = 0; i < m.trail.length; i++) { const p = m.trail[i], f = (i + 1) / m.trail.length; c.globalAlpha = f * (this.dashT > 0 ? 0.55 : 0.22); c.fillStyle = color; const q = Math.max(2, Math.round(m.r * 0.6 * f)); c.fillRect(Math.round(p.x - q / 2), Math.round(p.y - q / 2), q, q); }
    c.globalAlpha = 1;
    this.shadow(c, m.x, m.y + bob, m.r);
    // glow
    c.fillStyle = color; c.globalAlpha = info.kind === "exposed" ? 0.14 + 0.08 * Math.sin(this.t * 3) : 0.1 + 0.05 * Math.sin(this.t * 2);
    c.fillRect(Math.round(m.x - m.r - 8), Math.round(m.y + bob - m.r - 8), Math.round(m.r * 2 + 16), Math.round(m.r * 2 + 16));
    c.globalAlpha = 1;
    if (info.kind === "exposed") {
      c.fillStyle = RED;
      for (let i = 0; i < 4; i++) { const ph = (this.t * 1.1 + i * 0.27) % 1; c.globalAlpha = 1 - ph; c.fillRect(Math.round(m.x - m.r + 5 + i * ((m.r * 2 - 10) / 3.2)), Math.round(m.y + m.r + ph * 16), 3, 3); }
      c.globalAlpha = 1;
    }
    this.outline(c, m.x, m.y + bob, m.r, this.colors.ink, 2);
    this.sprite(c, info.kind === "vault" ? "__sack_gold__" : "__sack_red__", m.x, m.y, m.r, m.face, bob, wobble);
    if (this.blinkAt(77)) { c.fillStyle = info.kind === "vault" ? GOLD : RED; c.fillRect(Math.round(m.x - m.r * 0.6), Math.round(m.y + bob - m.r * 0.1), Math.round(m.r * 1.2), 3); }
    if (info.kind === "vault") { // vault door badge
      c.fillStyle = GOLD; c.fillRect(Math.round(m.x + m.r - 6), Math.round(m.y + bob + m.r - 8), 10, 9);
      c.fillStyle = GOLD2; c.fillRect(Math.round(m.x + m.r - 4), Math.round(m.y + bob + m.r - 6), 6, 5);
      c.fillStyle = "#0b0b0b"; c.fillRect(Math.round(m.x + m.r - 2), Math.round(m.y + bob + m.r - 4), 2, 2);
    }
    this.shieldRing(c, ME, m.x, m.y + bob, m.r, info.shieldBps);
    c.restore();
    if (info.kind === "vault" && info.maxRaids > 0) {
      for (let i = 0; i < info.maxRaids; i++) { c.fillStyle = i < info.raidsLeft ? RED : this.colors.line; c.fillRect(Math.round(m.x - (info.maxRaids * 7) / 2 + i * 7), Math.round(m.y - m.r - 10), 5, 4); }
    }
    c.textAlign = "center"; c.textBaseline = "top";
    c.font = this.font(12); c.fillStyle = color;
    this.label(c, "YOU", m.x, m.y + m.r + 8, 6);
    c.font = this.font(10.5); c.fillStyle = this.colors.ink;
    this.label(c, info.bag, m.x, m.y + m.r + 25, 5);
    if (info.inFlight) {
      const q = Math.floor(now / 110) % 4, sx = m.x - 8, sy = m.y - m.r - 34;
      c.fillStyle = this.colors.ink;
      [[0, 0], [8, 0], [8, 8], [0, 8]].forEach(([dx, dy], i) => { c.globalAlpha = i === q ? 1 : 0.3; c.fillRect(sx + dx, sy + dy, 6, 6); });
      c.globalAlpha = 1;
      c.font = this.mono(10.5); c.fillStyle = this.colors.ink; c.textBaseline = "bottom";
      this.label(c, info.inFlight, m.x, m.y - m.r - 42, 7);
    }
  }

  private drawGate(c: CanvasRenderingContext2D) {
    if (this.places.gate === "hidden") return;
    const { x, y } = this.gate, open = this.places.gate === "open";
    c.save();
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 3);
    // light spill (a flat glow on a phone: no per frame gradient)
    if (this.lowPower) { c.fillStyle = GOLD; c.globalAlpha = open ? 0.08 + pulse * 0.04 : 0.05; c.fillRect(x - 110, y - 110, 220, 220); c.globalAlpha = 1; }
    else {
      const gr = c.createRadialGradient(x, y, 20, x, y, 150);
      gr.addColorStop(0, `rgba(255,214,10,${open ? 0.28 + pulse * 0.1 : 0.14})`); gr.addColorStop(1, "rgba(255,214,10,0)");
      c.fillStyle = gr; c.fillRect(x - 150, y - 150, 300, 300);
    }
    // rotating ring segments
    c.strokeStyle = GOLD; c.lineWidth = 6; c.globalAlpha = open ? 0.9 : 0.5;
    for (let i = 0; i < 4; i++) { const a0 = this.t * 0.8 + (i * Math.PI) / 2; c.beginPath(); c.arc(x, y, 58, a0, a0 + 0.9); c.stroke(); }
    c.lineWidth = 3; c.globalAlpha = open ? 0.6 : 0.3;
    for (let i = 0; i < 3; i++) { const a0 = -this.t * 1.3 + (i * Math.PI * 2) / 3; c.beginPath(); c.arc(x, y, 72, a0, a0 + 1.1); c.stroke(); }
    c.globalAlpha = 1;
    // expanding squares
    for (let i = 0; i < 3; i++) { const ph = ((this.t * 0.5 + i / 3) % 1); c.globalAlpha = (open ? 0.5 : 0.2) * (1 - ph); c.lineWidth = 2; const R = 50 + ph * 90; c.strokeRect(x - R + 0.5, y - R + 0.5, R * 2, R * 2); }
    c.globalAlpha = 1;
    // the door
    c.fillStyle = this.colors.bg; c.fillRect(x - 46, y - 46, 92, 92);
    this.outline(c, x, y, 46, GOLD, 3);
    const im = this.imgs.get("__gate__");
    const bob = Math.sin(this.t * 2) * 2;
    if (im && im.complete && im.naturalWidth) c.drawImage(im, x - 40, y - 40 + bob, 80, 80);
    // floating sparks
    c.fillStyle = "#fff";
    for (let i = 0; i < 5; i++) { const ph = (this.t * 0.4 + i / 5) % 1; c.globalAlpha = (1 - ph) * 0.9; c.fillRect(Math.round(x - 60 + rnd(31, i) * 120), Math.round(y + 50 - ph * 110), 2, 2); }
    c.globalAlpha = 1;
    c.textAlign = "center"; c.textBaseline = "top"; c.font = this.font(13); c.fillStyle = GOLD;
    this.label(c, open ? "VAULT GATE" : "YOUR VAULT", x, y + 54, 4);
    if (open) { c.font = this.mono(10); c.fillStyle = this.colors.ink; this.label(c, "run here to get safe", x, y + 68, 2); }
    c.restore();
  }

  private drawBoss(c: CanvasRenderingContext2D) {
    if (!this.places.boss.visible) return;
    const { x, y, angle } = this.boss;
    const B = this.places.boss;
    c.save();
    // the boss is the danger in the room: hazard red, never gold (gold means safe here)
    const R = 100;
    c.strokeStyle = RED; c.globalAlpha = 0.07; c.lineWidth = 18; c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = 0.6; c.beginPath(); c.arc(x, y, R, angle - 0.95, angle + 0.95); c.stroke();
    c.globalAlpha = 1; c.lineWidth = 3; c.strokeStyle = "#7a1a10"; c.beginPath(); c.arc(x, y, R, angle - 0.95, angle + 0.95); c.stroke();
    // boss sprite, about 4.5x a player
    const S = 200, bob = Math.sin(this.t * 1.6) * 3;
    c.fillStyle = "rgba(0,0,0,0.5)"; c.fillRect(x - 76, y + 88, 152, 9);
    if (this.lowPower) { c.fillStyle = RED; c.globalAlpha = B.ready ? 0.1 : 0.04; c.fillRect(x - 120, y - 120, 240, 240); c.globalAlpha = 1; }
    else {
      const gr = c.createRadialGradient(x, y, 30, x, y, 150);
      gr.addColorStop(0, B.ready ? "rgba(255,61,46,0.26)" : "rgba(255,61,46,0.1)"); gr.addColorStop(1, "rgba(255,61,46,0)");
      c.fillStyle = gr; c.fillRect(x - 150, y - 150, 300, 300);
    }
    const im = this.imgs.get("__boss__");
    if (im && im.complete && im.naturalWidth) c.drawImage(im, x - S / 2, y - S / 2 + bob, S, S);
    if (B.ready) { c.strokeStyle = RED; c.lineWidth = 3; c.globalAlpha = 0.5 + 0.5 * Math.sin(this.t * 5); c.strokeRect(x - 50.5, y - 12.5 + bob, 101, 74); c.globalAlpha = 1; }
    // health bar: his stash over his starting stash, from the chain
    const bw = 190, bh = 14, by = y - S / 2 - 24;
    c.fillStyle = this.colors.bg; c.fillRect(x - bw / 2 - 2, by - 2, bw + 4, bh + 4);
    c.fillStyle = this.colors.line; c.fillRect(x - bw / 2, by, bw, bh);
    const hp = clamp(B.hp, 0, 1);
    c.fillStyle = RED; c.fillRect(x - bw / 2, by, Math.round(bw * hp), bh);
    c.fillStyle = "#7a1a10"; for (let i = 1; i < 10; i++) c.fillRect(x - bw / 2 + Math.round((bw * i) / 10), by, 1, bh);
    if (B.hpText) { c.textAlign = "center"; c.textBaseline = "middle"; c.font = this.font(11); c.fillStyle = "#fff"; c.fillText(B.hpText, Math.round(x), by + bh / 2 + 1); }
    // BOSS tag and name
    c.textAlign = "center"; c.textBaseline = "bottom";
    c.font = this.font(12); c.fillStyle = "#fff";
    const tag = "BOSS", tw = c.measureText(tag).width + 12;
    c.fillStyle = RED; c.fillRect(Math.round(x - tw / 2), by - 46, Math.round(tw), 16);
    c.fillStyle = "#fff"; c.fillText(tag, Math.round(x), by - 33);
    c.font = this.font(16); c.fillStyle = RED;
    c.fillText("SATOSHI", Math.round(x), by - 50);
    // under him: the pulsing SHOOT HIM badge when your hit is ready, else when the next one comes
    if (B.hint || B.ready) {
      const text = B.ready ? (B.badge || "SHOOT HIM") : (B.line || "");
      if (text) {
        c.textBaseline = "top"; c.font = this.font(B.ready ? 15 : 12);
        const w = c.measureText(text).width + 16, ty = y + S / 2 + 10;
        const p = B.ready ? 0.5 + 0.5 * Math.sin(this.t * 6) : 0;
        c.fillStyle = B.ready ? RED : this.colors.bg; c.globalAlpha = B.ready ? 0.75 + 0.25 * p : 0.9;
        c.fillRect(Math.round(x - w / 2), ty, Math.round(w), B.ready ? 24 : 20);
        c.globalAlpha = 1; c.fillStyle = B.ready ? "#fff" : this.colors.dim;
        c.fillText(text, Math.round(x), ty + (B.ready ? 5 : 4));
      }
    }
    c.restore();
  }

  /** Raid badges: a big ROBBING + countdown over the body you are robbing (cyan), ROBBING YOU over the one robbing you (red).
   * Drawn after the labels so they always read. */
  private drawRaidBadges(c: CanvasRenderingContext2D) {
    const now = this.cb.chainNow(), pnow = performance.now();
    const box = (x: number, y: number, top: string, sub: string, col: string, big: boolean) => {
      c.save();
      c.textAlign = "center"; c.textBaseline = "middle";
      c.font = this.font(big ? 15 : 12);
      const w1 = c.measureText(top).width;
      c.font = this.font(big ? 20 : 15);
      const w2 = sub ? c.measureText(sub).width : 0;
      const w = Math.max(w1, w2) + 16, h = sub ? (big ? 44 : 34) : (big ? 26 : 20);
      const bx = Math.round(x - w / 2), by = Math.round(y - h);
      c.fillStyle = this.colors.bg; c.globalAlpha = 0.92; c.fillRect(bx, by, Math.round(w), h);
      c.globalAlpha = 1; c.strokeStyle = col; c.lineWidth = 2; c.strokeRect(bx + 0.5, by + 0.5, Math.round(w), h);
      c.fillStyle = col; c.font = this.font(big ? 15 : 12); c.fillText(top, Math.round(x), by + (sub ? 12 : h / 2 + 1));
      if (sub) { c.font = this.font(big ? 20 : 15); c.fillStyle = col; c.fillText(sub, Math.round(x), by + h - 13); }
      // the little stem to the body
      c.fillStyle = col; c.fillRect(Math.round(x) - 2, by + h, 4, 6);
      c.restore();
    };
    const clockText = (until: number) => { const left = until - now; const sec = Math.max(0, Math.ceil(left / 1000)); return left > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : "settling"; };
    for (const id of this.order) {
      const b = this.info.get(id)!, s = this.bodies.get(id)!;
      if (!b || !s) continue;
      if (this.shattered.has(id)) continue;
      const top = s.y - s.r - 14;
      if (b.raidedByMe && !b.raidingMe) box(s.x, top, "ROBBING", b.until ? clockText(b.until) : "…", CYAN, true);
      else if (b.raidingMe) box(s.x, top, "ROBBING YOU", b.until ? clockText(b.until) : "", RED, true);
    }
    // moment badges: HIT, BLOCKED, numbers
    for (const [key, bd] of [...this.badges]) {
      if (pnow > bd.until) { this.badges.delete(key); continue; }
      const s = this.simOf(key === ME ? "me" : key); if (!s) continue;
      const r = "r" in s ? (s as Sim).r : 70;
      const f = clamp((bd.until - pnow) / 1600, 0, 1);
      const rise = (1 - f) * 18;
      c.save();
      c.globalAlpha = Math.min(1, f * 3);
      c.textAlign = "center"; c.textBaseline = "bottom"; c.font = this.font(bd.big ? 26 : 16);
      const tx = Math.round(s.x), ty = Math.round(s.y - r - 30 - rise);
      c.fillStyle = "#0c0c0b"; for (const [ox, oy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) c.fillText(bd.text, tx + ox, ty + oy);
      c.fillStyle = bd.color; c.fillText(bd.text, tx, ty);
      c.restore();
    }
  }

  /** Bullets: a bright pixel slug with a short tail. */
  private drawShots(c: CanvasRenderingContext2D) {
    for (const p of this.shots) {
      const sp = Math.hypot(p.vx, p.vy) || 1, nx = p.vx / sp, ny = p.vy / sp;
      const col = p.mine ? GOLD : RED;
      c.globalAlpha = 0.35; c.fillStyle = col;
      for (let i = 1; i <= 3; i++) c.fillRect(Math.round(p.x - nx * i * 7) - 2, Math.round(p.y - ny * i * 7) - 2, 4, 4);
      c.globalAlpha = 1;
      c.fillStyle = "#0c0c0b"; c.fillRect(Math.round(p.x) - 4, Math.round(p.y) - 4, 8, 8);
      c.fillStyle = col; c.fillRect(Math.round(p.x) - 3, Math.round(p.y) - 3, 6, 6);
      c.fillStyle = "#fff"; c.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 2, 2, 2);
    }
  }
  /** The aim: a faint dotted line to the body your next shot would snap to, with a bracket on it. */
  private drawAim(c: CanvasRenderingContext2D) {
    if (this.meInfo.kind !== "vault") return;
    const aim = this.aimTarget();
    if (!aim) return;
    const s = this.simOf(aim); if (!s) return;
    const r = aim === "satoshi" ? 64 : ("r" in s ? (s as Sim).r : 24) + 10;
    c.save();
    c.strokeStyle = GOLD; c.globalAlpha = 0.5; c.lineWidth = 2; c.setLineDash([3, 7]); c.lineDashOffset = -((this.t * 60) % 10);
    c.beginPath(); c.moveTo(this.me.x, this.me.y); c.lineTo(s.x, s.y); c.stroke();
    c.setLineDash([]); c.globalAlpha = 0.9;
    const p = 0.5 + 0.5 * Math.sin(this.t * 8), R = r + p * 3;
    c.strokeRect(Math.round(s.x - R) + 0.5, Math.round(s.y - R) + 0.5, Math.round(R * 2), Math.round(R * 2));
    c.restore();
  }
  /** The body you tapped: four turning gold brackets (grey while it cannot be raided). */
  private drawLock(c: CanvasRenderingContext2D) {
    const id = this.lockId;
    if (!id) return;
    const s = this.simOf(id); if (!s) return;
    const live = this.meInfo.kind === "vault" && this.targets.has(id);
    const r = (id === "satoshi" ? 70 : ("r" in s ? (s as Sim).r : 24) + 14);
    c.save();
    c.translate(Math.round(s.x), Math.round(s.y));
    c.rotate(this.t * (live ? 1.6 : 0.5));
    c.fillStyle = live ? GOLD : this.colors.dim;
    const L = 12;
    for (let i = 0; i < 4; i++) {
      c.rotate(Math.PI / 2);
      c.fillRect(r - 3, -L / 2, 4, L);
    }
    c.restore();
    if (live) {
      c.save();
      c.font = this.font(11); c.textAlign = "center"; c.textBaseline = "bottom";
      c.fillStyle = GOLD;
      this.label(c, "LOCKED", s.x, s.y - r - 6, 4);
      c.restore();
    }
  }
  /** Shield ring: one cyan ring per 10%, brighter while it takes a hit. */
  private shieldRing(c: CanvasRenderingContext2D, key: string, x: number, y: number, r: number, bps: number) {
    if (bps <= 0) return;
    const n = Math.min(3, Math.ceil(bps / 1000));
    const hit = this.ringHit.get(key) || 0;
    c.save();
    c.strokeStyle = hit > 0 ? "#fff" : CYAN; c.lineWidth = hit > 0 ? 3 : 2; c.globalAlpha = (hit > 0 ? 1 : 0.8) * c.globalAlpha;
    for (let i = 0; i < n; i++) { c.beginPath(); c.arc(x, y, r + 7 + i * 5 + (hit > 0 ? hit * 6 : 0), 0, Math.PI * 2); c.stroke(); }
    c.restore();
  }

  private drawParticles(c: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      if (p.t < 0) continue;
      c.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
      c.fillStyle = p.c;
      c.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
      if (p.s >= 5) { c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(Math.round(p.x) + p.s - 2, Math.round(p.y) + 1, 2, p.s - 1); }
    }
    c.globalAlpha = 1;
  }

  /** Arrows on the screen edge for what matters off screen. */
  private drawPointers(c: CanvasRenderingContext2D) {
    if (this.meInfo.kind === "none") return;
    const targets: { x: number; y: number; color: string; label: string; pulse: boolean }[] = [];
    if (this.places.gate !== "hidden") targets.push({ x: this.gate.x, y: this.gate.y, color: GOLD, label: this.places.gate === "open" ? "GATE" : "VAULT", pulse: false });
    for (const id of this.order) { const b = this.info.get(id)!, s = this.bodies.get(id)!; if (b && s && (b.hunting || b.raidingMe)) targets.push({ x: s.x, y: s.y, color: RED, label: b.name.toUpperCase(), pulse: true }); }
    if (this.places.boss.ready) targets.push({ x: this.boss.x, y: this.boss.y, color: RED, label: "SHOOT HIM", pulse: true });
    if (this.hintPointer) {
      if (performance.now() > this.hintPointer.until) this.hintPointer = null;
      else { const s = this.simOf(this.hintPointer.id); if (s && !targets.some((t) => t.x === s.x && t.y === s.y)) targets.push({ x: s.x, y: s.y, color: RED, label: (this.hintPointer.id === "satoshi" ? "SATOSHI" : this.info.get(this.hintPointer.id)?.name.toUpperCase()) || "TARGET", pulse: true }); }
    }
    const g = this.guide;
    if (g && g.kind !== "me") {
      const s = g.kind === "gate" ? this.gate : g.kind === "boss" ? this.boss : g.id ? this.bodies.get(g.id) : null;
      if (s && !targets.some((t) => t.x === s.x && t.y === s.y)) targets.push({ x: s.x, y: s.y, color: g.kind === "body" ? RED : GOLD, label: g.kind === "gate" ? "GOLD DOOR" : g.kind === "boss" ? "SATOSHI" : (g.id && this.info.get(g.id)?.name.toUpperCase()) || "TARGET", pulse: true });
    }
    const cx = this.w / 2, cy = this.h / 2, inset = 26, top = Math.max(118, this.topInset + 14), bottom = 24;
    const placed: { x: number; y: number; w: number }[] = [];
    for (const t of targets) {
      const p = this.toScreen(t.x, t.y);
      if (p.x > -20 && p.x < this.w + 20 && p.y > -20 && p.y < this.h + 20) continue; // on screen: no pointer
      const dx = p.x - cx, dy = p.y - cy;
      const sx = (this.w / 2 - inset) / Math.abs(dx || 1e-6), sy = Math.min((cy - top) / Math.abs(Math.min(dy, -1e-6)), (this.h - bottom - cy) / Math.abs(Math.max(dy, 1e-6)));
      const k = Math.min(sx, dy < 0 ? (cy - top) / Math.abs(dy || 1e-6) : (this.h - bottom - cy) / Math.abs(dy || 1e-6));
      void sy;
      const ex = cx + dx * k, ey = cy + dy * k;
      const ang = Math.atan2(dy, dx);
      const dist = Math.hypot(t.x - this.me.x, t.y - this.me.y);
      const size = t.pulse ? 11 + 4 * (0.5 + 0.5 * Math.sin(this.t * (dist < 300 ? 12 : 6))) : 11;
      c.save();
      c.translate(ex, ey); c.rotate(ang);
      c.fillStyle = t.color; c.beginPath(); c.moveTo(size, 0); c.lineTo(-size * 0.7, -size * 0.75); c.lineTo(-size * 0.3, 0); c.lineTo(-size * 0.7, size * 0.75); c.closePath(); c.fill();
      c.restore();
      c.save();
      c.font = this.font(10); c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = t.color;
      const lx = clamp(ex - Math.cos(ang) * 26, 30, this.w - 30);
      let ly = clamp(ey - Math.sin(ang) * 26, top - 6, this.h - 14);
      const txt = `${t.label} ${Math.round(dist / 10)}m`;
      const w = c.measureText(txt).width + 8;
      // stack pointer labels instead of overlapping them
      for (let i = 0; i < 4 && placed.some((q) => Math.abs(q.x - lx) * 2 < q.w + w && Math.abs(q.y - ly) < 16); i++) ly += 16;
      placed.push({ x: lx, y: ly, w });
      c.fillStyle = this.colors.bg; c.globalAlpha = 0.8; c.fillRect(Math.round(lx - w / 2), Math.round(ly - 7), Math.round(w), 14); c.globalAlpha = 1;
      c.fillStyle = t.color; c.fillText(txt, Math.round(lx), Math.round(ly) + 1);
      c.restore();
    }
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
    if (this.meInfo.kind === "none" || this.cardOn) return; // the guide card sits where the map goes
    const R = 34, cx = this.w - R - 10, cy = R + 10;
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
      const r = "r" in s ? (s as Sim).r : 80;
      const p = this.toScreen(s.x, s.y);
      const left = p.x > this.w * 0.62;
      b.el.classList.toggle("left", left);
      b.el.classList.toggle("below", p.y < 130);
      b.el.style.left = `${Math.round(p.x)}px`;
      b.el.style.top = `${Math.round(p.y < 130 ? p.y + r + 34 : p.y - r - 18)}px`;
    }
  }
}
