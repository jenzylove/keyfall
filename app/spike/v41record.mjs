// v4.1: record a brand new player's first minute through the guide as a real
// CDP screencast (headful, phone size), then encode at 30 fps from the frame
// timestamps. Bag -> this is you -> you are red -> gold door (real vault +
// move in) -> you are gold -> rob someone (real raid). One sponsored wallet.
// Usage: node spike/v41record.mjs [profile]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const BASE = process.env.BASE || "http://localhost:5189";
const OUT = "C:/Users/LENOVO/qday-launch/v41shots";
const FR = `${OUT}/first-minute-frames`;
const FFMPEG = "C:/Users/LENOVO/tools/ffmpeg-9.0-essentials_build/bin/ffmpeg";
const FFPROBE = "C:/Users/LENOVO/tools/ffmpeg-9.0-essentials_build/bin/ffprobe";
const PROFILE = process.argv[2] || `C:/Users/LENOVO/qday-launch/chrome-v41-rec-${Date.now()}`;
fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: false, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--use-angle=d3d11", "--window-size=420,900", "--window-position=20,20"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = (fn, ...args) => p.evaluate((src, ...a) => { const ar = document.querySelector("#field").__arena; return new Function("ar", ...a.map((_, i) => `a${i}`), `return (${src})(ar, ${a.map((_, i) => `a${i}`).join(",")})`)(ar, ...a); }, fn.toString(), ...args);
const G = () => p.evaluate(() => document.querySelector("#field").__guide());
const waitFor = async (fn, ms, every = 300) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };
const waitStep = async (n, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const g = await G().catch(() => null); if (g && g.step >= n) return g; await sleep(250); } return null; };
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

await p.evaluateOnNewDocument(() => { localStorage.setItem("qday.theme", "dark"); localStorage.setItem("qday.intro.v2", "1"); });
await p.goto(`${BASE}/play`, { waitUntil: "domcontentloaded" });
await waitFor(() => document.querySelector("#field")?.__arena?.ready, 30000);
await waitFor(() => document.querySelector("#start:not([hidden]) #m-go") ? "grab" : null, 30000);
await sleep(800);

// ---- screencast on, from the start card
const cdp = await p.createCDPSession();
const frames = [];
cdp.on("Page.screencastFrame", async (ev) => {
  const i = frames.length;
  fs.writeFileSync(`${FR}/f${String(i).padStart(4, "0")}.jpg`, Buffer.from(ev.data, "base64"));
  frames.push(ev.metadata.timestamp);
  await cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1, maxWidth: 390, maxHeight: 844 });
const rec0 = Date.now();
const marks = {};
const mark = (k) => { marks[k] = frames.length; log(k, "frame", frames.length); };

await sleep(900);
await p.click("#m-go");
const r = await waitFor(() => { const s = document.querySelector("#start"); return s && s.hidden ? "ok" : (document.querySelector(".m-msg.bad")?.textContent || null); }, 150000, 500);
log("grab:", r);
if (r !== "ok") { await cdp.send("Page.stopScreencast"); await b.close(); process.exit(1); }
await waitStep(1, 15000); mark("step1");
await sleep(1400);
// step 1: move a little, in two directions so the drag reads on camera
await p.keyboard.down("d"); await sleep(500); await p.keyboard.up("d");
await p.keyboard.down("w"); await sleep(400); await p.keyboard.up("w");
await waitStep(2, 10000); mark("step2");
await sleep(5200); // read the red card
await p.evaluate(() => document.querySelector("#g-next")?.click());
await waitStep(3, 10000); mark("step3");
await sleep(1200);
await steerTo("gate", 45000, 46, async (n) => { if (n === 20) await p.keyboard.press(" "); });
if (await waitFor(() => document.querySelector("#n-go") ? "yes" : null, 8000, 200)) {
  mark("gate");
  await sleep(1600);
  await p.evaluate(() => document.querySelector("#n-go")?.click());
  await waitFor(() => document.querySelector("#n-msg.ok, #n-msg.bad")?.textContent || null, 150000, 400);
}
await waitStep(4, 30000); mark("step4");
await sleep(3000);
await p.evaluate(() => document.querySelector("#g-next")?.click());
const g5 = await waitFor(() => { const g = document.querySelector("#field").__guide(); return g.step === 5 && (g.target || g.variant === "boss") ? g : g.step > 5 ? g : null; }, 10000, 200);
mark("step5");
log("step 5", JSON.stringify(g5));
await sleep(1500);
if (g5 && g5.step === 5 && g5.target) { await steerTo(g5.target, 30000, 30); }
else if (g5 && g5.variant === "boss") { await steerTo("satoshi", 30000, 95); }
await waitStep(6, 60000); mark("step6");
await sleep(2600);
await cdp.send("Page.stopScreencast");
const recMs = Date.now() - rec0;
log("recorded", frames.length, "frames in", (recMs / 1000).toFixed(1), "s");
await b.close();

// ---- encode from timestamps (variable rate -> constant 30 fps)
let list = "";
for (let i = 0; i < frames.length; i++) {
  const d = i + 1 < frames.length ? Math.max(0.001, frames[i + 1] - frames[i]) : 1 / 30;
  list += `file 'f${String(i).padStart(4, "0")}.jpg'\nduration ${d.toFixed(4)}\n`;
}
list += `file 'f${String(frames.length - 1).padStart(4, "0")}.jpg'\n`;
fs.writeFileSync(`${FR}/list.txt`, list);
execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${FR}/list.txt`, "-vf", "fps=30,scale=780:1688:flags=neighbor,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "19", `${OUT}/first-minute.tmp.mp4`]);
fs.renameSync(`${OUT}/first-minute.tmp.mp4`, `${OUT}/first-minute.mp4`);
const still = (i, name) => execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", `${FR}/f${String(Math.min(i, frames.length - 1)).padStart(4, "0")}.jpg`, "-vf", "scale=780:1688:flags=neighbor", `${OUT}/${name}.png`]);
for (const [k, i] of Object.entries(marks)) still(i + 8, `rec-${k}`);
const probe = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames,r_frame_rate,duration", "-of", "default=nw=1", `${OUT}/first-minute.mp4`]).toString();
console.log(probe);
console.log("marks:", JSON.stringify(marks));
console.log("source frame rate:", (frames.length / ((frames[frames.length - 1] - frames[0]) || 1)).toFixed(1), "fps captured");
