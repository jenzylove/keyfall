// Bottom sheets over the play field. One at a time.

export interface Sheet { el: HTMLElement; body: HTMLElement; close(): void; closed: boolean }

let current: Sheet | null = null;

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
      opts.onClose?.();
    },
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") s.close(); };
  document.addEventListener("keydown", onKey);
  wrap.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-close]")) s.close(); });
  requestAnimationFrame(() => wrap.classList.add("in"));
  setTimeout(() => wrap.querySelector<HTMLElement>(".sheet")?.focus({ preventScroll: true }), 60);
  current = s;
  return s;
}

export const closeSheet = () => current?.close();
export const currentSheet = () => current;
