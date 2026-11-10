import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
for (const [t, w, h] of [["light", 390, 844], ["dark", 390, 844], ["light", 1440, 900]]) {
  const p = await b.newPage(); await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await p.evaluateOnNewDocument((t) => localStorage.setItem("qday.theme", t), t);
  await p.goto("https://keyfall.jdollar.site/", { waitUntil: "networkidle2" }); await new Promise((r) => setTimeout(r, 4000));
  await p.screenshot({ path: `C:/Users/LENOVO/qday-launch/walletchk/land-${t}-${w}.png` });
}
await b.close();
