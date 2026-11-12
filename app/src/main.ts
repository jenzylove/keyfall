import "./styles.css";
import { landing } from "./pages/landing";
import { play } from "./pages/play";
import { defendPage } from "./pages/defend";
import { proof } from "./pages/proof";
import { MARK } from "./ui/pixels";
import * as sfx from "./ui/sound";

export type Page = (root: HTMLElement, params: Record<string, string>) => () => void;

const routes: [RegExp, Page, string][] = [
  [/^\/$/, landing, "KEYFALL · Run your coins into a quantum vault before Q-Day"],
  [/^\/play\/?$/, play, "Play · KEYFALL"],
  [/^\/d\/(?<id>\d+)\/?$/, defendPage, "Defend · KEYFALL"],
  [/^\/proof\/?$/, proof, "Under the hood · KEYFALL"],
];

const app = document.getElementById("app")!;

function effectiveTheme(): "light" | "dark" {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "light" || t === "dark") return t;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function chrome() {
  app.innerHTML = `
    <div class="crt" aria-hidden="true"></div>
    <header class="wrap top">
      <a class="brand" href="/" data-link><span class="mark">${MARK}</span>KEYFALL</a>
      <nav class="nav">
        <a href="/play" data-link class="play-link">Play</a>
        <a href="/proof" data-link>Under the hood</a>
        <button class="snd ico" type="button" aria-label="Sound"></button>
        <button class="theme ico" type="button" aria-label="Switch colour theme"></button>
      </nav>
    </header>
    <main id="page"></main>`;
  const tb = app.querySelector<HTMLButtonElement>(".theme")!;
  const SUN = `<svg viewBox="0 0 24 24" aria-hidden="true" shape-rendering="crispEdges"><rect x="9" y="9" width="6" height="6" fill="currentColor"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" stroke="currentColor" stroke-width="2"/></svg>`;
  const MOON = `<svg viewBox="0 0 24 24" aria-hidden="true" shape-rendering="crispEdges"><path d="M9 3h5v2h-3v2H9v2H7v6h2v2h2v2h3v2H9v-2H7v-2H5v-2H3V9h2V7h2V5h2z" fill="currentColor"/></svg>`;
  const label = () => { const dark = effectiveTheme() === "dark"; tb.innerHTML = dark ? SUN : MOON; tb.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme"); };
  label();
  tb.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("qday.theme", next); } catch {}
    sfx.play("blip");
    label();
  });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", label);
  const sb = app.querySelector<HTMLButtonElement>(".snd")!;
  const slabel = (m: boolean) => { sb.innerHTML = m ? sfx.SPEAKER_OFF : sfx.SPEAKER; sb.setAttribute("aria-label", m ? "Sound off. Turn on" : "Sound on. Mute"); sb.classList.toggle("off", m); };
  slabel(sfx.isMuted());
  sfx.onMute(slabel);
  sb.addEventListener("click", () => { sfx.unlock(); sfx.toggleMute(); if (!sfx.isMuted()) sfx.play("blip"); });
}

let cleanup: (() => void) | null = null;

function render() {
  const path = location.pathname;
  shownPath = path;
  const page = document.getElementById("page")!;
  cleanup?.();
  cleanup = null;
  document.body.classList.remove("alert", "in-game", "on-title");
  page.innerHTML = "";
  for (const a of app.querySelectorAll<HTMLAnchorElement>(".nav a")) {
    if (a.getAttribute("href") === path || (path.startsWith("/d/") && a.getAttribute("href") === "/play")) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  for (const [re, fn, title] of routes) {
    const m = path.match(re);
    if (m) {
      document.title = title;
      cleanup = fn(page, (m.groups as Record<string, string>) || {});
      if (!location.hash) window.scrollTo(0, 0);
      else requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
      return;
    }
  }
  document.title = "Not found · KEYFALL";
  page.innerHTML = `<section class="wrap page-title"><p class="eyebrow"><span class="dot"></span>Signal lost</p><h1 class="display h2">No such page</h1><p><a class="btn" href="/" data-link>Back to the title</a></p></section>`;
}

export function go(href: string) {
  history.pushState(null, "", href);
  render();
}

document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest?.("a");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank") return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  if (url.pathname === location.pathname && url.hash) return; // in-page anchor
  if (url.searchParams.has("net")) return; // switching arena: a full page load, so the chain layer starts on that network
  e.preventDefault();
  go(url.pathname + url.search + url.hash);
});
// Every button and link blips, once sound is unlocked.
document.addEventListener("pointerdown", (e) => {
  const t = (e.target as HTMLElement).closest?.("button, a.btn, .blip");
  if (t && !t.classList.contains("snd") && !(t as HTMLButtonElement).disabled) sfx.play("blip");
}, { passive: true });
// Back and forward re-render only when the page changes: a sheet's own history entry (ui/sheet.ts) or an in page anchor keeps the game running.
let shownPath = location.pathname;
window.addEventListener("popstate", () => { if (location.pathname === shownPath) return; render(); });

chrome();
render();
