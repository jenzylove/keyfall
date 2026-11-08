import puppeteer, { KnownDevices } from "puppeteer-core";
const out = "C:/Users/LENOVO/qday-launch/fonttest";
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, userDataDir: process.env.PROFILE });
for (const [name, path] of [["title", "/"], ["play", "/play"], ["proof", "/proof"]]) {
  const p = await b.newPage(); await p.emulate(KnownDevices["Pixel 5"]);
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem("qday.intro.v1", "1"); localStorage.setItem("qday.intro.seen", "1"); } catch {} });
  await p.goto("http://localhost:5183" + path, { waitUntil: "networkidle2" }); await new Promise((r) => setTimeout(r, 6000));
  await p.screenshot({ path: `${out}/after-${name}.png` });
  if (name === "title") await p.screenshot({ path: `${out}/after-title-full.png`, fullPage: true });
  await p.close();
}
await b.close();
