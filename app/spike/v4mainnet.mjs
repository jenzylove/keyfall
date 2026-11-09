// v4 mainnet screens at 390x844, spending nothing: landing with two buttons,
// the network sheet, the start card, the top up sheet with a QR (the
// /api/fund call is mocked unless MOCK=0), the waiting state, the mainnet
// arena with the 3 bots (read only mainnet views), the menu.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:5188";
const OUT = "C:/Users/LENOVO/qday-launch/v4shots";
const MOCK = process.env.MOCK !== "0";
fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ userDataDir: "C:/Users/LENOVO/qday-launch/chrome-v4main", executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
p.on("console", (m) => m.type() === "error" && !/well-known|403|favicon|CORS|ERR_FAILED|vibrate/.test(m.text()) && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (n) => { await p.screenshot({ path: `${OUT}/m-${n}.png` }); console.log("shot", n); };
await p.evaluateOnNewDocument((mock) => {
  localStorage.setItem("qday.theme", "dark"); localStorage.setItem("qday.intro.v2", "1");
  if (!mock) return;
  const real = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/api/fund")) {
      const body = JSON.parse(init?.body || "{}");
      const near = Number(body.near || 1);
      return new Response(JSON.stringify({ depositAddress: "7GkXz2mN9qRt4vBw8yHcL3pJdF6sAeUoKiQnZ1xM5tYb", amountIn: String(Math.round(near * 3.64 * 1e6)), amountInFormatted: (near * 3.64).toFixed(2), amountOut: String(BigInt(Math.round(near * 1000)) * 10n ** 21n), asset: "USDC", chain: "Solana", deadline: new Date(Date.now() + 86400000).toISOString() }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("1click.chaindefuser.com/v0/status")) return new Response(JSON.stringify({ status: "PENDING_DEPOSIT" }), { status: 200, headers: { "content-type": "application/json" } });
    return real(url, init);
  };
}, MOCK);

await p.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await sleep(2500);
await shot("01-landing-two-buttons");
await p.goto(`${BASE}/play?net=mainnet`, { waitUntil: "domcontentloaded" }); for (let i = 0; i < 40 && !(await p.evaluate(() => document.querySelector("#field")?.__arena?.ready).catch(() => false)); i++) await sleep(500);
await sleep(3000);
const info = await p.evaluate(() => { const ar = document.querySelector("#field").__arena; return { bodies: ar.order.map((id) => ar.info.get(id).name), fps: Math.round(ar.fps), chip: document.querySelector("#h-net")?.textContent }; });
console.log(JSON.stringify(info));
await shot("02-mainnet-start");
await p.click("#h-net"); await sleep(900); await shot("03-network-sheet");
await p.keyboard.press("Escape"); await sleep(600);
await p.click("#m-go"); await sleep(1200); await shot("04-topup-sheet");
await p.click("#tu-go"); await sleep(2500); await shot("05-topup-quote-qr");
await p.evaluate(() => document.querySelector(".sheet").scrollTo(0, 9999)); await sleep(600); await shot("06-topup-waiting");
await p.keyboard.press("Escape"); await sleep(600);
// look at the arena with the bots: dismiss the start card for the shot by hiding it
await p.evaluate(() => { document.querySelector("#start").hidden = true; });
await sleep(800); await shot("07-mainnet-arena-bots");
await p.evaluate(() => { document.querySelector("#start").hidden = false; });
await p.click("#h-menu"); await sleep(900); await shot("08-mainnet-menu");
console.log("errors:", JSON.stringify(errors.slice(0, 6)));
await b.close();
