// v4.1 test helper: carry an existing practice player (wallet key + vault recovery
// code) from one dev origin to another, through the game's own menu. Nothing
// here touches the chain; no new wallet is made.
//   node spike/v41port.mjs <fromProfile> <fromBase> <toProfile> <toBase>
import puppeteer from "puppeteer-core";
const [, , FROM = "C:/Users/LENOVO/qday-launch/chrome-v4", FROM_BASE = "http://localhost:5188", TO = "C:/Users/LENOVO/qday-launch/chrome-v41-vault", TO_BASE = "http://127.0.0.1:5189"] = process.argv;
const launch = (dir) => puppeteer.launch({ userDataDir: dir, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (p, fn, ms, every = 500) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };

const b1 = await launch(FROM);
const p1 = await b1.newPage();
await p1.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await p1.evaluateOnNewDocument(() => { localStorage.setItem("qday.intro.v2", "1"); localStorage.setItem("qday.guide.v1.testnet", JSON.stringify({ step: 7, done: true })); });
await p1.goto(`${FROM_BASE}/play`, { waitUntil: "domcontentloaded" });
await waitFor(p1, () => document.querySelector("#h-menu") ? "ok" : null, 30000);
await sleep(4000);
const wallet = await p1.evaluate(() => localStorage.getItem("qday.wallet.v1"));
const vault = await p1.evaluate(() => localStorage.getItem("qday.vault.v1"));
console.log("wallet:", wallet ? JSON.parse(wallet).accountId : null, "vault:", vault ? JSON.parse(vault).accountId : null);
let code = null, name = null;
if (vault) {
  name = JSON.parse(vault).accountId.split(".")[0];
  await p1.click("#h-menu"); await sleep(1200);
  await p1.click("#bk-show"); await sleep(1500);
  code = await p1.evaluate(() => [...document.querySelectorAll(".code span")].map((s) => [...s.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("")).join("-"));
  console.log("code chars:", code.replace(/-/g, "").length);
}
await b1.close();

const b2 = await launch(TO);
const p2 = await b2.newPage();
await p2.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await p2.evaluateOnNewDocument((w) => { localStorage.setItem("qday.intro.v2", "1"); localStorage.setItem("qday.theme", "dark"); if (w) localStorage.setItem("qday.wallet.v1", w); }, wallet);
await p2.goto(`${TO_BASE}/play`, { waitUntil: "domcontentloaded" });
await waitFor(p2, () => document.querySelector("#h-menu") ? "ok" : null, 30000);
await sleep(3000);
if (code && name) {
  await p2.click("#h-menu"); await sleep(1200);
  await p2.evaluate(() => document.querySelector("details.det")?.setAttribute("open", ""));
  await p2.type("#rs-n", name); await p2.type("#rs-c", code);
  await p2.click("#rs-go");
  const r = await waitFor(p2, () => document.querySelector("#st-msg.ok, #st-msg.bad")?.textContent || null, 60000);
  console.log("restore:", r);
}
await sleep(2000);
console.log("to-origin session:", await p2.evaluate(() => ({ wallet: !!localStorage.getItem("qday.wallet.v1"), vault: localStorage.getItem("qday.vault.v1") ? JSON.parse(localStorage.getItem("qday.vault.v1")).accountId : null })));
await b2.close();
