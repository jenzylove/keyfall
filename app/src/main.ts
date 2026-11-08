import "./styles.css";
import { landing } from "./pages/landing";
import { play } from "./pages/play";
import { defendPage } from "./pages/defend";
import { proof } from "./pages/proof";

export type Page = (root: HTMLElement, params: Record<string, string>) => () => void;

const routes: [RegExp, Page, string][] = [
  [/^\/$/, landing, "Q-DAY · Migrate before Q-Day or freeze"],
  [/^\/play\/?$/, play, "Play · Q-DAY"],
  [/^\/d\/(?<id>\d+)\/?$/, defendPage, "Defend · Q-DAY"],
  [/^\/proof\/?$/, proof, "Proof · Q-DAY"],
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
        <a href="/play" data-link>Play</a>
        <a href="/proof" data-link>Proof</a>
        <button class="theme" type="button" aria-label="Switch colour theme"></button>
      </nav>
    </header>
    <main id="page"></main>`;
  const tb = app.querySelector<HTMLButtonElement>(".theme")!;
  const label = () => (tb.textContent = effectiveTheme() === "dark" ? "Light" : "Dark");
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
  document.body.classList.remove("alert");
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
  page.innerHTML = `<section class="wrap page-title"><p class="eyebrow"><span class="dot"></span>Signal lost</p><h1 class="display h2">No such page.</h1><p><a class="btn" href="/" data-link>Back to the alert</a></p></section>`;
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
