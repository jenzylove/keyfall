// Keep the game open until the escape raid settles; screenshot the result card.
import puppeteer from "puppeteer-core";
const OUT = "C:/Users/LENOVO/qday-launch/v2shots";
const b = await puppeteer.launch({ userDataDir: process.argv[2], executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = []; p.on("console", (m) => m.type() === "error" && errors.push(m.text())); p.on("pageerror", (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto("http://localhost:5180/play", { waitUntil: "networkidle2" });
const end = Date.now() + 9 * 60 * 1000; let got = null; let n = 0;
while (Date.now() < end) {
  got = await p.evaluate(() => [...document.querySelectorAll(".ev:not(.pin)")].map((e) => e.textContent).find((t) => /Escaped|raid took/.test(t)) || null);
  if (got) break;
  if (n++ % 30 === 0) await p.screenshot({ path: `${OUT}/s-27-waiting.png` });
  await sleep(1000);
}
console.log("escape event:", got);
await p.screenshot({ path: `${OUT}/s-28-escaped-event.png` });
await sleep(1500);
console.log("pin left:", await p.evaluate(() => document.querySelector(".ev.pin")?.textContent || "none"));
console.log("errors", JSON.stringify(errors));
await b.close();
