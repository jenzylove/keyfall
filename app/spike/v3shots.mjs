// v3 static shots: title (full page), fresh /play, /proof, /d at phone and desktop, dark and light.
import puppeteer from "puppeteer-core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const BASE = "http://localhost:5181";
const OUT = "C:/Users/LENOVO/qday-launch/v3shots";
const only = process.argv[2] || "";
const b = await puppeteer.launch({ userDataDir: mkdtempSync(join(tmpdir(), "qd3-")), executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [dev, w, h, mobile] of [["phone", 390, 844, true], ["desk", 1440, 900, false]]) {
  for (const theme of ["dark", "light"]) {
    if (only && !`${dev}-${theme}`.includes(only)) continue;
    const p = await b.newPage();
    p.on("console", (m) => m.type() === "error" && !/well-known|403/.test(m.text()) && errors.push(`${dev}-${theme}: ${m.text()}`));
    p.on("pageerror", (e) => errors.push(`${dev}-${theme}: ${e}`));
    await p.setViewport({ width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    await p.evaluateOnNewDocument((t) => { localStorage.setItem("qday.theme", t); localStorage.setItem("qday.intro.v1", "1"); }, theme);
    await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await sleep(2500);
    await p.screenshot({ path: `${OUT}/${dev}-${theme}-title.png` });
    await p.screenshot({ path: `${OUT}/${dev}-${theme}-title-full.png`, fullPage: true });
    const sc = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    console.log(dev, theme, "title scroll", JSON.stringify(sc));
    await p.goto(`${BASE}/play`, { waitUntil: "domcontentloaded" });
    await sleep(3500);
    await p.screenshot({ path: `${OUT}/${dev}-${theme}-play-fresh.png` });
    console.log(dev, theme, "play scroll", JSON.stringify(await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))));
    if (theme === "dark") {
      await p.goto(`${BASE}/proof`, { waitUntil: "domcontentloaded" });
      await sleep(4000);
      await p.screenshot({ path: `${OUT}/${dev}-${theme}-proof.png` });
      await p.goto(`${BASE}/d/1`, { waitUntil: "domcontentloaded" });
      await sleep(2500);
      await p.screenshot({ path: `${OUT}/${dev}-${theme}-defend.png` });
    }
    await p.close();
  }
}
console.log("console errors:", JSON.stringify(errors, null, 1));
await b.close();
