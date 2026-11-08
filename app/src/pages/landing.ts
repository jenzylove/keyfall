// The title screen: wordmark, the live radar, the countdown and one PLAY button.

import { getHolderCount, getHolders, getStats, type Holder } from "../chain";
import { REPO, chainNow, esc, poll, syncClock } from "../ui/dom";
import { Radar, type Blip } from "../ui/radar";
import { avatar } from "../ui/avatars";
import { isNpc, nameOf } from "../ui/names";
import { full, longClock, pct } from "../ui/plain";

/** Tiny pixel art from rows of characters. */
function pix(rows: string[], colors: Record<string, string>) {
  const h = rows.length, w = rows[0].length;
  let r = "";
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (colors[ch]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${colors[ch]}"/>`; }));
  return `<svg viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}
const ART_BAG = pix(
  [
    "................",
    "................",
    "......rr........",
    ".....rrrr.......",
    "....rrrrrr......",
    "...rrrRrrrr.....",
    "..rrrrrrRrrr....",
    ".rrRrrrrrrrrr...",
    "rrrrrrrrRrrrrr..",
    "g.g.g.g.g.g.g.g.",
    "..r.....r.......",
    "..r.........r...",
    "......r.....r...",
    "......r.........",
    "..........r.....",
    "................",
  ],
  { r: "#ff3d2e", R: "#b3180c", g: "#8a877e" },
);
const ART_VAULT = pix(
  [
    "................",
    "......kkkk......",
    ".....k....k.....",
    ".....k....k.....",
    "....yyyyyyyy....",
    "....yyykkyyy....",
    "....yyykkyyy....",
    "....yyyyyyyy....",
    "................",
    "y......Y.......y",
    "y.....YYYY.....y",
    "y...YYYyYYYY...y",
    "y.YYYYYYYYyYYY.y",
    "yYYYyYYYYYYYYYYy",
    "yyyyyyyyyyyyyyyy",
    "................",
  ],
  { y: "#ffd60a", Y: "#e0b400", k: "#8a877e" },
);
const ART_RAID = pix(
  [
    "................",
    ".......w........",
    ".......w........",
    "....wwwwwww.....",
    "...w...w...w....",
    "..w..rrrrr..w...",
    "..w.rkrrkrr.w...",
    "wwwwrrrrrrrwwww.",
    "..w.rrkkkrr.w...",
    "..w..rrrrr..w...",
    "...w...w...w....",
    "....wwwwwww.....",
    ".......w........",
    ".......w...yy...",
    "..........yyyy..",
    "...........yy...",
  ],
  { w: "#8a877e", r: "#ff3d2e", k: "#0c0c0b", y: "#ffd60a" },
);

export function landing(root: HTMLElement) {
  document.body.classList.add("on-title");
  root.innerHTML = `
    <section class="title" aria-label="Q-DAY">
      <div class="t-radar" id="t-radar"></div>
      <div class="t-copy">
        <h1 class="wordmark">Q<span class="hy">-</span>DAY</h1>
        <p class="premise">Quantum computers will break old crypto keys. Move your coins into a quantum vault before Q-Day, raid everyone who doesn't.</p>
        <p class="t-cd">Q-Day in <b id="t-cd">·</b></p>
        <a class="btn play" href="/play" data-link><span class="tri" aria-hidden="true"></span>Play</a>
        <p class="t-sub">Free. No wallet, no sign up. NEAR testnet.</p>
      </div>
      <a class="t-more" href="#how">How to play <i aria-hidden="true">↓</i></a>
    </section>

    <section class="how" id="how">
      <div class="wrap">
        <div class="sec-k"><span>01</span><h2>How to play</h2></div>
        <div class="how-grid">
          <article class="how-card">${ART_BAG}<div><h3><em>1</em>Grab a bag</h3><p>Your coins start exposed: they bleed every 6 hours and freeze at Q-Day.</p></div></article>
          <article class="how-card">${ART_VAULT}<div><h3><em>2</em>Build a vault</h3><p>Only a quantum safe key can open it, and only vaults can fight.</p></div></article>
          <article class="how-card">${ART_RAID}<div><h3><em>3</em>Raid and defend</h3><p>Raid rivals, defend your bag, hit Satoshi. Biggest vault at Q-Day wins.</p></div></article>
        </div>
      </div>
    </section>

    <section class="board5">
      <div class="wrap">
        <div class="sec-k"><span>02</span><h2>Top vaults</h2></div>
        <ol class="top5" id="top5"><li><span class="rk"></span><span></span><span class="nm" style="color:var(--dim)">Reading the chain…</span><span></span></li></ol>
        <p class="share-line" id="share"></p>
      </div>
    </section>

    <footer class="foot2">
      <div class="wrap">
        <span class="q">Q<span>-</span>DAY</span>
        <span>Built at NEAR HACKATHON</span>
        <a href="/proof" data-link>Under the hood</a>
        <a href="${REPO}" target="_blank" rel="noopener">GitHub ↗</a>
        <span>Also by the same team: Offmap</span>
      </div>
    </footer>`;

  const core = document.createElement("div");
  core.className = "t-core";
  core.innerHTML = `<b id="t-share">·</b><span>in vaults</span>`;
  const radar = new Radar(root.querySelector<HTMLElement>("#t-radar")!, core, { interactive: false, max: 22 });
  let qday = 0;

  const stop = poll(async () => {
    try {
      const s = await getStats();
      syncClock(s.now_ms);
      qday = Number(s.q_day_ms);
      root.querySelector("#t-share")!.textContent = pct(s.vault_share_bps).replace(/\.\d+%$/, "%");
      const n = await getHolderCount();
      const pages = await Promise.all(Array.from({ length: Math.max(1, Math.ceil(n / 200)) }, (_, i) => getHolders(i * 200, 200)));
      const holders: Holder[] = pages.flat().filter((h) => BigInt(h.balance) > 0n);
      const frozen = s.after_q_day;
      radar.set(holders.map<Blip>((h) => ({
        id: h.account, name: nameOf(h.account), kind: h.kind, balance: BigInt(h.balance),
        state: frozen && h.kind === "exposed" ? "frozen" : h.under_raid ? "busy" : "idle", shielded: h.shield_bps > 0, npc: isNpc(h.account),
      })));
      const vaults = holders.filter((h) => h.kind === "vault").sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1));
      root.querySelector("#top5")!.innerHTML = vaults.slice(0, 5).map((h, i) => `<li><span class="rk">${i + 1}</span><span class="av">${avatar(h.account)}</span><span class="nm">${esc(nameOf(h.account))}${isNpc(h.account) ? `<span class="tag">NPC</span>` : ""}</span><span class="bg">${full(h.balance)}</span></li>`).join("");
      const vt = BigInt(s.vault_tokens);
      const npc = vaults.filter((h) => isNpc(h.account)).reduce((a, h) => a + BigInt(h.balance), 0n);
      const npcShare = vt > 0n ? Number((npc * 10000n) / vt) : 0;
      root.querySelector("#share")!.innerHTML = `<b>${pct(s.vault_share_bps)}</b> of all held coins sit in vaults; <b>${pct(npcShare)}</b> of that is NPC bots.`;
    } catch {
      const t = root.querySelector("#t-cd");
      if (t && !qday) t.textContent = "can't reach NEAR right now";
    }
  }, 15000);
  const t = window.setInterval(() => {
    if (!qday) return;
    const el = root.querySelector("#t-cd");
    if (el) el.textContent = qday - chainNow() > 0 ? longClock(qday - chainNow()) : "now. Exposed coins are frozen.";
  }, 1000);
  return () => { stop(); clearInterval(t); document.body.classList.remove("on-title"); };
}
