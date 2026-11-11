// v8 polish check: a fresh practice player plays the real loop on testnet and we
// screenshot every state. Instant shots (time from SHOOT to the ROBBING badge, the
// background pip instead of words), calm arena, music (ducked under the intro),
// payoffs flying into the bag with combos, out of raids state, Satoshi, shield,
// fps at 6x CPU throttle. Every number logged is read from the page's chain view.
// Usage: node spike/v8chk.mjs <phone|desk> <dark|light> [minutes] [profile]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:5189";
const OUT = process.env.OUT || "C:/Users/LENOVO/qday-launch/v8shots";
const DEV = process.argv[2] || "phone";
const THEME = process.argv[3] || "dark";
const MIN = Number(process.argv[4] || 6);
const PROFILE = process.argv[5] || `C:/Users/LENOVO/qday-launch/chrome-v8-${DEV}-${Date.now()}`;
const TAG = `${DEV}-${THEME}`;
fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
if (DEV === "phone") await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
else await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const errors = [];
p.on("console", (m) => m.type() === "error" && !/well-known|favicon|403/.test(m.text()) && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));
const t0 = Date.now();
const T = () => ((Date.now() - t0) / 1000).toFixed(0);
const log = (...a) => console.log(`[${T()}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shotN = 0;
const shot = async (n) => { const f = `${OUT}/${TAG}-${String(++shotN).padStart(2, "0")}-${n}.png`; await p.screenshot({ path: f }); log("shot", f); };
const A = (fn, ...args) => p.evaluate((src, ...a) => { const ar = document.querySelector("#field").__arena; return new Function("ar", ...a.map((_, i) => `a${i}`), `return (${src})(ar, ${a.map((_, i) => `a${i}`).join(",")})`)(ar, ...a); }, fn.toString(), ...args);
const W = () => p.evaluate(() => document.querySelector("#field")?.__world?.() || { raidsLeft: 0, myRaids: 0, vaultBal: "0" });
const M = () => p.evaluate(() => document.querySelector("#field").__music?.());
const waitFor = async (fn, ms, every = 500) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };
const toasts = new Set();
const watchToasts = async () => { const t = await p.evaluate(() => [...document.querySelectorAll(".ev .ev-t, .bp-say")].map((e) => e.textContent)).catch(() => []); for (const x of t) if (x && !toasts.has(x)) { toasts.add(x); log("text:", x); } };
const shootBtn = () => p.evaluate(() => document.querySelector("#shoot-btn").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true })));
const shootSt = () => p.evaluate(() => document.querySelector("#a-shoot")?.textContent);
async function steerTo(target, ms = 25000, near = 30) {
  const end = Date.now() + ms; const held = new Set();
  const setKeys = async (want) => { for (const k of held) if (!want.has(k)) { await p.keyboard.up(k); held.delete(k); } for (const k of want) if (!held.has(k)) { await p.keyboard.down(k); held.add(k); } };
  let stuck = 0, lastD = Infinity;
  while (Date.now() < end) {
    const d0 = await A((ar, id) => { const s = id === "gate" ? ar.gate : id === "satoshi" ? ar.boss : ar.bodies.get(id); return s ? { dx: s.x - ar.me.x, dy: s.y - ar.me.y } : null; }, target);
    if (!d0) break;
    const { dx, dy } = d0, d = Math.hypot(dx, dy);
    if (d < near) break;
    if (d > lastD - 2) stuck++; else stuck = 0; lastD = d;
    const want = new Set();
    if (stuck > 8) { const side = Math.floor(stuck / 14) % 2 === 0; want.add(Math.abs(dx) > Math.abs(dy) ? (side ? "w" : "s") : (side ? "a" : "d")); if (stuck > 28) stuck = 0; }
    else { if (Math.abs(dx) > 8) want.add(dx > 0 ? "d" : "a"); if (Math.abs(dy) > 8) want.add(dy > 0 ? "s" : "w"); }
    await setKeys(want); await sleep(50);
  }
  await setKeys(new Set());
}
async function fps(rate) {
  const cdp = await p.target().createCDPSession();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await sleep(2500);
  const r = await p.evaluate(() => new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 5000) requestAnimationFrame(f); else res({ fps: +(n / ((performance.now() - s) / 1000)).toFixed(1) }); }; requestAnimationFrame(f); }));
  const ar = await A((ar) => ({ lowPower: ar.lowPower, slow: ar.slowDevice, bodies: ar.order.length }));
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  return { ...r, ...ar };
}

await p.evaluateOnNewDocument((th) => { localStorage.setItem("qday.theme", th); }, THEME);
await p.goto(`${BASE}/play`, { waitUntil: "domcontentloaded", timeout: 120000 });
await waitFor(() => document.querySelector("#field")?.__arena?.ready, 30000);
// the intro: music ducks under it
const intro = await waitFor(() => document.querySelector(".intro") ? 1 : null, 6000, 200);
if (intro) {
  await p.click(".intro"); await sleep(400);
  log("music in intro:", JSON.stringify(await M()));
  await shot("intro");
  await p.click("#in-skip"); await sleep(1200);
}
log("music after intro:", JSON.stringify(await M()));
await waitFor(() => (document.querySelector("#field")?.__world?.().holders || 0) > 0 ? "ok" : null, 40000);
// grab a bag
if (await waitFor(() => document.querySelector("#start:not([hidden]) #m-go") ? 1 : null, 15000)) {
  await p.click("#m-go");
  const r = await waitFor(() => { const s = document.querySelector("#start"); return s && s.hidden ? "ok" : (document.querySelector(".m-msg.bad")?.textContent || null); }, 150000, 1000);
  log("grab:", r);
  if (r !== "ok") { await shot("grab-failed"); log("errors", JSON.stringify(errors)); await b.close(); process.exit(1); }
}
await sleep(1500); await shot("red-bag");
await p.evaluate(() => document.querySelector("#g-skip")?.click());
await steerTo("gate", 90000, 46);
await shot("gold-door");
if (await waitFor(() => document.querySelector("#n-go") ? 1 : null, 10000, 300)) {
  await p.evaluate(() => document.querySelector("#n-go")?.click());
  log("vault build:", await waitFor(() => document.querySelector("#n-msg.ok, #n-msg.bad")?.textContent || null, 180000, 500));
}
const gold = await waitFor(() => document.querySelector("#field").__world().vault ? "vault" : null, 150000, 1000);
log("vault:", gold);
await waitFor(() => BigInt(document.querySelector("#field").__world().vaultBal || "0") > 0n ? 1 : null, 90000, 1000);
await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("qday.guide")) localStorage.setItem(k, JSON.stringify({ step: 8, done: true })); });
await sleep(2500);
const startBal = BigInt((await W()).vaultBal);
log("in the vault with", String(startBal / 10n ** 18n), "coins; raids left", (await W()).raidsLeft, "| shoot:", await shootSt());
await shot("calm-arena");
log("music in game:", JSON.stringify(await M()));
log("fps 1x:", JSON.stringify(await fps(1)));
log("fps 6x:", JSON.stringify(await fps(6)));

// hunt: lock a red bagholder, get close, press SHOOT, time the provisional badge
const end = Date.now() + MIN * 60_000;
let raids = 0, bossDone = false, shieldDone = false, outShot = false, payShots = 0;
while (Date.now() < end) {
  await watchToasts();
  const w = await W();
  if (await p.evaluate(() => !!document.querySelector(".fx-fly.fixed"))) { if (payShots++ < 3) await shot("payoff-coins"); }
  if (await p.evaluate(() => { const c = document.querySelector(".hud-cell.bag .combo"); return c && !c.hidden; })) { if (payShots < 6) { payShots = 6; await shot("combo"); } }
  if (w.raidsLeft > 0) {
    const targets = await A((ar) => [...ar.targets].filter((id) => id !== "satoshi").map((id) => { const s = ar.bodies.get(id); return s ? { id, red: ar.info.get(id)?.kind === "exposed", d: Math.hypot(s.x - ar.me.x, s.y - ar.me.y) } : null; }).filter(Boolean).sort((a, b) => (b.red - a.red) || a.d - b.d));
    const pick = targets[0]?.id;
    if (!pick) { await sleep(2000); continue; }
    await steerTo(pick, 20000, 170);
    await A((ar, id) => ar.lockOn(id), pick);
    await p.evaluate(() => { window.__t0 = performance.now(); });
    await shootBtn();
    const ms = await p.evaluate((id) => new Promise((res) => { const ar = document.querySelector("#field").__arena; const end = performance.now() + 4000; const f = () => { const b = ar.info.get(id); if (b && b.raidedByMe) res(Math.round(performance.now() - window.__t0)); else if (performance.now() > end) res(null); else requestAnimationFrame(f); }; f(); }), pick);
    const me = await A((ar) => ({ inFlight: ar.meInfo.inFlight, signing: !!ar.meInfo.signing }));
    log(`raid ${raids + 1} on`, pick.slice(0, 22), "| SHOOT to ROBBING badge:", ms, "ms | words:", JSON.stringify(me.inFlight), "pip:", me.signing, "| shoot:", await shootSt());
    if (ms !== null) { await sleep(120); await shot(`shot-${raids + 1}`); }
    const res = await waitFor(() => { const ar = document.querySelector("#field").__arena; return ar.meInfo.signing || ar.meInfo.inFlight ? null : "done"; }, 60000, 200);
    const w2 = await W();
    log("  signed:", res, "| raids left", w2.raidsLeft, "| open raids", w2.myRaids, "| bag", String(BigInt(w2.vaultBal) / 10n ** 18n));
    await watchToasts();
    raids++;
    await sleep(1500);
    continue;
  }
  if (!outShot) { outShot = true; await sleep(1500); log("out of raids | shoot:", await shootSt(), "| chip:", await p.evaluate(() => { const c = document.querySelector(".round-chip"); return c && !c.hidden ? c.textContent : null; }), "| boss arrow:", await A((ar) => ar.bossArrow)); await shot("out-of-raids"); }
  if (!bossDone && await A((ar) => ar.targets.has("satoshi"))) {
    bossDone = true;
    await steerTo("satoshi", 20000, 230);
    await A((ar) => ar.lockOn("satoshi"));
    await shot("satoshi-ready");
    await shootBtn();
    await sleep(450); await shot("satoshi-hit");
    const r = await waitFor(() => { const ar = document.querySelector("#field").__arena; return ar.meInfo.signing ? null : "done"; }, 60000, 200);
    log("satoshi:", r, "| bag", String(BigInt((await W()).vaultBal) / 10n ** 18n));
    await sleep(900); await shot("satoshi-paid");
    await watchToasts();
    continue;
  }
  if (!shieldDone) {
    shieldDone = true;
    await p.evaluate(() => document.querySelector('.act[data-act="shield"]').click());
    if (await waitFor(() => document.querySelector("#sh-go") ? 1 : null, 5000, 200)) {
      await sleep(400); await shot("shield-sheet");
      await p.evaluate(() => document.querySelector("#sh-go").click());
      log("shield:", await waitFor(() => { const m = document.querySelector("#sh-msg"); return m && m.textContent ? m.textContent : null; }, 60000, 300));
      await sleep(1500); await shot("shield-up");
    }
    continue;
  }
  await sleep(700);
  if (payShots >= 6 && outShot && bossDone && shieldDone && (await W()).myRaids === 0) break;
}
await watchToasts();
const w = await W();
log("start", String(startBal / 10n ** 18n), "end", String(BigInt(w.vaultBal) / 10n ** 18n));
await shot("after");
fs.writeFileSync(`${OUT}/${TAG}-profile.txt`, PROFILE);
log("errors:", JSON.stringify(errors.slice(0, 6)));
await b.close();
