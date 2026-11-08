// Countdown, counting numbers, the hazard crawl.

import { chainNow, esc, reducedMotion } from "./dom";

// ------------------------------------------------------------------ countdown

export interface Countdown { set(targetMs: number | null): void; stop(): void }

/** Ticking digits to a chain-time target. Units: days, hours, minutes, seconds
 * (days drop out when zero and `compact` is set). */
export function countdown(el: HTMLElement, opts: { compact?: boolean; onZero?: () => void } = {}): Countdown {
  let target: number | null = null;
  let shape = "";
  let digits: HTMLElement[] = [];
  let fired = false;
  el.classList.add("countdown");
  el.setAttribute("role", "timer");

  const groups = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const p = (n: number) => String(n).padStart(2, "0");
    const g: [string, string][] = [];
    if (!opts.compact || d > 0) g.push([p(d), "days"]);
    if (!opts.compact || d > 0 || h > 0) g.push([p(h), "hrs"]);
    g.push([p(m), "min"], [p(sec), "sec"]);
    return g;
  };

  const render = () => {
    if (target === null) return;
    const left = target - chainNow();
    const g = groups(left);
    const sig = g.map(([v, u]) => `${v.length}${u}`).join();
    if (sig !== shape) {
      shape = sig;
      el.innerHTML = g
        .map(([v, u], i) => `${i ? '<span class="cd-sep">:</span>' : ""}<span class="cd-grp"><span class="cd-digits">${[...v].map((c) => `<span class="cd-d">${c}</span>`).join("")}</span><span class="cd-unit">${u}</span></span>`)
        .join("");
      digits = [...el.querySelectorAll<HTMLElement>(".cd-d")];
    }
    const chars = g.map(([v]) => v).join("");
    [...chars].forEach((c, i) => {
      const d = digits[i];
      if (d && d.textContent !== c) {
        d.textContent = c;
        if (!reducedMotion()) { d.classList.remove("tick"); void d.offsetWidth; d.classList.add("tick"); }
      }
    });
    el.setAttribute("aria-label", g.map(([v, u]) => `${v} ${u}`).join(" "));
    if (left <= 0 && !fired) { fired = true; opts.onZero?.(); }
  };
  const t = window.setInterval(render, 250);
  return {
    set(ms) {
      if (ms !== target) fired = false;
      target = ms;
      render();
    },
    stop() { clearInterval(t); },
  };
}

// ------------------------------------------------------------------ count up

const running = new WeakMap<Element, number>();
/** Animate a number from what is shown to `value`. */
export function countTo(el: HTMLElement | null, value: number, fmt: (n: number) => string) {
  if (!el) return;
  const prev = Number(el.dataset.v ?? NaN);
  el.dataset.v = String(value);
  el.classList.add("count-up");
  if (!Number.isFinite(prev) || prev === value || reducedMotion()) {
    el.textContent = fmt(value);
    if (!Number.isFinite(prev) && !reducedMotion() && value !== 0) {
      // first paint: count up from zero
      el.dataset.v = String(value);
      return countFrom(el, 0, value, fmt);
    }
    return;
  }
  countFrom(el, prev, value, fmt);
}
function countFrom(el: HTMLElement, from: number, to: number, fmt: (n: number) => string) {
  const id = (running.get(el) || 0) + 1;
  running.set(el, id);
  const t0 = performance.now();
  const dur = 900;
  const step = (t: number) => {
    if (running.get(el) !== id) return;
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------ crawl

export interface Crawl { el: HTMLElement; set(lines: string[] | null): void }

export function crawl(label = "Live feed"): Crawl {
  const el = document.createElement("div");
  el.className = "crawl";
  el.innerHTML = `<div class="crawl-line"><div class="crawl-tag"><span class="dot"></span>${esc(label)}</div><div class="crawl-track" aria-live="off"><div class="crawl-run"></div></div></div>`;
  const run = el.querySelector<HTMLElement>(".crawl-run")!;
  let last = "";
  return {
    el,
    set(lines) {
      const items = lines === null ? ["can't reach NEAR right now"] : lines.length ? lines : ["no moves yet this season. be the first: play now"];
      const key = items.join("|");
      if (key === last) return;
      last = key;
      const one = items.map((l) => `<span>${esc(l)}</span>`).join("");
      // duplicated so the loop is seamless at translateX(-50%)
      let reps = 1;
      while (one.length * reps < 600 && reps < 8) reps++;
      const half = one.repeat(reps);
      run.innerHTML = half + half;
      const chars = items.join("").length * reps;
      run.style.setProperty("--dur", `${Math.max(18, chars * 0.16)}s`);
    },
  };
}
