import puppeteer, { KnownDevices } from "puppeteer-core";
const url = process.argv[2]; const mobile = process.argv[3] === "mobile";
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const p = await b.newPage();
if (mobile) { await p.emulate(KnownDevices["Pixel 5"]); await p.emulateCPUThrottling(4); }
p.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
await p.goto(url); await p.waitForFunction("window.__done === true", { timeout: 240000 });
console.log(JSON.stringify(await p.evaluate("window.__out"), null, 1)); await b.close();
