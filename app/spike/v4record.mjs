// v4: record a real 30 s practice run as video frames through CDP screencast
// (not screenshots), then encode at 30 fps from the frame timestamps.
// spawn -> one hunter comes -> catch -> run and dash to the gate -> vault slams.
// Usage: node spike/v4record.mjs [profile]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const BASE = process.env.BASE || "http://localhost:5188";
const OUT = "C:/Users/LENOVO/qday-launch/v4shots";
const FR = `${OUT}/calm-frames`;
const FFMPEG = "C:/Users/LENOVO/tools/ffmpeg-9.0-essentials_build/bin/ffmpeg";
const FFPROBE = "C:/Users/LENOVO/tools/ffmpeg-9.0-essentials_build/bin/ffprobe";
const PROFILE = process.argv[2] || "C:/Users/LENOVO/qday-launch/chrome-v4rec3";
fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: false, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--use-angle=d3d11", "--window-size=420,900", "--window-position=20,20"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log("shot", n); };
const k = () => p.evaluate(() => document.querySelector(".strip, .strip-chip")?.getAttribute("data-k") || (document.querySelector("#start:not([hidden])") ? "grab" : "none"));
const waitFor = async (fn, ms, every = 500) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };
const A = (fn, ...args) => p.evaluate((src, ...a) => { const ar = document.querySelector("#field").__arena; return new Function("ar", ...a.map((_, i) => `a${i}`), `return (${src})(ar, ${a.map((_, i) => `a${i}`).join(",")})`)(ar, ...a); }, fn.toString(), ...args);
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
await sleep(1500);
log("state", await k());
if ((await k()) === "grab") {
  await p.click("#m-go");
  const r = await waitFor(() => { const s = document.querySelector("#start"); return s && s.hidden ? "ok" : (document.querySelector(".m-msg.bad")?.textContent || null); }, 150000, 1000);
  log("grab:", r);
  if (r !== "ok") { await b.close(); process.exit(1); }
}
await sleep(1500);
await shot("calm-00-spawn");

// ---- screencast on
const cdp = await p.createCDPSession();
const frames = [];
cdp.on("Page.screencastFrame", async (ev) => {
  const i = frames.length;
  fs.writeFileSync(`${FR}/f${String(i).padStart(4, "0")}.jpg`, Buffer.from(ev.data, "base64"));
  frames.push(ev.metadata.timestamp);
  fs.appendFileSync(`${FR}/stamps.txt`, `${ev.metadata.timestamp}
`);
  await cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 75, everyNthFrame: 1, maxWidth: 520, maxHeight: 1126 });
const rec0 = Date.now();

// stand still: the hunter tunnels in and catches you
log("waiting for a hunter");
await waitFor(() => { const ar = document.querySelector("#field").__arena; return ar.hunters.length ? ar.hunters[0] : null; }, 40000, 500);
const caught = await waitFor(() => /tone-alarm|alarm/.test(document.querySelector(".strip, .strip-chip")?.className || "") ? "caught" : null, 45000, 500);
log("caught:", caught);
await sleep(1500);
await shot("after-raid-open");
// run for the gate, dash twice
await steerTo("gate", 40000, 46, async (n) => { if (n === 12 || n === 60) await p.keyboard.press(" "); });
await sleep(600);
if (await waitFor(() => document.querySelector("#n-go") ? "yes" : null, 6000, 300)) {
  await sleep(400);
  await p.evaluate(() => document.querySelector("#n-go")?.click());
  await waitFor(() => document.querySelector("#n-msg.ok, #n-msg.bad")?.textContent || null, 120000, 500);
  await sleep(2600); // the slam and the banner
}
await cdp.send("Page.stopScreencast");
const recMs = Date.now() - rec0;
log("recorded", frames.length, "frames in", (recMs / 1000).toFixed(1), "s");
await shot("calm-99-vault");
await b.close();

// ---- encode from timestamps (variable rate -> constant 30 fps)
let list = "";
for (let i = 0; i < frames.length; i++) {
  const d = i + 1 < frames.length ? Math.max(0.001, frames[i + 1] - frames[i]) : 1 / 30;
  list += `file 'f${String(i).padStart(4, "0")}.jpg'\nduration ${d.toFixed(4)}\n`;
}
list += `file 'f${String(frames.length - 1).padStart(4, "0")}.jpg'\n`;
fs.writeFileSync(`${FR}/list.txt`, list);
execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${FR}/list.txt`, "-vf", "fps=30,scale=780:1688:flags=bicubic,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "19", `${OUT}/calm-chase.mp4`]);
const probe = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames,r_frame_rate,duration", "-of", "default=nw=1", `${OUT}/calm-chase.mp4`]).toString();
console.log(probe);
console.log("source frame rate:", (frames.length / ((frames[frames.length - 1] - frames[0]) || 1)).toFixed(1), "fps captured");
