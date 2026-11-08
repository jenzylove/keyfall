// v3: play the real first session on testnet at phone size and screenshot every state.
import puppeteer from "puppeteer-core";
const BASE = "http://localhost:5181";
const OUT = "C:/Users/LENOVO/qday-launch/v3shots";
const PROFILE = process.argv[2];
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
p.on("console", (m) => m.type() === "error" && !/well-known|403/.test(m.text()) && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (n) => { await p.screenshot({ path: `${OUT}/s-${n}.png` }); log("shot", n); };
const k = () => p.evaluate(() => document.querySelector(".mission")?.getAttribute("data-k") || "none");
const waitFor = async (fn, ms, every = 1000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };
const msg = () => p.evaluate(() => [...document.querySelectorAll(".m-msg, .s-msg")].map((e) => e.textContent).filter(Boolean).join(" | "));
const scrollCheck = () => p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));

await p.evaluateOnNewDocument(() => { if (!localStorage.getItem("qday.theme")) localStorage.setItem("qday.theme", "dark"); });
await p.goto(`${BASE}/play`, { waitUntil: "networkidle2" });
await sleep(1200);
await shot("00-cold-open-1");
await p.tap(".intro-text"); await sleep(1500); await shot("00-cold-open-2");
await p.tap(".intro-text"); await sleep(1500); await shot("00-cold-open-3");
await p.tap(".intro-text"); await sleep(900); await shot("00-power-on");
await waitFor(() => document.querySelector(".mission")?.getAttribute("data-k"), 30000);
await sleep(1500);
log("start mission", await k(), JSON.stringify(await scrollCheck()));
if ((await k()) === "grab") {
  await shot("01-grab");
  await p.click("#m-go");
  await sleep(2500);
  await shot("02-grab-progress");
  const r = await waitFor(() => { const k = document.querySelector(".mission")?.getAttribute("data-k"); return k && k !== "grab" ? k : (document.querySelector(".m-msg.bad")?.textContent || null); }, 150000);
  log("after grab:", r, await msg());
  await sleep(1500);
}
if ((await k()) === "exposed") {
  await shot("03-exposed");
  log("waiting for a raid card (up to 120 s)");
  const raid = await waitFor(() => document.querySelector(".mission.tone-alarm") ? "raid" : null, 120000, 2000);
  log("raid card:", raid || "none in 120 s");
  if (!raid) { await p.click("#m-go"); await sleep(800); }
}
await sleep(1500);
log("mission now", await k());
if (["build", "movein"].includes(await k())) {
  const alarm = await p.$(".mission.tone-alarm");
  await shot(alarm ? "04-raid-build" : "04-build");
  await p.click("#m-go");
  await sleep(3000);
  await shot("05-build-progress");
  const r = await waitFor(() => { const k = document.querySelector(".mission")?.getAttribute("data-k"); return k && !["build", "movein"].includes(k) ? k : (document.querySelector(".m-msg.bad")?.textContent || null); }, 180000);
  log("after build:", r, await msg());
  await sleep(600);
  await shot("06-slam");
  await sleep(2500);
}
if ((await k()) === "safe") {
  await shot("06-safe");
  // wait for the escape raid to settle at 0 (up to 11 minutes)
  log("waiting for the raid on the old wallet to settle");
  const settled = await waitFor(() => /Escaped|took/.test(document.querySelector(".mission .m-text")?.textContent || "") && !/Watch the clock/.test(document.querySelector(".mission .m-text")?.textContent || "") ? "yes" : null, 11 * 60 * 1000, 3000);
  log("settled:", settled);
  await sleep(600);
  await shot("06b-escaped");
  await p.click("#m-go");
  await sleep(1500);
}
log("mission now", await k());
if ((await k()) === "strike") {
  await shot("07-strike");
  const go = await p.$("#m-go");
  if (go) {
    await go.click();
    await sleep(1500);
    await shot("08-raid-sheet");
    const can = await p.evaluate(() => { const b = document.querySelector("#rs-go"); return b && !b.disabled && !document.querySelector("#rs-play")?.hidden; });
    if (can) {
      await p.click("#rs-go");
      await sleep(1200);
      await shot("09-raid-in-flight");
      const r = await waitFor(() => document.querySelector(".mission")?.getAttribute("data-k") === "done" || document.querySelector(".ev.tone-gold") ? "ok" : null, 90000);
      log("raid result:", r);
      await sleep(2500);
      await shot("10-raid-line");
    } else log("raid sheet blocked:", await p.evaluate(() => document.querySelector("#rs-why")?.textContent));
  }
}
log("mission now", await k());
if ((await k()) === "done") { await shot("11-done"); await p.click("#m-go"); await sleep(1000); }
await p.click('.act[data-act="shield"]'); await sleep(1200); await shot("12-shield-sheet");
if (await p.evaluate(() => !document.querySelector("#sh-go")?.disabled)) {
  await p.click("#sh-go");
  log("shield:", await waitFor(() => document.querySelector("#sh-msg.ok, #sh-msg.bad")?.textContent || null, 90000));
  await sleep(1200);
  await shot("13-shield-done");
}
await p.keyboard.press("Escape"); await sleep(800);
await p.click('.act[data-act="satoshi"]'); await sleep(1400); await shot("14-boss");
if (await p.evaluate(() => !document.querySelector("#bs-go")?.disabled)) {
  await p.click("#bs-go");
  await sleep(1000); await shot("14b-boss-in-flight");
  log("satoshi:", await waitFor(() => document.querySelector("#bs-msg.ok, #bs-msg.bad")?.textContent || null, 90000));
  await sleep(500);
  await shot("15-boss-hit");
  await sleep(2500);
  await shot("15b-boss-after");
} else log("satoshi blocked:", await p.evaluate(() => document.querySelector("#bs-next")?.textContent));
await p.keyboard.press("Escape"); await sleep(800);
await p.click('.act[data-act="raid"]'); await sleep(1200); await shot("16-targets-sheet");
await p.keyboard.press("Escape"); await sleep(600);
await p.click('.act[data-act="market"]'); await sleep(2500); await shot("17-market-buy");
await p.click('[data-tab="sell"]'); await sleep(2000); await shot("18-market-sell");
await p.keyboard.press("Escape"); await sleep(600);
await p.click("#h-menu"); await sleep(1000); await shot("19-menu");
await p.click("#bk-show"); await sleep(1200); await shot("20-backup-code");
await p.click("#st-act"); await sleep(1200); await shot("21-activity");
await p.keyboard.press("Escape"); await sleep(800);
await shot("22-field");
log("scroll", JSON.stringify(await scrollCheck()));
const ls = await p.evaluate(() => ({ wallet: localStorage.getItem("qday.wallet.v1") && JSON.parse(localStorage.getItem("qday.wallet.v1")).accountId, vault: localStorage.getItem("qday.vault.v1") && JSON.parse(localStorage.getItem("qday.vault.v1")).accountId, prog: localStorage.getItem("qday.game.v2"), titles: localStorage.getItem("qday.titles.v1"), receipts: localStorage.getItem("qday.receipts.v1") }));
console.log(JSON.stringify(ls, null, 1));
console.log("console errors:", JSON.stringify(errors, null, 1));
await b.close();
