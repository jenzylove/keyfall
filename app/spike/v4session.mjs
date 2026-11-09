// v4: play the real practice session in the arena on testnet at phone size
// and screenshot every state. Movement is driven through the exposed arena
// (field.__arena) by faking a joystick: we set keys via keyboard events.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:5188";
const OUT = "C:/Users/LENOVO/qday-launch/v4shots";
const PROFILE = process.argv[2] || "C:/Users/LENOVO/qday-launch/chrome-v4";
const DESK = process.argv.includes("--desk");
fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
if (DESK) await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
else await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
p.on("console", (m) => m.type() === "error" && !/well-known|403|favicon/.test(m.text()) && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pre = DESK ? "d-" : "";
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${pre}${n}.png` }); log("shot", n); };
const k = () => p.evaluate(() => document.querySelector(".strip")?.getAttribute("data-k") || (document.querySelector("#start:not([hidden])") ? "grab" : "none"));
const waitFor = async (fn, ms, every = 1000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };
const msg = () => p.evaluate(() => [...document.querySelectorAll(".m-msg, .s-msg, .bp-say")].map((e) => e.textContent).filter(Boolean).join(" | "));
const A = (fn, ...args) => p.evaluate((src, ...a) => { const ar = document.querySelector("#field").__arena; return new Function("ar", ...a.map((_, i) => `a${i}`), `return (${src})(ar, ${a.map((_, i) => `a${i}`).join(",")})`)(ar, ...a); }, fn.toString(), ...args);
// steer toward a world point by pressing keys; stops when within `near` px or after ms
async function steerTo(target, ms = 25000, near = 30) {
  const end = Date.now() + ms;
  let held = new Set();
  const setKeys = async (want) => {
    for (const key of held) if (!want.has(key)) { await p.keyboard.up(key); held.delete(key); }
    for (const key of want) if (!held.has(key)) { await p.keyboard.down(key); held.add(key); }
  };
  while (Date.now() < end) {
    const me = await A((ar) => ({ x: ar.me.x, y: ar.me.y }));
    const tgt = typeof target === "string" ? await A((ar, id) => { const s = id === "gate" ? ar.gate : id === "satoshi" ? ar.boss : ar.bodies.get(id); return s ? { x: s.x, y: s.y } : null; }, target) : target;
    if (!tgt) break;
    const dx = tgt.x - me.x, dy = tgt.y - me.y;
    if (Math.hypot(dx, dy) < near) break;
    const want = new Set();
    if (Math.abs(dx) > 8) want.add(dx > 0 ? "d" : "a");
    if (Math.abs(dy) > 8) want.add(dy > 0 ? "s" : "w");
    await setKeys(want);
    await sleep(60);
  }
  await setKeys(new Set());
}
const fps = () => A((ar) => Math.round(ar.fps));
const bodies = () => A((ar) => ar.order.length);

await p.evaluateOnNewDocument(() => { if (!localStorage.getItem("qday.theme")) localStorage.setItem("qday.theme", "dark"); });
await p.goto(`${BASE}/play`, { waitUntil: "networkidle2" });
await sleep(1200);
if (await p.$(".intro")) {
  await shot("00-cold-open-1");
  let panel = 1;
  for (let i = 0; i < 12 && (await p.$(".intro")); i++) {
    const before = await p.evaluate(() => document.querySelector("#in-text")?.textContent || "");
    await p.click(".intro-text"); await sleep(1400);
    const after = await p.evaluate(() => document.querySelector("#in-text")?.textContent || "");
    if (after && after !== before && !before.startsWith(after.slice(0, 8))) { panel++; await shot(`00-cold-open-${panel}`); }
  }
  await sleep(400); await shot("00-power-on");
}
await waitFor(() => document.querySelector("#field")?.__arena?.ready, 30000);
await sleep(1500);
log("start", await k(), "bodies", await bodies(), "fps", await fps());
if ((await k()) === "grab") {
  await shot("01-grab");
  await p.click("#m-go");
  await sleep(2500);
  await shot("02-grab-progress");
  const r = await waitFor(() => { const s = document.querySelector("#start"); return s && s.hidden ? "ok" : (document.querySelector(".m-msg.bad")?.textContent || null); }, 150000);
  log("after grab:", r, await msg());
  await sleep(2500);
}
if ((await k()) === "exposed") {
  await shot("03-exposed-spawn");
  // stand still: a hunter tunnels in and catches you
  log("waiting for a hunter (up to 60 s)");
  const hunter = await waitFor(() => { const ar = document.querySelector("#field").__arena; return ar.hunters.length ? ar.hunters[0] : null; }, 60000, 1000);
  log("hunter:", hunter);
  await sleep(2500);
  await shot("04-hunter-coming");
  // capture ~20 s of the chase as frames
  const frames = `${OUT}/${pre}chase`;
  fs.mkdirSync(frames, { recursive: true });
  const cap = (async () => { for (let i = 0; i < 100; i++) { await p.screenshot({ path: `${frames}/f${String(i).padStart(3, "0")}.jpg`, type: "jpeg", quality: 70 }); await sleep(120); } })();
  // run a little, then let it catch you
  await p.keyboard.down("d"); await sleep(1500); await p.keyboard.up("d");
  await p.keyboard.down("w"); await sleep(1200); await p.keyboard.up("w");
  const caught = await waitFor(() => document.querySelector(".strip")?.getAttribute("data-k") === "build" && document.querySelector(".strip.tone-alarm") ? "caught" : null, 90000, 1500);
  log("caught:", caught, await msg());
  await sleep(1200);
  await shot("05-caught-tether");
  // now run for the gate (dash on the way)
  log("running for the gate");
  const run = steerTo("gate", 60000, 40);
  await sleep(2500); await p.keyboard.press(" "); await sleep(1500); await shot("06-running-dash");
  await run;
  await cap;
  await sleep(800);
  await shot("07-at-gate");
}
await sleep(1200);
log("mission now", await k());
if (await p.$("#n-go")) {
  await shot("08-name-sheet");
  await p.click("#n-go");
  await sleep(3000);
  await shot("09-building");
  const r = await waitFor(() => document.querySelector("#n-msg.ok, #n-msg.bad")?.textContent || null, 180000);
  log("after build:", r);
  await sleep(700);
  await shot("10-quantum-safe-banner");
  await sleep(3000);
}
if ((await k()) === "movein") {
  await steerTo("gate", 30000, 40);
  const r = await waitFor(() => document.querySelector(".strip")?.getAttribute("data-k") !== "movein" ? "ok" : null, 120000);
  log("movein:", r);
}
log("mission now", await k(), "fps", await fps(), "bodies", await bodies());
await shot("11-vault");
if ((await k()) === "safe") {
  log("waiting for the raid on the old wallet to settle (up to 11 min)");
  const settled = await waitFor(() => /Escaped|took/.test(document.querySelector(".strip-text")?.textContent || "") && !/Watch the clock/.test(document.querySelector(".strip-text")?.textContent || "") ? "yes" : null, 11 * 60 * 1000, 3000);
  log("settled:", settled);
  await sleep(800);
  await shot("12-escaped");
}
// raid a rival by touch: the first body in the open state
const target = await A((ar) => { for (const id of ar.order) { const b = ar.info.get(id); if (b && b.state === "open" && !b.hunting && !b.raidingMe) return id; } return null; });
log("raid target:", target);
if (target) {
  await steerTo(target, 40000, 10);
  await sleep(600);
  await shot("13-raid-in-flight");
  const r = await waitFor(() => document.querySelector(".ev.tone-gold") || [...document.querySelectorAll(".bp-say")].length ? (document.querySelector(".ev-t")?.textContent || "said") : null, 90000);
  log("raid:", r);
  await sleep(2000);
  await shot("14-raid-beam");
}
// Satoshi by touch
await steerTo("satoshi", 60000, 95);
await sleep(600);
await shot("15-satoshi-touch");
const bossMsg = await waitFor(() => { const s = [...document.querySelectorAll(".bp-say, .fx-banner, .ev-t")].map((e) => e.textContent).join(" | "); return s || null; }, 30000, 500);
log("satoshi:", bossMsg);
await sleep(2500);
await shot("16-satoshi-after");
// shield from the bar
await p.click('.act[data-act="shield"]'); await sleep(1200); await shot("17-shield-sheet");
if (await p.evaluate(() => !document.querySelector("#sh-go")?.disabled)) {
  await p.click("#sh-go");
  log("shield:", await waitFor(() => document.querySelector("#sh-msg.ok, #sh-msg.bad")?.textContent || null, 90000));
  await sleep(1500);
  await shot("18-shield-done");
}
await p.keyboard.press("Escape"); await sleep(800);
await p.click("#h-menu"); await sleep(1000); await shot("19-menu");
await p.click("#st-boss"); await sleep(1200); await shot("20-boss-sheet");
await p.keyboard.press("Escape"); await sleep(600);
await p.click('.act[data-act="market"]'); await sleep(1500); await shot("21-market");
await p.keyboard.press("Escape"); await sleep(600);
await shot("22-final");
log("fps", await fps(), "bodies", await bodies());
log("errors:", JSON.stringify(errors.slice(0, 10)));
await b.close();
