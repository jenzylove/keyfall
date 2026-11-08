import * as chain from "../chain";
import { accountLink, fmtNear, fmtTokens, type Holder, type Params, type Raid, type Stats, type FeedItem } from "../chain";
import { $, $$, FAIL, act, ago, chainNow, clockText, esc, failIn, isNpc, maybe, poll, sentence, short, syncClock, tagsFor, text, unitsToNumber, wholeToUnits } from "../ui/dom";
import { countTo, countdown, crawl, type Countdown } from "../ui/widgets";
import { Bleed } from "../ui/bleed";
import { pct, bigParam, numParam } from "../ui/params";
import { restoreForm, vaultForm } from "../ui/vaultform";
import { explainRaid } from "../../npc/rules.mjs";

const bps = (x: bigint, b: number | bigint) => (x * BigInt(b)) / 10000n;
const isqrt = (n: bigint) => { if (n < 2n) return n; let x = BigInt(Math.floor(Math.sqrt(Number(n)))); while (x * x > n) x--; while ((x + 1n) * (x + 1n) <= n) x++; return x; };
const minB = (a: bigint, b: bigint) => (a < b ? a : b);
const maxB = (a: bigint, b: bigint) => (a > b ? a : b);
const tick = () => {
  // Ask the NPCs to look now, and again after the function throttle (20 s) so a fresh bag is always seen.
  const once = () => fetch("/api/tick", { method: "POST" }).catch(() => {});
  once();
  setTimeout(once, 25_000);
};

const LS_RAIDS = "qday.myraids.v1";
function myRaidIds(vault: string): string[] {
  try { return (JSON.parse(localStorage.getItem(LS_RAIDS) || "{}")[vault] || []).slice(-20); } catch { return []; }
}
function rememberRaid(vault: string, id: string) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_RAIDS) || "{}");
    all[vault] = [...new Set([...(all[vault] || []), id])].slice(-20);
    localStorage.setItem(LS_RAIDS, JSON.stringify(all));
  } catch {}
}

interface World {
  ok: boolean;
  stats: Stats | null;
  config: Params | null;
  wallet: Holder | null;
  vault: Holder | null;
  walletBal: bigint;
  vaultBal: bigint;
  walletNear: bigint | null;
  vaultNear: bigint | null;
  holders: Holder[] | null;
  open: Raid[] | null;
  feed: FeedItem[] | null;
  myRaids: Raid[];
  incoming: Raid | null;
}

export function play(root: HTMLElement) {
  root.innerHTML = `
    <div id="crawl-slot"></div>
    <div class="wrap"><div class="status" id="status">
      <div><span class="label">You</span><span class="state" id="st-state">·</span></div>
      <div><span class="label">Bag</span><span class="sv" id="st-bal">·</span></div>
      <div><span class="label">NEAR left</span><span class="sv" id="st-near">·</span></div>
      <div><span class="label">Shield</span><span class="sv" id="st-shield">·</span></div>
      <div><span class="label">Raids left</span><span class="sv" id="st-raids">·</span></div>
      <div><span class="label">Epoch ends in</span><span class="sv" id="st-epoch" data-until="">·</span></div>
    </div></div>
    <section id="alert"></section>
    <section class="wrap bag" id="bag">
      <div style="display:grid;gap:14px">
        <span class="label" id="bag-label">Your bag</span>
        <div class="bag-amt" id="bag-amt">·</div>
        <p class="bag-note" id="bag-note"></p>
      </div>
      <div class="bag-canvas"><canvas id="bag-cv"></canvas></div>
    </section>
    <section id="onb"></section>
    <section id="game"></section>`;

  const cr = crawl("Live feed");
  $("#crawl-slot", root).replaceWith(cr.el);
  const bleed = new Bleed($<HTMLCanvasElement>("#bag-cv", root), "bag");
  let alive = true;
  let w: World = { ok: false, stats: null, config: null, wallet: null, vault: null, walletBal: 0n, vaultBal: 0n, walletNear: null, vaultNear: null, holders: null, open: null, feed: null, myRaids: [], incoming: null };
  let mode = "";
  let alertCd: Countdown | null = null;
  let alertKey = "";
  let refreshing: Promise<void> | null = null;

  const sess = () => chain.session();
  const mine = () => [sess().wallet?.accountId, sess().vault?.accountId].filter(Boolean) as string[];

  // ---------------------------------------------------------------- data

  async function load(): Promise<void> {
    const s = sess();
    const safe = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };
    const [stats, config, wallet, vault, walletNear, vaultNear, feed, open] = await Promise.all([
      safe(chain.getStats()),
      w.config ? Promise.resolve(w.config) : safe(chain.getConfig()),
      s.wallet ? safe(chain.getHolder(s.wallet.accountId)) : Promise.resolve(null),
      s.vault ? safe(chain.getHolder(s.vault.accountId)) : Promise.resolve(null),
      s.wallet ? safe(chain.nearBalance(s.wallet.accountId)) : Promise.resolve(null),
      s.vault ? safe(chain.nearBalance(s.vault.accountId)) : Promise.resolve(null),
      safe(chain.getFeed(30)),
      safe(chain.getOpenRaids()),
    ]);
    let holders: Holder[] | null = null;
    if (s.vault) {
      try {
        const n = await chain.getHolderCount();
        const pages = await Promise.all(Array.from({ length: Math.ceil(n / 200) }, (_, i) => chain.getHolders(i * 200, 200)));
        holders = pages.flat();
      } catch { holders = null; }
    }
    let myRaids: Raid[] = [];
    if (s.vault) {
      const ids = new Set(myRaidIds(s.vault.accountId));
      for (const r of open || []) if (r.attacker === s.vault.accountId) ids.add(String(r.id));
      myRaids = (await Promise.all([...ids].map((id) => safe(chain.getRaid(id))))).filter(Boolean) as Raid[];
      myRaids.sort((a, b) => b.id - a.id);
    }
    const target = vault?.under_raid ?? wallet?.under_raid ?? null;
    const incoming = target ? await safe(chain.getRaid(target)) : null;
    if (stats) syncClock(stats.now_ms);
    w = {
      ok: !!stats,
      stats, config, wallet, vault,
      walletBal: wallet ? BigInt(wallet.balance) : 0n,
      vaultBal: vault ? BigInt(vault.balance) : 0n,
      walletNear, vaultNear, holders, open, feed, myRaids, incoming,
    };
  }

  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try { await load(); } finally { refreshing = null; }
      if (alive) render();
    })();
    return refreshing;
  }

  // ---------------------------------------------------------------- render

  function step(): number {
    const s = sess();
    if (!s.wallet && !s.vault) return 1;
    if (!s.vault) return w.walletBal > 0n ? 3 : 2;
    if (w.vaultBal === 0n && w.walletBal > 0n) return 4;
    return 0;
  }

  function render() {
    const s = sess();
    // crawl
    cr.set(w.feed ? w.feed.map((f) => sentence(f, mine(), true)) : null);
    renderStatus();
    renderBag();
    renderAlert();
    const over = Boolean(w.stats?.after_q_day);
    const st = step();
    const m = over ? (st ? "over" : "over-game") : st ? `onb${st}` : "game";
    if (m !== mode) {
      mode = m;
      $("#onb", root).innerHTML = "";
      $("#game", root).innerHTML = "";
      if (over) $("#onb", root).innerHTML = `<div class="wrap onb-grid"><div class="step fadein"><span class="count">Season 1 is over</span><h2 class="display h2">Q-Day has come.</h2>
        <p class="lede">Every exposed bag is frozen for good. Raids, the harvest and Satoshi have stopped. Vaults keep their tokens and can still trade and transfer.</p>
        <p class="lede"><a href="/proof" data-link>See the season result and every check →</a></p></div></div>`;
      if (st && over) return;
      if (st) buildOnboarding(st);
      else buildGame();
    }
    if (!st) updateGame();
    else updateOnboarding(st);
    void s;
  }

  function renderStatus() {
    const s = sess();
    const stEl = $("#st-state", root);
    if (!w.ok) {
      for (const id of ["#st-state", "#st-bal", "#st-near", "#st-shield", "#st-raids", "#st-epoch"]) failIn(maybe(id, root));
      return;
    }
    const inVault = !!s.vault;
    stEl.innerHTML = inVault ? '<span class="yel">VAULT</span>' : s.wallet ? '<span class="red">EXPOSED</span>' : '<span class="dim">NOT JOINED</span>';
    text($("#st-bal", root), s.vault || s.wallet ? `${fmtTokens(inVault ? w.vaultBal : w.walletBal)} $QDAY` : "none");
    const nearV = inVault ? w.vaultNear : w.walletNear;
    if (s.vault || s.wallet) {
      if (nearV === null) failIn($("#st-near", root));
      else text($("#st-near", root), `${fmtNear(nearV)} NEAR`);
    } else text($("#st-near", root), "none");
    text($("#st-shield", root), w.vault ? pct(w.vault.shield_bps) : "none");
    text($("#st-raids", root), w.vault ? `${w.vault.raids_left} of ${w.config ? numParam(w.config, "max_raids_per_epoch") : "·"}` : "none");
    $("#st-epoch", root).dataset.until = w.stats!.epoch_ends_ms;
  }

  function renderBag() {
    const s = sess();
    const amt = $("#bag-amt", root);
    $("#bag", root).hidden = false;
    const note = $("#bag-note", root);
    if (!w.ok) { failIn(amt); note.textContent = ""; return; }
    if (w.vaultBal > 0n || (s.vault && w.walletBal === 0n)) {
      text($("#bag-label", root), "Your vault");
      countTo(amt, unitsToNumber(w.vaultBal), (n) => Math.round(n).toLocaleString("en-US"));
      const vt = w.config ? pct(numParam(w.config, "vault_take_bps")) : "a small share";
      note.innerHTML = `Safe from the harvest and from Q-Day. A raid can still take ${vt} unless you defend.${w.walletBal > 0n ? ` <span class="red">${fmtTokens(w.walletBal)} still exposed in your wallet.</span>` : ""}`;
      bleed.setBag(w.vaultBal > 0n ? "vault" : "none", fillFor(w.vaultBal));
    } else if (w.walletBal > 0n) {
      text($("#bag-label", root), "Your bag, exposed");
      countTo(amt, unitsToNumber(w.walletBal), (n) => Math.round(n).toLocaleString("en-US"));
      note.innerHTML = `<span class="red">Your bag is exposed.</span> It bleeds every epoch and freezes at Q-Day.`;
      bleed.setBag("exposed", fillFor(w.walletBal));
    } else {
      $("#bag", root).hidden = !s.wallet;
      text($("#bag-label", root), "Your bag");
      amt.textContent = "0";
      note.textContent = s.wallet ? "Empty. Buy a bag to start." : "No bag yet. Join to get one.";
      bleed.setBag("none", 0.6);
    }
  }
  const fillFor = (x: bigint) => Math.min(1, Math.max(0.15, Math.log10(Math.max(1, unitsToNumber(x))) / 6.3));

  // ---------------------------------------------------------------- alert

  function renderAlert() {
    const host = $("#alert", root);
    const r = w.incoming;
    const s = sess();
    if (!r || r.status !== "open") {
      document.body.classList.remove("alert");
      if (alertKey) { host.innerHTML = ""; alertKey = ""; alertCd?.stop(); alertCd = null; }
      return;
    }
    document.body.classList.add("alert");
    const exposed = r.target_kind === "exposed";
    const closed = Number(r.deadline) < chainNow();
    const key = `${r.id}:${closed}:${exposed}:${!!s.vault}`;
    const c = w.config;
    const tgt = exposed ? w.wallet : w.vault;
    let lose = "·";
    if (c && tgt) {
      const raw = bps(bps(BigInt(tgt.balance), exposed ? numParam(c, "take_bps") : numParam(c, "vault_take_bps")), 10000 - tgt.shield_bps);
      lose = fmtTokens(minB(raw, BigInt(r.stake) * BigInt(numParam(c, "stake_mult"))));
    }
    if (key === alertKey) {
      text(maybe("#al-lose", host), lose);
      return;
    }
    alertKey = key;
    alertCd?.stop();
    const why = isNpc(r.attacker) ? explainRaid(r, { balance: tgt?.balance, shield_bps: tgt?.shield_bps }) : "";
    host.innerHTML = `
      <div class="alert-band"><div class="wrap alert-inner">
        <div style="display:grid;gap:18px">
          <p class="eyebrow"><span class="dot"></span>Alert · raid ${r.id}</p>
          <h2 class="display h2">${closed ? "The window closed" : exposed ? "You are being raided" : "Your vault is under raid"}</h2>
          <div id="al-cd"></div>
          <div class="calc">
            <div><span>Raider</span><b>${esc(short(r.attacker, 24))}${isNpc(r.attacker) ? '<span class="tag npc">NPC</span>' : ""}</b></div>
            <div><span>Their stake</span><b>${fmtTokens(r.stake)}</b></div>
            <div><span>You would lose</span><b id="al-lose">${lose}</b></div>
          </div>
          ${why ? `<p class="msg" style="color:#f6e9e6;opacity:.8">${esc(why)}</p>` : ""}
        </div>
        <div style="display:grid;gap:16px" id="al-act"></div>
      </div></div>`;
    alertCd = countdown($("#al-cd", host), { compact: true, onZero: () => refresh() });
    alertCd.set(Number(r.deadline));
    const actHost = $("#al-act", host);
    if (closed) {
      actHost.innerHTML = `<p>Anyone can settle it now.</p><div><button class="btn hot wide" id="al-go">Settle raid ${r.id}</button></div><p class="msg" id="al-msg"></p>`;
      const b = $<HTMLButtonElement>("#al-go", actHost);
      b.onclick = () => act(b, $("#al-msg", actHost), () => chain.resolve(r.id), () => "Settled.").then(() => refresh());
    } else if (!exposed) {
      actHost.innerHTML = `<p>Defend now and the raider's stake is yours, minus a burn.</p><div><button class="btn wide" id="al-go">Defend <span class="arrow">→</span></button></div><p class="msg" id="al-msg"></p>`;
      const b = $<HTMLButtonElement>("#al-go", actHost);
      b.onclick = () => act(b, $("#al-msg", actHost), () => chain.defend(r.id), () => "Defended. The stake is yours.").then(() => refresh());
    } else if (s.vault) {
      actHost.innerHTML = `<p>An exposed wallet cannot defend. It can run: move the bag into your vault and the raid takes nothing from it.</p><div><button class="btn wide" id="al-go">Escape: migrate now <span class="arrow">→</span></button></div><p class="msg" id="al-msg"></p>`;
      const b = $<HTMLButtonElement>("#al-go", actHost);
      b.onclick = () => act(b, $("#al-msg", actHost), () => chain.migrate(), () => "Escaped. Your bag is in the vault.").then(() => refresh());
    } else {
      actHost.innerHTML = `<p>An exposed wallet cannot defend. Make a quantum vault and move the bag in before the clock runs out.</p><div id="al-form" style="display:grid;gap:18px"></div>`;
      vaultForm($("#al-form", actHost), { button: "Escape: migrate now", migrateAfter: true, onDone: () => { tick(); refresh(); } });
    }
  }

  // ---------------------------------------------------------------- onboarding

  let buyNear = 1;
  function buildOnboarding(st: number) {
    const host = $("#onb", root);
    const bars = [1, 2, 3, 4].map((i) => `<i class="${i < st ? "done" : i === st ? "now" : ""}"></i>`).join("");
    const head = (t: string) => `<div class="steps" aria-label="Step ${st} of 4">${bars}</div><span class="count">Step ${st} of 4</span><h2 class="display h2">${t}</h2>`;
    let body = "";
    if (st === 1) {
      body = `${head("Join")}
        <p class="lede">Get a free testnet wallet. No sign up, no app, no popups.</p>
        <div><button class="btn" id="ob-go">Join the game <span class="arrow">→</span></button></div>
        <p class="msg" id="ob-msg"></p>
        <details class="faq" style="border:0"><summary style="font-size:20px">Already have a vault? Restore it</summary><div id="ob-restore" style="display:grid;gap:14px;padding-bottom:12px"></div></details>`;
    } else if (st === 2) {
      body = `${head("Buy a bag")}
        <p class="lede">You are in as <b class="break">${esc(sess().wallet?.accountId || "")}</b>. Pick how much testnet NEAR to spend.</p>
        <div class="choice" role="group" aria-label="NEAR to spend">${[0.5, 0.8, 1].map((n) => `<button type="button" data-n="${n}" aria-pressed="${n === buyNear}">${n} NEAR</button>`).join("")}</div>
        <p>You get about <b id="ob-quote">·</b> $QDAY.</p>
        <div><button class="btn" id="ob-go">Buy for <span id="ob-n">${buyNear}</span> NEAR <span class="arrow">→</span></button></div>
        <p class="msg" id="ob-msg"></p>`;
    } else if (st === 3) {
      body = `${head("Make your quantum vault")}
        <p class="lede">Your vault is a new NEAR account whose only key is quantum safe. The key was made in this browser and never leaves it.</p>
        <p class="tx">It costs 0.3 NEAR from your wallet, which pays the vault's own fees.</p>
        <div id="ob-form" style="display:grid;gap:20px"></div>`;
    } else {
      body = `${head("Migrate")}
        <p class="lede">Move your bag into the vault. From then on, the harvest pays you instead of bleeding you.</p>
        <div><button class="btn" id="ob-go">Move my bag in <span class="arrow">→</span></button></div>
        <p class="msg" id="ob-msg"></p>`;
    }
    const plan = [
      ["Join", "A free testnet wallet, made in this browser."],
      ["Buy", "A bag of $QDAY. It starts exposed and bleeds."],
      ["Vault", "A new account whose only key is quantum safe."],
      ["Migrate", "Move the bag in. Now you raid, shield and hit Satoshi."],
    ];
    host.innerHTML = `<div class="wrap onb-grid"><div class="step fadein">${body}</div>
      <ol class="plan" aria-label="The four steps">${plan.map(([t, d], i) => `<li class="${i + 1 < st ? "done" : i + 1 === st ? "now" : ""}"><span class="pn">0${i + 1}</span><span><b>${t}</b><span class="dim">${d}</span></span></li>`).join("")}</ol></div>`;
    const go = maybe<HTMLButtonElement>("#ob-go", host);
    const msg = maybe("#ob-msg", host);
    if (st === 1) {
      go!.onclick = () => act(go!, msg, async () => { const r = await chain.join(); return r as any; }, () => "Wallet ready.").then(() => refresh());
      restoreForm($("#ob-restore", host), { onDone: () => refresh() });
    } else if (st === 2) {
      for (const b of $$<HTMLButtonElement>(".choice button", host))
        b.onclick = () => {
          buyNear = Number(b.dataset.n);
          for (const x of $$<HTMLButtonElement>(".choice button", host)) x.setAttribute("aria-pressed", String(x === b));
          text($("#ob-n", host), String(buyNear));
          quote();
        };
      const quote = async () => {
        const q = $("#ob-quote", host);
        try { const v = await chain.quoteBuy(chain.nearToYocto(buyNear)); text(q, v ? fmtTokens(v) : "none, the market is at its cap"); } catch { failIn(q); }
      };
      quote();
      go!.onclick = () => act(go!, msg, () => chain.buy(buyNear), () => "Bought.").then((r) => { if (r) tick(); refresh(); });
    } else if (st === 3) {
      vaultForm($("#ob-form", host), { button: "Create my vault", onDone: () => { tick(); refresh(); } });
    } else {
      go!.onclick = () => act(go!, msg, () => chain.migrate(), () => "Moved. Your bag is quantum safe.").then(() => refresh());
    }
  }
  function updateOnboarding(_st: number) {}

  // ---------------------------------------------------------------- game

  let selected = "";
  let stakeTouched = false;
  let forgetArmed = false;

  function band(id: string, title: string, sub: string, body: string) {
    return `<section class="game-band wrap" id="${id}"><header><h2>${title}</h2><p>${sub}</p></header><div class="game-body">${body}</div></section>`;
  }

  function buildGame() {
    const host = $("#game", root);
    host.innerHTML = [
      band("g-raid", "Raid", "Pick a target, lock a stake. If they don't defend in time, you take a share of their bag.", `
        <ul class="targets" id="tg-list"><li class="dim" style="padding:14px 0">reading the chain…</li></ul>
        <div class="field"><label class="label" for="tg-stake">Stake, $QDAY</label><div class="input-wrap"><input id="tg-stake" class="input" inputmode="decimal" autocomplete="off" /><span class="suffix" id="tg-stake-hint"></span></div></div>
        <div class="calc" id="tg-calc"></div>
        <div><button class="btn hot" id="tg-go" disabled>Raid <span class="arrow">→</span></button></div>
        <p class="msg" id="tg-msg"></p>
        <div><span class="label">Your raids</span><ul class="mine" id="my-raids"></ul></div>`),
      band("g-boss", "Satoshi", "An exposed stash that can never move or defend. Every vault may hit it once an epoch.", `
        <div class="calc"><div><span>Stash</span><span class="big" id="bs-stash">·</span></div><div><span>One hit takes</span><b id="bs-hit">·</b></div><div><span>You keep</span><b id="bs-gain">·</b></div><div><span>Status</span><b id="bs-ready">·</b></div></div>
        <div><button class="btn" id="bs-go">Hit Satoshi <span class="arrow">→</span></button></div><p class="msg" id="bs-msg"></p>`),
      band("g-shield", "Shield", "Burn a slice of your bag for a shield that lasts to the end of the epoch. Strength is the square root of the share you burn.", `
        <div class="field"><label class="label" for="sh-range">Burn <b id="sh-pct">4%</b> of your bag</label><input type="range" id="sh-range" min="25" max="900" step="25" value="400" /></div>
        <div class="calc"><div><span>Burn</span><b id="sh-amt">·</b></div><div><span>Shield</span><span class="big" id="sh-str">·</span></div><div><span>Now</span><b id="sh-now">·</b></div></div>
        <div><button class="btn" id="sh-go">Charge shield <span class="arrow">→</span></button></div><p class="msg" id="sh-msg"></p>`),
      band("g-market", "Market", "Buy more straight into your vault, or sell for testnet NEAR.", `
        <span class="label">Buy</span>
        <div class="choice" role="group" aria-label="NEAR to spend">${[0.5, 1, 2].map((n) => `<button type="button" data-n="${n}" aria-pressed="${n === 1}">${n} NEAR</button>`).join("")}</div>
        <p class="msg" id="mk-buy-q"></p>
        <div><button class="btn small" id="mk-buy">Buy <span class="arrow">→</span></button></div><p class="msg" id="mk-buy-msg"></p>
        <span class="label" style="margin-top:12px">Sell</span>
        <div class="input-wrap"><input id="mk-sell-amt" class="input" inputmode="decimal" placeholder="$QDAY to sell" autocomplete="off" /><span class="suffix"><button type="button" class="link-btn" id="mk-max" style="pointer-events:auto;padding:0">max</button></span></div>
        <p class="msg" id="mk-sell-q"></p>
        <div><button class="btn small" id="mk-sell">Sell <span class="arrow">→</span></button></div><p class="msg" id="mk-sell-msg"></p>`),
      `<div id="g-harvest-slot"></div>`,
      band("g-open", "Open raids", "Every raid still running across the game. Once a window closes, anyone can settle it.", `<ul class="mine" id="op-list"></ul>`),
      band("g-feed", "Feed", "The latest moves, newest first, read from the contract.", `<ul class="feed" id="fd-list"></ul>`),
      band("g-keys", "Your keys", "What controls your vault, read live from NEAR.", `
        <ul class="keys" id="ky-list"></ul>
        <p class="tx">The recovery code is sealed on this device and can't be shown again. Your saved copy is the only one.</p>
        <details class="faq"><summary style="font-size:20px">Restore a vault from a code</summary><div id="ky-restore" style="display:grid;gap:14px;padding-bottom:14px"></div></details>
        <div><button class="link-btn" id="ky-forget">Forget this device</button></div><p class="msg" id="ky-msg"></p>`),
    ].join("");

    // raid
    const stake = $<HTMLInputElement>("#tg-stake", host);
    stake.addEventListener("input", () => { stakeTouched = true; updateRaidCalc(); });
    $("#tg-list", host).addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.t");
      if (!b || b.disabled) return;
      selected = b.dataset.acct || "";
      stakeTouched = false;
      updateRaid();
    });
    const rg = $<HTMLButtonElement>("#tg-go", host);
    rg.onclick = () => {
      const amt = wholeToUnits(stake.value);
      if (!amt || !selected) return;
      const tgt = selected;
      act(rg, $("#tg-msg", host), () => chain.raid(tgt, amt.toString()), (r: any) => {
        const id = String(r?.value ?? "");
        if (id && sess().vault) rememberRaid(sess().vault!.accountId, id);
        selected = "";
        return `Raid ${id} launched on ${esc(short(tgt))}.`;
      }).then(() => refresh());
    };
    $("#my-raids", host).addEventListener("click", onRaidAction);
    $("#op-list", host).addEventListener("click", onRaidAction);

    // boss
    const bg = $<HTMLButtonElement>("#bs-go", host);
    bg.onclick = () => act(bg, $("#bs-msg", host), () => chain.bossRaid(), (r: any) => `You took ${fmtTokens(String(r?.value ?? "0"))} from Satoshi.`).then(() => refresh());

    // shield
    const range = $<HTMLInputElement>("#sh-range", host);
    range.addEventListener("input", updateShield);
    const sg = $<HTMLButtonElement>("#sh-go", host);
    sg.onclick = () => {
      const amt = bps(w.vaultBal, Number(range.value));
      act(sg, $("#sh-msg", host), () => chain.chargeShield(amt.toString()), (r: any) => `Shield up: ${pct(Number(r?.value ?? 0))} until the epoch ends.`).then(() => refresh());
    };

    // market
    let mkNear = 1;
    for (const b of $$<HTMLButtonElement>("#g-market .choice button", host))
      b.onclick = () => {
        mkNear = Number(b.dataset.n);
        for (const x of $$<HTMLButtonElement>("#g-market .choice button", host)) x.setAttribute("aria-pressed", String(x === b));
        buyQuote();
      };
    const buyQuote = async () => {
      const q = $("#mk-buy-q", host);
      try {
        const v = await chain.quoteBuy(chain.nearToYocto(mkNear));
        const fromVault = (w.vaultNear ?? 0n) >= BigInt(chain.nearToYocto(mkNear + 0.05));
        q.className = "msg";
        q.textContent = v ? `About ${fmtTokens(v)} $QDAY. ${fromVault ? "Paid from your vault." : sess().wallet ? "Paid from your wallet, then moved into the vault." : "Your vault needs more NEAR for this."}` : "The market is at its cap.";
      } catch { failIn(q); }
    };
    (host as any)._buyQuote = buyQuote;
    buyQuote();
    const mb = $<HTMLButtonElement>("#mk-buy", host);
    mb.onclick = () => act(mb, $("#mk-buy-msg", host), async () => {
      const fromVault = (w.vaultNear ?? 0n) >= BigInt(chain.nearToYocto(mkNear + 0.05));
      if (fromVault) return chain.buy(mkNear, "vault");
      if (!sess().wallet) throw new chain.ChainError("Your vault needs more NEAR for this buy.");
      await chain.buy(mkNear, "wallet");
      return chain.migrate();
    }, () => "Bought, and it's in your vault.").then(() => refresh());
    const sellAmt = $<HTMLInputElement>("#mk-sell-amt", host);
    const sellQuote = async () => {
      const q = $("#mk-sell-q", host);
      const a = wholeToUnits(sellAmt.value);
      if (!a || a === 0n) { q.textContent = ""; return; }
      try {
        const v = await chain.quoteSell(a.toString());
        const fee = w.config ? bps(a, numParam(w.config, "sell_fee_bps")) : 0n;
        q.className = "msg";
        q.textContent = v ? `About ${fmtNear(v)} NEAR. Fee ${fmtTokens(fee)} $QDAY, half burned, half to vaults.` : "The market can't buy that much back.";
      } catch { failIn(q); }
    };
    let sq = 0;
    sellAmt.addEventListener("input", () => { clearTimeout(sq); sq = window.setTimeout(sellQuote, 300); });
    $("#mk-max", host).onclick = () => { sellAmt.value = String(Math.floor(unitsToNumber(w.vaultBal))); sellQuote(); };
    const ms = $<HTMLButtonElement>("#mk-sell", host);
    ms.onclick = () => {
      const a = wholeToUnits(sellAmt.value);
      act(ms, $("#mk-sell-msg", host), async () => {
        if (!a || a === 0n) throw new chain.ChainError("Type how much to sell.");
        return chain.sell(a.toString(), "vault");
      }, () => "Sold.").then(() => { sellAmt.value = ""; sellQuote(); refresh(); });
    };

    // keys
    restoreForm($("#ky-restore", host), { onDone: () => { mode = ""; refresh(); } });
    const fg = $<HTMLButtonElement>("#ky-forget", host);
    fg.onclick = () => {
      if (!forgetArmed) {
        forgetArmed = true;
        fg.textContent = "Tap again to forget. Your code is the only way back.";
        setTimeout(() => { forgetArmed = false; fg.textContent = "Forget this device"; }, 6000);
        return;
      }
      chain.forget();
      mode = "";
      refresh();
    };
    loadKeys();
  }

  async function loadKeys() {
    const el = maybe("#ky-list", root);
    const s = sess();
    if (!el) return;
    const rows: string[] = [];
    if (s.vault) {
      try {
        const keys = await chain.keyList(s.vault.accountId);
        const pq = keys.filter((k) => k.public_key.startsWith("ml-dsa-65")).length;
        rows.push(`<li><span class="label">Vault</span><a href="${accountLink(s.vault.accountId)}" target="_blank" rel="noopener">${esc(s.vault.accountId)} ↗</a></li>`);
        rows.push(`<li><span class="label">Keys on the vault: ${keys.length}${keys.length === 1 && pq === 1 ? ", quantum only" : ""}</span>${keys.map((k) => `<span><span class="${k.public_key.startsWith("ml-dsa-65") ? "okmark" : "badmark"}">${k.public_key.startsWith("ml-dsa-65") ? "ml-dsa-65" : esc(k.public_key.split(":")[0])}</span> <span class="dim">${esc(k.public_key.slice(0, 40))}…</span></span>`).join("")}</li>`);
      } catch {
        rows.push(`<li><span class="label">Vault</span><span>${esc(s.vault.accountId)}</span><span class="fail-inline">${FAIL}</span></li>`);
      }
    }
    if (s.wallet) rows.push(`<li><span class="label">Exposed wallet, ed25519</span><a href="${accountLink(s.wallet.accountId)}" target="_blank" rel="noopener">${esc(s.wallet.accountId)} ↗</a></li>`);
    el.innerHTML = rows.join("");
  }

  function onRaidAction(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!b) return;
    const id = b.dataset.id!;
    const out = b.closest("li")?.querySelector<HTMLElement>(".msg") || null;
    if (b.dataset.act === "settle") act(b, out, () => chain.resolve(id), (r: any) => `Settled. Take: ${fmtTokens(String(r?.value ?? "0"))}.`).then(() => refresh());
    if (b.dataset.act === "share") {
      const url = `${location.origin}/d/${id}`;
      navigator.clipboard?.writeText(url).then(() => { if (out) { out.className = "msg ok"; out.textContent = `Copied ${url}`; } }, () => { if (out) { out.className = "msg"; out.textContent = url; } });
      if (!navigator.clipboard && out) out.textContent = url;
    }
  }

  function updateGame() {
    updateRaid();
    updateBoss();
    updateShield();
    updateHarvest();
    updateOpen();
    updateFeed();
  }

  function eligibility(h: Holder): string {
    const c = w.config!;
    const now = chainNow();
    const me = w.vaultBal;
    if (w.stats?.after_q_day && h.kind === "exposed") return "frozen";
    if (h.under_raid) return "under raid";
    if (Number(h.immune_until) > now) return `immune ${clockText(Number(h.immune_until) - now)}`;
    if (BigInt(h.balance) < bigParam(c, "min_target_balance")) return "too small to raid";
    if (BigInt(h.balance) * BigInt(numParam(c, "punch_down_band")) < me) return "no punching down";
    return "";
  }

  function rawTake(h: Holder) {
    const c = w.config!;
    return bps(bps(BigInt(h.balance), h.kind === "vault" ? numParam(c, "vault_take_bps") : numParam(c, "take_bps")), 10000 - h.shield_bps);
  }

  function updateRaid() {
    const list = maybe("#tg-list", root);
    if (!list) return;
    if (!w.holders || !w.config) { failIn(list); return; }
    const own = mine();
    const ts = w.holders.filter((h) => !own.includes(h.account)).sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1));
    if (selected && !ts.some((t) => t.account === selected && !eligibility(t))) selected = "";
    if (!ts.length) { list.innerHTML = `<li class="dim" style="padding:14px 0">Nobody else holds a bag yet. Share the game and come back.</li>`; }
    else
      list.innerHTML = ts.slice(0, 40).map((h) => {
        const why = eligibility(h);
        const imm = Number(h.immune_until) > chainNow();
        return `<li><button type="button" class="t ${h.kind}" data-acct="${esc(h.account)}" aria-pressed="${h.account === selected}" ${why ? "disabled" : ""}>
          <span class="nm">${esc(short(h.account, 26))}${tagsFor(h.account, h.kind)}</span><span class="bl">${fmtTokens(h.balance)}</span>
          <span class="sub">${h.kind === "vault" ? `shield ${pct(h.shield_bps)}` : "cannot defend"}${why ? ` · <span class="why">${esc(why)}</span>` : imm ? "" : " · open to raid"}</span>
        </button></li>`;
      }).join("");
    updateRaidCalc();
    renderMyRaids();
  }

  function updateRaidCalc() {
    const calc = maybe("#tg-calc", root);
    const stake = maybe<HTMLInputElement>("#tg-stake", root);
    const go = maybe<HTMLButtonElement>("#tg-go", root);
    if (!calc || !stake || !go || !w.config || !w.vault) return;
    const c = w.config;
    const min = bigParam(c, "min_stake");
    text(maybe("#tg-stake-hint", root), `min ${fmtTokens(min)}`);
    const t = w.holders?.find((h) => h.account === selected);
    if (!t) {
      calc.innerHTML = `<div><span class="dim">${w.vault.raids_left > 0 ? "Pick a target above." : "No raids left this epoch."}</span></div>`;
      go.disabled = true;
      return;
    }
    const raw = rawTake(t);
    const mult = BigInt(numParam(c, "stake_mult"));
    if (!stakeTouched) {
      const best = maxB(min, (raw + mult - 1n) / mult);
      stake.value = String(Math.ceil(unitsToNumber(minB(best, w.vaultBal))));
    }
    const s = wholeToUnits(stake.value) ?? 0n;
    const take = minB(raw, s * mult);
    const net = take - bps(take, numParam(c, "raid_burn_bps"));
    let err = "";
    if (s < min) err = `Stake at least ${fmtTokens(min)}.`;
    else if (s > w.vaultBal) err = "That is more than your bag.";
    else if (w.vault.raids_left <= 0) err = "No raids left this epoch.";
    calc.innerHTML = `
      <div><span>Target</span><b>${esc(short(t.account, 22))}</b></div>
      <div><span>Take if they don't stop you</span><span class="big">${fmtTokens(net)}</span></div>
      <div><span class="dim">${t.kind === "vault" ? pct(numParam(c, "vault_take_bps")) : pct(numParam(c, "take_bps"))} of their bag${t.shield_bps ? `, less a ${pct(t.shield_bps)} shield` : ""}, capped at ${numParam(c, "stake_mult")}× stake, after a ${pct(numParam(c, "raid_burn_bps"))} burn</span></div>
      <div><span>${t.kind === "vault" ? "If they defend" : "If they escape"}</span><b>${t.kind === "vault" ? "you lose the stake" : "you get the stake back"}</b></div>
      ${err ? `<div><span class="red">${err}</span></div>` : ""}`;
    go.disabled = !!err;
    go.innerHTML = `Raid ${esc(short(t.account, 14))} <span class="arrow">→</span>`;
  }

  function raidRow(r: Raid, mineSide: boolean) {
    const now = chainNow();
    const open = r.status === "open";
    const due = open && Number(r.deadline) < now;
    const status = open ? (due ? "window closed, ready to settle" : `open, <span data-until="${r.deadline}">${clockText(Number(r.deadline) - now)}</span> left`) : r.status === "defended" ? "defended, stake lost" : `settled, took ${fmtTokens(r.take)}`;
    const own = mine();
    return `<li>
      <div class="line1"><span>${mineSide ? "" : `${own.includes(r.attacker) ? "<b>you</b>" : esc(short(r.attacker))} → `}${own.includes(r.target) ? "<b>you</b>" : esc(short(r.target, 22))}${isNpc(r.target) ? '<span class="tag npc">NPC</span>' : ""} <span class="dim">#${r.id}</span></span><span>${fmtTokens(r.stake)} staked</span></div>
      <div class="line1"><span class="dim">${status}</span><span class="acts">
        ${open ? `<a href="/d/${r.id}" data-link class="link-btn">defend link</a><button class="link-btn" data-act="share" data-id="${r.id}">share</button>` : ""}
        ${due ? `<button class="btn small" data-act="settle" data-id="${r.id}">Settle</button>` : ""}
      </span></div><p class="msg"></p></li>`;
  }

  function renderMyRaids() {
    const el = maybe("#my-raids", root);
    if (!el) return;
    if (el.querySelector(".busy")) return;
    el.innerHTML = w.myRaids.length ? w.myRaids.map((r) => raidRow(r, true)).join("") : `<li class="dim">None yet.</li>`;
  }

  function updateBoss() {
    const c = w.config, s = w.stats, v = w.vault;
    if (!c || !s || !v) { for (const id of ["#bs-stash", "#bs-hit", "#bs-gain", "#bs-ready"]) failIn(maybe(id, root)); return; }
    const stash = BigInt(s.satoshi_tokens);
    const hit = minB(bps(stash, numParam(c, "boss_bps")), bigParam(c, "boss_cap"));
    countTo(maybe("#bs-stash", root), unitsToNumber(stash), (n) => Math.round(n).toLocaleString("en-US"));
    text(maybe("#bs-hit", root), `${fmtTokens(hit)} $QDAY`);
    text(maybe("#bs-gain", root), `${fmtTokens(hit - bps(hit, numParam(c, "boss_burn_bps")))} after a ${pct(numParam(c, "boss_burn_bps"))} burn`);
    const enough = w.vaultBal >= bigParam(c, "boss_min_balance");
    const r = maybe("#bs-ready", root);
    if (r) r.innerHTML = !enough ? `<span class="red">hold ${fmtTokens(bigParam(c, "boss_min_balance"))} to hit</span>` : v.boss_ready ? '<span class="yel">ready</span>' : `done, next in <span data-until="${s.epoch_ends_ms}">${clockText(Number(s.epoch_ends_ms) - chainNow())}</span>`;
    const b = maybe<HTMLButtonElement>("#bs-go", root);
    if (b && !b.classList.contains("busy")) b.disabled = !(enough && v.boss_ready);
  }

  function updateShield() {
    const c = w.config, v = w.vault, s = w.stats;
    const range = maybe<HTMLInputElement>("#sh-range", root);
    if (!c || !v || !range || !s) return;
    const share = Number(range.value);
    const amt = bps(w.vaultBal, share);
    const str = Math.min(Number(isqrt(BigInt(share) * 10000n)), numParam(c, "max_shield_bps"));
    text(maybe("#sh-pct", root), pct(share));
    text(maybe("#sh-amt", root), `${fmtTokens(amt)} $QDAY`);
    text(maybe("#sh-str", root), pct(str));
    const now = maybe("#sh-now", root);
    if (now) now.innerHTML = v.shield_bps ? `${pct(v.shield_bps)}, ends in <span data-until="${s.epoch_ends_ms}">${clockText(Number(s.epoch_ends_ms) - chainNow())}</span>` : "no shield";
    const b = maybe<HTMLButtonElement>("#sh-go", root);
    if (b && !b.classList.contains("busy")) b.disabled = amt === 0n || str <= v.shield_bps;
  }

  function updateHarvest() {
    const slot = maybe("#g-harvest-slot", root);
    if (!slot) return;
    if (!w.stats?.harvest_due) { if (slot.innerHTML && !slot.querySelector(".busy")) slot.innerHTML = ""; return; }
    if (slot.innerHTML) return;
    slot.innerHTML = band("g-harvest", "Harvest", "Due now. Anyone can run it.", `<p class="lede">Run the harvest: exposed bags bleed into vaults.</p><div><button class="btn" id="hv-go">Run the harvest <span class="arrow">→</span></button></div><p class="msg" id="hv-msg"></p>`);
    const b = $<HTMLButtonElement>("#hv-go", slot);
    b.onclick = () => act(b, $("#hv-msg", slot), () => chain.harvest(), (r: any) => `Harvested ${fmtTokens(String(r?.value ?? "0"))} from exposed bags.`).then(() => refresh());
  }

  function updateOpen() {
    const el = maybe("#op-list", root);
    if (!el || el.querySelector(".busy")) return;
    if (!w.open) { failIn(el); return; }
    el.innerHTML = w.open.length ? w.open.map((r) => raidRow(r, false)).join("") : `<li class="dim">No raids running right now.</li>`;
  }

  function updateFeed() {
    const el = maybe("#fd-list", root);
    if (!el) return;
    if (!w.feed) { failIn(el); return; }
    el.innerHTML = w.feed.length ? w.feed.map((f) => `<li><span class="ago">${ago(Number(f.at))}</span><span class="s">${sentence(f, mine())}</span></li>`).join("") : `<li><span></span><span class="dim">No moves yet.</span></li>`;
  }

  // ---------------------------------------------------------------- timers

  const clock = window.setInterval(() => {
    let due = false;
    for (const el of $$("[data-until]", root)) {
      const u = Number(el.dataset.until);
      if (!u) continue;
      const left = u - chainNow();
      el.textContent = clockText(left);
      if (left <= 0 && left > -1500) due = true;
    }
    if (due) refresh();
  }, 1000);

  const stop = poll(async () => { await chain.loadSession(); await refresh(); }, 5000);
  tick();
  // While the game is open, wake the NPCs once a minute: they settle closed raids,
  // run the harvest when it is due, and answer raids on their own vaults.
  const npcBeat = window.setInterval(() => fetch("/api/tick", { method: "POST" }).catch(() => {}), 60_000);

  return () => {
    alive = false;
    stop();
    clearInterval(clock);
    clearInterval(npcBeat);
    alertCd?.stop();
    bleed.destroy();
    document.body.classList.remove("alert");
  };
}
