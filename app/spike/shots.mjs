import puppeteer, { KnownDevices } from "puppeteer-core";
const [base, out] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
for (const path of ["/", "/play", "/proof"]) {
  const p = await b.newPage(); await p.emulate(KnownDevices["Pixel 5"]); const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 150)));
  await p.goto(base + path, { waitUntil: "networkidle2" }); await new Promise((r) => setTimeout(r, 7000));
  const name = path === "/" ? "home" : path.slice(1);
  await p.screenshot({ path: `${out}/qd-${name}.png` });
  const t = await p.evaluate(() => document.body.innerText);
  console.log(path, "cantReach", (t.match(/can't reach/g) || []).length, "errors", JSON.stringify(errs), "|", t.slice(0, 260).replace(/\s+/g, " "));
  await p.close();
}
await b.close();
