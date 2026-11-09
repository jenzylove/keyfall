// v4.2 probe: does an NPC shot or your own shot stall the page? Runs on an existing practice profile, no chain writes.
import puppeteer from "puppeteer-core";
const PROFILE = process.argv[2] || "C:/Users/LENOVO/qday-launch/chrome-v41-vault2";
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto("http://localhost:5189/play", { waitUntil: "domcontentloaded" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { if (await p.evaluate(() => !!document.querySelector("#field")?.__arena?.ready && document.querySelector("#field").__arena.order.length > 0).catch(() => false)) break; await sleep(500); }
const fps = () => p.evaluate(() => Math.round(document.querySelector("#field").__arena.fps));
const id = await p.evaluate(() => document.querySelector("#field").__arena.order[0]);
console.log("body", id, "fps", await fps());
await p.evaluate((id) => document.querySelector("#field").__arena.npcShot(id), id);
await sleep(1500);
console.log("after npcShot fps", await fps(), "shots", await p.evaluate(() => document.querySelector("#field").__arena.shots.length));
// an NPC shot while you are red (the arena only): fake the kind locally to see the hit path
await p.evaluate(() => { const ar = document.querySelector("#field").__arena; ar.meInfo.kind = "exposed"; ar.meInfo.shieldBps = 0; });
await p.evaluate((id) => document.querySelector("#field").__arena.npcShot(id), id);
await sleep(1500);
console.log("after red npcShot fps", await fps());
await p.evaluate(() => { const ar = document.querySelector("#field").__arena; ar.meInfo.kind = "vault"; ar.shoot(); });
await sleep(1500);
console.log("after shoot fps", await fps(), "errors", JSON.stringify(errs.slice(0, 5)));
await b.close();
