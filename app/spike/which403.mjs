import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const p = await b.newPage();
p.on("response", (r) => r.status() >= 400 && console.log(r.status(), r.url()));
await p.goto("https://qday-one.vercel.app/play", { waitUntil: "networkidle2" }); await new Promise((r) => setTimeout(r, 4000));
await b.close();
