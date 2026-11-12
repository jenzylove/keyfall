// Bottom sheets over the play field. One at a time.

export interface Sheet { el: HTMLElement; body: HTMLElement; close(): void; closed: boolean }

let current: Sheet | null = null;

// The phone's back button closes the open sheet instead of leaving the game: one history entry stands for
// "a sheet is open". Closing a sheet any other way takes that entry back off, so history stays clean.
let entry = 0; // the id of our history entry while it is on top, else 0
let skipPop = false; // the next popstate is our own history.back(), not the player's
const isOurs = () => !!entry && (history.state as any)?.keyfallSheet === entry;
window.addEventListener("popstate", () => {
  if (skipPop) { skipPop = false; return; }
  if (entry && !isOurs()) { entry = 0; current?.close(); }
});
function dropEntry() {
  setTimeout(() => {
    if (current || !entry) return; // another sheet opened in its place: it keeps the entry
    const ours = isOurs();
    entry = 0;
    if (ours) { skipPop = true; history.back(); } // only our own entry: never step back over a page change
  }, 0);
}

export function openSheet(opts: { tone?: "hot" | "gold" | ""; label: string; html: string; onClose?: () => void; host?: HTMLElement }): Sheet {
  current?.close();
  const wrap = document.createElement("div");
  wrap.className = `sheet-wrap${opts.tone ? ` tone-${opts.tone}` : ""}`;
  wrap.innerHTML = `
    <div class="sheet-back" data-close></div>
    <section class="sheet" tabindex="-1" role="dialog" aria-modal="true" aria-label="${opts.label}">
      <div class="sheet-grab" data-close aria-hidden="true"><i></i></div>
      <button class="sheet-x" type="button" data-close aria-label="Close">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.8"/></svg>
      </button>
      <div class="sheet-body">${opts.html}</div>
    </section>`;
  (opts.host || document.body).appendChild(wrap);
  const body = wrap.querySelector<HTMLElement>(".sheet-body")!;
  const s: Sheet = {
    el: wrap,
    body,
    closed: false,
    close() {
      if (s.closed) return;
      s.closed = true;
      document.removeEventListener("keydown", onKey);
      wrap.classList.add("out");
      setTimeout(() => wrap.remove(), 220);
      if (current === s) current = null;
      dropEntry();
      opts.onClose?.();
    },
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") s.close(); };
  document.addEventListener("keydown", onKey);
  wrap.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-close]")) s.close(); });
  requestAnimationFrame(() => wrap.classList.add("in"));
  setTimeout(() => wrap.querySelector<HTMLElement>(".sheet")?.focus({ preventScroll: true }), 60);
  current = s;
  if (!entry) { try { const id = Date.now(); history.pushState({ ...(history.state || {}), keyfallSheet: id }, "", location.href); entry = id; } catch {} }
  return s;
}

export const closeSheet = () => current?.close();
export const currentSheet = () => current;
