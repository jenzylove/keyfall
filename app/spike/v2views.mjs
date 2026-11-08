// In-game views with an existing session: desktop and phone, dark and light, plus small phone, defend link and proof.
import puppeteer from "puppeteer-core";
const OUT = "C:/Users/LENOVO/qday-launch/v2shots";
const b = await puppeteer.launch({ userDataDir: process.argv[2], executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const views = [[1440, 900, "desk"], [390, 844, "phone"], [360, 640, "small"]];
for (const [vw, vh, tag] of views) for (const theme of ["dark", "light"]) {
  if (tag === "small" && theme === "light") continue;
  const p = await b.newPage();
  await p.setViewport({ width: vw, height: vh, deviceScaleFactor: vw < 500 ? 2 : 1, isMobile: vw < 500, hasTouch: vw < 500 });
  p.on("console", (m) => m.type() === "error" && errors.push(`${tag}/${theme}: ${m.text()}`));
  p.on("pageerror", (e) => errors.push(`${tag}/${theme}: ${e}`));
  await p.goto("http://localhost:5180/", { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => localStorage.setItem("qday.theme", t), theme);
  await p.goto("http://localhost:5180/play", { waitUntil: "networkidle2" });
  await sleep(6000);
  const m = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  console.log(tag, theme, "play", JSON.stringify(m));
  await p.screenshot({ path: `${OUT}/v-${tag}-${theme}-play.png` });
  if (tag !== "small") {
    // tap a blip to open its raid sheet
    const blip = await p.$(".blip.s-open") || await p.$(".blip");
    if (blip) { await blip.click(); await sleep(1500); await p.screenshot({ path: `${OUT}/v-${tag}-${theme}-raid-sheet.png` }); await p.keyboard.press("Escape"); await sleep(600); }
  }
  if (theme === "dark" && tag !== "small") {
    await p.goto("http://localhost:5180/d/9", { waitUntil: "networkidle2" }); await sleep(4000);
    await p.screenshot({ path: `${OUT}/v-${tag}-defend-link.png` });
    await p.goto("http://localhost:5180/proof", { waitUntil: "networkidle2" }); await sleep(5000);
    const m2 = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    console.log(tag, "proof", JSON.stringify(m2));
    await p.screenshot({ path: `${OUT}/v-${tag}-proof.png` });
  }
  await p.close();
}
console.log("errors", JSON.stringify(errors, null, 1));
await b.close();
