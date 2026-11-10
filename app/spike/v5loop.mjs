// v5 arcade season: play the loop for real and measure it. A fresh player grabs a
// bag, skips the guide, builds a vault, then hunts for MINUTES: lock the nearest
// target, chase, the auto fire raids it, and we time shot -> coins. Every number
// in the log is read back from the chain view the page holds.
// Usage: node spike/v5loop.mjs [minutes] [profile]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:5189";
const OUT = process.env.OUT || "C:/Users/LENOVO/qday-launch/v5shots";
const MIN = Number(process.argv[2] || 8);
const PROFILE = process.argv[3] || `C:/Users/LENOVO/qday-launch/chrome-v5-${Date.now()}`;
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
const waitFor = async (fn, ms, every = 500) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };
const bubbles = () => p.evaluate(() => [...document.querySelectorAll(".bp-say")].map((e) => e.textContent).join(" | "));
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
    if (d > lastD - 2) stuck++; else stuck = 0; lastD = d;
    const want = new Set();
    if (stuck > 8) { const side = Math.floor(stuck / 14) % 2 === 0; want.add(Math.abs(dx) > Math.abs(dy) ? (side ? "w" : "s") : (side ? "a" : "d")); if (stuck > 28) stuck = 0; }
    else { if (Math.abs(dx) > 8) want.add(dx > 0 ? "d" : "a"); if (Math.abs(dy) > 8) want.add(dy > 0 ? "s" : "w"); }
    await setKeys(want); await sleep(50);
  }
  await setKeys(new Set());
}

await p.evaluateOnNewDocument(() => { localStorage.setItem("qday.theme", "dark"); localStorage.setItem("qday.intro.v2", "1"); });
await p.goto(`${BASE}/play`, { waitUntil: "domcontentloaded" });
await waitFor(() => document.querySelector("#field")?.__arena?.ready, 30000);
await waitFor(() => (document.querySelector("#field")?.__world?.().holders || 0) > 0 ? "ok" : null, 40000);
log("world", JSON.stringify(await W()));

// grab a bag
if (await waitFor(() => document.querySelector("#start:not([hidden]) #m-go") ? 1 : null, 15000)) {
  await p.click("#m-go");
  const r = await waitFor(() => { const s = document.querySelector("#start"); return s && s.hidden ? "ok" : (document.querySelector(".m-msg.bad")?.textContent || null); }, 150000, 1000);
  log("grab:", r);
  if (r !== "ok") { await shot("x-grab-failed"); log("errors", JSON.stringify(errors)); await b.close(); process.exit(1); }
}
await sleep(1500); await shot("01-red");
await p.evaluate(() => document.querySelector("#g-skip")?.click());
// the gate: build the vault and move in
await steerTo("gate", 90000, 46);
if (await waitFor(() => document.querySelector("#n-go") ? 1 : null, 10000, 300)) {
  await p.evaluate(() => document.querySelector("#n-go")?.click());
  log("vault build:", await waitFor(() => document.querySelector("#n-msg.ok, #n-msg.bad")?.textContent || null, 180000, 500));
}
const gold = await waitFor(() => document.querySelector("#field").__world().vault ? "vault" : null, 150000, 1000);
log("vault:", gold, JSON.stringify(await W()));
await waitFor(() => BigInt(document.querySelector("#field").__world().vaultBal || "0") > 0n ? 1 : null, 90000, 1000);
await p.evaluate(() => { localStorage.setItem("qday.guide.v1.testnet", JSON.stringify({ step: 8, done: true })); });
const startBal = BigInt((await W()).vaultBal);
log("in the vault with", String(startBal / 10n ** 18n), "coins");
await shot("02-gold");

// hunt
const raids = new Map(); // target -> { at, deadline }
const timeline = [];
const end = Date.now() + MIN * 60_000;
let n = 0;
while (Date.now() < end) {
  const w = await W();
  const bal = BigInt(w.vaultBal || "0");
  timeline.push([T(), String(bal / 10n ** 18n), w.raidsLeft]);
  const targets = await A((ar) => [...ar.targets].filter((id) => id !== "satoshi").map((id) => { const s = ar.bodies.get(id); return s ? { id, d: Math.hypot(s.x - ar.me.x, s.y - ar.me.y) } : null; }).filter(Boolean).sort((a, b) => a.d - b.d));
  const boss = await A((ar) => ar.targets.has("satoshi"));
  const pick = targets[0]?.id || (boss ? "satoshi" : null);
  if (pick && w.raidsLeft > 0) {
    await A((ar, id) => ar.lockOn(id), pick);
    await steerTo(pick, 20000, 140);
    const fired = await waitFor(() => { const ar = document.querySelector("#field").__arena; return ar.meInfo.inFlight ? "signing" : null; }, 6000, 150);
    log("lock", pick === "satoshi" ? "Satoshi" : pick.slice(0, 18), "fired:", fired || "no", "|", (await bubbles()).slice(0, 120));
    if (fired) { raids.set(pick, { at: Date.now() }); await waitFor(() => document.querySelector("#field").__arena.meInfo.inFlight ? null : 1, 60000, 300); if (n++ < 3) await shot(`10-shot-${n}`); }
  } else {
    await sleep(4000);
  }
  await sleep(1500);
}
const w = await W();
const endBal = BigInt(w.vaultBal || "0");
const feed = await p.evaluate(() => fetch("/").then(() => null).catch(() => null));
log("TIMELINE", JSON.stringify(timeline.filter((_, i) => i % 3 === 0)));
log("start", String(startBal / 10n ** 18n), "end", String(endBal / 10n ** 18n), "change", String((endBal - startBal) / 10n ** 18n));
await shot("20-after");
log("errors:", JSON.stringify(errors.slice(0, 6)));
await b.close();
