import "./styles.css";
import { landing } from "./pages/landing";
import { play } from "./pages/play";
import { defendPage } from "./pages/defend";
import { proof } from "./pages/proof";

export type Page = (root: HTMLElement, params: Record<string, string>) => () => void;

const routes: [RegExp, Page, string][] = [
  [/^\/$/, landing, "Q-DAY · Move into a quantum vault before Q-Day"],
  [/^\/play\/?$/, play, "Play · Q-DAY"],
  [/^\/d\/(?<id>\d+)\/?$/, defendPage, "Defend · Q-DAY"],
  [/^\/proof\/?$/, proof, "Under the hood · Q-DAY"],
];

const app = document.getElementById("app")!;

const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="21" fill="none" stroke="#FFD60A" stroke-width="8"/><path d="M13 51L51 13" stroke="#FF3D2E" stroke-width="8" stroke-linecap="round"/></svg>`;

function effectiveTheme(): "light" | "dark" {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "light" || t === "dark") return t;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function chrome() {
  app.innerHTML = `
    <div class="alert-edge" aria-hidden="true"></div>
    <header class="wrap top">
      <a class="brand" href="/" data-link>${LOGO}Q-DAY</a>
      <nav class="nav">
        <a href="/play" data-link class="play-link">Play</a>
        <a href="/proof" data-link>Under the hood</a>
        <button class="theme ico" type="button" aria-label="Switch colour theme"></button>
      </nav>
    </header>
    <main id="page"></main>`;
  const tb = app.querySelector<HTMLButtonElement>(".theme")!;
  const SUN = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" stroke="currentColor" stroke-width="2"/></svg>`;
  const MOON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 2.5A9.5 9.5 0 1 0 21.5 16 8 8 0 0 1 15.5 2.5Z" fill="currentColor"/></svg>`;
  const label = () => { const dark = effectiveTheme() === "dark"; tb.innerHTML = dark ? SUN : MOON; tb.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme"); };
  label();
  tb.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("qday.theme", next); } catch {}
    label();
  });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", label);
}

let cleanup: (() => void) | null = null;

function render() {
  const path = location.pathname;
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
  document.title = "Not found · Q-DAY";
  page.innerHTML = `<section class="wrap page-title"><p class="eyebrow"><span class="dot"></span>Signal lost</p><h1 class="display h2">No such page.</h1><p><a class="btn" href="/" data-link>Back to the title</a></p></section>`;
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
  e.preventDefault();
  go(url.pathname + url.search + url.hash);
});
window.addEventListener("popstate", render);

chrome();
render();
