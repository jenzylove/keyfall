// The radar: the play field. Your bag in the centre, rivals as blips on rings
// by bag size (bigger bags further out), a slow sweep, and raid lines.

import { avatar } from "./avatars";
import { hash32 } from "./names";
import { esc } from "./dom";
import { short } from "./plain";

export type BlipState = "open" | "rest" | "busy" | "small" | "down" | "idle" | "frozen";
export interface Blip {
  id: string;
  name: string;
  kind: "exposed" | "vault";
  balance: bigint;
  state: BlipState;
  shielded: boolean;
  npc: boolean;
  hot?: boolean; // highlighted by a mission or a raid on you
}
export interface RaidLine { id: string; to: string; dir: "out" | "in" | "miss"; until: number }

const SWEEP_MS = 8000;
const RINGS = [0.5, 0.7, 0.9];

const ICON: Record<string, string> = {
  rest: `<svg viewBox="0 0 10 10"><path d="M6.5 1.2A4 4 0 1 0 8.8 7 3.2 3.2 0 0 1 6.5 1.2Z" fill="currentColor"/></svg>`,
  shield: `<svg viewBox="0 0 10 10"><path d="M5 .8 8.8 2.2v2.6c0 2.3-1.6 3.8-3.8 4.6C2.8 8.6 1.2 7.1 1.2 4.8V2.2Z" fill="currentColor"/></svg>`,
  down: `<svg viewBox="0 0 10 10"><path d="M5 9 1.2 5h2.3V1h3v4h2.3Z" fill="currentColor"/></svg>`,
  busy: `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 0v3M5 7v3M0 5h3M7 5h3" stroke="currentColor" stroke-width="1.4"/></svg>`,
};

const now = () => (document.timeline?.currentTime as number | null) ?? performance.now();

export class Radar {
  el: HTMLElement;
  private disc: HTMLElement;
  private layer: HTMLElement;
  private svg: SVGSVGElement;
  private labels: HTMLElement;
  private nodes = new Map<string, HTMLButtonElement>();
  private pos = new Map<string, { x: number; y: number; a: number }>();
  private lineSig = "";
  private lineData: RaidLine[] = [];

  constructor(host: HTMLElement, center: HTMLElement, private opts: { interactive: boolean; onTap?: (id: string) => void; max?: number }) {
    this.el = document.createElement("div");
    this.el.className = `radar${opts.interactive ? " live" : " idle"}`;
    this.el.innerHTML = `
      <div class="rd-disc">
        <svg class="rd-rings" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="49.5" class="rg o"/>
          ${RINGS.map((r) => `<circle cx="50" cy="50" r="${r * 50}" class="rg"/>`).join("")}
          <path d="M50 0V100M0 50H100" class="cross"/>
          ${Array.from({ length: 72 }, (_, i) => {
            const a = (i * 5 * Math.PI) / 180, l = i % 6 === 0 ? 3 : 1.4;
            return `<path d="M${50 + Math.sin(a) * 49.5} ${50 - Math.cos(a) * 49.5}L${50 + Math.sin(a) * (49.5 - l)} ${50 - Math.cos(a) * (49.5 - l)}" class="tk"/>`;
          }).join("")}
        </svg>
        <div class="rd-sweep" aria-hidden="true"></div>
        <svg class="rd-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
        <div class="rd-center"></div>
        <div class="rd-blips"></div>
        <div class="rd-labels" aria-hidden="true"></div>
      </div>`;
    this.disc = this.el.querySelector(".rd-disc")!;
    this.layer = this.el.querySelector(".rd-blips")!;
    this.svg = this.el.querySelector(".rd-lines")!;
    this.labels = this.el.querySelector(".rd-labels")!;
    this.el.querySelector(".rd-center")!.appendChild(center);
    const sw = this.el.querySelector<HTMLElement>(".rd-sweep")!;
    sw.style.animationDelay = `${-(now() % SWEEP_MS)}ms`;
    host.appendChild(this.el);
    if (opts.interactive)
      this.layer.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.blip");
        if (b) opts.onTap?.(b.dataset.id!);
      });
  }

  /** Where a blip sits, in percent of the disc. */
  where(id: string) {
    return this.pos.get(id) || null;
  }
  node(id: string) {
    return this.nodes.get(id) || null;
  }

  set(blips: Blip[]) {
    const max = this.opts.max ?? 24;
    // keep the hot ones and the biggest bags
    const keep = [...blips].sort((a, b) => Number(!!b.hot) - Number(!!a.hot) || (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0)).slice(0, max);
    const asc = [...keep].sort((a, b) => (a.balance > b.balance ? 1 : a.balance < b.balance ? -1 : a.id < b.id ? -1 : 1));
    const n = asc.length;
    const weights = RINGS.reduce((s, r) => s + r, 0);
    const counts = RINGS.map((r) => Math.round((n * r) / weights));
    counts[2] = n - counts[0] - counts[1];
    let i = 0;
    const placed: { id: string; r: number; a: number }[] = [];
    RINGS.forEach((r, ri) => {
      const ring = asc.slice(i, i + counts[ri]);
      i += counts[ri];
      // stable order around the ring: by hash, so a blip does not jump when bags change a little
      ring.sort((a, b) => hash32(a.id) - hash32(b.id));
      const off = [18, 47, 5][ri];
      ring.forEach((b, k) => placed.push({ id: b.id, r, a: off + (k * 360) / ring.length + ((hash32(b.id) % 9) - 4) }));
    });
    // nudge blips apart along their rings so avatars and labels never overlap
    const xy = (q: { r: number; a: number }) => [Math.sin((q.a * Math.PI) / 180) * q.r * 50, -Math.cos((q.a * Math.PI) / 180) * q.r * 50];
    const MIN = 15;
    for (let it = 0; it < 60; it++) {
      let moved = false;
      for (let x = 0; x < placed.length; x++)
        for (let y = x + 1; y < placed.length; y++) {
          const A = placed[x], B = placed[y];
          const [ax, ay] = xy(A), [bx, by] = xy(B);
          const d = Math.hypot(ax - bx, ay - by);
          if (d >= MIN) continue;
          moved = true;
          let diff = ((A.a - B.a + 540) % 360) - 180;
          if (diff === 0) diff = 1;
          const push = (((MIN - d) / 2 + 0.3) * 180) / Math.PI;
          A.a += Math.sign(diff) * push / (A.r * 50);
          B.a -= Math.sign(diff) * push / (B.r * 50);
        }
      if (!moved) break;
    }
    const next = new Map<string, { x: number; y: number; a: number }>();
    for (const q of placed) {
      const a = ((q.a % 360) + 360) % 360;
      const [px, py] = xy({ r: q.r, a });
      next.set(q.id, { x: 50 + px, y: 50 + py, a });
    }
    this.pos = next;
    for (const [id, node] of this.nodes) if (!next.has(id)) { node.remove(); this.nodes.delete(id); }
    for (const b of keep) {
      const p = next.get(b.id)!;
      let node = this.nodes.get(b.id);
      if (!node) {
        node = document.createElement("button");
        node.type = "button";
        node.dataset.id = b.id;
        node.dataset.t0 = String(now());
        node.innerHTML = `<span class="bp-av">${avatar(b.id)}</span><span class="bp-ic"></span><span class="bp-tx"><span class="bp-nm"></span><span class="bp-bal"></span></span>`;
        if (!this.opts.interactive) node.tabIndex = -1;
        this.layer.appendChild(node);
        this.nodes.set(b.id, node);
      }
      node.className = `blip k-${b.kind} s-${b.state}${b.hot ? " hot" : ""}${b.npc ? " npc" : ""}${b.shielded ? " shd" : ""}`;
      node.style.left = `${p.x}%`;
      node.style.top = `${p.y}%`;
      node.style.setProperty("--ping", `${(p.a / 360) * SWEEP_MS - (Number(node.dataset.t0) % SWEEP_MS)}ms`);
      const icon = b.state === "rest" ? ICON.rest : b.state === "busy" ? ICON.busy : b.state === "down" || b.state === "small" ? ICON.down : b.shielded ? ICON.shield : "";
      const ic = node.querySelector<HTMLElement>(".bp-ic")!;
      if (ic.innerHTML !== icon) ic.innerHTML = icon;
      node.querySelector(".bp-nm")!.textContent = b.name;
      node.querySelector(".bp-bal")!.textContent = short(b.balance);
      node.setAttribute("aria-label", `${b.name}, ${b.kind === "vault" ? "vault" : "exposed"}, ${short(b.balance)} coins`);
    }
    this.drawLines();
  }

  /** Raid lines between you (the centre) and a blip, with a countdown. */
  lines(list: RaidLine[]) {
    this.lineData = list.filter((l) => this.pos.has(l.to));
    const sig = this.lineData.map((l) => `${l.id}:${l.to}:${l.dir}`).join("|");
    if (sig !== this.lineSig) { this.lineSig = sig; this.drawLines(); }
    this.tickLabels();
  }

  private drawLines() {
    const list = this.lineData.filter((l) => this.pos.has(l.to));
    this.svg.innerHTML = list
      .map((l) => {
        const p = this.pos.get(l.to)!;
        return l.dir === "out"
          ? `<line x1="50" y1="50" x2="${p.x}" y2="${p.y}" class="ln out"/>`
          : `<line x1="${p.x}" y1="${p.y}" x2="50" y2="50" class="ln ${l.dir}"/>`;
      })
      .join("");
    this.labels.innerHTML = list
      .map((l) => {
        const p = this.pos.get(l.to)!;
        // two raids on one line (yours out, theirs in): the labels sit at different points
        const k = l.dir === "out" ? 0.62 : 0.38;
        return `<span class="rd-lab ${l.dir}" data-id="${esc(l.id)}" data-until="${l.until}" style="left:${50 + (p.x - 50) * k}%;top:${50 + (p.y - 50) * k}%"></span>`;
      })
      .join("");
    this.tickLabels();
  }

  tickLabels(chainNow = Date.now()) {
    for (const el of this.labels.querySelectorAll<HTMLElement>(".rd-lab")) {
      const left = Number(el.dataset.until) - chainNow;
      const s = Math.max(0, Math.ceil(left / 1000));
      el.textContent = left > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "settling";
    }
  }

  pulse(id: string, cls: string) {
    const n = this.nodes.get(id);
    if (!n) return;
    n.classList.remove(cls);
    void n.offsetWidth;
    n.classList.add(cls);
  }

  get discEl() {
    return this.disc;
  }
}
