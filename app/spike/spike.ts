import * as c from "../src/chain";
const out: any[] = [];
const log = (step: string, data: any = {}) => { out.push({ step, t: Math.round(performance.now()), ...data }); document.getElementById("log")!.textContent = JSON.stringify(out, null, 1); };
(window as any).__done = false;
(async () => {
  try {
    log("start", { contract: c.CONTRACT, ua: navigator.userAgent });
    const w = await c.join(); log("joined", w);
    const b = await c.buy(1); log("bought", { hash: b.hash, bal: await c.balanceOf(w.accountId) });
    const { seed, code } = c.newVaultSeed(); log("seed", { codeLen: code.length });
    const name = "s" + Date.now().toString(36);
    const t0 = performance.now();
    const v = await c.createVault(name, seed); log("vault", { hash: v.hash, accountId: v.accountId, ms: Math.round(performance.now() - t0), keys: await c.keyList(v.accountId) });
    const m = await c.migrate(); log("migrated", { hash: m.hash, vault: await c.balanceOf(v.accountId) });
    const t1 = performance.now();
    const s = await c.chargeShield(c.tokens(10)); log("shield (ML-DSA signed)", { hash: s.hash, value: s.value, ms: Math.round(performance.now() - t1) });
    // reload path: session restore from sealed seed
    const sess = await c.loadSession(); log("session", sess);
    log("done", { ok: true });
  } catch (e: any) { log("error", { message: e.message, code: e.code, hash: e.hash, stack: String(e.stack).slice(0, 400) }); }
  (window as any).__done = true; (window as any).__out = out;
})();
