// v2 UI screenshots: title and /play (fresh visitor) at phone and desktop, dark and light.
import puppeteer from "puppeteer-core";
const BASE = "http://localhost:5180";
const OUT = "C:/Users/LENOVO/qday-launch/v2shots";
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
const errors = [];
for (const [vw, vh, tag] of [[390, 844, "phone"], [1440, 900, "desk"]]) {
  for (const theme of ["dark", "light"]) {
    const p = await b.newPage();
    await p.setViewport({ width: vw, height: vh, deviceScaleFactor: vw < 500 ? 2 : 1, isMobile: vw < 500, hasTouch: vw < 500 });
    p.on("console", (m) => m.type() === "error" && errors.push(`${tag}/${theme}: ${m.text()}`));
    p.on("pageerror", (e) => errors.push(`${tag}/${theme}: ${e}`));
    await p.evaluateOnNewDocument((t) => localStorage.setItem("qday.theme", t), theme);
    for (const path of ["/", "/play"]) {
      await p.goto(BASE + path, { waitUntil: "networkidle2" });
      await new Promise((r) => setTimeout(r, 3500));
      const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
      console.log(tag, theme, path, JSON.stringify(m));
      await p.screenshot({ path: `${OUT}/${tag}-${theme}-${path === "/" ? "title" : "play-fresh"}.png` });
      if (path === "/") await p.screenshot({ path: `${OUT}/${tag}-${theme}-title-full.png`, fullPage: true });
    }
    await p.close();
  }
}
console.log("errors:", JSON.stringify(errors, null, 1));
await b.close();
