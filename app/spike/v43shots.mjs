// v4.3: README stills and the title pill check, on existing practice players (the Satoshi hit is real).
//   node spike/v43shots.mjs shield <profile>    clean shield ring, no banners
//   node spike/v43shots.mjs satoshi <profile>   shoot Satoshi's core when ready: result banner, then the title pill mid animation and settled
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:5189";
const OUT = "C:/Users/LENOVO/qday-launch/v43shots";
const README = `${OUT}/readme`;
fs.mkdirSync(README, { recursive: true });
const [, , MODE = "shield", PROFILE = "C:/Users/LENOVO/qday-launch/chrome-v41-vault2"] = process.argv;
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (dir, n) => { await p.screenshot({ path: `${dir}/${n}.png` }); log("shot", n); };
const A = (fn, ...args) => p.evaluate((src, ...a) => { const ar = document.querySelector("#field").__arena; return new Function("ar", ...a.map((_, i) => `a${i}`), `return (${src})(ar, ${a.map((_, i) => `a${i}`).join(",")})`)(ar, ...a); }, fn.toString(), ...args);
const waitFor = async (fn, ms, every = 300) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };
async function steerTo(target, ms = 25000, near = 30) {
  const end = Date.now() + ms; const held = new Set();
  const setKeys = async (want) => { for (const key of held) if (!want.has(key)) { await p.keyboard.up(key); held.delete(key); } for (const key of want) if (!held.has(key)) { await p.keyboard.down(key); held.add(key); } };
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
await sleep(1500);
log("world", JSON.stringify(await p.evaluate(() => document.querySelector("#field").__world())));

if (MODE === "shield") {
  // wait until no toast, strip or bubble is up, then the ring on you
  await waitFor(() => !document.querySelector(".ev, .strip, .bp-say, .fx-banner") ? "clear" : null, 20000, 300);
  await p.evaluate(() => { document.querySelector(".strip-chip")?.remove(); });
  await sleep(400);
  log("shield bps", await A((ar) => ar.meInfo.shieldBps));
  await shot(README, "c-shield-ring");
}

if (MODE === "pill") {
  // the title pill through the page's own toast (debug hook, stores nothing): mid animation and settled
  await waitFor(() => !document.querySelector(".ev, .strip") ? "clear" : null, 15000, 300);
  await p.evaluate(() => { document.querySelector(".strip-chip")?.remove(); document.querySelector("#field").__toastTitle("slayer"); });
  await waitFor(() => document.querySelector(".ev.ev-title") ? "pill" : null, 5000, 20);
  await sleep(120);
  await shot(OUT, "21-title-pill-mid");
  await sleep(1500);
  await shot(OUT, "22-title-pill-settled");
  await (await p.$(".ev.ev-title")).screenshot({ path: `${OUT}/23-pill-zoom.png` });
}

if (MODE === "shieldtitle") {
  // charge a shield for real on a vault that never had one: the Shield Up title pill follows
  await waitFor(() => !document.querySelector(".ev, .strip") ? "clear" : null, 15000, 300);
  await p.evaluate(() => { document.querySelector(".strip-chip")?.remove(); });
  await p.click('.act[data-act="shield"]'); await sleep(1200);
  await p.click("#sh-go");
  log("shield:", await waitFor(() => document.querySelector("#sh-msg.ok, #sh-msg.bad")?.textContent || null, 90000));
  const pill = await waitFor(() => document.querySelector(".ev.ev-title") ? "pill" : null, 20000, 40);
  log("title pill:", pill);
  if (pill) { await shot(OUT, "21-title-pill-mid"); await sleep(1500); await shot(OUT, "22-title-pill-settled"); }
}

if (MODE === "satoshi") {
  await waitFor(() => !document.querySelector(".ev, .strip") ? "clear" : null, 15000, 300);
  await p.evaluate(() => { document.querySelector(".strip-chip")?.remove(); });
  await steerTo("satoshi", 60000, 250);
  await sleep(300);
  const ready = await A((ar) => ar.places.boss.ready);
  log("boss ready for you:", ready);
  const me = await A((ar) => ({ x: ar.me.x, y: ar.me.y, bx: ar.boss.x, by: ar.boss.y }));
  const dx = me.bx - me.x, dy = me.by - me.y;
  const keys = []; if (Math.abs(dx) > Math.abs(dy) * 0.4) keys.push(dx > 0 ? "d" : "a"); if (Math.abs(dy) > Math.abs(dx) * 0.4) keys.push(dy > 0 ? "s" : "w");
  for (const k of keys) await p.keyboard.down(k); await sleep(140); for (const k of keys) await p.keyboard.up(k); await sleep(200);
  log("aim", await A((ar) => ar.aimTarget()));
  await p.click("#shoot-btn");
  const banner = await waitFor(() => document.querySelector(".fx-banner")?.textContent || null, 30000, 100);
  log("banner:", banner);
  await sleep(500);
  await shot(README, "d-satoshi-hit");
  // the title pill (Satoshi Slayer) follows the banner once the strip is quiet
  const pill = await waitFor(() => document.querySelector(".ev.ev-title") ? "pill" : null, 15000, 50);
  log("title pill:", pill);
  if (pill) {
    await shot(OUT, "21-title-pill-mid");
    const cs = await p.evaluate(() => { const e = document.querySelector(".ev.ev-title"); const s = getComputedStyle(e); const t = getComputedStyle(e.querySelector(".ev-t")); return { w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, bg: s.backgroundImage, bgc: s.backgroundColor, color: s.color, anim: s.animationName, shadow: s.boxShadow, justify: s.justifySelf, width: s.width, tColor: t.color, tOpacity: t.opacity, html: e.outerHTML.slice(0, 300) }; });
    log("pill styles:", JSON.stringify(cs));
    await sleep(1500);
    await shot(OUT, "22-title-pill-settled");
  }
}
await b.close();
