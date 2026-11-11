// Existing vault player in another theme or size: music after the first tap, calm arena, one shot if a raid is left.
// Usage: node spike/v8look.mjs <profile> <phone|desk> <dark|light>
import puppeteer from "puppeteer-core";
const [PROFILE, DEV, THEME] = process.argv.slice(2);
const OUT = "C:/Users/LENOVO/qday-launch/v8shots";
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
if (DEV === "phone") await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
else await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
await p.evaluateOnNewDocument((th) => localStorage.setItem("qday.theme", th), THEME);
try {
  await p.goto("http://localhost:5189/play", { waitUntil: "domcontentloaded", timeout: 90000 });
  const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(400); } return null; };
  await waitFor(() => document.querySelector("#field")?.__world?.().vault && document.querySelector("#field").__world().holders > 0, 60000);
  await p.keyboard.press("d"); // first gesture
  const m = await waitFor(() => { const s = document.querySelector("#field").__music(); return s.on ? s : null; }, 15000);
  console.log("music after first key:", JSON.stringify(m));
  await sleep(1500);
  await p.screenshot({ path: `${OUT}/${DEV}-${THEME}-look-arena.png` });
  const w = await p.evaluate(() => document.querySelector("#field").__world());
  console.log("raids left", w.raidsLeft, "| shoot:", await p.evaluate(() => document.querySelector("#a-shoot")?.textContent));
  await p.evaluate(() => { const c = document.querySelector('.act[data-act="shield"]'); c?.click(); });
  await sleep(1200);
  await p.screenshot({ path: `${OUT}/${DEV}-${THEME}-look-shield.png` });
} catch (e) { console.log("err", String(e).slice(0, 200)); }
console.log("errors", JSON.stringify(errors));
await b.close();
