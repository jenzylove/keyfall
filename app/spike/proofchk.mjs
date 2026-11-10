import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
for (const net of ["practice", "mainnet"]) {
  const p = await b.newPage();
  await p.goto(`http://localhost:5191/proof?net=${net}`, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 12000));
  const r = await p.evaluate(() => ({ lede: document.querySelector(".lede")?.textContent?.slice(0, 90), cfg: document.querySelector("#p-config")?.textContent?.replace(/\s+/g, " ").slice(0, 160) }));
  console.log(net, JSON.stringify(r));
}
const p = await b.newPage();
await p.goto("http://localhost:5191/", { waitUntil: "domcontentloaded" }); await new Promise((r) => setTimeout(r, 3000));
await p.click("#t-real"); await new Promise((r) => setTimeout(r, 6000));
console.log("after mainnet button:", p.url(), await p.evaluate(() => document.querySelector(".hud .net, #h-net, .net-chip")?.textContent || document.body.innerText.slice(0, 40)));
await b.close();
