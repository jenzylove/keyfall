import puppeteer, { KnownDevices } from "puppeteer-core";
const [base, out] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
for (const [tag, setup] of [["m", (p) => p.emulate(KnownDevices["Pixel 5"])], ["d", (p) => p.setViewport({ width: 1440, height: 900 })]]) {
  for (const path of ["/", "/play", "/proof", "/d/5"]) {
    const p = await b.newPage(); await setup(p);
    await p.goto(base + path, { waitUntil: "networkidle2" }); await new Promise((r) => setTimeout(r, 7000));
    const name = path === "/" ? "home" : path.slice(1).replace("/", "_");
    await p.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: true });
    await p.close();
  }
}
await b.close();
