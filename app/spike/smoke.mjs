import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
for (const path of ["/", "/play", "/proof", "/d/2"]) {
  const p = await b.newPage(); const errs = [];
  p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 120))); p.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  await p.goto(process.argv[2] + path, { waitUntil: "networkidle2" }); await new Promise((r) => setTimeout(r, 9000));
  const t = await p.evaluate(() => document.body.innerText);
  console.log(path, "cantReach:", (t.match(/can't reach NEAR/g) || []).length, "errors:", JSON.stringify(errs.slice(0, 3)));
  await p.close();
}
await b.close();
