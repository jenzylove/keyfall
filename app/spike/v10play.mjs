// v10 arcade play test: a fresh practice player plays season 5 for N minutes and we
// screenshot every arcade state (pips, SHIELD or SHOOT BACK prompt, reload popup,
// Satoshi's life bar, blast and recap, glow, break, while you were away) and log
// the timings that matter: gaps between attacks on you and how long Satoshi lives.
// Every number comes from the page's chain view or the contract.
// Usage: node spike/v10play.mjs <phone|desk> <dark|light> [minutes]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:5179";
const OUT = process.env.OUT || "C:/Users/LENOVO/qday-launch/v10shots";
const DEV = process.argv[2] || "phone";
const THEME = process.argv[3] || "dark";
const MIN = Number(process.argv[4] || 16);
const PROFILE = `C:/Users/LENOVO/qday-launch/chrome-v10-${DEV}-${Date.now()}`;
const CONTRACT = "keyfall-arcade5-mwdhcz2c13e.testnet";
const TAG = `${DEV}-${THEME}`;
fs.mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/${TAG}-timeline.jsonl`;
const b = await puppeteer.launch({ userDataDir: PROFILE, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 300000, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
if (DEV === "phone") await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
else await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: THEME }]);
const errors = [];
p.on("console", (m) => m.type() === "error" && !/well-known|favicon|403|api\/(tick|hunt|clientlog)/.test(m.text()) && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));
const t0 = Date.now();
const T = () => ((Date.now() - t0) / 1000).toFixed(0);
const log = (...a) => console.log(`[${TAG} ${T()}s]`, ...a);
const ev = (o) => fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...o }) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shotN = 0;
const shot = async (n) => { const f = `${OUT}/${TAG}-${String(++shotN).padStart(2, "0")}-${n}.png`; await p.screenshot({ path: f }); log("shot", f); };
const A = (fn, ...args) => p.evaluate((src, ...a) => { const ar = document.querySelector("#field").__arena; return new Function("ar", ...a.map((_, i) => `a${i}`), `return (${src})(ar, ${a.map((_, i) => `a${i}`).join(",")})`)(ar, ...a); }, fn.toString(), ...args);
const W = () => p.evaluate(() => document.querySelector("#field")?.__world?.() || {});
const waitFor = async (fn, ms, every = 500) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn).catch(() => null); if (v) return v; await sleep(every); } return null; };
const shoot = () => p.evaluate(() => document.querySelector("#shoot-btn").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true })));
const RPC = "https://rpc.testnet.fastnear.com";
const view = async (method, args = {}) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
  const j = await r.json();
  return JSON.parse(Buffer.from(j.result.result).toString());
};
async function steerTo(target, ms = 25000, near = 30) {
  const end = Date.now() + ms; const held = new Set();
  const setKeys = async (want) => { for (const k of held) if (!want.has(k)) { await p.keyboard.up(k); held.delete(k); } for (const k of want) if (!held.has(k)) { await p.keyboard.down(k); held.add(k); } };
  let stuck = 0, lastD = Infinity;
  while (Date.now() < end) {
    const d0 = await A((ar, id) => { const s = id === "gate" ? ar.gate : id === "satoshi" ? ar.boss : ar.bodies.get(id); return s ? { dx: s.x - ar.me.x, dy: s.y - ar.me.y } : null; }, target).catch(() => null);
    if (!d0) break;
    const { dx, dy } = d0, d = Math.hypot(dx, dy);
    if (d < near) break;
    if (d > lastD - 2) stuck++; else stuck = 0; lastD = d;
    const want = new Set();
    if (stuck > 8) { const side = Math.floor(stuck / 14) % 2 === 0; want.add(Math.abs(dx) > Math.abs(dy) ? (side ? "w" : "s") : (side ? "a" : "d")); if (stuck > 28) stuck = 0; }
    else { if (Math.abs(dx) > 8) want.add(dx > 0 ? "d" : "a"); if (Math.abs(dy) > 8) want.add(dy > 0 ? "s" : "w"); }
    await setKeys(want); await sleep(50);
  }
  await setKeys(new Set());
}

// ---------------------------------------------------------------- onboard
await p.goto(`${BASE}/play`, { waitUntil: "domcontentloaded", timeout: 120000 });
await waitFor(() => document.querySelector("#field")?.__arena?.ready, 30000);
if (await waitFor(() => document.querySelector(".intro") ? 1 : null, 6000, 200)) { await p.click(".intro"); await sleep(300); await p.click("#in-skip").catch(() => {}); await sleep(1200); }
await waitFor(() => (document.querySelector("#field")?.__world?.().holders || 0) > 0 ? "ok" : null, 40000);
if (await waitFor(() => document.querySelector("#start:not([hidden]) #m-go") ? 1 : null, 15000)) {
  await p.click("#m-go");
  const r = await waitFor(() => { const s = document.querySelector("#start"); return s && s.hidden ? "ok" : (document.querySelector(".m-msg.bad")?.textContent || null); }, 150000, 1000);
  log("grab:", r);
  if (r !== "ok") { await shot("grab-failed"); log("errors", JSON.stringify(errors)); await b.close(); process.exit(1); }
}
await sleep(1500);
await p.evaluate(() => document.querySelector("#g-skip")?.click());
await steerTo("gate", 90000, 46);
if (await waitFor(() => document.querySelector("#n-go") ? 1 : null, 10000, 300)) {
  await p.evaluate(() => document.querySelector("#n-go")?.click());
  log("vault build:", await waitFor(() => document.querySelector("#n-msg.ok, #n-msg.bad")?.textContent || null, 180000, 500));
}
log("vault:", await waitFor(() => document.querySelector("#field").__world().vault ? "vault" : null, 150000, 1000));
await waitFor(() => BigInt(document.querySelector("#field").__world().vaultBal || "0") > 0n ? 1 : null, 90000, 1000);
await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("qday.guide")) localStorage.setItem(k, JSON.stringify({ step: 8, done: true })); });
await sleep(2500);
const me = (await W()).vault;
log("in the vault:", me, "bag", String(BigInt((await W()).vaultBal) / 10n ** 18n));
ev({ kind: "start", me, bal: (await W()).vaultBal });
await shot("gold-pips");

// ---------------------------------------------------------------- play
const end = Date.now() + MIN * 60_000;
const seen = { prompt: 0, reload: false, reloaded: false, shield: false, recap: 0, blast: false, breakDone: false, satoshi: false };
let lastIncoming = "", lastRound = null, answer = 0;
let lastArena = 0;
while (Date.now() < end) {
  const st = await p.evaluate(() => {
    const f = document.querySelector("#field");
    const w = f.__world();
    const ar = f.__arena;
    return { w, targets: [...ar.targets], pips: document.querySelector("#h-pips")?.getAttribute("aria-label"), prompt: !!document.querySelector(".arc-prompt"), sheet: document.querySelector(".sheet .s-title, .sheet h2")?.textContent || "", shootSt: document.querySelector("#a-shoot")?.textContent, brk: !document.querySelector(".break-chip")?.hidden };
  }).catch(() => null);
  if (!st) { await sleep(1000); continue; }
  // attacks on me: log each new raid id with its open time
  const inc = st.w.incoming;
  if (inc && String(inc.id) !== lastIncoming) {
    lastIncoming = String(inc.id);
    ev({ kind: "attacked", raid: inc.id, by: inc.attacker, opened: inc.opened_at, deadline: inc.deadline });
    log("attacked by", inc.attacker, "raid", inc.id);
  }
  // the prompt: answer SHIELD first, SHOOT BACK next, then let one settle
  if (st.prompt) {
    seen.prompt++;
    if (seen.prompt === 1 || answer < 3) {
      if (answer === 0) await shot("prompt");
      await sleep(1500);
      const pick = answer % 3 === 0 ? ".ap-btn.sh" : answer % 3 === 1 ? ".ap-btn.sb" : null;
      answer++;
      if (pick) { await p.click(pick).catch(() => {}); ev({ kind: "answered", how: pick }); log("answered", pick); await sleep(4000); if (answer <= 2) await shot(pick.includes("sh") ? "shielded" : "shot-back"); }
      else ev({ kind: "ignored" });
    }
  }
  // the recap
  if (/Round recap|Satoshi blasted|Satoshi survived/.test(st.sheet) || (await p.$(".rc-win"))) {
    seen.recap++;
    if (seen.recap <= 2) await shot("recap");
    await p.click("#rc-go").catch(() => {});
    await sleep(800);
  }
  // Satoshi: arena view every 10 s
  if (Date.now() - lastArena > 10_000) {
    lastArena = Date.now();
    const a = await view("arena").catch(() => null);
    if (a) {
      ev({ kind: "arena", round: a.round, hp: a.boss_hp, spawn: a.boss_spawn, hitters: a.hitters, damage: a.damage });
      const lr = a.last_round?.round ?? null;
      if (lastRound !== null && lr !== lastRound) { ev({ kind: "round_end", round: lr, killer: a.last_round?.killer, pot: a.last_round?.pot, winner: a.last_round?.winner, ended: a.last_round?.ended_ms, started: a.last_round?.started_ms }); log("round ended", lr, a.last_round?.killer ? "BLAST" : "timeout"); }
      lastRound = lr;
    }
  }
  // a blast on screen: catch the banner and the glow
  if (!seen.blast && (await p.$(".fx-banner"))) { const t = await p.$eval(".fx-banner b", (e) => e.textContent).catch(() => ""); if (/SATOSHI BLASTS/.test(t)) { seen.blast = true; await shot("blast"); await sleep(2500); await shot("glow"); } }
  if (st.sheet && !/recap/i.test(st.sheet) && !st.prompt) { /* another sheet: close it unless we opened it */ }
  const left = st.w.raidsLeft ?? 0;
  // out of bullets: SHOOT opens the reload popup; reload once
  if (left <= 0 && !inc && !seen.reloaded) {
    await shoot(); await sleep(1200);
    if (await p.$("#rl-go")) {
      if (!seen.reload) { seen.reload = true; await shot("reload-popup"); }
      const ok = await p.$eval("#rl-go", (e) => !e.disabled).catch(() => false);
      if (ok) { await p.click("#rl-go"); await waitFor(() => document.querySelector("#rl-msg")?.textContent || null, 60000); seen.reloaded = true; ev({ kind: "reload" }); log("reloaded"); await sleep(1500); await shot("reloaded"); }
      else await p.click("#rl-no").catch(() => {});
    }
  }
  // the shield sheet: buy one charge once
  if (!seen.shield && Date.now() - t0 > 4 * 60_000) {
    seen.shield = true;
    await p.evaluate(() => document.querySelector('.act[data-act="shield"]')?.click());
    await sleep(1200); await shot("shield-sheet");
    const can = await p.$eval("#sa-go", (e) => !e.disabled).catch(() => false);
    if (can) { await p.click("#sa-go"); await waitFor(() => document.querySelector("#sa-msg")?.textContent || null, 60000); ev({ kind: "shield_bought" }); await shot("shield-bought"); }
    await p.keyboard.press("Escape"); await p.evaluate(() => document.querySelector(".sheet .s-close, .sheet [aria-label=Close]")?.click()); await sleep(800);
  }
  // Satoshi's sheet once
  if (!seen.satoshi && Date.now() - t0 > 2 * 60_000) {
    seen.satoshi = true;
    await p.evaluate(() => document.querySelector("#h-menu")?.click()); await sleep(800);
    await p.evaluate(() => document.querySelector("#st-boss")?.click()); await sleep(1500);
    await shot("satoshi-sheet");
    await p.keyboard.press("Escape"); await p.evaluate(() => document.querySelector(".sheet .s-close, .sheet [aria-label=Close]")?.click()); await sleep(800);
  }
  // take a break in the middle, for three minutes
  if (!seen.breakDone && Date.now() - t0 > (MIN * 60_000) / 2) {
    seen.breakDone = true;
    await p.evaluate(() => document.querySelector("#h-menu")?.click()); await sleep(800);
    await shot("menu-break");
    await p.evaluate(() => document.querySelector("#st-break")?.click());
    await waitFor(() => !document.querySelector(".break-chip")?.hidden ? 1 : null, 60000);
    ev({ kind: "break_on" }); log("on a break"); await sleep(1500); await shot("on-break");
    await sleep(180_000);
    await p.click(".break-chip").catch(() => {});
    await waitFor(() => document.querySelector(".break-chip")?.hidden ? 1 : null, 60000);
    ev({ kind: "break_off" }); log("back from the break"); await sleep(4000);
    if (await p.$("#aw-go")) { await shot("away-after-break"); await p.click("#aw-go"); }
    continue;
  }
  // play: hit Satoshi when he is a target, else raid the nearest open target
  if (!inc && left > 0) {
    const tgt = st.targets.includes("satoshi") ? "satoshi" : st.targets.filter((x) => x !== "satoshi")[0];
    if (tgt) {
      await steerTo(tgt, 12000, tgt === "satoshi" ? 160 : 110);
      await A((ar, id) => ar.lockOn(id), tgt).catch(() => {});
      await shoot();
      ev({ kind: "shot", at: tgt });
      if (tgt === "satoshi" && !seen.lifebar) { seen.lifebar = true; await sleep(1500); await shot("satoshi-hit"); }
      await sleep(3000);
      continue;
    }
  }
  await sleep(1500);
}

// ---------------------------------------------------------------- while you were away (a return after 10 minutes)
await p.evaluate((c) => { const k = `kf-away:${c}`; const v = JSON.parse(localStorage.getItem(k) || "{}"); v.t = Date.now() - 12 * 60_000; v.bal = "1"; localStorage.setItem(k, JSON.stringify(v)); }, CONTRACT);
await p.reload({ waitUntil: "domcontentloaded" });
const away = await waitFor(() => document.querySelector("#aw-go") ? 1 : null, 60000, 1000);
log("away summary:", away ? "shown" : "not shown");
if (away) await shot("while-away");
const final = await W();
ev({ kind: "end", bal: final.vaultBal });
log("end bag", String(BigInt(final.vaultBal || "0") / 10n ** 18n), "| console errors:", JSON.stringify(errors.slice(0, 8)));
await b.close();
