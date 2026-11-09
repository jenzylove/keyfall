// v4.1: drive the first run guide on testnet at phone size and screenshot every
// card. Movement goes through the arena's keyboard input; every chain call is
// the real one. Usage:
//   node spike/v41guide.mjs --fresh [profile]       new player: grab -> steps 1..7 (one sponsored wallet)
//   node spike/v41guide.mjs --vault <profile>       existing vault player: clears the guide flag, steps 4..7
//   node spike/v41guide.mjs --fps <profile>         fps at 6x CPU throttle, full and low power paths
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:5189"; // the live API allows localhost origins only
const OUT = "C:/Users/LENOVO/qday-launch/v41shots";
const MODE = process.argv[2] || "--vault";
const PROFILE = process.argv[3] || (MODE === "--fresh" ? `C:/Users/LENOVO/qday-launch/chrome-v41-${Date.now()}` : "C:/Users/LENOVO/qday-launch/chrome-v4");
fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
if (MODE === "--desk") await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
else await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
const card = () => p.evaluate(() => { const g = document.querySelector(".guide"); return g ? `${g.dataset.step}: ${g.querySelector(".g-title")?.textContent} | ${g.querySelector(".g-text")?.textContent} | ${g.querySelector(".g-wait, .g-next")?.textContent || ""} | note=${g.querySelector(".g-note")?.textContent || ""}` : null; });
const waitFor = async (fn, ms, every = 500) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };
const waitStep = async (n, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const g = await G().catch(() => null); if (g && (g.step === n || (!g.on && n === 0))) return g; await sleep(400); } return null; };
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
    if (await A((ar) => !!ar.meInfo.inFlight)) break; // a move is signing: the touch landed
    if (d > lastD - 2) stuck++; else stuck = 0; lastD = d;
    const want = new Set();
    if (stuck > 8) { const side = Math.floor(stuck / 14) % 2 === 0; want.add(Math.abs(dx) > Math.abs(dy) ? (side ? "w" : "s") : (side ? "a" : "d")); if (stuck > 28) stuck = 0; }
    else { if (Math.abs(dx) > 8) want.add(dx > 0 ? "d" : "a"); if (Math.abs(dy) > 8) want.add(dy > 0 ? "s" : "w"); }
    await setKeys(want); if (onTick) await onTick(n++); await sleep(50);
  }
  await setKeys(new Set());
}
const fps = () => A((ar) => Math.round(ar.fps));

await p.evaluateOnNewDocument((mode) => {
  localStorage.setItem("qday.theme", "dark");
  localStorage.setItem("qday.intro.v2", "1");
  if (mode === "--vault" || mode === "--desk") localStorage.removeItem("qday.guide.v1.testnet");
}, MODE);
await p.goto(`${BASE}/play`, { waitUntil: "domcontentloaded" });
await waitFor(() => document.querySelector("#field")?.__arena?.ready, 30000);
await waitFor(() => (document.querySelector("#field")?.__world?.().holders || 0) > 0 ? "ok" : null, 40000);
await sleep(1200);
log("world", JSON.stringify(await W()), "fps", await fps(), "lowPower", await A((ar) => ar.lowPower));

if (MODE === "--desk") {
  await waitFor(() => document.querySelector(".guide") ? "ok" : null, 15000);
  await sleep(800);
  await shot("desk-guide-card");
  await p.evaluate(() => document.querySelector("#g-skip")?.click());
  await sleep(1500);
  await shot("desk-free-play");
  log("errors:", JSON.stringify(errors.slice(0, 5)));
  await b.close();
  process.exit(0);
}

if (MODE === "--fps") {
  const cdp = await p.createCDPSession();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  const measure = async (label) => {
    const samples = [];
    // keep moving so the camera and floor work like real play
    await p.keyboard.down("w");
    for (let i = 0; i < 8; i++) { await sleep(1000); samples.push(await fps()); if (i === 3) { await p.keyboard.up("w"); await p.keyboard.down("d"); } }
    await p.keyboard.up("d");
    const sorted = [...samples.slice(2)].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    log(`${label}: fps samples ${samples.join(" ")} -> median ${med}, bodies ${await A((ar) => ar.order.length)}, dpr ${await A((ar) => ar.dpr)}, lowPower ${await A((ar) => ar.lowPower)}`);
    return med;
  };
  await A((ar) => { ar.powerLocked = true; ar.lowPower = false; ar.resize(false); });
  await sleep(7000); // a refresh hands over the full body set
  const before = await measure("full path (before)");
  await A((ar) => { ar.lowPower = true; ar.slowDevice = false; ar.slowFrames = 0; ar.resize(false); });
  await sleep(7000);
  const after = await measure("low power path (after)");
  await A((ar) => { ar.slowDevice = true; ar.resize(false); });
  await sleep(3000);
  const after1x = await measure("low power + 1x pixels (after, slow device tier)");
  console.log(JSON.stringify({ before, after, after1x }));
  await shot("fps-low-power");
  await b.close();
  process.exit(0);
}

if (MODE === "--fresh") {
  const start = await waitFor(() => document.querySelector("#start:not([hidden]) #m-go") ? "grab" : null, 15000);
  log("start card:", start);
  if (!start) { log("no start card; profile already has a bag: continuing from the saved step"); }
  else {
    await shot("00-grab");
    await p.click("#m-go");
    const r = await waitFor(() => { const s = document.querySelector("#start"); return s && s.hidden ? "ok" : (document.querySelector(".m-msg.bad")?.textContent || null); }, 150000, 1000);
    log("grab:", r);
    if (r !== "ok") { await shot("00-grab-failed"); await b.close(); process.exit(1); }
  }
  if (!start) { /* skip the red steps */ } else {
  // step 1: this is you
  let g = await waitStep(1, 20000);
  log("guide", JSON.stringify(g), await card());
  await sleep(900);
  await shot("01-this-is-you");
  // a red player bumping a rival before moving: the rule in words on the card
  await p.keyboard.down("d"); await sleep(700); await p.keyboard.up("d");
  g = await waitStep(2, 10000);
  log("guide", JSON.stringify(g), await card());
  await sleep(700);
  await shot("02-you-are-red");
  g = await waitStep(3, 20000);
  log("guide", JSON.stringify(g), await card());
  await sleep(800);
  await shot("03-gold-door");
  // touch a rival while red on the way: refusal line on the card, not a bubble
  const rival = await A((ar) => { let best = null, bd = 1e9; for (const id of ar.order) { const s = ar.bodies.get(id); const d = Math.hypot(s.x - ar.me.x, s.y - ar.me.y); if (d < bd) { bd = d; best = id; } } return best; });
  if (rival) { await steerTo(rival, 15000, 10); await sleep(500); log("red bump:", await card()); await shot("03b-red-bump-refusal"); }
  await steerTo("gate", 60000, 46);
  if (await waitFor(() => document.querySelector("#n-go") ? "yes" : null, 8000, 300)) {
    await sleep(500);
    await shot("03c-name-sheet");
    await p.evaluate(() => document.querySelector("#n-go")?.click());
    await sleep(2500);
    await shot("03d-building");
    const r = await waitFor(() => document.querySelector("#n-msg.ok, #n-msg.bad")?.textContent || null, 180000, 500);
    log("vault:", r);
    await sleep(3200);
  }
  }
}

// steps 4..7 (a vault player)
const waitAtLeast = async (n, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const g = await G().catch(() => null); if (g && g.on && g.step >= n) return g; await sleep(300); } return null; };
let g = await waitAtLeast(4, 40000);
log("guide", JSON.stringify(g), await card(), JSON.stringify(await W()));
if (g && g.step === 4) { await sleep(400); await shot("04-you-are-gold"); }
g = await waitAtLeast(5, 20000);
// the target is picked on the next guide tick
g = (await waitFor(() => { const g2 = document.querySelector("#field").__guide(); return g2.step === 5 && (g2.target || g2.variant === "boss") ? g2 : g2.step > 5 ? g2 : null; }, 8000, 200)) || g;
log("guide", JSON.stringify(g), await card());
await sleep(600);
await shot("05-rob-someone");
if (g && g.variant === "body" && g.target) {
  // come close first: the target mark and the "Touch to rob" line, then the raid by touch
  await steerTo(g.target, 40000, 150);
  await sleep(400);
  await shot("05b-target-mark-near");
  await steerTo(g.target, 20000, 30);
  await sleep(500);
  await shot("05c-raid-in-flight");
  g = await waitStep(6, 90000);
  log("after raid", JSON.stringify(g), JSON.stringify(await W()));
} else if (g && g.variant === "boss") {
  await steerTo("satoshi", 60000, 95);
  g = await waitStep(6, 90000);
}
log("guide", JSON.stringify(g), await card());
await sleep(600);
await shot("06-they-hunt-you");
g = await waitStep(7, 30000);
log("guide", JSON.stringify(g), await card());
await sleep(600);
await shot("07-your-goal");
await p.click("#g-next").catch(() => {});
await sleep(1500);
log("done", JSON.stringify(await G()), "strip:", await p.evaluate(() => document.querySelector(".strip, .strip-chip")?.textContent || null));
await shot("08-free-play");
// a body you cannot raid, with its icon and line as you come close
const blocked = await A((ar) => { let best = null, bd = 1e9; for (const id of ar.order) { const b = ar.info.get(id), s = ar.bodies.get(id); if (!b.hint || b.state === "open" || b.hunting || b.raidingMe) continue; const d = Math.hypot(s.x - ar.me.x, s.y - ar.me.y); if (d < bd) { bd = d; best = id; } } return best ? { id: best, hint: ar.info.get(best).hint, state: ar.info.get(best).state } : null; });
log("blocked body:", JSON.stringify(blocked));
if (blocked) { await steerTo(blocked.id, 40000, 110); await sleep(500); await shot("09-cannot-raid-line"); }
await steerTo("satoshi", 60000, 300);
await sleep(500);
await shot("10-satoshi-line");
log("fps", await fps(), "bodies", await A((ar) => ar.order.length), "lowPower", await A((ar) => ar.lowPower));
log("errors:", JSON.stringify(errors.slice(0, 10)));
await b.close();
