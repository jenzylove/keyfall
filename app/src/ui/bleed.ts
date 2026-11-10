// The bleed: KEYFALL's signature visual. Grains of coins drawn as piles.
//
// Season mode (landing hero): the red pile on the ledge is every exposed bag,
// the yellow pile on the floor is every vault. Pile areas are in proportion to
// the live totals from stats(). Grains drip off the ledge and turn yellow as
// they fall into the vault side: the harvest and the migration.
//
// Bag mode (/play): your own bag. Red and dripping through a grate while it is
// exposed, yellow and still in a vault tray once migrated.

import { reducedMotion } from "./dom";

type RGB = [number, number, number];
type BagState = "none" | "exposed" | "vault";

const CELL = 4;
const GRAIN = 3;

function parse(c: string): RGB {
  c = c.trim();
  if (c.startsWith("#")) {
    const h = c.length === 4 ? [...c.slice(1)].map((x) => x + x).join("") : c.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = c.match(/\d+/g);
  return m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

interface P { x: number; y: number; vx: number; vy: number; phase: 0 | 1 | 2 | 3; life: number; c: number; land: number }

export class Bleed {
  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement("canvas");
  private W = 0;
  private H = 0;
  private dpr = 1;
  private raf = 0;
  private ps: P[] = [];
  private colors = { red: [255, 61, 46] as RGB, yel: [255, 214, 10] as RGB, bg: [12, 12, 11] as RGB, line: [42, 41, 38] as RGB, dim: [138, 135, 126] as RGB, ink: [237, 235, 227] as RGB };
  private e = 0;
  private v = 0;
  private bag: BagState = "none";
  private bagFill = 0.6;
  private morph = 1; // 0..1 transition progress into the current bag state
  private from: BagState = "none";
  private ro: ResizeObserver;
  private mo: MutationObserver;
  private mq = window.matchMedia("(prefers-color-scheme: light)");
  private alive = true;
  private dirty = true;

  constructor(private canvas: HTMLCanvasElement, private mode: "season" | "bag") {
    this.ctx = canvas.getContext("2d")!;
    this.readColors();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement || canvas);
    this.mo = new MutationObserver(() => { this.readColors(); this.dirty = true; });
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    this.mq.addEventListener("change", this.onScheme);
    this.resize();
    this.loop();
  }

  private onScheme = () => { this.readColors(); this.dirty = true; };

  private readColors() {
    const s = getComputedStyle(document.documentElement);
    const g = (n: string, d: RGB) => { const v = s.getPropertyValue(n); return v ? parse(v) : d; };
    this.colors = {
      red: g("--hazard", this.colors.red), yel: g("--safe", this.colors.yel), bg: g("--bg", this.colors.bg),
      line: g("--line", this.colors.line), dim: g("--dim", this.colors.dim), ink: g("--ink", this.colors.ink),
    };
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(1, Math.round(r.width));
    this.H = Math.max(1, Math.round(r.height));
    for (const c of [this.canvas, this.layer]) { c.width = this.W * this.dpr; c.height = this.H * this.dpr; }
    this.dirty = true;
    if (reducedMotion()) this.frame();
  }

  /** Season totals (any unit, only the ratio matters). */
  setSeason(exposed: number, vault: number) {
    if (exposed === this.e && vault === this.v) return;
    this.e = exposed;
    this.v = vault;
    this.dirty = true;
    if (reducedMotion()) this.frame();
  }

  /** Your bag. `fill` 0..1 sets the pile size. */
  setBag(state: BagState, fill = 0.6) {
    fill = Math.max(0.12, Math.min(1, fill));
    if (state !== this.bag) {
      this.from = this.bag;
      this.bag = state;
      this.morph = reducedMotion() || this.from === "none" ? 1 : 0;
      if (state === "vault") this.ps = this.ps.filter((p) => p.phase === 3);
    }
    if (Math.abs(fill - this.bagFill) > 0.01) this.bagFill = fill;
    this.dirty = true;
    if (reducedMotion()) this.frame();
  }

  destroy() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.mo.disconnect();
    this.mq.removeEventListener("change", this.onScheme);
  }

  // ---------------------------------------------------------------- geometry

  private season() {
    const { W, H } = this;
    const narrow = W < 520;
    const ledgeY = Math.round(H * (narrow ? 0.48 : 0.46) / CELL) * CELL;
    const ledgeX = Math.round(W * 0.5 / CELL) * CELL;
    const floor = H - CELL * 2;
    const maxH = Math.min(ledgeY - 18, (floor - ledgeY) * 0.92);
    const r = Math.min(ledgeX * 0.46, W * 0.22);
    const big = Math.max(this.e, this.v);
    const hR = big > 0 ? (maxH * this.e) / big : 0;
    const hV = big > 0 ? (maxH * this.v) / big : 0;
    return { ledgeY, ledgeX, floor, r, hR, hV, cR: ledgeX * 0.5, cV: ledgeX + (W - ledgeX) * 0.55 };
  }

  private bagGeo() {
    const { W, H } = this;
    const r = Math.min(W * 0.42, H * 1.2);
    const grate = Math.round((H * 0.62) / CELL) * CELL;
    const floor = H - CELL * 3;
    const k = this.bag === "vault" ? this.morph : this.from === "vault" ? 1 - this.morph : 0;
    const base = Math.round(grate + (floor - grate) * k);
    const maxH = (this.bag === "vault" || this.from === "vault" ? Math.min(grate, floor) : grate) - 10;
    return { cx: W / 2, r, base, grate, floor, h: maxH * this.bagFill, k };
  }

  private colH(x: number, cx: number, r: number, h: number) {
    const d = (x - cx) / r;
    if (d <= -1 || d >= 1 || h <= 0) return 0;
    return h * Math.pow(1 - d * d, 0.8);
  }

  // ---------------------------------------------------------------- static layer

  private shades(c: RGB) {
    return [0, 0.1, 0.2, 0.32, 0.45].map((t) => css(mix(c, this.colors.bg, t)));
  }

  private pile(g: CanvasRenderingContext2D, cx: number, r: number, h: number, baseY: number, color: (x: number, y: number) => string) {
    if (h <= 0) return;
    for (let x = Math.floor((cx - r) / CELL) * CELL; x <= cx + r; x += CELL) {
      const ch = this.colH(x + CELL / 2, cx, r, h);
      const n = Math.floor(ch / CELL);
      for (let i = 0; i < n; i++) {
        const y = baseY - (i + 1) * CELL;
        if (i === n - 1 && hash(x, i) < 0.35) continue; // ragged top
        g.fillStyle = color(x, i);
        g.fillRect(x, y, GRAIN, GRAIN);
      }
    }
  }

  private paintLayer() {
    const g = this.layer.getContext("2d")!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    const C = this.colors;
    const R = this.shades(C.red), Y = this.shades(C.yel);
    const pick = (S: string[]) => (x: number, i: number) => S[Math.floor(hash(x, i) * hash(i, x) * S.length * 1.6) % S.length];

    if (this.mode === "season") {
      const s = this.season();
      // ledge
      g.fillStyle = css(C.dim);
      g.fillRect(0, s.ledgeY, s.ledgeX, 2);
      for (let x = s.ledgeX - 24; x < s.ledgeX; x += 8) { g.fillStyle = css(C.red); g.fillRect(x, s.ledgeY + 2, 4, 4); }
      // floor
      g.fillStyle = css(C.line);
      g.fillRect(s.ledgeX + 8, s.floor, this.W - s.ledgeX - 8, 2);
      // the line every grain crosses
      g.fillStyle = css(C.line);
      for (let y = 0; y < this.H; y += 8) g.fillRect(s.ledgeX + 6, y, 1, 4);
      this.pile(g, s.cR, s.r, s.hR, s.ledgeY, pick(R));
      this.pile(g, s.cV, s.r, s.hV, s.floor, pick(Y));
      if (s.hV <= 0) {
        g.fillStyle = css(C.yel, 0.7);
        g.fillRect(s.cV - s.r, s.floor - 1, s.r * 2, 2);
      }
      return;
    }

    const b = this.bagGeo();
    if (this.bag === "none" && this.from === "none") {
      // an empty outline: no bag yet
      g.fillStyle = css(C.line);
      for (let x = b.cx - b.r; x <= b.cx + b.r; x += CELL * 2) {
        const ch = this.colH(x, b.cx, b.r, b.h);
        g.fillRect(x, b.grate - ch, 2, 2);
      }
      g.fillRect(b.cx - b.r - 10, b.grate, b.r * 2 + 20, 1);
      return;
    }
    // grate (exposed) fading into the vault tray
    const trayA = b.k, grateA = 1 - b.k;
    if (grateA > 0.01) {
      g.fillStyle = css(C.red, grateA);
      for (let x = b.cx - b.r - 12; x < b.cx + b.r + 12; x += 10) g.fillRect(x, b.base, 6, 2);
    }
    if (trayA > 0.01) {
      g.fillStyle = css(C.yel, trayA);
      const L = b.cx - b.r - 14, Rr = b.cx + b.r + 14;
      g.fillRect(L, b.base, Rr - L, 3);
      g.fillRect(L, b.base - 28, 3, 31);
      g.fillRect(Rr - 3, b.base - 28, 3, 31);
    }
    const wave = (x: number) => {
      // red to yellow sweeps left to right during the migration
      const p = (x - (b.cx - b.r)) / (2 * b.r);
      const t = this.bag === "vault" ? this.morph * 1.6 - p * 0.6 : 1 - (this.morph * 1.6 - p * 0.6);
      return Math.max(0, Math.min(1, t));
    };
    const toY = this.bag === "vault" ? 1 : this.bag === "exposed" ? 0 : 0;
    this.pile(g, b.cx, b.r, b.h, b.base, (x, i) => {
      const t = this.morph >= 1 ? toY : wave(x);
      const sh = Math.floor(hash(x, i) * hash(i, x) * 8) % 5;
      return css(mix(mix(C.red, C.yel, t), C.bg, [0, 0.1, 0.2, 0.32, 0.45][sh]));
    });
  }

  // ---------------------------------------------------------------- motion

  private spawnSeason() {
    const s = this.season();
    if (s.hR <= 0) return;
    const rate = this.W < 520 ? 0.7 : 1.2;
    let n = Math.random() < rate % 1 ? Math.ceil(rate) : Math.floor(rate);
    while (n-- > 0) {
      const x = s.cR + Math.random() * s.r * 0.9;
      this.ps.push({ x, y: s.ledgeY - this.colH(x, s.cR, s.r, s.hR), vx: 0.5 + Math.random() * 0.9, vy: 0, phase: 0, life: 0, c: 0, land: 0 });
    }
  }

  private stepSeason(g: CanvasRenderingContext2D) {
    const s = this.season();
    const C = this.colors;
    const fall = s.floor - s.ledgeY;
    const G = 0.22;
    const T = Math.sqrt((2 * fall) / G);
    for (const p of this.ps) {
      p.life++;
      if (p.phase === 0) {
        // roll down the slope of the exposed pile
        p.x += p.vx;
        const foot = s.cR + s.r;
        if (p.x >= foot) { p.phase = 1; p.y = s.ledgeY - CELL; }
        else p.y = s.ledgeY - Math.max(CELL, this.colH(p.x, s.cR, s.r, s.hR));
      } else if (p.phase === 1) {
        // slide along the ledge
        p.x += p.vx * 1.6;
        if (p.x >= s.ledgeX) {
          p.phase = 2;
          const target = s.cV + (Math.random() - 0.5) * s.r * 1.2;
          p.vx = (target - p.x) / T;
          p.vy = 0;
        }
      } else if (p.phase === 2) {
        p.vy += G;
        p.x += p.vx;
        p.y += p.vy;
        if (p.x > s.ledgeX + 6) p.c = Math.min(1, p.c + 0.06);
        const surface = s.floor - this.colH(p.x, s.cV, s.r, s.hV);
        if (p.y >= surface - GRAIN) { p.y = surface - GRAIN; p.phase = 3; p.land = 0; }
      } else {
        p.land++;
      }
    }
    this.ps = this.ps.filter((p) => !(p.phase === 3 && p.land > 40) && p.y < this.H + 10 && p.life < 2000);
    for (const p of this.ps) {
      const a = p.phase === 3 ? 1 - p.land / 40 : 1;
      g.fillStyle = css(mix(C.red, C.yel, p.c), a);
      g.fillRect(Math.round(p.x), Math.round(p.y), GRAIN, GRAIN);
    }
  }

  private stepBag(g: CanvasRenderingContext2D) {
    const b = this.bagGeo();
    const C = this.colors;
    if (this.bag === "exposed" && this.morph >= 1 && Math.random() < 0.55) {
      const x = b.cx + (Math.random() * 2 - 1) * b.r * 0.85;
      this.ps.push({ x: Math.round(x / CELL) * CELL, y: b.grate + 4, vx: 0, vy: 0.2 + Math.random() * 0.4, phase: 2, life: 0, c: 0, land: 0 });
    }
    for (const p of this.ps) { p.life++; p.vy += 0.12; p.y += p.vy; }
    this.ps = this.ps.filter((p) => p.y < this.H + 6);
    for (const p of this.ps) {
      const a = Math.max(0, 1 - (p.y - b.grate) / (this.H - b.grate + 1));
      g.fillStyle = css(C.red, a);
      g.fillRect(p.x, p.y, GRAIN, GRAIN + Math.min(6, p.vy));
    }
  }

  private frame() {
    const g = this.ctx;
    if (this.mode === "bag" && this.morph < 1) {
      this.morph = Math.min(1, this.morph + 1 / 75);
      this.dirty = true;
    }
    if (this.dirty) { this.paintLayer(); this.dirty = false; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.layer, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (reducedMotion()) return;
    if (this.mode === "season") { this.spawnSeason(); this.stepSeason(g); }
    else this.stepBag(g);
  }

  private loop = () => {
    if (!this.alive) return;
    if (!reducedMotion() && !document.hidden) this.frame();
    this.raf = requestAnimationFrame(this.loop);
  };
}
