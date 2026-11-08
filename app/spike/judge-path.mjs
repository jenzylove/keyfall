// Drive the real judge path on the live site at phone size and screenshot each beat.
import puppeteer, { KnownDevices } from "puppeteer-core";
const BASE = process.argv[2] || "https://qday-one.vercel.app";
const OUT = process.argv[3] || "shots";
const b = await puppeteer.launch({ userDataDir: process.env.PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
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
if (t) {
  await click("#al-go"); log("escape clicked");
  await new Promise((r) => setTimeout(r, 1500)); await shot("05-escape-form");
}
// vault form (onboarding or escape flow)
await p.waitForSelector("#vf-saved", { visible: true, timeout: 60000 });
await p.$eval("#vf-saved", (e) => e.scrollIntoView({ block: "center" }));
await p.click("#vf-saved"); await click("#vf-go"); log("create vault clicked");
t = await waitText((s) => /STEP 4 OF 4/i.test(s) || /Hit Satoshi/i.test(s), 90000);
await shot("06-vault"); log("after vault", t ? "ok" : "timeout");
if (await p.$("#ob-go")) { const label = await text("#ob-go"); if (/Move my bag/i.test(label)) { await click("#ob-go"); log("migrate clicked"); } }
t = await waitText((s) => /Hit Satoshi|Charge shield/i.test(s), 90000);
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
await b.close();
