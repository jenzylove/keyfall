// fps for an existing vault player at 1x and 6x CPU throttle. Usage: node spike/v8fps.mjs <profile> <phone|desk> [label]
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE || "http://localhost:5189";
const [PROFILE, DEV = "phone", LABEL = ""] = process.argv.slice(2);
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: process.env.NOSW ? ["--no-sandbox"] : ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
if (DEV === "phone") await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
else await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (BASE !== "http://localhost:5189") { // another origin: carry the session over
  await p.goto("http://localhost:5189/404", { waitUntil: "domcontentloaded", timeout: 120000 });
  const ls = await p.evaluate(() => JSON.stringify({ ...localStorage }));
  await p.goto(`${BASE}/404`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.evaluate((s) => { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); }, ls);
}
await p.goto(`${BASE}/play`, { waitUntil: "domcontentloaded", timeout: 120000 });
const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(400); } return null; };
await waitFor(() => document.querySelector("#field")?.__world?.().vault && document.querySelector("#field").__world().holders > 0, 60000);
await p.evaluate(() => document.querySelector("#g-skip")?.click());
await p.mouse.click(5, 300).catch(() => {});
await sleep(6000);
const cdp = await p.createCDPSession();
const run = async (rate) => {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await p.keyboard.down("w");
  await sleep(rate > 1 ? 10000 : 2500);
  const r = await p.evaluate(() => new Promise((res) => { let n = 0, worst = 0, last = performance.now(); const s = last; const f = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; n++; if (t - s < 6000) requestAnimationFrame(f); else res({ fps: +(n / ((t - s) / 1000)).toFixed(1), worstMs: Math.round(worst) }); }; requestAnimationFrame(f); }));
  await p.keyboard.up("w");
  const ar = await p.evaluate(() => { const a = document.querySelector("#field").__arena; return { arenaFps: Math.round(a.fps), lowPower: a.lowPower, slow: a.slowDevice, bodies: a.order.length, dpr: a.dpr }; });
  return { rate, ...r, ...ar };
};
console.log(LABEL, DEV, JSON.stringify(await run(1)));
console.log(LABEL, DEV, JSON.stringify(await run(6)));
await b.close();
