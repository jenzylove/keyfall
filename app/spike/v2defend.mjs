import puppeteer from "puppeteer-core";
const OUT = "C:/Users/LENOVO/qday-launch/v2shots";
const b = await puppeteer.launch({ userDataDir: process.argv[2], executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = []; p.on("console", (m) => m.type() === "error" && errors.push(m.text())); p.on("pageerror", (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto("http://localhost:5180/play", { waitUntil: "networkidle2" });
await sleep(6000);
await p.screenshot({ path: `${OUT}/s-23-under-raid-field.png` });
const pin = await p.$(".ev.pin.tone-hot");
console.log("live pin:", !!pin, await p.evaluate(() => document.querySelector(".ev.pin")?.textContent));
if (pin) {
  await pin.click(); await sleep(1500);
  await p.screenshot({ path: `${OUT}/s-24-under-raid-sheet.png` });
  const go = await p.$("#ur-go");
  console.log("action:", await p.evaluate(() => document.querySelector("#ur-act")?.textContent?.trim()));
  if (go) {
    await go.click();
    const end = Date.now() + 90000; let r = null;
    while (Date.now() < end && !(r = await p.evaluate(() => document.querySelector("#ur-msg.ok, #ur-msg.bad")?.textContent || null))) await sleep(1000);
    console.log("defend:", r);
    await sleep(1500);
    await p.screenshot({ path: `${OUT}/s-25-defended.png` });
  }
}
await p.keyboard.press("Escape"); await sleep(2500);
await p.screenshot({ path: `${OUT}/s-26-field-after.png` });
console.log("errors", JSON.stringify(errors));
await b.close();
