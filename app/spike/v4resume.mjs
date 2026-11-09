// v4: resume a session whose vault lives in the Chrome profile. Does the
// vault side: look around, raid a rival by touch, Satoshi by touch, shield,
// menu, market, plus a 60 body fps measurement with synthetic bodies.
// Usage: node spike/v4resume.mjs [profile] [--desk] [--fps-only]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:5188";
const OUT = "C:/Users/LENOVO/qday-launch/v4shots";
const PROFILE = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "C:/Users/LENOVO/qday-launch/chrome-v4";
const DESK = process.argv.includes("--desk");
const FPS_ONLY = process.argv.includes("--fps-only");
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
async function steerTo(target, ms = 25000, near = 30) {
  const end = Date.now() + ms;
  const held = new Set();
  const setKeys = async (want) => {
    for (const key of held) if (!want.has(key)) { await p.keyboard.up(key); held.delete(key); }
    for (const key of want) if (!held.has(key)) { await p.keyboard.down(key); held.add(key); }
  };
  let stuck = 0, lastD = Infinity;
  while (Date.now() < end) {
    const me = await A((ar) => ({ x: ar.me.x, y: ar.me.y }));
    const tgt = typeof target === "string" ? await A((ar, id) => { const s = id === "gate" ? ar.gate : id === "satoshi" ? ar.boss : ar.bodies.get(id); return s ? { x: s.x, y: s.y } : null; }, target) : target;
    if (!tgt) break;
    const dx = tgt.x - me.x, dy = tgt.y - me.y, d = Math.hypot(dx, dy);
    if (d < near) break;
    if (d > lastD - 2) stuck++; else stuck = 0;
    lastD = d;
    const want = new Set();
    if (stuck > 8) { // slide sideways around whatever blocks the way, then try again
      const side = Math.floor(stuck / 14) % 2 === 0;
      want.add(Math.abs(dx) > Math.abs(dy) ? (side ? "w" : "s") : (side ? "a" : "d"));
      if (stuck > 28) stuck = 0;
    }
    else { if (Math.abs(dx) > 8) want.add(dx > 0 ? "d" : "a"); if (Math.abs(dy) > 8) want.add(dy > 0 ? "s" : "w"); }
    await setKeys(want);
    await sleep(60);
  }
  await setKeys(new Set());
}
const fps = () => A((ar) => Math.round(ar.fps));

await p.evaluateOnNewDocument(() => { if (!localStorage.getItem("qday.theme")) localStorage.setItem("qday.theme", "dark"); localStorage.setItem("qday.intro.v2", "1"); });
await p.goto(`${BASE}/play`, { waitUntil: "networkidle2" });
await waitFor(() => document.querySelector("#field")?.__arena?.ready, 30000);
await sleep(2500);
log("state", await k(), "fps", await fps());

if (FPS_ONLY) {
  // 60 synthetic bodies on top of the real ones, measured over 6 s while moving
  await A((ar) => {
    const list = ar.order.map((id) => ar.info.get(id));
    const tmpl = list[0];
    const fake = [];
    for (let i = 0; fake.length + list.length < 60; i++) fake.push({ ...tmpl, id: `fake-${i}.testnet`, name: `Fake ${i}`, bag: "123k", kind: i % 2 ? "vault" : "exposed", hunting: false, raidingMe: false, raidedByMe: false, state: "idle", shieldBps: i % 3 ? 0 : 2000, immune: false });
    ar.setBodies([...list, ...fake]);
    ar.setBodies = () => {}; // the 5 s poll must not replace them
  });
  await p.keyboard.down("w"); await sleep(1500); await p.keyboard.up("w");
  await p.keyboard.down("d"); await sleep(3000); await p.keyboard.up("d");
  const n = await A((ar) => ar.order.length);
  const f = await fps();
  log("bodies", n, "fps", f);
  await shot("fps-60-bodies");
  await b.close();
  process.exit(0);
}

await shot("11-vault-look");
const stripText = async () => { if (await p.$("#m-show")) { await p.click("#m-show"); await sleep(500); } return p.evaluate(() => document.querySelector(".strip-text")?.textContent || ""); };
if ((await k()) === "safe") {
  let txt = "";
  const end = Date.now() + 11 * 60 * 1000;
  while (Date.now() < end) { txt = await stripText(); if (/Escaped|took/.test(txt) && !/Watch the clock/.test(txt)) break; await sleep(4000); }
  log("settled:", txt);
  await shot("12-escaped");
}
// walk a bit so the world shows, then raid a rival by touch
await p.keyboard.down("w"); await sleep(1800); await p.keyboard.up("w");
await shot("12b-walking");
const target = await A((ar) => { let best = null, bd = Infinity; for (const id of ar.order) { const b = ar.info.get(id), s = ar.bodies.get(id); if (b && s && b.state === "open" && !b.hunting && !b.raidingMe) { const d = Math.hypot(s.x - ar.me.x, s.y - ar.me.y); if (d < bd) { bd = d; best = id; } } } return best; });
log("raid target:", target);
if (target) {
  await steerTo(target, 45000, 14);
  await sleep(500);
  await shot("13-raid-in-flight");
  const r = await waitFor(() => document.querySelector(".ev.tone-gold .ev-t")?.textContent || null, 90000);
  log("raid:", r);
  await sleep(1500);
  await shot("14-raid-beam");
}
await steerTo("satoshi", 60000, 110);
await sleep(400);
await shot("15-satoshi-touch");
const bossMsg = await waitFor(() => { const s = [...document.querySelectorAll(".bp-say, .fx-banner, .ev-t")].map((e) => e.textContent).join(" | "); return s || null; }, 30000, 500);
log("satoshi:", bossMsg);
await sleep(2500);
await shot("16-satoshi-after");
await p.click('.act[data-act="shield"]'); await sleep(1200); await shot("17-shield-sheet");
if (await p.evaluate(() => !document.querySelector("#sh-go")?.disabled)) {
  await p.click("#sh-go");
  log("shield:", await waitFor(() => document.querySelector("#sh-msg.ok, #sh-msg.bad")?.textContent || null, 90000));
  await sleep(1500);
  await shot("18-shield-done");
}
await p.keyboard.press("Escape"); await sleep(1200);
await shot("18b-shielded-body");
await p.click("#h-menu"); await sleep(1000); await shot("19-menu");
await p.click("#st-boss"); await sleep(1200); await shot("20-boss-sheet");
await p.keyboard.press("Escape"); await sleep(600);
await p.click('.act[data-act="market"]'); await sleep(1500); await shot("21-market");
await p.keyboard.press("Escape"); await sleep(600);
await shot("22-final");
log("fps", await fps(), "bodies", await A((ar) => ar.order.length));
log("errors:", JSON.stringify(errors.slice(0, 10)));
await b.close();
