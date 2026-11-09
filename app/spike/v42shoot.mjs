// v4.2: drive the shooting arena on testnet at phone size and screenshot every
// state. Movement and aim go through the arena's keyboard input; a shot is the
// SHOOT button; every chain call is the real one. Usage:
//   node spike/v42shoot.mjs --fresh [profile]   new player: grab -> guide 1..7 with a real shot raid (one sponsored wallet)
//   node spike/v42shoot.mjs --vault <profile>   existing vault player: guide from step 4, miss, deflect, shield ring, Satoshi
//   node spike/v42shoot.mjs --fps <profile>     fps at 6x CPU throttle with shots flying
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:5189";
const OUT = "C:/Users/LENOVO/qday-launch/v42shots";
const MODE = process.argv[2] || "--vault";
const PROFILE = process.argv[3] || (MODE === "--fresh" ? `C:/Users/LENOVO/qday-launch/chrome-v42-${Date.now()}` : "C:/Users/LENOVO/qday-launch/chrome-v41-vault2");
fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
p.on("console", (m) => m.type() === "error" && !/well-known|403|favicon/.test(m.text()) && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log("shot", n); };
const A = (fn, ...args) => p.evaluate((src, ...a) => { const ar = document.querySelector("#field").__arena; return new Function("ar", ...a.map((_, i) => `a${i}`), `return (${src})(ar, ${a.map((_, i) => `a${i}`).join(",")})`)(ar, ...a); }, fn.toString(), ...args);
const G = () => p.evaluate(() => document.querySelector("#field").__guide());
const W = () => p.evaluate(() => document.querySelector("#field").__world());
const card = () => p.evaluate(() => { const g = document.querySelector(".guide"); return g ? `${g.dataset.step}: ${g.querySelector(".g-title")?.textContent} | ${g.querySelector(".g-text")?.textContent} | ${g.querySelector(".g-wait, .g-next")?.textContent || ""}` : null; });
const bubbles = () => p.evaluate(() => [...document.querySelectorAll(".bp-say")].map((e) => e.textContent).join(" | "));
const waitFor = async (fn, ms, every = 500) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };
const waitAtLeast = async (n, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const g = await G().catch(() => null); if (g && g.on && g.step >= n) return g; if (g && !g.on && n > 7) return g; await sleep(300); } return null; };
async function steerTo(target, ms = 25000, near = 30, onTick) {
  const end = Date.now() + ms; const held = new Set();
  const setKeys = async (want) => { for (const key of held) if (!want.has(key)) { await p.keyboard.up(key); held.delete(key); } for (const key of want) if (!held.has(key)) { await p.keyboard.down(key); held.add(key); } };
  let stuck = 0, lastD = Infinity, n = 0;
  while (Date.now() < end) {
    const me = await A((ar) => ({ x: ar.me.x, y: ar.me.y }));
    const tgt = typeof target === "string" ? await A((ar, id) => { const s = id === "gate" ? ar.gate : id === "satoshi" ? ar.boss : ar.bodies.get(id); return s ? { x: s.x, y: s.y } : null; }, target) : target;
    if (!tgt) break;
    const dx = tgt.x - me.x, dy = tgt.y - me.y, d = Math.hypot(dx, dy);
    if (d < near) break;
    if (await A((ar) => !!ar.meInfo.inFlight)) break;
    if (d > lastD - 2) stuck++; else stuck = 0; lastD = d;
    const want = new Set();
    if (stuck > 8) { const side = Math.floor(stuck / 14) % 2 === 0; want.add(Math.abs(dx) > Math.abs(dy) ? (side ? "w" : "s") : (side ? "a" : "d")); if (stuck > 28) stuck = 0; }
    else { if (Math.abs(dx) > 8) want.add(dx > 0 ? "d" : "a"); if (Math.abs(dy) > 8) want.add(dy > 0 ? "s" : "w"); }
    await setKeys(want); if (onTick) await onTick(n++); await sleep(50);
  }
  await setKeys(new Set());
}
/** Face a body (tap the key toward it for a moment) so the aim cone holds it, then press SHOOT. */
async function aimAndShoot(target) {
  const me = await A((ar) => ({ x: ar.me.x, y: ar.me.y }));
  const tgt = await A((ar, id) => { const s = id === "satoshi" ? ar.boss : ar.bodies.get(id); return s ? { x: s.x, y: s.y } : null; }, target);
  if (!tgt) return false;
  const dx = tgt.x - me.x, dy = tgt.y - me.y;
  const keys = []; if (Math.abs(dx) > Math.abs(dy) * 0.4) keys.push(dx > 0 ? "d" : "a"); if (Math.abs(dy) > Math.abs(dx) * 0.4) keys.push(dy > 0 ? "s" : "w");
  for (const k of keys) await p.keyboard.down(k); await sleep(120); for (const k of keys) await p.keyboard.up(k);
  await sleep(150);
  const aim = await A((ar) => ar.aimTarget());
  log("aim ->", aim);
  await p.click("#shoot-btn");
  return aim;
}
const fps = () => A((ar) => Math.round(ar.fps));

await p.evaluateOnNewDocument((mode) => {
  localStorage.setItem("qday.theme", "dark");
  localStorage.setItem("qday.intro.v2", "1");
  if (mode === "--vault") localStorage.removeItem("qday.guide.v1.testnet");
}, MODE);
await p.goto(`${BASE}/play`, { waitUntil: "domcontentloaded" });
await waitFor(() => document.querySelector("#field")?.__arena?.ready, 30000);
await waitFor(() => (document.querySelector("#field")?.__world?.().holders || 0) > 0 ? "ok" : null, 40000);
await sleep(1200);
log("world", JSON.stringify(await W()), "fps", await fps(), "lowPower", await A((ar) => ar.lowPower));

if (MODE === "--fps") {
  const cdp = await p.createCDPSession();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  const measure = async (label) => {
    const samples = [];
    await p.keyboard.down("w");
    for (let i = 0; i < 8; i++) { await p.evaluate(() => document.querySelector("#shoot-btn").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))); await sleep(1000); samples.push(await fps()); if (i === 3) { await p.keyboard.up("w"); await p.keyboard.down("d"); } }
    await p.keyboard.up("d");
    const sorted = [...samples.slice(2)].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    log(`${label}: fps samples ${samples.join(" ")} -> median ${med}, bodies ${await A((ar) => ar.order.length)}, dpr ${await A((ar) => ar.dpr)}, shots ${await A((ar) => ar.shots.length)}`);
    return med;
  };
  await A((ar) => { ar.powerLocked = true; ar.lowPower = false; ar.resize(false); });
  await sleep(7000);
  const before = await measure("full path (before)");
  await A((ar) => { ar.lowPower = true; ar.slowDevice = false; ar.slowFrames = 0; ar.resize(false); });
  await sleep(7000);
  const after = await measure("low power path (after)");
  console.log(JSON.stringify({ before, after }));
  await b.close();
  process.exit(0);
}

if (MODE === "--fresh") {
  const start = await waitFor(() => document.querySelector("#start:not([hidden]) #m-go") ? "grab" : null, 15000);
  log("start card:", start);
  if (start) {
    await shot("00-grab");
    await p.click("#m-go");
    const r = await waitFor(() => { const s = document.querySelector("#start"); return s && s.hidden ? "ok" : (document.querySelector(".m-msg.bad")?.textContent || null); }, 150000, 1000);
    log("grab:", r);
    if (r !== "ok") { await shot("00-grab-failed"); await b.close(); process.exit(1); }
    let g = await waitAtLeast(1, 20000);
    log("guide", JSON.stringify(g), await card());
    await sleep(900);
    await shot("01-this-is-you");
    // red: SHOOT is disabled with its reason
    await p.click("#shoot-btn"); await sleep(400);
    log("red shoot:", await bubbles());
    await shot("01b-red-shoot-refused");
    await p.keyboard.down("d"); await sleep(700); await p.keyboard.up("d");
    g = await waitAtLeast(2, 10000); log("guide", JSON.stringify(g), await card()); await sleep(700); await shot("02-you-are-red");
    g = await waitAtLeast(3, 20000); log("guide", JSON.stringify(g), await card()); await sleep(800); await shot("03-gold-door");
    await steerTo("gate", 60000, 46);
    if (await waitFor(() => document.querySelector("#n-go") ? "yes" : null, 8000, 300)) {
      await sleep(500); await shot("03c-name-sheet");
      await p.evaluate(() => document.querySelector("#n-go")?.click());
      const r2 = await waitFor(() => document.querySelector("#n-msg.ok, #n-msg.bad")?.textContent || null, 180000, 500);
      log("vault:", r2);
      await sleep(3200);
    }
  }
}

// steps 4..7 (a vault player)
let g = await waitAtLeast(4, 40000);
log("guide", JSON.stringify(g), await card(), JSON.stringify(await W()));
if (g && g.step === 4) { await sleep(400); await shot("04-you-are-gold"); }
g = await waitAtLeast(5, 20000);
g = (await waitFor(() => { const g2 = document.querySelector("#field").__guide(); return g2.step === 5 && (g2.target || g2.variant === "boss") ? g2 : g2.step > 5 ? g2 : null; }, 8000, 200)) || g;
log("guide", JSON.stringify(g), await card());
await sleep(600);
await shot("05-shoot-a-target");
if (g && g.step === 5 && g.variant === "body" && g.target) {
  // a miss first: face away from the target and shoot (free, local)
  const away = await A((ar, id) => { const s = ar.bodies.get(id); return s ? (s.x > ar.me.x ? "a" : "d") : "a"; }, g.target);
  await p.keyboard.down(away); await sleep(150); await p.keyboard.up(away); await sleep(100);
  const w0 = await W();
  await p.click("#shoot-btn"); await sleep(250);
  await shot("05a-miss-in-flight");
  await sleep(1500);
  const w1 = await W();
  log("miss: raidsLeft before", w0.raidsLeft, "after", w1.raidsLeft, "myRaids", w0.myRaids, "->", w1.myRaids, "bubbles:", await bubbles());
  // come within range of the target and shoot it for real
  await steerTo(g.target, 40000, 220);
  await sleep(300);
  await shot("05b-aim-line");
  const aim = await aimAndShoot(g.target);
  await sleep(350);
  await shot("05c-shot-flying");
  await waitFor(() => document.querySelector("#field").__arena.meInfo.inFlight ? "signing" : null, 4000, 100);
  await sleep(300);
  await shot("05d-hit-in-flight");
  g = await waitAtLeast(6, 90000);
  log("after shot", aim, JSON.stringify(g), JSON.stringify(await W()));
} else if (g && g.variant === "boss") {
  await steerTo("satoshi", 60000, 300);
  await aimAndShoot("satoshi");
  g = await waitAtLeast(6, 90000);
}
log("guide", JSON.stringify(g), await card());
await sleep(500);
await shot("06-they-hunt-you");
g = await waitAtLeast(7, 30000);
log("guide", JSON.stringify(g), await card());
await sleep(600);
await shot("07-your-goal");
await p.click("#g-next").catch(() => {});
await sleep(1500);
log("done", JSON.stringify(await G()));
await shot("08-free-play");
// deflect: shoot a resting body (costs nothing, the reason shows at the body)
const rest = await A((ar) => { let best = null, bd = 1e9; for (const id of ar.order) { const b = ar.info.get(id), s = ar.bodies.get(id); if (b.state !== "rest" || b.hunting || b.raidingMe) continue; const d = Math.hypot(s.x - ar.me.x, s.y - ar.me.y); if (d < bd) { bd = d; best = id; } } return best; });
log("resting body:", rest);
if (rest) {
  await steerTo(rest, 40000, 170);
  const w0 = await W();
  // no aim assist on a non raidable body: face it and fire straight
  const me = await A((ar) => ({ x: ar.me.x, y: ar.me.y }));
  const tgt = await A((ar, id) => { const s = ar.bodies.get(id); return { x: s.x, y: s.y }; }, rest);
  const dx = tgt.x - me.x, dy = tgt.y - me.y;
  const keys = []; if (Math.abs(dx) > Math.abs(dy) * 0.4) keys.push(dx > 0 ? "d" : "a"); if (Math.abs(dy) > Math.abs(dx) * 0.4) keys.push(dy > 0 ? "s" : "w");
  for (const k of keys) await p.keyboard.down(k); await sleep(120); for (const k of keys) await p.keyboard.up(k); await sleep(120);
  for (let i = 0; i < 3; i++) { await p.click("#shoot-btn"); await sleep(700); const bb = await bubbles(); if (bb) { log("deflect:", bb); break; } }
  await shot("09-deflect-resting");
  await sleep(1200);
  const w1 = await W();
  log("deflect cost: raidsLeft", w0.raidsLeft, "->", w1.raidsLeft, "myRaids", w0.myRaids, "->", w1.myRaids);
}
// shield: charge from the bar, then the ring shows on you
await p.click('.act[data-act="shield"]'); await sleep(1200); await shot("10-shield-sheet");
if (await p.evaluate(() => !document.querySelector("#sh-go")?.disabled)) {
  await p.click("#sh-go");
  log("shield:", await waitFor(() => document.querySelector("#sh-msg.ok, #sh-msg.bad")?.textContent || null, 90000));
  await sleep(1500);
}
await p.keyboard.press("Escape"); await sleep(1200);
await shot("11-shield-ring");
// Satoshi: shoot the core when ready; otherwise the reason bounces off
await steerTo("satoshi", 60000, 260);
await sleep(300);
const ready = await A((ar) => ar.places.boss.ready);
const aimB = await aimAndShoot("satoshi");
await sleep(400);
await shot("12-satoshi-shot");
await sleep(2500);
log("satoshi ready", ready, "aim", aimB, "bubbles:", await bubbles(), "inFlight", await A((ar) => ar.meInfo.inFlight));
await shot("13-satoshi-after");
log("fps", await fps(), "bodies", await A((ar) => ar.order.length), "lowPower", await A((ar) => ar.lowPower));
log("errors:", JSON.stringify(errors.slice(0, 10)));
await b.close();
