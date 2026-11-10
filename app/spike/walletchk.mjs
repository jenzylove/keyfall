// Mainnet wallet safety, on the live site, no money moved: the top up asks for the
// backup first, the key is sealed (no plain secret in localStorage), it survives a
// reload, the code restores the same wallet in a clean browser, and a real 1Click
// quote comes back with a refund address on the paying chain.
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE || "https://keyfall.jdollar.site";
const OUT = "C:/Users/LENOVO/qday-launch/walletchk";
import fs from "node:fs"; fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const launch = (dir) => puppeteer.launch({ userDataDir: dir, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
const page = async (b) => { const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await p.evaluateOnNewDocument(() => { localStorage.setItem("qday.intro.v2", "1"); localStorage.setItem("qday.theme", "light"); }); return p; };
const waitFor = async (p, fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(400); } return null; };

const b1 = await launch(`C:/Users/LENOVO/qday-launch/chrome-w1-${Date.now()}`);
const p = await page(b1);
await p.goto(`${BASE}/play?net=mainnet`, { waitUntil: "domcontentloaded" });
await waitFor(p, () => document.querySelector("#field")?.__arena?.ready, 30000);
await sleep(3000);
// open the top up from the start card or the menu
const opened = await p.evaluate(() => { const b = [...document.querySelectorAll("button, a")].find((x) => /top up|add near|get near|fund/i.test(x.textContent || "")); if (b) { b.click(); return b.textContent.trim(); } return null; });
console.log("opened via:", opened);
const backup = await waitFor(p, () => document.querySelector("#wb-go") ? document.querySelector(".s-title")?.textContent : null, 15000);
console.log("backup step:", backup);
await p.screenshot({ path: `${OUT}/01-backup.png` });
const code = await p.evaluate(() => [...document.querySelectorAll(".code span")].map((s) => s.textContent.replace(/^\d/, "")).join("-"));
const ls = await p.evaluate(() => { const v = localStorage.getItem("keyfall.mainnet.wallet.v1"); return v ? JSON.parse(v) : null; });
console.log("stored record keys:", ls && Object.keys(ls).join(","), "plain secret present:", !!(ls && ls.secretKey));
console.log("continue disabled before tick:", await p.evaluate(() => document.querySelector("#wb-go").disabled));
await p.click("#wb-ok"); await p.click("#wb-go");
await waitFor(p, () => document.querySelector("#tu-refund") ? 1 : null, 8000);
await p.screenshot({ path: `${OUT}/02-topup.png` });
await sleep(3500); await p.screenshot({ path: `${OUT}/02-topup.png` }); await p.click("#tu-go"); await sleep(800);
console.log("no refund address:", await p.evaluate(() => document.querySelector("#tu-msg")?.textContent));
await p.type("#tu-refund", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
await p.click("#tu-go");
const q = await waitFor(p, () => document.querySelector("#tu-quote:not([hidden]) .addr code")?.textContent || document.querySelector("#tu-msg.bad")?.textContent, 30000);
console.log("quote:", q);
await p.screenshot({ path: `${OUT}/03-quote.png` });
const acct = await p.evaluate(() => document.querySelector("#tu-wallet")?.textContent);
await p.reload({ waitUntil: "domcontentloaded" }); await sleep(6000);
const after = await p.evaluate(() => document.querySelector("#field").__world().wallet);
console.log("wallet:", acct, "after reload:", after, after === acct ? "SAME" : "DIFFERENT");
await b1.close();

const b2 = await launch(`C:/Users/LENOVO/qday-launch/chrome-w2-${Date.now()}`);
const p2 = await page(b2);
await p2.goto(`${BASE}/play?net=mainnet`, { waitUntil: "domcontentloaded" });
await waitFor(p2, () => document.querySelector("#field")?.__arena?.ready, 30000); await sleep(2000);
await p2.evaluate(() => document.querySelector(".hud .menu, #h-menu, [aria-label*=enu]")?.click());
await waitFor(p2, () => document.querySelector("#rw-c") ? 1 : null, 8000);
await p2.evaluate(() => { const d = document.querySelector("#rw-c").closest("details"); if (d) d.open = true; });
await p2.type("#rw-c", code);
await p2.click("#rw-go");
const rr = await waitFor(p2, () => /restored|code/i.test(document.querySelector("#st-msg")?.textContent || "") && !/Opening/.test(document.querySelector("#st-msg").textContent) ? document.querySelector("#st-msg").textContent : null, 20000);
const w2 = await p2.evaluate(() => document.querySelector("#field").__world().wallet);
console.log("restore:", rr, "wallet:", w2, w2 === acct ? "SAME AS ORIGINAL" : "DIFFERENT");
await p2.screenshot({ path: `${OUT}/04-restored.png` });
await b2.close();
