// Small DOM helpers shared by every page. No framework.

import { CONTRACT, ChainError, txLink, type FeedItem, fmtTokens } from "../chain";
import { isNpc as npcRule } from "../../npc/rules.mjs";

export const FAIL = "can't reach NEAR right now";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel as any);
  if (!el) throw new Error(`missing ${sel}`);
  return el as T;
}
export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(sel as any)] as T[];
}
export const maybe = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel as any) as T | null;

export function html(el: Element, s: string) {
  if (el.innerHTML !== s) el.innerHTML = s;
}
export function text(el: Element | null, s: string) {
  if (el && el.textContent !== s) el.textContent = s;
}

/** Show a live value, or the failure line in its place. */
export function failIn(el: Element | null) {
  if (el) el.innerHTML = `<span class="fail-inline">${FAIL}</span>`;
}

// ------------------------------------------------------------------ chain clock

let offset = 0;
let synced = false;
/** Countdowns use chain time from stats().now_ms, ticking locally in between. */
export function syncClock(nowMs: string | number) {
  offset = Number(nowMs) - Date.now();
  synced = true;
}
export const chainNow = () => Date.now() + offset;
export const clockSynced = () => synced;

// ------------------------------------------------------------------ polling

export function poll(fn: () => Promise<unknown> | unknown, ms: number): () => void {
  let stopped = false;
  let t: number | undefined;
  const run = async () => {
    if (stopped) return;
    try {
      await fn();
    } catch (e) {
      console.warn("poll", e);
    }
    if (!stopped) t = window.setTimeout(run, document.hidden ? ms * 3 : ms);
  };
  run();
  return () => {
    stopped = true;
    if (t) clearTimeout(t);
  };
}

// ------------------------------------------------------------------ names

export const isNpc = (account: string) => npcRule(account, CONTRACT);

export function short(account: string, max = 18): string {
  if (!account) return "";
  const suffix = `.${CONTRACT}`;
  let a = account.endsWith(suffix) ? account.slice(0, -suffix.length) : account.replace(/\.testnet$/, "");
  if (a.length > max) a = a.slice(0, max - 1) + "…";
  return a;
}

export function who(account: string, mine: string[] = []): string {
  if (mine.includes(account)) return `<b>you</b>`;
  if (account === "satoshi") return `<b>Satoshi</b>`;
  return `<b>${esc(short(account))}</b>${isNpc(account) ? '<span class="tag npc">NPC</span>' : ""}`;
}

export function tagsFor(account: string, kind: string, mine: string[] = []) {
  let t = "";
  if (mine.includes(account)) t += '<span class="tag you">you</span>';
  if (isNpc(account)) t += '<span class="tag npc">NPC</span>';
  t += kind === "vault" ? '<span class="tag qv">vault</span>' : '<span class="tag ex">exposed</span>';
  return t;
}

// ------------------------------------------------------------------ time

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const units: [number, string][] = [[86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]];
  for (const [n, u] of units) if (s >= n && s % n === 0) return `${s / n} ${u}${s / n === 1 ? "" : "s"}`;
  for (const [n, u] of units) if (s >= n) { const v = Math.round((s / n) * 10) / 10; return `${v} ${u}${v === 1 ? "" : "s"}`; }
  return `${s} seconds`;
}

export function clockText(ms: number): string {
  if (ms <= 0) return "00:00";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${p(h)}h ${p(m)}m`;
  if (h > 0) return `${p(h)}:${p(m)}:${p(sec)}`;
  return `${p(m)}:${p(sec)}`;
}

export function ago(atMs: number): string {
  const s = Math.max(0, Math.floor((chainNow() - atMs) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ------------------------------------------------------------------ feed sentences

export function sentence(f: FeedItem, mine: string[] = [], plain = false): string {
  const W = (a: string | null) => (plain ? (mine.includes(a || "") ? "you" : a === "satoshi" ? "Satoshi" : short(a || "")) : who(a || "", mine));
  const amt = fmtTokens(f.amount);
  switch (f.kind) {
    case "buy": return `${W(f.actor)} bought ${amt} $KEYFALL`;
    case "sell": return `${W(f.actor)} sold ${amt} $KEYFALL`;
    case "vault": return `${W(f.actor)} opened a quantum vault`;
    case "migrate": return `${W(f.actor)} moved ${amt} into the vault ${W(f.target)}`;
    case "transfer": return `${W(f.actor)} sent ${amt} to ${W(f.target)}`;
    case "harvest": return `the harvest ran: ${amt} bled out of exposed bags`;
    case "raid": return `${W(f.actor)} raided ${W(f.target)} with a ${amt} stake`;
    case "defend": return `${W(f.actor)} fought off ${W(f.target)} and won ${amt}`;
    case "resolve": return BigInt(f.amount) > 0n ? `${W(f.actor)} raided ${W(f.target)}: took ${amt}` : `${W(f.actor)} raided ${W(f.target)}: took nothing`;
    case "shield": return `${W(f.actor)} burned ${amt} for a ${Number(f.extra || 0) / 100}% shield`;
    case "boss": return `${W(f.actor)} hit Satoshi for ${amt}`;
    default: return `${W(f.actor)} ${esc(f.kind)} ${amt}`;
  }
}

// ------------------------------------------------------------------ actions

/** Wire a button to a chain move: busy state, result line with explorer link,
 * errors in the action's own spot. */
export async function act(
  btn: HTMLButtonElement,
  outEl: Element | null,
  fn: () => Promise<{ hash?: string } | void>,
  done?: (r: any) => string | void,
) {
  const out = outEl as HTMLElement | null;
  if (btn.classList.contains("busy")) return;
  const label = btn.innerHTML;
  btn.classList.add("busy");
  btn.disabled = true;
  if (out) { out.className = "msg"; out.textContent = ""; }
  try {
    const r = await fn();
    const note = done?.(r);
    if (out) {
      out.className = "msg ok";
      const h = (r as any)?.hash;
      out.innerHTML = `${note ?? "Done."}${h ? ` <a class="tx" href="${txLink(h)}" target="_blank" rel="noopener">view on explorer ↗</a>` : ""}`;
    }
    return r;
  } catch (e: any) {
    const err = e instanceof ChainError ? e : new ChainError(String(e?.message || e));
    if (out) {
      out.className = "msg err";
      out.innerHTML = `${esc(err.message)}${err.hash ? ` <a class="tx" href="${txLink(err.hash)}" target="_blank" rel="noopener">view on explorer ↗</a>` : ""}`;
    }
    console.warn(err);
  } finally {
    btn.classList.remove("busy");
    btn.disabled = false;
    btn.innerHTML = label;
  }
}

// read once and kept current: the arena asks many times a frame, and matchMedia is not free
let rmq: MediaQueryList | null = null;
let rmNow = false;
export const reducedMotion = () => {
  if (!rmq) { rmq = window.matchMedia("(prefers-reduced-motion: reduce)"); rmNow = rmq.matches; rmq.addEventListener?.("change", (e) => { rmNow = e.matches; }); }
  return rmNow;
};

/** Whole $KEYFALL input to base units. */
export function wholeToUnits(v: string): bigint | null {
  const m = String(v).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(m)) return null;
  const [w, f = ""] = m.split(".");
  return BigInt(w) * 10n ** 18n + BigInt((f + "000000").slice(0, 6)) * 10n ** 12n;
}
export const unitsToNumber = (x: string | bigint) => Number(BigInt(x) / 10n ** 12n) / 1e6;

/** Client side navigation without importing the router. */
export function nav(href: string) {
  history.pushState(null, "", href);
  dispatchEvent(new PopStateEvent("popstate"));
}

export const REPO = "https://github.com/jenzylove/keyfall";
