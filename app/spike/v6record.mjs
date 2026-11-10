// v6: a real screencast of free play on the arcade season (headful, phone size, light or dark):
// a fresh player builds a vault, then we record ~150 s of hunting: lock, shoot, ROBBING badge,
// the settle burst and coins in, a block if a gold bot defends, a raid on you if a hunter comes.
// The 60 to 90 s cut is picked afterwards around the first burst. One sponsored wallet.
// Usage: node spike/v6record.mjs [theme] [profile]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const BASE = process.env.BASE || "http://localhost:5189";
const THEME = process.argv[2] || "light";
const OUT = "C:/Users/LENOVO/qday-launch/v6shots";
const FR = `${OUT}/loop-frames`;
const FFMPEG = "C:/Users/LENOVO/tools/ffmpeg-9.0-essentials_build/bin/ffmpeg";
const PROFILE = process.argv[3] || `C:/Users/LENOVO/qday-launch/chrome-v6-rec-${Date.now()}`;
fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: false, protocolTimeout: 300000, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--use-angle=d3d11", "--window-size=420,900", "--window-position=20,20", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = (fn, ...args) => p.evaluate((src, ...a) => { const ar = document.querySelector("#field").__arena; return new Function("ar", ...a.map((_, i) => `a${i}`), `return (${src})(ar, ${a.map((_, i) => `a${i}`).join(",")})`)(ar, ...a); }, fn.toString(), ...args);
const W = () => p.evaluate(() => document.querySelector("#field").__world());
const waitFor = async (fn, ms, every = 300) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };
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

await p.evaluateOnNewDocument((theme) => { localStorage.setItem("qday.theme", theme); localStorage.setItem("qday.intro.v2", "1"); }, THEME);
await p.goto(`${BASE}/play`, { waitUntil: "domcontentloaded" });
await waitFor(() => document.querySelector("#field")?.__arena?.ready, 30000);
await waitFor(() => (document.querySelector("#field")?.__world?.().holders || 0) > 0 ? "ok" : null, 40000);
if (await waitFor(() => document.querySelector("#start:not([hidden]) #m-go") ? 1 : null, 15000)) {
  await p.click("#m-go");
  const r = await waitFor(() => { const s = document.querySelector("#start"); return s && s.hidden ? "ok" : (document.querySelector(".m-msg.bad")?.textContent || null); }, 150000, 1000);
  log("grab:", r);
  if (r !== "ok") { await b.close(); process.exit(1); }
}
await sleep(1000);
await p.evaluate(() => document.querySelector("#g-skip")?.click());
await steerTo("gate", 90000, 46);
if (await waitFor(() => document.querySelector("#n-go") ? 1 : null, 10000, 300)) {
  const tv = Date.now();
  await p.evaluate(() => document.querySelector("#n-go")?.click());
  log("vault build:", await waitFor(() => document.querySelector("#n-msg.ok, #n-msg.bad")?.textContent || null, 180000, 300), "wall ms", Date.now() - tv);
}
await waitFor(() => BigInt(document.querySelector("#field").__world().vaultBal || "0") > 0n ? 1 : null, 90000, 1000);
await p.evaluate(() => { localStorage.setItem("qday.guide.v1.testnet", JSON.stringify({ step: 7, done: true })); });
await sleep(2500);

// ---- screencast on
const cdp = await p.createCDPSession();
const frames = [];
cdp.on("Page.screencastFrame", async (ev) => {
  const i = frames.length;
  fs.writeFileSync(`${FR}/f${String(i).padStart(4, "0")}.jpg`, Buffer.from(ev.data, "base64"));
  frames.push(ev.metadata.timestamp);
  await cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1, maxWidth: 390, maxHeight: 844 });
const marks = {};
const mark = (k) => { marks[k] = frames.length; log(k, "frame", frames.length); };
const end = Date.now() + 150_000;
let shots = 0;
const seen = new Set();
while (Date.now() < end) {
  const w = await W();
  const list = await A((ar) => [...ar.targets].filter((id) => id !== "satoshi" && !ar.info.get(id)?.raidedByMe).map((id) => ({ id, d: ar.distTo(id), red: ar.info.get(id)?.kind === "exposed" })).sort((a, b) => (b.red - a.red) || a.d - b.d));
  if (list[0] && (w.raidsLeft || 0) > 0 && !seen.has(list[0].id)) {
    seen.add(list[0].id);
    await A((ar, id) => ar.lockOn(id), list[0].id);
    await steerTo(list[0].id, 25000, 150);
    const fired = await waitFor(() => document.querySelector("#field").__arena.meInfo.inFlight ? 1 : null, 7000, 100);
    if (fired) { mark(`shot${++shots}`); await waitFor(() => document.querySelector("#field").__arena.meInfo.inFlight ? null : 1, 60000, 200); }
  } else {
    // wander a little so the picture moves, and let settles and raids on you arrive
    const k = ["w", "a", "s", "d"][Math.floor(Math.random() * 4)];
    await p.keyboard.down(k); await sleep(700); await p.keyboard.up(k);
    await sleep(2500);
  }
  if (await p.evaluate(() => !!document.querySelector(".fx-pop.big")) && !marks.burst) mark("burst");
  if (await p.evaluate(() => !!document.querySelector(".ev.pin")) && !marks.raidOnYou) mark("raidOnYou");
}
await cdp.send("Page.stopScreencast");
log("recorded", frames.length, "frames");
await b.close();
let list = "";
for (let i = 0; i < frames.length; i++) { const d = i + 1 < frames.length ? Math.max(0.001, frames[i + 1] - frames[i]) : 1 / 30; list += `file 'f${String(i).padStart(4, "0")}.jpg'\nduration ${d.toFixed(4)}\n`; }
list += `file 'f${String(frames.length - 1).padStart(4, "0")}.jpg'\n`;
fs.writeFileSync(`${FR}/list.txt`, list);
fs.writeFileSync(`${FR}/marks.json`, JSON.stringify({ marks, stamps: frames }));
execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${FR}/list.txt`, "-vf", "fps=30,scale=780:1688:flags=neighbor,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "19", `${OUT}/loop.full.mp4`]);
console.log("marks:", JSON.stringify(marks), "seconds:", (frames[frames.length - 1] - frames[0]).toFixed(1));
