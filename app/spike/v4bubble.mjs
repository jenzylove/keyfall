// Debug: inject a speech bubble over Satoshi and measure it.
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.evaluateOnNewDocument(() => { localStorage.setItem("qday.theme", "dark"); localStorage.setItem("qday.intro.v2", "1"); });
await p.goto("http://localhost:5188/play", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 2500));
const info = await p.evaluate(async () => {
  const ar = document.querySelector("#field").__arena;
  ar.say("satoshi", "hello hello hello", 9000);
  await new Promise((r) => setTimeout(r, 600));
  const el = document.querySelector(".ar-say");
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const range = document.createRange(); range.selectNodeContents(el);
  const tr = range.getBoundingClientRect();
  return { box: [r.left, r.top, r.width, r.height], text: [tr.left, tr.top, tr.width, tr.height], transform: cs.transform, bottom: cs.bottom, top: cs.top, lineHeight: cs.lineHeight, display: cs.display, overflow: cs.overflow, anim: cs.animationName, imgs: [...ar.imgs.values()].map((i) => [i.complete, i.naturalWidth]) };
});
console.log(JSON.stringify(info));
await p.screenshot({ path: "C:/Users/LENOVO/qday-launch/v4shots/debug-bubble.png" });
await b.close();
