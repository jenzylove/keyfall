// v4.3: style probe for the title pill. Inserts the pill's markup into the events host (a styling check only,
// nothing is earned or stored) and screenshots it with and without the CRT overlay.
import puppeteer from "puppeteer-core";
const PROFILE = process.argv[2] || "C:/Users/LENOVO/qday-launch/chrome-v41-vault2";
const OUT = "C:/Users/LENOVO/qday-launch/v43shots";
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.evaluateOnNewDocument(() => { localStorage.setItem("qday.theme", "dark"); localStorage.setItem("qday.intro.v2", "1"); });
await p.goto("http://localhost:5189/play", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 40; i++) { if (await p.evaluate(() => !!document.querySelector("#field")?.__arena?.ready).catch(() => false)) break; await sleep(500); }
await sleep(2500);
await p.evaluate(() => { document.querySelector(".strip-chip")?.remove(); for (const e of document.querySelectorAll(".ev")) e.remove(); const el = document.createElement("button"); el.type = "button"; el.className = "ev tone-gold ev-title"; el.innerHTML = `<span class="ev-t"><b>Title earned</b> · Satoshi Slayer · You hit Satoshi</span>`; document.querySelector("#events").appendChild(el); });
await sleep(900);
const el = await p.$(".ev.ev-title");
await el.screenshot({ path: `${OUT}/23-pill-zoom.png` });
console.log("pill rect", JSON.stringify(await el.boundingBox()));
console.log("crt", await p.evaluate(() => { const c = document.querySelector(".crt"); const s = c ? getComputedStyle(c) : null; return s ? { display: s.display, bg: s.backgroundImage.slice(0, 120), mix: s.mixBlendMode, z: s.zIndex, opacity: s.opacity } : "none"; }));
console.log("events host", await p.evaluate(() => { const s = getComputedStyle(document.querySelector("#events")); return { display: s.display, justify: s.justifyItems, filter: s.filter, backdrop: s.backdropFilter }; }));
console.log("title text", await p.evaluate(() => { const s = getComputedStyle(document.querySelector(".ev.ev-title .ev-t")); return { font: s.font, color: s.color, textShadow: s.textShadow, filter: s.filter, overflow: s.overflow, lineHeight: s.lineHeight, height: document.querySelector(".ev.ev-title .ev-t").getBoundingClientRect().height }; }));
await p.evaluate(() => { const c = document.querySelector(".crt"); if (c) c.style.display = "none"; });
await sleep(200);
await el.screenshot({ path: `${OUT}/23-pill-zoom-nocrt.png` });
console.log("all title styles", await p.evaluate(() => { const s = getComputedStyle(document.querySelector(".ev.ev-title")); const out = {}; for (const k of ["textShadow", "backgroundImage", "backgroundColor", "boxShadow", "filter", "backdropFilter", "mixBlendMode", "opacity", "transform", "animationName", "appearance", "borderStyle", "outline", "maskImage", "webkitMaskImage"]) out[k] = s[k]; return out; }));
// a plain div beside it, outside the .ev rules
await p.evaluate(() => { const d = document.createElement("div"); d.className = "title-probe"; d.style.cssText = "margin-top:8px;width:max-content;padding:8px 12px;background:#ffd60a;color:#0b0b0b;font:600 12.5px/1.3 'IBM Plex Mono',monospace"; d.textContent = "Title earned · Satoshi Slayer · You hit Satoshi"; document.querySelector("#events").appendChild(d); });
await sleep(200);
await (await p.$(".title-probe")).screenshot({ path: `${OUT}/23-pill-plain-div.png` });
console.log("ev-t / b styles", await p.evaluate(() => { const o = {}; for (const sel of [".ev.ev-title .ev-t", ".ev.ev-title b"]) { const s = getComputedStyle(document.querySelector(sel)); o[sel] = { bg: s.backgroundImage, bgc: s.backgroundColor, shadow: s.boxShadow, text: s.textShadow, deco: s.textDecorationLine, filter: s.filter, blend: s.mixBlendMode, display: s.display }; } return o; }));
await p.evaluate(() => { document.querySelector(".ev.ev-title .ev-t").style.visibility = "hidden"; });
await sleep(100);
await el.screenshot({ path: `${OUT}/23-pill-notext.png` });
await p.evaluate(() => { document.querySelector(".ev.ev-title .ev-t").style.visibility = ""; document.querySelector(".ev.ev-title b").remove(); });
await sleep(100);
await el.screenshot({ path: `${OUT}/23-pill-nob.png` });
await b.close();
