// v3: the played session's game state at desktop size and in light theme (reads only, no new moves).
import puppeteer from "puppeteer-core";
const BASE = "http://localhost:5181";
const OUT = "C:/Users/LENOVO/qday-launch/v3shots";
const PROFILE = process.argv[2];
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
for (const [dev, w, h, mobile, theme] of [["desk", 1440, 900, false, "dark"], ["desk", 1440, 900, false, "light"], ["phone", 390, 844, true, "light"], ["phone", 390, 844, true, "dark"]]) {
  const p = await b.newPage();
  p.on("console", (m) => m.type() === "error" && !/well-known|403/.test(m.text()) && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.setViewport({ width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await p.evaluateOnNewDocument((t) => localStorage.setItem("qday.theme", t), theme);
  await p.goto(`${BASE}/play`, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  await p.screenshot({ path: `${OUT}/${dev}-${theme}-play-vault.png` });
  console.log(dev, theme, JSON.stringify(await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))));
  await p.click('.act[data-act="satoshi"]'); await sleep(1200);
  await p.screenshot({ path: `${OUT}/${dev}-${theme}-boss.png` });
  await p.keyboard.press("Escape"); await sleep(600);
  await p.click('.act[data-act="raid"]'); await sleep(1200);
  await p.screenshot({ path: `${OUT}/${dev}-${theme}-targets.png` });
  await p.keyboard.press("Escape"); await sleep(600);
  await p.click("#h-menu"); await sleep(900);
  await p.screenshot({ path: `${OUT}/${dev}-${theme}-menu.png` });
  await p.keyboard.press("Escape"); await sleep(400);
  await p.close();
}
console.log("console errors:", JSON.stringify(errors));
await b.close();
