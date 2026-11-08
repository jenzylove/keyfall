// The title screen: pixel logotype over the live radar, PLAY, how to play,
// the rivals, the high score table and a real footer. Every number is live.

import { getHolderCount, getHolders, getStats, type Holder } from "../chain";
import { REPO, chainNow, esc, poll, syncClock } from "../ui/dom";
import { Radar, type Blip } from "../ui/radar";
import { avatar, satoshiAvatar } from "../ui/avatars";
import { isNpc, nameOf } from "../ui/names";
import { full, pct } from "../ui/plain";
import { ART_BAG, ART_RAID, ART_VAULT, MARK, logotype } from "../ui/pixels";
import { RIVALS } from "../ui/lines";
import * as sfx from "../ui/sound";

const rivalArt = (who: string) =>
  who === "satoshi" ? satoshiAvatar()
  : who === "qubit" ? [1, 2, 3].map((n) => avatar(`qubit-0${n}.${import.meta.env.VITE_CONTRACT || "x"}`)).join("")
  : avatar(`${who}.${import.meta.env.VITE_CONTRACT || "x"}`);

export function landing(root: HTMLElement) {
  document.body.classList.add("on-title");
  root.innerHTML = `
    <section class="title" aria-label="Q-DAY">
      <div class="t-radar" id="t-radar"></div>
      <div class="t-copy">
        <h1 class="wordmark glitch">${logotype()}</h1>
        <p class="premise">Quantum computers just broke old crypto keys. Get your coins into a quantum vault, then raid everyone who didn't.</p>
        <a class="btn play pulse" href="/play" data-link id="t-play"><span class="tri" aria-hidden="true"></span>PLAY</a>
        <p class="t-cd"><span class="t-cd-k">Q-DAY IN</span><b id="t-cd">··</b></p>
        <p class="t-sub">Free · no wallet · NEAR testnet</p>
      </div>
      <a class="t-more" href="#how">How to play <i aria-hidden="true">▼</i></a>
    </section>

    <section class="sec how" id="how">
      <div class="wrap">
        <h2 class="sec-h"><span>01</span>How to play</h2>
        <div class="how-strip" id="how-strip">
          <article class="how-card"><div class="how-art bag">${ART_BAG}</div><h3>Grab a bag</h3><p>Your coins start exposed. They bleed every 6 hours and freeze for good at Q-Day.</p></article>
          <article class="how-card"><div class="how-art vault">${ART_VAULT}</div><h3>Build your vault</h3><p>Only a quantum safe key can open it. Only vaults can fight.</p></article>
          <article class="how-card"><div class="how-art raid">${ART_RAID}</div><h3>Raid and survive</h3><p>Raid rivals, defend your bag, hit Satoshi. Biggest vault at Q-Day wins.</p></article>
        </div>
        <div class="how-dots" aria-hidden="true"><i class="on"></i><i></i><i></i></div>
      </div>
    </section>

    <section class="sec rivals">
      <div class="wrap">
        <h2 class="sec-h"><span>02</span>Meet the rivals</h2>
        <ul class="rival-list">
          ${RIVALS.map((r) => `<li class="rival ${r.who}"><span class="rv-art">${rivalArt(r.who)}</span><div><b>${r.name}</b><p>${r.line}</p></div></li>`).join("")}
        </ul>
      </div>
    </section>

    <section class="sec scores">
      <div class="wrap">
        <h2 class="sec-h"><span>03</span>High scores</h2>
        <ol class="hs" id="hs"><li class="hs-wait">Reading the chain<span class="ell"></span></li></ol>
        <p class="share-line" id="share">&nbsp;</p>
      </div>
    </section>

    <footer class="foot">
      <div class="wrap">
        <div class="f-top">
          <a class="brand" href="/" data-link><span class="mark">${MARK}</span>Q-DAY</a>
          <nav class="f-nav">
            <a href="/play" data-link>Play</a>
            <a href="/proof" data-link>Under the hood</a>
            <a href="${REPO}" target="_blank" rel="noopener">GitHub ↗</a>
          </nav>
        </div>
        <p class="f-line">Built at NEAR HACKATHON on NEAR testnet. Every vault is a real account that only a quantum safe key controls.</p>
        <p class="f-line dim">Also by the same team: Offmap. MIT licence. Testnet coins have no value.</p>
      </div>
    </footer>`;

  const core = document.createElement("div");
  core.className = "t-core";
  core.innerHTML = `<b id="t-share">··</b><span>in vaults</span>`;
  const radar = new Radar(root.querySelector<HTMLElement>("#t-radar")!, core, { interactive: false, max: 18 });
  let qday = 0;

  // PLAY unlocks sound (the first tap) and plays the start chime.
  root.querySelector("#t-play")!.addEventListener("pointerdown", () => { sfx.unlock(); sfx.play("powerup"); }, { passive: true });
  // A quiet siren on the title, only once sound is already unlocked (returning visitors).
  if (sfx.isUnlocked()) setTimeout(() => sfx.play("siren"), 600);

  // dots under the how to play strip follow the scroll
  const strip = root.querySelector<HTMLElement>("#how-strip")!;
  const dots = [...root.querySelectorAll<HTMLElement>(".how-dots i")];
  strip.addEventListener("scroll", () => {
    const i = Math.round(strip.scrollLeft / Math.max(1, strip.firstElementChild!.getBoundingClientRect().width + 12));
    dots.forEach((d, k) => d.classList.toggle("on", k === Math.min(2, i)));
  }, { passive: true });

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
      const ord = (i: number) => (i === 1 ? "1ST" : i === 2 ? "2ND" : i === 3 ? "3RD" : `${i}TH`);
      root.querySelector("#hs")!.innerHTML = vaults.slice(0, 10).map((h, i) => `<li class="${i < 3 ? "top" : ""}"><span class="rk">${ord(i + 1)}</span><span class="av">${avatar(h.account)}</span><span class="nm">${esc(nameOf(h.account))}${isNpc(h.account) ? `<span class="tag">NPC</span>` : ""}</span><span class="dots"></span><span class="sc">${full(h.balance)}</span></li>`).join("") || `<li class="hs-wait">No vaults yet. Be the first.</li>`;
      const vt = BigInt(s.vault_tokens);
      const npc = vaults.filter((h) => isNpc(h.account)).reduce((a, h) => a + BigInt(h.balance), 0n);
      const npcShare = vt > 0n ? Number((npc * 10000n) / vt) : 0;
      root.querySelector("#share")!.innerHTML = `<b>${pct(s.vault_share_bps)}</b> of all coins are in vaults · <b>${pct(npcShare)}</b> of those are NPC bots`;
    } catch {
      const t = root.querySelector("#t-cd");
      if (t && !qday) t.textContent = "can't reach NEAR";
    }
  }, 15000);
  const tickCd = () => {
    if (!qday) return;
    const el = root.querySelector("#t-cd");
    if (!el) return;
    const left = qday - chainNow();
    if (left <= 0) { el.textContent = "NOW"; return; }
    const s = Math.floor(left / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    el.textContent = d > 0 ? `${d}D ${String(h).padStart(2, "0")}H` : `${h}H ${String(m).padStart(2, "0")}M`;
  };
  const t = window.setInterval(tickCd, 1000);
  return () => { stop(); clearInterval(t); document.body.classList.remove("on-title"); };
}
