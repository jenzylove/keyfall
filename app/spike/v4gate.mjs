// v4: an exposed wallet in the given profile runs to the gate, builds its
// vault, moves in, then raids the nearest raidable rival by touch.
// Usage: node spike/v4gate.mjs <profile> [--desk]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:5188";
const OUT = "C:/Users/LENOVO/qday-launch/v4shots";
const PROFILE = process.argv[2];
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
const k = () => p.evaluate(() => document.querySelector(".strip, .strip-chip")?.getAttribute("data-k") || (document.querySelector("#start:not([hidden])") ? "grab" : "none"));
const waitFor = async (fn, ms, every = 1000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };
const A = (fn, ...args) => p.evaluate((src, ...a) => { const ar = document.querySelector("#field").__arena; return new Function("ar", ...a.map((_, i) => `a${i}`), `return (${src})(ar, ${a.map((_, i) => `a${i}`).join(",")})`)(ar, ...a); }, fn.toString(), ...args);
async function steerTo(target, ms = 25000, near = 30, onTick) {
  const end = Date.now() + ms;
  const held = new Set();
  const setKeys = async (want) => {
    for (const key of held) if (!want.has(key)) { await p.keyboard.up(key); held.delete(key); }
    for (const key of want) if (!held.has(key)) { await p.keyboard.down(key); held.add(key); }
  };
  let stuck = 0, lastD = Infinity, n = 0;
  while (Date.now() < end) {
    const me = await A((ar) => ({ x: ar.me.x, y: ar.me.y }));
    const tgt = typeof target === "string" ? await A((ar, id) => { const s = id === "gate" ? ar.gate : id === "satoshi" ? ar.boss : ar.bodies.get(id); return s ? { x: s.x, y: s.y } : null; }, target) : target;
    if (!tgt) break;
    const dx = tgt.x - me.x, dy = tgt.y - me.y, d = Math.hypot(dx, dy);
    if (d < near) break;
    if (d > lastD - 2) stuck++; else stuck = 0;
    lastD = d;
    const want = new Set();
    if (stuck > 8) { const side = Math.floor(stuck / 14) % 2 === 0; want.add(Math.abs(dx) > Math.abs(dy) ? (side ? "w" : "s") : (side ? "a" : "d")); if (stuck > 28) stuck = 0; }
    else { if (Math.abs(dx) > 8) want.add(dx > 0 ? "d" : "a"); if (Math.abs(dy) > 8) want.add(dy > 0 ? "s" : "w"); }
    await setKeys(want);
    if (onTick) await onTick(n++);
    await sleep(60);
  }
  await setKeys(new Set());
}

await p.evaluateOnNewDocument(() => { if (!localStorage.getItem("qday.theme")) localStorage.setItem("qday.theme", "dark"); localStorage.setItem("qday.intro.v2", "1"); });
await p.goto(`${BASE}/play`, { waitUntil: "networkidle2" });
await waitFor(() => document.querySelector("#field")?.__arena?.ready, 30000);
await sleep(2500);
log("state", await k());
await shot("05b-exposed-look");
if (!(await p.evaluate(() => !!document.querySelector("#field").__arena && true))) process.exit(1);
// run for the gate, dash twice on the way, capture frames as a second chase clip
const frames = `${OUT}/${pre}run`;
fs.mkdirSync(frames, { recursive: true });
let fi = 0;
await steerTo("gate", 70000, 46, async (n) => { if (n === 20 || n === 90) await p.keyboard.press(" "); if (n % 3 === 0 && fi < 100) await p.screenshot({ path: `${frames}/f${String(fi++).padStart(3, "0")}.jpg`, type: "jpeg", quality: 70 }); });
await sleep(700);
await shot("07-at-gate");
if (await waitFor(() => document.querySelector("#n-go") ? "yes" : null, 8000, 300)) {
  await shot("08-name-sheet");
  await p.click("#n-go");
  await sleep(2500);
  await shot("09-building");
  const r = await waitFor(() => document.querySelector("#n-msg.ok, #n-msg.bad")?.textContent || null, 180000);
  log("after build:", r);
  await sleep(500);
  await shot("10-quantum-safe-banner");
  await sleep(3200);
  await shot("10b-vault-body");
} else if ((await k()) === "movein") {
  await sleep(2000);
  const r = await waitFor(() => document.querySelector(".strip, .strip-chip")?.getAttribute("data-k") !== "movein" ? "ok" : null, 120000);
  log("movein:", r);
  await shot("10b-vault-body");
}
await sleep(1500);
const target = await A((ar) => { let best = null, bd = Infinity; for (const id of ar.order) { const b = ar.info.get(id), s = ar.bodies.get(id); if (b && s && b.state === "open" && !b.hunting && !b.raidingMe) { const d = Math.hypot(s.x - ar.me.x, s.y - ar.me.y); if (d < bd) { bd = d; best = id; } } } return best; });
log("raid target:", target);
if (target) {
  await steerTo(target, 60000, 12);
  await sleep(450);
  await shot("13-raid-in-flight");
  const r = await waitFor(() => document.querySelector(".ev.tone-gold .ev-t, .ev.tone-ink .ev-t")?.textContent || null, 90000);
  log("raid:", r);
  await sleep(1200);
  await shot("14-raid-beam");
  await p.keyboard.down("s"); await sleep(1500); await p.keyboard.up("s");
  await sleep(500);
  await shot("14b-raid-beam-far");
}
log("fps", await A((ar) => Math.round(ar.fps)), "errors:", JSON.stringify(errors.slice(0, 10)));
await b.close();
