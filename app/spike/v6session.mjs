// v6: a fresh player's real session on the arcade season, every state screenshotted.
// guide (new key text) -> vault (three steps, timed) -> shoot bagholders (ROBBING badge, burst, +N) ->
// SHOOT on an already robbed target and with zero shots -> YOUR BAG sheet -> shield -> a raid on you (HIT strip,
// ring catches the shot) -> defend by shot (BLOCKED, +stake) -> Satoshi red (badge, hit numbers).
// Usage: node spike/v6session.mjs [theme light|dark] [profile]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:5189";
const THEME = process.argv[2] || "light";
const OUT = process.env.OUT || `C:/Users/LENOVO/qday-launch/v6shots/${THEME}`;
const PROFILE = process.argv[3] || `C:/Users/LENOVO/qday-launch/chrome-v6-${THEME}-${Date.now()}`;
fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
p.on("console", (m) => m.type() === "error" && !/well-known|favicon/.test(m.text()) && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));
const t0 = Date.now();
const T = () => ((Date.now() - t0) / 1000).toFixed(0);
const log = (...a) => console.log(`[${T()}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png` }).then(() => log("shot", n));
const A = (fn, ...args) => p.evaluate((src, ...a) => { const ar = document.querySelector("#field").__arena; return new Function("ar", ...a.map((_, i) => `a${i}`), `return (${src})(ar, ${a.map((_, i) => `a${i}`).join(",")})`)(ar, ...a); }, fn.toString(), ...args);
const W = () => p.evaluate(() => document.querySelector("#field").__world());
const G = () => p.evaluate(() => document.querySelector("#field").__guide());
const waitFor = async (fn, ms, every = 400) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };
const waitStep = async (n, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const g = await G().catch(() => null); if (g && g.on && g.step >= n) return g; await sleep(300); } return null; };
const bubbles = () => p.evaluate(() => [...document.querySelectorAll(".bp-say")].map((e) => e.textContent).join(" | "));
const shootStatus = () => p.evaluate(() => document.querySelector("#a-shoot")?.textContent);
async function steerTo(target, ms = 25000, near = 30) {
  const end = Date.now() + ms; const held = new Set();
  const setKeys = async (want) => { for (const k of held) if (!want.has(k)) { await p.keyboard.up(k); held.delete(k); } for (const k of want) if (!held.has(k)) { await p.keyboard.down(k); held.add(k); } };
  let stuck = 0, lastD = Infinity;
  while (Date.now() < end) {
    const me = await A((ar) => ({ x: ar.me.x, y: ar.me.y }));
    const tgt = await A((ar, id) => { const s = id === "gate" ? ar.gate : id === "satoshi" ? ar.boss : ar.bodies.get(id); return s ? { x: s.x, y: s.y } : null; }, target);
    if (!tgt) break;
    const dx = tgt.x - me.x, dy = tgt.y - me.y, d = Math.hypot(dx, dy);
    if (d < near) break;
    if (await A((ar) => !!ar.meInfo.inFlight)) break;
    if (d > lastD - 2) stuck++; else stuck = 0; lastD = d;
    const want = new Set();
    if (stuck > 8) { const side = Math.floor(stuck / 14) % 2 === 0; want.add(Math.abs(dx) > Math.abs(dy) ? (side ? "w" : "s") : (side ? "a" : "d")); if (stuck > 28) stuck = 0; }
    else { if (Math.abs(dx) > 8) want.add(dx > 0 ? "d" : "a"); if (Math.abs(dy) > 8) want.add(dy > 0 ? "s" : "w"); }
    await setKeys(want); await sleep(50);
  }
  await setKeys(new Set());
}
const press = () => p.click("#shoot-btn");

await p.evaluateOnNewDocument((theme) => { localStorage.setItem("qday.theme", theme); localStorage.setItem("qday.intro.v2", "1"); }, THEME);
await p.goto(`${BASE}/play`, { waitUntil: "domcontentloaded" });
await waitFor(() => document.querySelector("#field")?.__arena?.ready, 30000);
await waitFor(() => (document.querySelector("#field")?.__world?.().holders || 0) > 0 ? "ok" : null, 40000);
log("world", JSON.stringify(await W()));

// ---- grab, guide 1..3
if (await waitFor(() => document.querySelector("#start:not([hidden]) #m-go") ? 1 : null, 15000)) {
  await shot("00-grab");
  await p.click("#m-go");
  const r = await waitFor(() => { const s = document.querySelector("#start"); return s && s.hidden ? "ok" : (document.querySelector(".m-msg.bad")?.textContent || null); }, 150000, 1000);
  log("grab:", r);
  if (r !== "ok") { await shot("x-grab-failed"); log("errors", JSON.stringify(errors)); await b.close(); process.exit(1); }
}
await waitStep(1, 20000); await sleep(800); await shot("01-this-is-you");
await p.keyboard.down("d"); await sleep(700); await p.keyboard.up("d");
await waitStep(2, 10000); await sleep(600); await shot("02-you-are-red");
await p.evaluate(() => document.querySelector("#g-next")?.click());
await waitStep(3, 10000); await sleep(600); await shot("03-gold-door-key-text");
// ---- the vault: three steps, timed
await steerTo("gate", 90000, 46);
if (await waitFor(() => document.querySelector("#n-go") ? 1 : null, 10000, 300)) {
  await shot("04-name-sheet");
  const tv = Date.now();
  await p.evaluate(() => document.querySelector("#n-go")?.click());
  await waitFor(() => document.querySelector(".n-steps li.now") ? 1 : null, 5000, 50);
  await sleep(1200); await shot("05-vault-step1");
  await waitFor(() => document.querySelector('.n-steps li[data-step="2"].now, .n-steps li[data-step="2"].done') ? 1 : null, 60000, 100);
  await sleep(300); await shot("05b-vault-step2");
  await waitFor(() => document.querySelector('.n-steps li[data-step="3"].now, .n-steps li[data-step="3"].done') ? 1 : null, 60000, 100);
  await sleep(300); await shot("05c-vault-step3");
  const r = await waitFor(() => document.querySelector("#n-msg.ok, #n-msg.bad")?.textContent || null, 180000, 200);
  log("vault build:", r, "wall ms", Date.now() - tv, "page ms", await p.evaluate(() => document.querySelector("#field").__buildMs));
  await sleep(200); await shot("05d-vault-done");
}
await waitFor(() => BigInt(document.querySelector("#field").__world().vaultBal || "0") > 0n ? 1 : null, 90000, 1000);
await waitStep(4, 20000); await sleep(500); await shot("06-you-are-gold-key-text");
await p.evaluate(() => document.querySelector("#g-next")?.click());
await waitStep(5, 15000); await sleep(800); await shot("07-shoot-a-target");
await p.evaluate(() => { localStorage.setItem("qday.guide.v1.testnet", JSON.stringify({ step: 7, done: true })); });
await sleep(1200);
log("gold", JSON.stringify(await W()));

// ---- hunt three bagholders: lock, chase, auto fire; badge, settle, burst
const bagholders = () => A((ar) => [...ar.targets].filter((id) => id !== "satoshi" && /^kfbag/.test(id)).map((id) => ({ id, d: ar.distTo(id) })).sort((a, b) => a.d - b.d));
const robbing = []; // { id, at }
let shotsTaken = 0;
for (let i = 0; i < 3 && shotsTaken < 3; i++) {
  const list = await bagholders();
  const pick = list.find((x) => !robbing.some((r) => r.id === x.id));
  if (!pick) { log("no free bagholder in range", JSON.stringify(list)); break; }
  await A((ar, id) => ar.lockOn(id), pick.id);
  await steerTo(pick.id, 30000, 150);
  const fired = await waitFor(() => document.querySelector("#field").__arena.meInfo.inFlight ? 1 : null, 8000, 100);
  log("lock", pick.id, "fired:", !!fired, "|", await bubbles());
  if (fired) {
    if (i === 0) { await sleep(150); await shot("08-shot-flying"); }
    await waitFor(() => document.querySelector("#field").__arena.meInfo.inFlight ? null : 1, 60000, 200);
    shotsTaken++;
    robbing.push({ id: pick.id, at: Date.now() });
    await sleep(900);
    await shot(`09-robbing-badge-${shotsTaken}`);
  }
}
// SHOOT on the locked target that is already being robbed: the lock switches or the bubble says so
if (robbing[0]) {
  await A((ar, id) => ar.lockOn(id), robbing[0].id);
  await sleep(300);
  const before = await A((ar) => ar.lockId);
  await press(); await sleep(400);
  log("press on robbed target: lock", before, "->", await A((ar) => ar.lockId), "|", await bubbles());
  await shot("10-shoot-already-robbing");
}
// the first settle: 90 s raid clock on the arcade season; the browser settles it at zero
const firstDue = robbing.length ? robbing[0].at + 93_000 : 0;
if (firstDue) {
  log("waiting for the first settle");
  await waitFor(() => document.querySelector(".fx-pop.big") ? 1 : null, Math.max(5000, firstDue - Date.now() + 25000), 60);
  await shot("11-settle-burst-plus");
  await sleep(1200);
  await shot("11b-after-settle");
  log("after settle", JSON.stringify(await W()), "|", await p.evaluate(() => [...document.querySelectorAll(".ev")].map((e) => e.textContent).join(" | ")));
}
// zero shots: use the shots left on gold bots (they may block), then press with none left
for (let k = 0; k < 4; k++) {
  const w = await W();
  if ((w.raidsLeft || 0) <= 0) break;
  const list = await A((ar) => [...ar.targets].filter((id) => id !== "satoshi" && !ar.info.get(id)?.raidedByMe).map((id) => ({ id, d: ar.distTo(id), gold: ar.info.get(id)?.kind === "vault" })).sort((a, b) => (b.gold - a.gold) || a.d - b.d));
  if (!list.length) { await sleep(5000); continue; }
  await A((ar, id) => ar.lockOn(id), list[0].id);
  await steerTo(list[0].id, 30000, 150);
  const fired = await waitFor(() => document.querySelector("#field").__arena.meInfo.inFlight ? 1 : null, 8000, 100);
  log("extra shot at", list[0].id, "gold", list[0].gold, "fired", !!fired);
  if (fired) { await waitFor(() => document.querySelector("#field").__arena.meInfo.inFlight ? null : 1, 60000, 200); robbing.push({ id: list[0].id, at: Date.now(), gold: list[0].gold }); }
  await sleep(800);
}
await sleep(1000);
log("shots left", (await W()).raidsLeft, "button:", await shootStatus());
await press(); await sleep(400);
log("press with zero shots:", await bubbles());
await shot("12-shoot-zero-shots");
// YOUR BAG
await p.click(".hud-cell.bag"); await sleep(1200);
await shot("13-your-bag-sheet");
log("bag sheet:", await p.evaluate(() => document.querySelector("#bag-grid")?.innerText.replace(/\n/g, " · ")));
await p.keyboard.press("Escape"); await sleep(600);
// shield
await p.click('.act[data-act="shield"]'); await sleep(1000);
if (await p.evaluate(() => !document.querySelector("#sh-go")?.disabled)) { await p.click("#sh-go"); log("shield:", await waitFor(() => document.querySelector("#sh-msg.ok, #sh-msg.bad")?.textContent || null, 90000)); }
await p.keyboard.press("Escape"); await sleep(1500);
await shot("14-shield-ring");
// a bot blocking one of your raids (BLOCKED + stake loss) shows up when its raid settles: wait for the gold bot raids
const goldRaid = robbing.find((r) => r.gold);
if (goldRaid) {
  await waitFor(() => [...document.querySelectorAll(".ev")].some((e) => /blocked|landed|took nothing/i.test(e.textContent)) ? 1 : null, Math.max(5000, goldRaid.at + 93_000 - Date.now() + 25000), 100);
  await sleep(250);
  await shot("15-bot-result");
  log("gold bot result:", await p.evaluate(() => [...document.querySelectorAll(".ev")].map((e) => e.textContent).join(" | ")));
}
// a raid on you: hunters come after the first 3 minutes; wait up to 6 minutes
log("waiting for a raid on the vault");
const inc = await waitFor(() => { const w = document.querySelector("#field").__world(); return w.incoming && w.incoming.target === w.vault ? w.incoming.attacker : null; }, 6 * 60 * 1000, 1500);
log("raid on vault by:", inc, "at", T(), "s");
if (inc) {
  await waitFor(() => document.querySelector(".ev.pin") ? 1 : null, 8000, 100);
  await sleep(500);
  await shot("16-hit-strip-robbing-you");
  await steerTo(inc, 30000, 200);
  await sleep(300);
  await A((ar, id) => ar.lockOn(id), inc);
  await press();
  const fired = await waitFor(() => document.querySelector("#field").__arena.meInfo.inFlight ? 1 : null, 6000, 100);
  log("defend shot fired:", !!fired);
  const done = await waitFor(() => document.querySelector(".fx-banner")?.textContent || null, 30000, 100);
  log("defend:", done);
  await sleep(400);
  await shot("17-defend-blocked-plus-stake");
}
// Satoshi: red, badge, hit
await steerTo("satoshi", 60000, 300);
await sleep(400);
await shot("18-satoshi-boss");
const ready = await A((ar) => ar.targets.has("satoshi"));
log("boss ready:", ready);
if (ready) {
  await A((ar) => ar.lockOn("satoshi"));
  await press();
  await waitFor(() => document.querySelector("#field").__arena.meInfo.inFlight ? 1 : null, 6000, 100);
  await waitFor(() => document.querySelector(".fx-pop") ? 1 : null, 30000, 80);
  await sleep(350);
  await shot("19-satoshi-hit-numbers");
}
await sleep(1500);
await shot("20-free-play");
log("final", JSON.stringify(await W()));
log("errors:", JSON.stringify(errors.slice(0, 8)));
await b.close();
