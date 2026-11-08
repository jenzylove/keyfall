// Drive the real judge path on the live site at phone size and screenshot each beat.
import puppeteer, { KnownDevices } from "puppeteer-core";
const BASE = process.argv[2] || "https://qday-one.vercel.app";
const OUT = process.argv[3] || "shots";
const b = await puppeteer.launch({ userDataDir: process.env.PROFILE, executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
const p = await b.newPage();
await p.emulate(KnownDevices["Pixel 5"]);
const errors = [];
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));
const t0 = Date.now();
const log = (s, x = "") => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s} ${x}`);
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
const text = (sel) => p.$eval(sel, (e) => e.textContent?.trim() || "").catch(() => "");
const waitText = async (pred, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const t = await p.evaluate(() => document.body.innerText); if (pred(t)) return t; await new Promise((r) => setTimeout(r, 2000)); } return null; };
const click = async (sel) => { await p.waitForSelector(sel, { visible: true, timeout: 60000 }); await p.$eval(sel, (e) => e.scrollIntoView({ block: "center" })); await p.click(sel); };

await p.goto(`${BASE}/play`, { waitUntil: "networkidle2" });
await shot("01-play-start");
await click("#ob-go"); log("join clicked");
let t = await waitText((s) => /STEP 2 OF 4/i.test(s) || /No free testnet wallet|Could not create/i.test(s), 90000);
await shot("02-joined"); log("after join", t ? (t.match(/(No free[^\n]*|Could not[^\n]*)/)?.[0] || "ok") : "timeout");
await click("#ob-go"); log("buy clicked");
t = await waitText((s) => /STEP 3 OF 4/i.test(s) || /being raided/i.test(s), 90000);
await shot("03-bought"); log("after buy", t ? "ok" : "timeout");
// wait for a greeting raid (NPC tick fires after buying)
t = await waitText((s) => /being raided|Escape/i.test(s), 150000);
log("raid alert", t ? "YES" : "no raid within 150s");
await shot("04-alert");
// Escape (or plain onboarding): use whichever vault form is visible.
const visible = async (sel) => { for (const h of await p.$$(sel)) { if (await h.isVisible()) return h; } return null; };
let saved = null; for (let i = 0; i < 30 && !(saved = await visible("#vf-saved")); i++) await new Promise((r) => setTimeout(r, 1000));
await saved.scrollIntoView(); await saved.click();
const go = await visible("#vf-go"); await go.click(); log("create vault (escape) clicked");
t = await waitText((s) => /STEP 4 OF 4/i.test(s) || /Hit Satoshi/i.test(s), 90000);
await shot("06-vault"); log("after vault", t ? "ok" : "timeout");
if (await p.$("#ob-go")) { const label = await text("#ob-go"); if (/Move my bag/i.test(label)) { await click("#ob-go"); log("migrate clicked"); } }
t = await p.waitForSelector("#bs-go", { visible: true, timeout: 150000 }).catch(() => null);
await shot("07-in-game"); log("in game", t ? "ok" : "timeout");
const after = await p.evaluate(() => document.body.innerText);
log("escape result", (after.match(/(took nothing|escaped[^\n]*|Escaped[^\n]*)/) || ["(not shown)"])[0]);
// boss + shield
if (await p.$("#bs-go")) { await click("#bs-go"); await waitText((s) => /explorer|already hit|Hold more/i.test(s), 60000); await shot("08-boss"); log("boss", (await text("#g-boss .msg, .msg")).slice(0, 120)); }
if (await p.$("#sh-go")) { await click("#sh-go"); await new Promise((r) => setTimeout(r, 15000)); await shot("09-shield"); log("shield done"); }
const fullText = await p.evaluate(() => document.body.innerText);
console.log("--- explorer links seen:", (fullText.match(/view on explorer/gi) || []).length);
await p.screenshot({ path: `${OUT}/10-full.png`, fullPage: true });
console.log("--- console errors:", JSON.stringify(errors.slice(0, 10)));

// Outcome of the greeting raid, read from the chain (not the page).
const RPC = "https://rpc.testnet.near.org";
const CONTRACT = "qday-live-mw6vii9l47s.testnet";
const callView = async (method, args) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
  const j = await r.json();
  return JSON.parse(Buffer.from(j.result.result).toString());
};
const wallet = JSON.parse(await p.evaluate(() => localStorage.getItem("qday.wallet.v1")) || "{}").accountId;
const vault = JSON.parse(await p.evaluate(() => localStorage.getItem("qday.vault.v1")) || "{}").accountId;
log("wallet", wallet); log("vault", vault);
const stats = await callView("stats", {});
let raid = null;
for (let id = Number(stats.raids); id > 0 && id > Number(stats.raids) - 40; id--) {
  const r = await callView("get_raid", { raid_id: String(id) });
  if (r && r.target === wallet) { raid = r; break; }
}
log("greeting raid", raid ? `#${raid.id} by ${raid.attacker.split(".")[0]}, status ${raid.status}` : "none found");
if (raid) {
  const end = Date.now() + 15 * 60 * 1000;
  while (raid.status === "open" && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 20000));
    raid = await callView("get_raid", { raid_id: String(raid.id) });
  }
  await p.screenshot({ path: `${OUT}/11-after-raid.png`, fullPage: false });
  log("raid outcome", `status ${raid.status}, take ${raid.take} (0 means the escape worked)`);
}
const vh = vault ? await callView("holder", { account_id: vault }) : null;
log("vault balance", vh ? vh.balance : "none");
await b.close();
