// Game feel: screen shake, number pops, coin bursts, coins flying to a
// winner, a short freeze frame. Everything respects prefers-reduced-motion.

import { reducedMotion } from "./dom";

const rm = () => reducedMotion();

/** Shake an element once (hits). */
export function shake(el: HTMLElement, hard = false) {
  if (rm()) return;
  el.classList.remove("fx-shake", "fx-shake-hard");
  void el.offsetWidth;
  el.classList.add(hard ? "fx-shake-hard" : "fx-shake");
  setTimeout(() => el.classList.remove("fx-shake", "fx-shake-hard"), 600);
}

/** Pause every CSS animation inside `el` for a beat (hitstop). */
export function freeze(el: HTMLElement, ms = 90) {
  if (rm()) return;
  el.classList.add("hitstop");
  setTimeout(() => el.classList.remove("hitstop"), ms);
}

/** A number that floats up from a point (percent of host or px). */
export function pop(host: HTMLElement, text: string, tone: "gold" | "red" | "ink" | "cyan" = "gold", at?: { x: number; y: number; unit?: "%" | "px" }, size: "" | "big" = "") {
  const el = document.createElement("span");
  el.className = `fx-pop ${tone}${size ? ` ${size}` : ""}`;
  el.textContent = text;
  const u = at?.unit || "%";
  el.style.left = `${at?.x ?? 50}${u}`;
  el.style.top = `${at?.y ?? 50}${u}`;
  host.appendChild(el);
  setTimeout(() => el.remove(), rm() ? 1400 : 1500);
}

/** Pixel coins that burst out from a point and fall. */
export function burst(host: HTMLElement, at: { x: number; y: number }, color = "gold", n = 14) {
  if (rm()) n = Math.min(n, 4);
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    p.className = `fx-coin ${color}`;
    const a = Math.random() * Math.PI * 2;
    const v = 40 + Math.random() * 90;
    p.style.left = `${at.x}%`;
    p.style.top = `${at.y}%`;
    p.style.setProperty("--dx", `${Math.cos(a) * v}px`);
    p.style.setProperty("--dy", `${Math.sin(a) * v - 60}px`);
    p.style.setProperty("--d", `${0.55 + Math.random() * 0.35}s`);
    host.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
}

/** Coins that fly from one point to another (percent of host). */
export function fly(host: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, color = "gold", n = 10, done?: () => void) {
  if (rm()) { done?.(); return; }
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    p.className = `fx-fly ${color}`;
    const jx = (Math.random() - 0.5) * 8, jy = (Math.random() - 0.5) * 8;
    p.style.left = `${from.x + jx}%`;
    p.style.top = `${from.y + jy}%`;
    p.style.setProperty("--tx", `${to.x - from.x - jx}cqw`);
    p.style.setProperty("--ty", `${to.y - from.y - jy}cqh`);
    p.style.setProperty("--delay", `${i * 35}ms`);
    host.appendChild(p);
    setTimeout(() => p.remove(), 900 + i * 35);
  }
  setTimeout(() => done?.(), 700);
}

/** Flash a full screen colour for a frame or two. */
export function flash(host: HTMLElement, tone: "red" | "gold" | "white" = "white") {
  if (rm()) return;
  const el = document.createElement("div");
  el.className = `fx-flash ${tone}`;
  host.appendChild(el);
  setTimeout(() => el.remove(), 260);
}

/** A big arcade banner over the field: ESCAPED, DEFENDED, TITLE EARNED. */
export function banner(host: HTMLElement, big: string, small = "", tone: "gold" | "red" | "cyan" = "gold", ms = 2600) {
  const el = document.createElement("div");
  el.className = `fx-banner ${tone}`;
  el.innerHTML = `<b>${big}</b>${small ? `<span>${small}</span>` : ""}`;
  host.appendChild(el);
  setTimeout(() => el.classList.add("out"), ms - 300);
  setTimeout(() => el.remove(), ms);
  return el;
}

/** Typewriter text into an element. Resolves when done or when cancelled. */
export function typewriter(el: HTMLElement, text: string, onTick?: () => void, ms = 28): { done: Promise<void>; cancel(): void } {
  let stop = false;
  el.textContent = "";
  const done = new Promise<void>((res) => {
    if (rm()) { el.textContent = text; res(); return; }
    let i = 0;
    const step = () => {
      if (stop) { el.textContent = text; res(); return; }
      i++;
      el.textContent = text.slice(0, i);
      if (i % 2 === 0 && text[i - 1] !== " ") onTick?.();
      if (i >= text.length) res();
      else setTimeout(step, text[i - 1] === "." ? ms * 9 : ms);
    };
    step();
  });
  return { done, cancel: () => { stop = true; } };
}
