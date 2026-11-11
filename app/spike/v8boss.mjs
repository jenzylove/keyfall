// Satoshi hit, raw: read the vault view, send boss_raid through the page's chain module, print the raw result or error.
// Usage: node spike/v8boss.mjs <profile> [send]
import puppeteer from "puppeteer-core";
const [PROFILE, SEND] = process.argv.slice(2);
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--no-sandbox"] });
const p = await b.newPage();
await p.goto("http://localhost:5189/404", { waitUntil: "domcontentloaded", timeout: 120000 });
const r = await p.evaluate(async (send) => {
  const chain = await import("/src/chain.ts");
  await chain.loadSession?.();
  const s = chain.session();
  const id = s.vault?.accountId;
  const out = { vault: id, stats: null, before: null, result: null, error: null, after: null };
  const st = await chain.getStats(); out.stats = { epoch: st.epoch, now: st.now_ms, ends: st.epoch_ends_ms };
  out.before = await chain.getHolder(id);
  if (send) { try { out.result = await chain.bossRaid(); } catch (e) { out.error = String(e?.message || e).slice(0, 600); } out.after = await chain.getHolder(id); }
  return out;
}, !!SEND);
console.log(JSON.stringify(r, null, 1));
await b.close();
