// v5: retry the vault build for an existing red player and print the raw chain error.
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE || "http://localhost:5189";
const b = await puppeteer.launch({ userDataDir: process.argv[2], executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
p.on("console", (m) => /keyfall|error/i.test(m.text()) && console.log("console:", m.text().slice(0, 500)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(`${BASE}/play`, { waitUntil: "domcontentloaded" });
await sleep(8000);
const A = (src) => p.evaluate((s) => new Function("ar", `return (${s})(ar)`)(document.querySelector("#field").__arena), src);
for (let i = 0; i < 600; i++) {
  const d = await A(String((ar) => { const dx = ar.gate.x - ar.me.x, dy = ar.gate.y - ar.me.y; return { dx, dy, d: Math.hypot(dx, dy) }; }));
  if (d.d < 46) break;
  const k = Math.abs(d.dx) > Math.abs(d.dy) ? (d.dx > 0 ? "d" : "a") : (d.dy > 0 ? "s" : "w");
  await p.keyboard.down(k); await sleep(80); await p.keyboard.up(k);
}
for (let i = 0; i < 20 && !(await p.$("#n-go")); i++) await sleep(500);
await p.evaluate(() => document.querySelector("#n-go")?.click());
for (let i = 0; i < 120; i++) { const m = await p.evaluate(() => document.querySelector("#n-msg.ok, #n-msg.bad")?.textContent || null); if (m) { console.log("result:", m); break; } await sleep(1000); }
await b.close();
