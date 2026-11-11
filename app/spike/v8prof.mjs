// Where the time goes at 6x CPU throttle: CPU profile of an existing vault player, self time by function.
// Usage: node spike/v8prof.mjs <profile> [phone|desk]
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE || "http://localhost:5189";
const [PROFILE, DEV = "phone"] = process.argv.slice(2);
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
if (DEV === "phone") await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
else await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (BASE !== "http://localhost:5189") {
  await p.goto("http://localhost:5189/404", { waitUntil: "domcontentloaded", timeout: 120000 });
  const ls = await p.evaluate(() => JSON.stringify({ ...localStorage }));
  await p.goto(`${BASE}/404`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.evaluate((s) => { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); }, ls);
}
await p.goto(`${BASE}/play`, { waitUntil: "domcontentloaded", timeout: 120000 });
const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(400); } return null; };
await waitFor(() => document.querySelector("#field")?.__world?.().vault && document.querySelector("#field").__world().holders > 0, 60000);
await sleep(5000);
const cdp = await p.createCDPSession();
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
await p.evaluate(() => document.querySelector("#field").__arena.powerLocked = true);
await sleep(1500);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
await cdp.send("Profiler.start");
await p.keyboard.down("w");
await sleep(8000);
await p.keyboard.up("w");
const { profile } = await cdp.send("Profiler.stop");
const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas; let total = 0;
profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); total += dt[i] || 0; });
console.log("total ms", Math.round(total / 1000));
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log((v / 1000).toFixed(0).padStart(6), k);
await b.close();
