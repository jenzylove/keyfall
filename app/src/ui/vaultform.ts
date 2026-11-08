// The two vault forms: make a new quantum vault (with its recovery code) and
// restore one from a code.

import { CONTRACT, createVault, getHolder, migrate, newVaultSeed, restoreVault, ChainError, type TxResult } from "../chain";
import { $, act, esc } from "./dom";

const NAME_RE = /^[a-z0-9]+([_-][a-z0-9]+)*$/;

export function suggestName() {
  const r = crypto.getRandomValues(new Uint8Array(4));
  return `vault${[...r].map((b) => (b % 36).toString(36)).join("")}`;
}

export function vaultForm(
  host: HTMLElement,
  opts: { button: string; hot?: boolean; migrateAfter?: boolean; onDone: (r: { vault: TxResult & { accountId: string }; moved?: TxResult }) => void },
) {
  const { seed, code } = newVaultSeed();
  const blocks = code.split("-");
  host.innerHTML = `
    <div class="field">
      <label class="label" for="vf-name">Vault name</label>
      <div class="input-wrap"><input id="vf-name" class="input" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" value="${suggestName()}" /><span class="suffix">.${esc(CONTRACT.split(".")[0].slice(0, 10))}…</span></div>
      <span class="msg" id="vf-name-msg">Lowercase letters, digits, _ and -. Up to 20.</span>
    </div>
    <div class="field">
      <span class="label">Recovery code. Write it down, it is shown once.</span>
      <div class="code">${blocks.map((b, i) => `<span data-n="${i + 1}">${b}</span>`).join("")}</div>
      <div><button type="button" class="link-btn" id="vf-copy">Copy code</button> <span class="msg" id="vf-copy-msg"></span></div>
    </div>
    <label class="check"><input type="checkbox" id="vf-saved" /><span>I saved this code. Without it, nobody can open this vault on another device.</span></label>
    <div><button class="btn${opts.hot ? " hot" : ""}" id="vf-go" disabled>${opts.button} <span class="arrow">→</span></button></div>
    <p class="msg" id="vf-msg"></p>`;

  const name = $<HTMLInputElement>("#vf-name", host);
  const nameMsg = $("#vf-name-msg", host);
  const saved = $<HTMLInputElement>("#vf-saved", host);
  const go = $<HTMLButtonElement>("#vf-go", host);
  let nameOk = true;
  let check = 0;

  const sync = () => (go.disabled = !(saved.checked && nameOk));
  const validate = () => {
    const v = name.value.trim();
    nameOk = v.length > 0 && v.length <= 20 && NAME_RE.test(v);
    nameMsg.className = nameOk ? "msg" : "msg err";
    nameMsg.textContent = nameOk ? `Your vault will be ${v}.${CONTRACT}` : "Use lowercase letters and digits, with single _ or - between them.";
    sync();
    if (!nameOk) return;
    const id = ++check;
    window.setTimeout(async () => {
      if (id !== check) return;
      try {
        if (await getHolder(`${v}.${CONTRACT}`)) {
          if (id !== check) return;
          nameOk = false;
          nameMsg.className = "msg err";
          nameMsg.textContent = "That vault name is taken.";
          sync();
        }
      } catch {
        /* the create call will say so if it is taken */
      }
    }, 350);
  };
  name.addEventListener("input", validate);
  saved.addEventListener("change", sync);
  validate();

  $("#vf-copy", host).addEventListener("click", async () => {
    const m = $("#vf-copy-msg", host);
    try {
      await navigator.clipboard.writeText(code);
      m.textContent = "Copied.";
    } catch {
      m.textContent = "Copy blocked here. Write the 8 blocks down.";
    }
  });

  go.addEventListener("click", () =>
    act(go, $("#vf-msg", host), async () => {
      const vault = await createVault(name.value.trim(), seed);
      let moved: TxResult | undefined;
      if (opts.migrateAfter) moved = await migrate();
      opts.onDone({ vault, moved });
      return moved ?? vault;
    }, () => (opts.migrateAfter ? "Vault made and bag moved in." : "Vault made.")),
  );
}

export function restoreForm(host: HTMLElement, opts: { name?: string; onDone: (accountId: string) => void }) {
  host.innerHTML = `
    <div class="field"><label class="label" for="rf-name">Vault name or account</label><input id="rf-name" class="input" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(opts.name || "")}" /></div>
    <div class="field"><label class="label" for="rf-code">Recovery code</label><input id="rf-code" class="input" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="8 blocks of 8" /></div>
    <div><button class="btn small" id="rf-go">Restore vault</button></div>
    <p class="msg" id="rf-msg"></p>`;
  const go = $<HTMLButtonElement>("#rf-go", host);
  go.addEventListener("click", () =>
    act(go, $("#rf-msg", host), async () => {
      const n = $<HTMLInputElement>("#rf-name", host).value.trim();
      const c = $<HTMLInputElement>("#rf-code", host).value.trim();
      if (!n) throw new ChainError("Type the vault name.");
      const r = await restoreVault(n, c);
      opts.onDone(r.accountId);
    }, () => "Vault restored on this device."),
  );
}
