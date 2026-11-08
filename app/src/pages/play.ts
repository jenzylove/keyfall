// /play: the game. One screen: HUD, mission card, radar, event cards, action bar.
// Every number is read from the chain through chain.ts; nothing is staged.

import * as chain from "../chain";
import { apiUrl, txLink, type FeedItem, type Holder, type Params, type Raid, type Stats } from "../chain";
import { ago, chainNow, esc, syncClock } from "../ui/dom";
import { Bleed } from "../ui/bleed";
import { Radar, type Blip, type RaidLine } from "../ui/radar";
import { avatar, satoshiAvatar } from "../ui/avatars";
import { isNpc, nameOf, suggestVaultName } from "../ui/names";
import { openSheet, currentSheet, type Sheet } from "../ui/sheet";
import { P, PB, clock, every, full, hudClock, minutes, pct, plainError, short, span, whole } from "../ui/plain";
import { explainRaid } from "../../npc/rules.mjs";

const bps = (x: bigint, b: number | bigint) => (x * BigInt(b)) / 10000n;
const isqrt = (n: bigint) => { if (n < 2n) return n; let x = BigInt(Math.floor(Math.sqrt(Number(n)))); while (x * x > n) x--; while ((x + 1n) * (x + 1n) <= n) x++; return x; };
const minB = (a: bigint, b: bigint) => (a < b ? a : b);
const maxB = (a: bigint, b: bigint) => (a > b ? a : b);
const NAME_RE = /^[a-z0-9]+([_-][a-z0-9]+)*$/;

/** Wake the NPCs now, and again after the function throttle so a fresh bag is seen. */
function tick(twice = true) {
  const once = () => fetch(apiUrl("/api/tick"), { method: "POST" }).catch(() => {});
  once();
  if (twice) setTimeout(once, 25_000);
}

// ------------------------------------------------------------------ local progress

interface Progress { stage?: "strike" | "done" | "free"; vault?: string; escapeId?: string; backedUp?: string; wantVault?: boolean; raids?: string[] }
const LS = "qday.game.v2";
function prog(): Progress { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch { return {}; } }
function setProg(p: Partial<Progress>) { try { localStorage.setItem(LS, JSON.stringify({ ...prog(), ...p })); } catch {} }

interface Receipt { kind: string; at: number; hash: string }
const LS_R = "qday.receipts.v1";
function receipts(): Receipt[] { try { return JSON.parse(localStorage.getItem(LS_R) || "[]"); } catch { return []; } }
function keepReceipt(kind: string, hash?: string) {
  if (!hash) return;
  try { localStorage.setItem(LS_R, JSON.stringify([...receipts(), { kind, at: chainNow(), hash }].slice(-60))); } catch {}
}

// ------------------------------------------------------------------ icons

const I = {
  raid: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5" stroke="currentColor" stroke-width="2.2"/></svg>`,
  shield: `<svg viewBox="0 0 24 24"><path d="M12 2.2 20.5 5.4v5.8c0 5.2-3.6 8.6-8.5 10.6-4.9-2-8.5-5.4-8.5-10.6V5.4Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 6v12" stroke="currentColor" stroke-width="2.2"/></svg>`,
  satoshi: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M9.5 6.5v11M12.5 6.5v11M8 8h5.5a2.5 2.5 0 0 1 0 5H8m0 0h6a2.5 2.5 0 0 1 0 5H8" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  market: `<svg viewBox="0 0 24 24"><path d="M3 17l5.5-5.5 4 4L21 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M15 7h6v6" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`,
  menu: `<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.2"/></svg>`,
  sun: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" stroke="currentColor" stroke-width="2"/></svg>`,
};

// ------------------------------------------------------------------ world

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
  holders: Holder[];
  open: Raid[];
  feed: FeedItem[];
  myRaids: Raid[];
  incoming: Raid | null;
  escape: Raid | null;
}

type Mission =
  | { k: "load" }
  | { k: "grab"; buyOnly: boolean }
  | { k: "exposed" }
  | { k: "build"; raid: Raid | null }
  | { k: "movein"; raid: Raid | null }
  | { k: "safe" }
  | { k: "strike" }
  | { k: "done" }
  | { k: "over" }
  | { k: "none" };

export function play(root: HTMLElement) {
  document.body.classList.add("in-game");
  root.innerHTML = `
    <div class="game">
      <header class="hud">
        <a class="hud-home" href="/" data-link aria-label="Q-DAY home"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="21" fill="none" stroke="#FFD60A" stroke-width="8"/><path d="M13 51L51 13" stroke="#FF3D2E" stroke-width="8" stroke-linecap="round"/></svg></a>
        <div class="hud-cell"><span class="hud-k">Q-Day in</span><span class="hud-v" id="h-qday">·</span></div>
        <div class="hud-cell bag"><span class="hud-k">Your bag</span><span class="hud-v"><span id="h-bag">·</span><span class="chip" id="h-chip"></span></span></div>
        <div class="hud-cell"><span class="hud-k">Rank</span><span class="hud-v" id="h-rank">·</span></div>
        <p class="hud-goal"><b>Goal</b>Hold the biggest vault when Q-Day hits</p>
        <button class="hud-menu" type="button" id="h-menu" aria-label="Menu">${I.menu}<i class="rdot" hidden></i></button>
      </header>
      <aside class="side left">
        <div class="mission-slot" id="mission"></div>
        <section class="stats panel" id="stats" aria-label="Your stats"></section>
      </aside>
      <main class="field" id="field">
        <p class="goal"><b>Goal</b> Hold the biggest vault when Q-Day hits</p>
        <div class="events" id="events" aria-live="polite"></div>
        <div class="field-msg" id="field-msg" hidden></div>
      </main>
      <nav class="actions" id="actions" aria-label="Moves">
        ${(["raid", "shield", "satoshi", "market"] as const).map((k) => `<button type="button" class="act" data-act="${k}"><span class="act-fill"></span><span class="act-ic">${I[k]}</span><span class="act-nm">${k}</span><span class="act-st" id="a-${k}">·</span></button>`).join("")}
      </nav>
      <aside class="side right">
        <section class="panel activity"><header><h2>Activity</h2><span class="live"><i></i>live</span></header><ul class="log" id="log"></ul></section>
      </aside>
    </div>`;

  const field = root.querySelector<HTMLElement>("#field")!;
  const missionEl = root.querySelector<HTMLElement>("#mission")!;
  // mission card lives in the left column on desktop, between HUD and field on phones (CSS grid areas)

  // centre: your bag
  const core = document.createElement("div");
  core.className = "core";
  core.innerHTML = `<canvas></canvas><span class="core-lab" id="core-lab">You</span>`;
  const bleed = new Bleed(core.querySelector("canvas")!, "bag");
  const radar = new Radar(field, core, { interactive: true, onTap: (id) => openRaid(id) });

  let alive = true;
  let w: World = { ok: false, stats: null, config: null, wallet: null, vault: null, walletBal: 0n, vaultBal: 0n, walletNear: null, vaultNear: null, holders: [], open: [], feed: [], myRaids: [], incoming: null, escape: null };
  let loaded = false;
  let busy = ""; // a flow in progress, by name
  let busyText = "";
  let lastFeed = -1;
  let lastBag = -1n;
  let missionKey = "";
  let refreshing: Promise<void> | null = null;
  let sheetKind = "";
  let sheetArg = "";
  let sheet: Sheet | null = null;

  const sess = () => chain.session();
  const mine = () => [sess().wallet?.accountId, sess().vault?.accountId].filter(Boolean) as string[];
  const N = (a: string | null | undefined) => esc(nameOf(a, mine()));
  const c = () => w.config;

  // ---------------------------------------------------------------- data

  async function load() {
    const s = sess();
    const safe = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };
    const [stats, config, wallet, vault, walletNear, vaultNear, feed, open, count] = await Promise.all([
      safe(chain.getStats()),
      w.config ? Promise.resolve(w.config) : safe(chain.getConfig()),
      s.wallet ? safe(chain.getHolder(s.wallet.accountId)) : Promise.resolve(null),
      s.vault ? safe(chain.getHolder(s.vault.accountId)) : Promise.resolve(null),
      s.wallet ? safe(chain.nearBalance(s.wallet.accountId)) : Promise.resolve(null),
      s.vault ? safe(chain.nearBalance(s.vault.accountId)) : Promise.resolve(null),
      safe(chain.getFeed(30)),
      safe(chain.getOpenRaids()),
      safe(chain.getHolderCount()),
    ]);
    let holders: Holder[] | null = null;
    if (count !== null) {
      const pages = await Promise.all(Array.from({ length: Math.max(1, Math.ceil(count / 200)) }, (_, i) => safe(chain.getHolders(i * 200, 200))));
      holders = pages.some((p) => p === null) ? null : (pages.flat() as Holder[]);
    }
    const pr = prog();
    let myRaids: Raid[] = [];
    if (s.vault) {
      const ids = new Set((pr.raids || []).slice(-12));
      for (const r of open || []) if (r.attacker === s.vault.accountId) ids.add(String(r.id));
      myRaids = (await Promise.all([...ids].map((id) => safe(chain.getRaid(id))))).filter(Boolean) as Raid[];
      myRaids.sort((a, b) => b.id - a.id);
    }
    const target = vault?.under_raid ?? wallet?.under_raid ?? null;
    const incoming = target ? await safe(chain.getRaid(target)) : null;
    if (incoming && incoming.target === s.wallet?.accountId && !pr.escapeId) setProg({ escapeId: String(incoming.id) });
    const escId = prog().escapeId;
    const escape = escId ? (incoming && String(incoming.id) === escId ? incoming : await safe(chain.getRaid(escId))) : null;
    if (!stats) { w.ok = false; return; }
    syncClock(stats.now_ms);
    w = {
      ok: true,
      stats,
      config,
      wallet,
      vault,
      walletBal: wallet ? BigInt(wallet.balance) : 0n,
      vaultBal: vault ? BigInt(vault.balance) : 0n,
      walletNear,
      vaultNear,
      holders: holders ?? w.holders,
      open: open ?? w.open,
      feed: feed ?? w.feed,
      myRaids,
      incoming: incoming && incoming.status === "open" ? incoming : null,
      escape,
    };
    loaded = true;
  }

  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try { await load(); } catch (e) { console.warn(e); } finally { refreshing = null; }
      if (alive) render();
    })();
    return refreshing;
  }

  // ---------------------------------------------------------------- rules in words

  const myBag = () => (sess().vault ? w.vaultBal : w.walletBal);
  /** A raid on your exposed wallet after you moved out finds nothing: not a threat. */
  const threat = () => !!w.incoming && !(w.incoming.target === sess().wallet?.accountId && w.walletBal === 0n);
  const inVault = () => !!sess().vault && !!w.vault;

  function rawTake(h: Holder) {
    return bps(bps(BigInt(h.balance), h.kind === "vault" ? P(c(), "vault_take_bps") : P(c(), "take_bps")), 10000 - (h.shield_bps || 0));
  }
  function netOf(take: bigint) { return take - bps(take, P(c(), "raid_burn_bps")); }

  /** Why you can't raid this holder right now, in words, or "" if you can. */
  function blocker(h: Holder): { state: Blip["state"]; why: string } {
    const now = chainNow();
    if (w.stats?.after_q_day) return { state: h.kind === "exposed" ? "frozen" : "idle", why: "Q-Day has passed. Raids are over." };
    if (h.under_raid) return { state: "busy", why: "Already under raid. Wait for it to settle." };
    if (Number(h.immune_until) > now) return { state: "rest", why: `Resting after a raid for ${span(Number(h.immune_until) - now)}.` };
    if (BigInt(h.balance) < PB(c(), "min_target_balance")) return { state: "small", why: `Too small to raid: bags under ${full(PB(c(), "min_target_balance"))} are left alone.` };
    if (!inVault()) return { state: "idle", why: "" };
    if (BigInt(h.balance) * BigInt(P(c(), "punch_down_band")) < w.vaultBal) return { state: "down", why: "Too small for your bag: no punching down." };
    return { state: w.vault && w.vault.raids_left > 0 ? "open" : "idle", why: "" };
  }

  function rivals(): Holder[] {
    const own = mine();
    return w.holders.filter((h) => !own.includes(h.account) && BigInt(h.balance) > 0n && h.account !== "satoshi");
  }

  function bestTarget(): Holder | null {
    const list = rivals().filter((h) => blocker(h).state === "open");
    const esc = w.escape ? list.find((h) => h.account === w.escape!.attacker) : null;
    if (esc) return esc;
    return list.sort((a, b) => (rawTake(b) > rawTake(a) ? 1 : -1))[0] || null;
  }

  function vaultsRanked(): Holder[] {
    return w.holders.filter((h) => h.kind === "vault").sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : BigInt(b.balance) < BigInt(a.balance) ? -1 : 0));
  }

  // ---------------------------------------------------------------- missions

  function mission(): Mission {
    if (!loaded) return { k: "load" };
    const s = sess();
    if (w.stats?.after_q_day) return { k: "over" };
    const pr = prog();
    const raid = w.incoming && w.incoming.target === s.wallet?.accountId ? w.incoming : null;
    if (!s.vault) {
      if (!s.wallet || w.walletBal === 0n) return { k: "grab", buyOnly: !!s.wallet };
      if (raid || pr.wantVault) return { k: "build", raid };
      return { k: "exposed" };
    }
    if (w.walletBal > 0n && s.wallet) return { k: "movein", raid };
    if (!s.wallet) return pr.stage === "free" || !pr.stage ? { k: "none" } : pr.stage === "done" ? { k: "done" } : { k: "strike" };
    if (pr.vault !== s.vault.accountId) return { k: "safe" };
    if (pr.stage === "strike") return w.myRaids.length ? (setProg({ stage: "done" }), { k: "done" }) : { k: "strike" };
    if (pr.stage === "done") return { k: "done" };
    if (pr.stage === "free") return { k: "none" };
    return { k: "safe" };
  }

  const STEPS = ["grab", "exposed", "build", "safe", "strike"];
  function pips(k: string) {
    const i = k === "movein" ? 2 : STEPS.indexOf(k);
    return `<span class="pips" aria-label="Mission ${i + 1} of 5">${STEPS.map((_, j) => `<i class="${j < i ? "d" : j === i ? "n" : ""}"></i>`).join("")}</span><span class="m-count">Mission ${i + 1} of 5</span>`;
  }

  function renderMission() {
    const m = mission();
    const raid = (m.k === "build" || m.k === "movein") && m.raid ? m.raid : null;
    const target = m.k === "strike" ? bestTarget() : null;
    const esc2 = w.escape;
    const key = [m.k, raid?.id ?? "", busy, target?.account ?? "", esc2 ? `${esc2.id}:${esc2.status}` : "", m.k === "grab" && m.buyOnly].join("|");
    root.classList.toggle("has-mission", m.k !== "none" && m.k !== "load");
    if (key === missionKey) { updateMissionLive(); return; }
    missionKey = key;
    const card = (tone: string, head: string, title: string, body: string, act: string) =>
      `<section class="mission tone-${tone}" data-k="${m.k}"><div class="m-head">${head}</div><h2 class="m-title">${title}</h2>${body}<div class="m-act">${act}</div><p class="m-msg" id="m-msg" role="status"></p></section>`;
    let html = "";
    const harvestEvery = every(P(c(), "epoch_ms") || 21_600_000);
    switch (m.k) {
      case "load":
        html = `<section class="mission tone-ink"><div class="m-head"><span class="m-count">Reading the chain</span></div><h2 class="m-title">Loading the field<span class="ell"></span></h2></section>`;
        break;
      case "grab":
        html = card("gold", pips("grab"), "Grab a free bag",
          `<p class="m-text">You need coins to play. We'll make you a free testnet wallet and buy your first bag.</p>`,
          `<button class="btn wide" id="m-go">${busy === "grab" ? esc(busyText) : m.buyOnly ? "Buy my bag" : "Grab my bag"}</button>`);
        break;
      case "exposed":
        html = card("hot", pips("exposed"), "Your coins are exposed",
          `<p class="m-text">Your coins sit behind an old key. ${cap(harvestEvery)} a share bleeds away, and at Q-Day they freeze for good. Only a quantum vault is safe.</p>`,
          `<button class="btn wide" id="m-go">Build my vault</button>`);
        break;
      case "build":
      case "movein": {
        const moveOnly = m.k === "movein";
        const field = moveOnly ? "" : `<label class="m-field"><span>Vault name</span><input id="m-name" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(vaultName)}" ${busy ? "disabled" : ""}/></label><p class="m-hint" id="m-hint"></p>`;
        const btn = `<button class="btn wide${raid ? " hot" : ""}" id="m-go">${busy === "build" ? esc(busyText) : moveOnly ? "Move in now" : "Build vault & move in"}</button>`;
        if (raid)
          html = card("alarm", `${pips(m.k)}<span class="m-clock" data-until="${raid.deadline}">${clock(raid.deadline - chainNow())}</span>`,
            `${N(raid.attacker)} is raiding you`,
            `<p class="m-text">Exposed coins can't fight back. ${moveOnly ? "Move your coins into your vault" : "Build your vault and move in"} before <b class="m-clock-in" data-until="${raid.deadline}">${clock(raid.deadline - chainNow())}</b> runs out. The raid gets nothing.</p>${field}`,
            btn);
        else
          html = card("gold", pips(m.k), moveOnly ? "Move your coins in" : "Build your vault",
            moveOnly
              ? `<p class="m-text">Your vault is ready. Move your coins in and they stop bleeding.</p>`
              : `<p class="m-text">A vault is a new account that only a quantum safe key can open. It uses 0.3 of the testnet NEAR in your wallet.</p>${field}`,
            btn);
        break;
      }
      case "safe": {
        let text = "Your coins can't bleed or freeze now. Next: strike back.";
        if (esc2 && esc2.target === sess().wallet?.accountId) {
          if (esc2.status === "open") text = `${N(esc2.attacker)}'s raid will find nothing. Watch the clock: <b data-until="${esc2.deadline}">${clock(esc2.deadline - chainNow())}</b>.`;
          else if (BigInt(esc2.take) === 0n) text = `Escaped. ${N(esc2.attacker)}'s raid took 0. Next: strike back.`;
          else text = `${N(esc2.attacker)}'s raid took ${full(esc2.take)} before you moved in. The rest is safe. Next: strike back.`;
        }
        html = card("gold", pips("safe"), "You're quantum safe", `<p class="m-text">${text}</p>`, `<button class="btn wide" id="m-go">Strike back</button>`);
        break;
      }
      case "strike":
        html = card("gold", pips("strike"), "Strike back",
          target
            ? `<p class="m-text">Raid ${N(target.account)}. If ${target.kind === "vault" ? "it doesn't defend" : "they don't escape"} in ${minutes(P(c(), "defend_window_ms"))} you take a share of ${target.kind === "vault" ? "its" : "their"} bag.</p>`
            : `<p class="m-text">Nobody is in range right now. Pick any glowing blip on the radar when one lights up.</p>`,
          target ? `<button class="btn wide hot" id="m-go">Raid ${N(target.account)}</button>` : `<button class="btn wide ghost" id="m-skip">Skip for now</button>`);
        break;
      case "done":
        html = card("gold", `<span class="m-count">Missions complete</span>`, "Free play",
          `<p class="m-text">Hit Satoshi ${every(P(c(), "epoch_ms") || 21_600_000)}, shield before others raid you, and climb the board.</p>`,
          `<button class="btn wide" id="m-go">Let's go</button>`);
        break;
      case "over": {
        const top = vaultsRanked().slice(0, 3);
        html = card("ink", `<span class="m-count">Season over</span>`, "Q-Day has come",
          `<p class="m-text">Exposed coins are frozen for good. Final standings:</p><ol class="m-top">${top.map((h) => `<li><span class="av">${avatar(h.account)}</span><b>${N(h.account)}</b><span>${full(h.balance)}</span></li>`).join("")}</ol>`, "");
        break;
      }
      case "none":
        html = "";
    }
    missionEl.innerHTML = html;
    wireMission(m, target);
  }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  let vaultName = "";
  function wireMission(m: Mission, target: Holder | null) {
    const go = missionEl.querySelector<HTMLButtonElement>("#m-go");
    const msg = missionEl.querySelector<HTMLElement>("#m-msg");
    const name = missionEl.querySelector<HTMLInputElement>("#m-name");
    if (busy && go) { go.disabled = true; go.classList.add("busy"); }
    if (name) {
      const hint = missionEl.querySelector<HTMLElement>("#m-hint")!;
      let n = 0;
      const check = () => {
        vaultName = name.value.trim().toLowerCase();
        const ok = vaultName.length > 0 && vaultName.length <= 20 && NAME_RE.test(vaultName);
        hint.className = `m-hint${ok ? "" : " bad"}`;
        hint.textContent = ok ? "Your name on the board." : "Use lowercase letters and digits only.";
        if (go && !busy) go.disabled = !ok;
        const id = ++n;
        if (ok) setTimeout(async () => {
          if (id !== n) return;
          const taken = await chain.getHolder(`${vaultName}.${chain.CONTRACT}`).catch(() => null);
          if (id === n && taken) { hint.className = "m-hint bad"; hint.textContent = "That name is taken. Try another."; if (go && !busy) go.disabled = true; }
        }, 350);
      };
      name.addEventListener("input", check);
      check();
    }
    if (m.k === "grab" && go) go.onclick = () => flow("grab", msg, async (say) => {
      if (!sess().wallet) { say("Making your wallet…"); await chain.join(); }
      say("Buying your bag…");
      const r = await chain.buy(1);
      keepReceipt("buy", r.hash);
      tick();
      return "Your bag landed.";
    });
    if (m.k === "exposed" && go) go.onclick = () => { setProg({ wantVault: true }); missionKey = ""; renderMission(); };
    if ((m.k === "build" || m.k === "movein") && go) go.onclick = () => buildAndMove(msg);
    if (m.k === "safe" && go) go.onclick = () => { setProg({ vault: sess().vault!.accountId, stage: "strike" }); missionKey = ""; render(); };
    if (m.k === "strike") {
      if (go && target) go.onclick = () => openRaid(target.account);
      const skip = missionEl.querySelector<HTMLButtonElement>("#m-skip");
      if (skip) skip.onclick = () => { setProg({ stage: "done" }); missionKey = ""; render(); };
    }
    if (m.k === "done" && go) go.onclick = () => { setProg({ stage: "free" }); missionKey = ""; render(); };
  }

  function updateMissionLive() {
    const b = missionEl.querySelector<HTMLButtonElement>("#m-go");
    if (b && busy && busyText) b.textContent = busyText;
  }

  async function buildAndMove(msg: HTMLElement | null) {
    const s = sess();
    const needVault = !s.vault;
    if (needVault && !(vaultName && NAME_RE.test(vaultName))) return;
    const n = vaultName;
    return flow("build", msg, async (say) => {
      if (needVault) {
        say("Building your vault…");
        const { seed } = chain.newVaultSeed();
        const r = await chain.createVault(n, seed);
        keepReceipt("vault", r.hash);
        setProg({ vault: r.accountId, wantVault: false });
      }
      say("Moving your coins in…");
      const r = await chain.migrate();
      keepReceipt("migrate", r.hash);
      setProg({ vault: chain.session().vault!.accountId });
      return "You moved in. Your coins are quantum safe.";
    });
  }

  /** Run a multi step move with progress text on the mission button. */
  async function flow(name: string, msg: HTMLElement | null, fn: (say: (t: string) => void) => Promise<string>) {
    if (busy) return;
    busy = name;
    busyText = "Working…";
    if (msg) { msg.textContent = ""; msg.className = "m-msg"; }
    missionKey = "";
    renderMission();
    const say = (t: string) => { busyText = t; updateMissionLive(); };
    try {
      const done = await fn(say);
      toast({ tone: "gold", title: done });
      busy = "";
      missionKey = "";
      await refresh();
    } catch (e) {
      console.warn(e);
      busy = "";
      missionKey = "";
      await refresh();
      const m2 = missionEl.querySelector<HTMLElement>("#m-msg");
      if (m2) { m2.textContent = plainError(e); m2.className = "m-msg bad"; }
    }
  }

  // ---------------------------------------------------------------- HUD, stats, actions

  function renderHud() {
    const s = sess(), st = w.stats;
    const q = root.querySelector<HTMLElement>("#h-qday")!;
    if (st) { q.dataset.until = st.q_day_ms; q.textContent = st.after_q_day ? "Over" : hudClock(Number(st.q_day_ms) - chainNow()); }
    const bag = myBag();
    const bagEl = root.querySelector<HTMLElement>("#h-bag")!;
    bagEl.textContent = s.wallet || s.vault ? short(bag) : "0";
    const chip = root.querySelector<HTMLElement>("#h-chip")!;
    const state = inVault() ? "vault" : s.wallet && w.walletBal > 0n ? "exposed" : "none";
    chip.className = `chip ${state}`;
    chip.textContent = state === "vault" ? "Vault" : state === "exposed" ? "Exposed" : "No bag";
    const rank = root.querySelector<HTMLElement>("#h-rank")!;
    if (inVault()) {
      const list = vaultsRanked();
      const i = list.findIndex((h) => h.account === s.vault!.accountId);
      rank.innerHTML = i >= 0 ? `#${i + 1}<small> of ${list.length}</small>` : "·";
    } else rank.innerHTML = `<small>Vaults only</small>`;
    root.querySelector<HTMLElement>(".rdot")!.hidden = !(s.vault && prog().backedUp !== s.vault.accountId);
  }

  function renderStats() {
    const el = root.querySelector<HTMLElement>("#stats")!;
    const s = sess(), st = w.stats, v = w.vault;
    if (!st) return;
    const rows: [string, string][] = [];
    if (!s.wallet && !s.vault) {
      rows.push(["Holders", String(rivals().length)], ["In vaults", pct(st.vault_share_bps)], ["Satoshi's stash", full(st.satoshi_tokens)]);
    } else {
      rows.push(["Bag", `${full(myBag())}`]);
      rows.push(["State", inVault() ? `<span class="yel">Quantum vault</span>` : `<span class="red">Exposed</span>`]);
      if (s.vault && w.walletBal > 0n) rows.push(["Still exposed", `<span class="red">${full(w.walletBal)}</span>`]);
      if (v) {
        rows.push(["Shield", v.shield_bps ? `${pct(v.shield_bps)}` : "None"]);
        rows.push(["Raids left", `${v.raids_left} of ${P(c(), "max_raids_per_epoch")}`]);
        rows.push(["Satoshi", v.boss_ready ? `<span class="yel">Ready</span>` : `in <span data-until="${st.epoch_ends_ms}">${span(Number(st.epoch_ends_ms) - chainNow())}</span>`]);
      }
      const nearV = inVault() ? w.vaultNear : w.walletNear;
      if (nearV !== null) rows.push(["Testnet NEAR", chain.fmtNear(nearV, 2)]);
    }
    rows.push(["Next harvest", `<span data-until="${st.epoch_ends_ms}">${span(Number(st.epoch_ends_ms) - chainNow())}</span>`]);
    el.innerHTML = `<header><h2>${s.wallet || s.vault ? "You" : "The field"}</h2></header><dl>${rows.map(([k, v2]) => `<div><dt>${k}</dt><dd>${v2}</dd></div>`).join("")}</dl>`;
  }

  function renderActions() {
    const s = sess(), v = w.vault, st = w.stats;
    const set = (k: string, status: string, disabled: boolean, fill = 0, ready = false) => {
      const b = root.querySelector<HTMLButtonElement>(`.act[data-act="${k}"]`)!;
      b.classList.toggle("off", disabled);
      b.classList.toggle("ready", ready);
      b.setAttribute("aria-disabled", String(disabled));
      b.style.setProperty("--fill", String(Math.max(0, Math.min(1, fill))));
      const e = root.querySelector<HTMLElement>(`#a-${k}`)!;
      if (e.innerHTML !== status) e.innerHTML = status;
    };
    const over = !!st?.after_q_day;
    if (!v || !inVault()) {
      const why = s.wallet || s.vault ? "Vaults only" : "Get a bag";
      set("raid", why, true); set("shield", why, true); set("satoshi", why, true);
      set("market", s.wallet ? "Buy · sell" : "Get a bag", !s.wallet);
      return;
    }
    const epochMs = P(c(), "epoch_ms") || 1;
    const leftMs = st ? Number(st.epoch_ends_ms) - chainNow() : 0;
    const cool = 1 - leftMs / epochMs;
    const max = P(c(), "max_raids_per_epoch");
    set("raid", over ? "Over" : v.raids_left > 0 ? `${v.raids_left} left` : `<span data-until="${st?.epoch_ends_ms}">${hudClock(leftMs)}</span>`, over, v.raids_left > 0 ? v.raids_left / max : cool, v.raids_left > 0 && !over);
    set("shield", v.shield_bps ? pct(v.shield_bps) : "None", over, v.shield_bps ? leftMs / epochMs : 0, false);
    const enough = w.vaultBal >= PB(c(), "boss_min_balance");
    set("satoshi", over ? "Over" : !enough ? "Need more" : v.boss_ready ? `<i class="dot-ready"></i>Ready` : `<span data-until="${st?.epoch_ends_ms}">${hudClock(leftMs)}</span>`, over, v.boss_ready ? 1 : cool, v.boss_ready && enough && !over);
    set("market", "Buy · sell", false);
  }

  root.querySelector("#actions")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".act");
    if (!b) return;
    const k = b.dataset.act!;
    if (b.classList.contains("off")) {
      const s = sess();
      toast({ tone: "ink", title: s.wallet || s.vault ? "Vaults only. Exposed coins can't fight." : "Grab a free bag first." });
      return;
    }
    if (k === "raid") openTargets();
    if (k === "shield") openShield();
    if (k === "satoshi") openSatoshi();
    if (k === "market") openMarket();
  });
  root.querySelector("#h-menu")!.addEventListener("click", () => openSettings());

  // ---------------------------------------------------------------- radar

  function renderRadar() {
    const s = sess();
    const raider = w.incoming?.attacker;
    const m = mission();
    const strike = m.k === "strike" ? bestTarget()?.account : undefined;
    const blips: Blip[] = rivals().map((h) => {
      const b = blocker(h);
      return {
        id: h.account,
        name: nameOf(h.account, mine()),
        kind: h.kind,
        balance: BigInt(h.balance),
        state: b.state,
        shielded: h.shield_bps > 0,
        npc: isNpc(h.account),
        hot: h.account === raider || h.account === strike,
      };
    });
    radar.set(blips);
    const lines: RaidLine[] = [];
    for (const r of w.myRaids) if (r.status === "open") lines.push({ id: `o${r.id}`, to: r.target, dir: "out", until: r.deadline });
    if (w.incoming) lines.push({ id: `i${w.incoming.id}`, to: w.incoming.attacker, dir: threat() ? "in" : "miss", until: w.incoming.deadline });
    radar.lines(lines);
    radar.tickLabels(chainNow());

    // centre: your bag
    const bag = myBag();
    const state = inVault() && w.vaultBal > 0n ? "vault" : s.wallet && w.walletBal > 0n ? "exposed" : inVault() ? "vault" : "none";
    const fill = bag > 0n ? Math.min(1, Math.max(0.25, Math.log10(Math.max(1, whole(bag))) / 6.4)) : 0.5;
    bleed.setBag(state as any, fill);
    core.className = `core st-${state}${threat() ? " shake" : ""}`;
    const lab = core.querySelector<HTMLElement>("#core-lab")!;
    lab.textContent = state === "none" ? "No bag yet" : "You";
    if (lastBag >= 0n && bag > lastBag && lastBag > 0n) { core.classList.remove("win"); void core.offsetWidth; core.classList.add("win"); }
    lastBag = bag;
    const fm = root.querySelector<HTMLElement>("#field-msg")!;
    fm.hidden = w.ok;
    if (!w.ok) fm.textContent = "Can't reach NEAR right now. Retrying…";
  }

  // ---------------------------------------------------------------- events

  interface Ev { tone: "hot" | "gold" | "ink"; title: string; who?: string; open?: () => void }
  const queue: Ev[] = [];
  let showing: HTMLElement | null = null;
  const evHost = root.querySelector<HTMLElement>("#events")!;

  function toast(ev: Ev) {
    queue.push(ev);
    if (!showing) nextToast();
  }
  function nextToast() {
    const ev = queue.shift();
    if (!ev) { showing = null; return; }
    const el = document.createElement("button");
    el.type = "button";
    el.className = `ev tone-${ev.tone}`;
    el.innerHTML = `${ev.who ? `<span class="av">${ev.who === "satoshi" ? satoshiAvatar() : avatar(ev.who)}</span>` : ""}<span class="ev-t">${ev.title}</span>`;
    el.onclick = () => { ev.open?.(); dismiss(); };
    evHost.appendChild(el);
    showing = el;
    let gone = false;
    const dismiss = () => { if (gone) return; gone = true; el.classList.add("out"); setTimeout(() => { el.remove(); if (showing === el) nextToast(); }, 260); };
    setTimeout(dismiss, 5200);
  }

  function renderPinned() {
    const r = w.incoming;
    const m = mission();
    const coveredByMission = (m.k === "build" || m.k === "movein") && !!m.raid;
    let pin = evHost.querySelector<HTMLButtonElement>(".ev.pin");
    if (!r || coveredByMission) { pin?.remove(); return; }
    const live = threat();
    if (!pin || pin.dataset.id !== `${r.id}:${live}`) {
      pin?.remove();
      pin = document.createElement("button");
      pin.type = "button";
      pin.className = `ev pin ${live ? "tone-hot" : "calm"}`;
      pin.dataset.id = `${r.id}:${live}`;
      pin.innerHTML = `<span class="av">${avatar(r.attacker)}</span><span class="ev-t">${live ? `${N(r.attacker)} is raiding you` : `${N(r.attacker)}'s raid finds an empty wallet`}</span><b class="ev-clock" data-until="${r.deadline}">${clock(r.deadline - chainNow())}</b>`;
      pin.onclick = () => openUnderRaid();
      evHost.prepend(pin);
    }
  }

  function feedEvents() {
    if (!w.feed.length) return;
    const top = Math.max(...w.feed.map((f) => Number(f.n)));
    if (lastFeed < 0) { lastFeed = top; return; }
    const fresh = w.feed.filter((f) => Number(f.n) > lastFeed).sort((a, b) => Number(a.n) - Number(b.n));
    lastFeed = top;
    const me = mine();
    for (const f of fresh) {
      const amt = full(f.amount);
      if (f.kind === "harvest") toast({ tone: "ink", title: `Harvest: exposed bags bled ${amt}. Half went to vaults.` });
      else if (f.kind === "resolve" && me.includes(f.actor)) toast({ tone: "gold", who: f.target || undefined, title: BigInt(f.amount) > 0n ? `Your raid on ${N(f.target)} landed: took ${amt}` : `Your raid on ${N(f.target)} took nothing` });
      else if (f.kind === "resolve" && me.includes(f.target || "")) toast({ tone: BigInt(f.amount) > 0n ? "hot" : "gold", who: f.actor, title: BigInt(f.amount) > 0n ? `${N(f.actor)}'s raid took ${amt} from you` : `Escaped. ${N(f.actor)}'s raid took 0` });
      else if (f.kind === "defend" && me.includes(f.target || "")) toast({ tone: "hot", who: f.actor, title: `${N(f.actor)} defended and won ${amt} of your stake` });
    }
  }

  // ---------------------------------------------------------------- activity

  function say(f: FeedItem, me: string[]): string {
    const W = (a: string | null) => `<b>${N(a)}</b>`;
    const O = (a: string | null) => (a && me.includes(a) ? `<b>you</b>` : W(a));
    const amt = full(f.amount);
    switch (f.kind) {
      case "buy": return `${W(f.actor)} bought ${amt}`;
      case "sell": return `${W(f.actor)} sold ${amt}`;
      case "vault": return `${W(f.actor)} built a quantum vault`;
      case "migrate": return me.includes(f.actor) ? `<b>You</b> moved ${amt} into your vault` : `${W(f.target)} moved ${amt} into its vault`;
      case "transfer": return `${W(f.actor)} sent ${amt} to ${O(f.target)}`;
      case "harvest": return `Harvest: exposed bags bled ${amt}`;
      case "raid": return `${W(f.actor)} raided ${O(f.target)}, staking ${amt}`;
      case "defend": return `${W(f.actor)} fought off ${O(f.target)} and won ${amt}`;
      case "resolve": {
        const who = me.includes(f.actor) ? "<b>Your</b> raid" : `${W(f.actor)}'s raid`;
        return BigInt(f.amount) > 0n ? `${who} on ${O(f.target)} took ${amt}` : `${who} on ${O(f.target)} took nothing`;
      }
      case "shield": return `${W(f.actor)} burned ${amt} for a ${pct(Number(f.extra || 0))} shield`;
      case "boss": return `${W(f.actor)} hit Satoshi for ${amt}`;
      default: return `${W(f.actor)} made a move`;
    }
  }

  function activityHtml(limit = 30) {
    const me = mine();
    const rs = receipts();
    const used = new Set<number>();
    const kindOf = (k: string) => k;
    if (!w.feed.length) return `<li class="empty">No moves yet.</li>`;
    return w.feed.slice(0, limit).map((f) => {
      const mineRow = me.includes(f.actor) || (f.kind === "migrate" && me.includes(f.target || ""));
      let receipt = "";
      if (me.includes(f.actor)) {
        const i = rs.findIndex((r, j) => !used.has(j) && kindOf(r.kind) === f.kind && Math.abs(r.at - Number(f.at)) < 180_000);
        if (i >= 0) { used.add(i); receipt = ` <a class="rcpt" href="${txLink(rs[i].hash)}" target="_blank" rel="noopener">receipt ↗</a>`; }
      }
      return `<li class="${mineRow ? "me" : ""}${f.target && me.includes(f.target) && !mineRow ? " at-me" : ""}"><span class="lt">${ago(Number(f.at)).replace(" ago", "")}</span><span class="ls">${say(f, me)}${receipt}</span></li>`;
    }).join("");
  }

  function renderLog() {
    const el = root.querySelector<HTMLElement>("#log")!;
    const h = activityHtml();
    if (el.innerHTML !== h) el.innerHTML = h;
  }

  // ---------------------------------------------------------------- sheets

  function show(kind: string, arg: string, label: string, html: string, tone: "hot" | "gold" | "" = "") {
    let self: Sheet | null = null;
    const s = openSheet({ label, html, tone, host: root, onClose: () => { if (sheet === self) { sheetKind = ""; sheet = null; } } });
    self = s;
    sheet = s;
    sheetKind = kind;
    sheetArg = arg;
    return s;
  }
  /** A button that sends one move, with its own busy state and message line. */
  function move(btn: HTMLButtonElement, out: HTMLElement, fn: () => Promise<{ hash?: string; value?: unknown }>, ok: (v: any) => string, kind: string, after?: () => void) {
    btn.onclick = async () => {
      if (btn.classList.contains("busy")) return;
      const label = btn.innerHTML;
      btn.classList.add("busy");
      btn.disabled = true;
      out.className = "s-msg";
      out.textContent = "Sending…";
      try {
        const r = await fn();
        keepReceipt(kind, r.hash);
        const text = ok(r.value);
        out.className = "s-msg ok";
        out.textContent = text;
        toast({ tone: "gold", title: esc(text) });
        after?.();
        await refresh();
      } catch (e) {
        console.warn(e);
        out.className = "s-msg bad";
        out.textContent = plainError(e);
      } finally {
        btn.classList.remove("busy");
        btn.disabled = false;
        btn.innerHTML = label;
        updateSheet();
      }
    };
  }

  function updateSheet() {
    if (!sheet || sheet.closed || currentSheet() !== sheet) return;
    if (sheetKind === "raid") updateRaidSheet();
    if (sheetKind === "shield") updateShield();
    if (sheetKind === "satoshi") updateSatoshi();
    if (sheetKind === "under") updateUnderRaid();
    if (sheetKind === "targets") updateTargets();
    if (sheetKind === "market") updateMarket();
    if (sheetKind === "activity") { const l = sheet.body.querySelector<HTMLElement>(".log"); if (l) { const h = activityHtml(30); if (l.innerHTML !== h) l.innerHTML = h; } }
  }

  // ----- targets list (RAID button)

  function openTargets() {
    show("targets", "", "Pick a target", `<h2 class="s-title">Pick a target</h2><p class="s-text">Glowing blips can be raided now. Raids left: <b id="tg-left"></b>.</p><ul class="targets" id="tg"></ul>`);
    updateTargets();
    sheet!.body.querySelector("#tg")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
      if (b) openRaid(b.dataset.id!);
    });
  }
  function updateTargets() {
    const el = sheet!.body.querySelector<HTMLElement>("#tg")!;
    sheet!.body.querySelector<HTMLElement>("#tg-left")!.textContent = String(w.vault?.raids_left ?? 0);
    const list = rivals().map((h) => ({ h, b: blocker(h) })).sort((x, y) => Number(y.b.state === "open") - Number(x.b.state === "open") || (rawTake(y.h) > rawTake(x.h) ? 1 : -1));
    el.innerHTML = list.map(({ h, b }) => `<li><button type="button" data-id="${esc(h.account)}" class="${b.state === "open" ? "on" : ""}">
      <span class="av">${avatar(h.account)}</span>
      <span class="tg-n"><b>${N(h.account)}</b>${isNpc(h.account) ? `<span class="tag">NPC</span>` : ""}<small>${b.state === "open" ? `${h.kind === "vault" ? "Vault" : "Exposed"} · take about ${full(netOf(rawTake(h)))}` : b.why || "Out of raids for now"}</small></span>
      <span class="tg-b"><span class="chip ${h.kind}">${h.kind === "vault" ? "Vault" : "Exposed"}</span>${short(h.balance)}</span></button></li>`).join("") || `<li class="empty">Nobody else holds a bag yet.</li>`;
  }

  // ----- raid sheet

  let stakeTouched = false;
  function openRaid(id: string) {
    const h = w.holders.find((x) => x.account === id);
    if (!h) return;
    stakeTouched = false;
    show("raid", id, `Raid ${nameOf(id, mine())}`, `
      <div class="who"><span class="av big">${avatar(id)}</span><div><h2 class="s-title">${N(id)}</h2><p class="who-sub" id="rs-sub"></p></div></div>
      <p class="s-text" id="rs-explain"></p>
      <div id="rs-play">
        <label class="s-range"><span>Stake</span><input type="range" id="rs-stake"/></label>
        <p class="s-calc" id="rs-calc"></p>
        <button class="btn wide hot" id="rs-go">Raid</button>
      </div>
      <p class="s-why" id="rs-why"></p>
      <p class="s-msg" id="rs-msg" role="status"></p>`, "hot");
    const range = sheet!.body.querySelector<HTMLInputElement>("#rs-stake")!;
    range.addEventListener("input", () => { stakeTouched = true; updateRaidSheet(); });
    const go = sheet!.body.querySelector<HTMLButtonElement>("#rs-go")!;
    move(go, sheet!.body.querySelector("#rs-msg")!, () => {
      const stake = BigInt(range.value) * 10n ** 18n;
      return chain.raid(id, stake.toString());
    }, (v) => {
      const rid = String(v ?? "");
      if (rid) setProg({ raids: [...(prog().raids || []), rid].slice(-20) });
      if (prog().stage === "strike") setProg({ stage: "done" });
      return `Raid on ${nameOf(id, mine())} is on. They have ${minutes(P(c(), "defend_window_ms"))}.`;
    }, "raid", () => setTimeout(() => sheet?.close(), 1400));
    updateRaidSheet();
  }

  function updateRaidSheet() {
    const id = sheetArg;
    const h = w.holders.find((x) => x.account === id);
    const B = sheet!.body;
    if (!h) return;
    const b = blocker(h);
    const vault = h.kind === "vault";
    const share = vault ? P(c(), "vault_take_bps") : P(c(), "take_bps");
    B.querySelector<HTMLElement>("#rs-sub")!.innerHTML = `<span class="chip ${h.kind}">${vault ? "Vault" : "Exposed"}</span>${isNpc(id) ? `<span class="tag">NPC</span>` : ""}<span>Bag ${full(h.balance)}</span>`;
    B.querySelector<HTMLElement>("#rs-explain")!.innerHTML = (vault
      ? `<b>Vault:</b> can defend for ${minutes(P(c(), "defend_window_ms"))}. You'd take ${pct(share)} of the bag if they don't.`
      : `<b>Exposed:</b> can't defend. You'd take ${pct(share)} of the bag, unless they escape into a vault first.`) + (h.shield_bps ? ` Their ${pct(h.shield_bps)} shield cuts that down.` : "");
    const playEl = B.querySelector<HTMLElement>("#rs-play")!;
    const why = B.querySelector<HTMLElement>("#rs-why")!;
    let reason = "";
    if (!inVault()) reason = "Vaults only. Build your vault first: exposed coins can't fight.";
    else if (b.why) reason = b.why;
    else if (w.vault!.raids_left <= 0) reason = `You've used your ${P(c(), "max_raids_per_epoch")} raids. They come back in ${span(Number(w.stats!.epoch_ends_ms) - chainNow())}.`;
    const go = B.querySelector<HTMLButtonElement>("#rs-go")!;
    if (reason && !go.classList.contains("busy")) { playEl.hidden = true; why.textContent = reason; return; }
    playEl.hidden = false;
    why.textContent = "";
    const raw = rawTake(h);
    const mult = BigInt(P(c(), "stake_mult"));
    const min = PB(c(), "min_stake");
    const best = maxB(min, (raw + mult - 1n) / mult);
    const cap = minB(best, w.vaultBal);
    const range = B.querySelector<HTMLInputElement>("#rs-stake")!;
    const lo = Number(min / 10n ** 18n), hi = Math.max(lo, Number(cap / 10n ** 18n));
    range.min = String(lo);
    range.max = String(hi);
    range.step = String(Math.max(1, Math.round((hi - lo) / 200)));
    range.disabled = hi <= lo;
    if (!stakeTouched) range.value = String(hi);
    const stake = BigInt(range.value) * 10n ** 18n;
    const take = netOf(minB(raw, stake * mult));
    const enough = stake <= w.vaultBal;
    B.querySelector<HTMLElement>("#rs-calc")!.innerHTML = enough
      ? `Stake <b>${full(stake)}</b> to take about <b class="yel">${full(take)}</b>. ${vault ? "If they defend, they keep your stake." : "If they escape, you get your stake back."}`
      : `You need at least ${full(min)} in your vault to raid.`;
    if (!go.classList.contains("busy")) {
      go.disabled = !enough;
      go.textContent = `Raid ${nameOf(id, mine())}`;
    }
  }

  // ----- under raid card

  function openUnderRaid() {
    const r = w.incoming;
    if (!r) return;
    show("under", String(r.id), "You are being raided", `
      <div class="who"><span class="av big">${avatar(r.attacker)}</span><div><p class="kick red">Incoming raid</p><h2 class="s-title">${N(r.attacker)} is raiding you</h2></div></div>
      <div class="big-clock" id="ur-clock" data-until="${r.deadline}">${clock(r.deadline - chainNow())}</div>
      <p class="s-text" id="ur-lose"></p>
      <p class="s-why" id="ur-why"></p>
      <div id="ur-act"></div>
      <p class="s-msg" id="ur-msg" role="status"></p>`, "hot");
    updateUnderRaid(true);
  }
  let urKey = "";
  function updateUnderRaid(first = false) {
    const r = w.incoming;
    const B = sheet!.body;
    if (!r || String(r.id) !== sheetArg) {
      const done = w.escape && String(w.escape.id) === sheetArg ? w.escape : null;
      B.querySelector<HTMLElement>("#ur-act")!.innerHTML = "";
      B.querySelector<HTMLElement>("#ur-lose")!.textContent = done && BigInt(done.take) === 0n ? "Escaped. The raid took 0." : "This raid is over.";
      return;
    }
    const exposed = r.target_kind === "exposed";
    const tgt = exposed ? w.wallet : w.vault;
    if (tgt) {
      const lose = minB(rawTake({ ...tgt, kind: r.target_kind } as Holder), BigInt(r.stake) * BigInt(P(c(), "stake_mult")));
      B.querySelector<HTMLElement>("#ur-lose")!.innerHTML = lose > 0n ? `If you do nothing you lose about <b class="red">${full(lose)}</b>.` : `Your exposed wallet is empty now. The raid will find nothing.`;
    }
    if (first && isNpc(r.attacker)) B.querySelector<HTMLElement>("#ur-why")!.textContent = cleanWhy(explainRaid(r, { balance: tgt?.balance, shield_bps: tgt?.shield_bps }));
    const closed = r.deadline < chainNow();
    const k = `${closed}:${exposed}:${!!sess().vault}:${w.walletBal > 0n}`;
    if (k === urKey && !first) return;
    urKey = k;
    const act = B.querySelector<HTMLElement>("#ur-act")!;
    const out = B.querySelector<HTMLElement>("#ur-msg")!;
    if (closed) {
      act.innerHTML = `<p class="s-text">Time is up. The raid settles in a moment.</p><button class="btn wide ghost" id="ur-go">Settle it now</button>`;
      move(act.querySelector("#ur-go")!, out, () => chain.resolve(r.id), (v) => `Settled. The raid took ${full(String(v ?? "0"))}.`, "resolve");
    } else if (!exposed) {
      act.innerHTML = `<p class="s-text">Defend now and their stake of ${full(r.stake)} is yours, less a ${pct(P(c(), "raid_burn_bps"))} burn.</p><button class="btn wide" id="ur-go">Defend</button>`;
      move(act.querySelector("#ur-go")!, out, () => chain.defend(r.id), () => `You defended! Their stake is yours.`, "defend");
    } else if (w.walletBal === 0n) {
      act.innerHTML = `<p class="s-text">Your coins are already in your vault. Watch the clock.</p>`;
    } else {
      act.innerHTML = `<p class="s-text">Exposed coins can't defend. They can run: ${sess().vault ? "move them into your vault" : "build a vault and move in"} before the clock runs out and the raid gets nothing.</p><button class="btn wide hot" id="ur-go">${sess().vault ? "Move in now" : "Build vault & escape"}</button>`;
      act.querySelector<HTMLButtonElement>("#ur-go")!.onclick = () => {
        sheet?.close();
        setProg({ wantVault: true });
        missionKey = "";
        render();
        missionEl.querySelector<HTMLElement>(".mission")?.classList.add("flash");
        if (!sess().vault) missionEl.querySelector<HTMLInputElement>("#m-name")?.focus();
        else buildAndMove(missionEl.querySelector("#m-msg"));
      };
    }
  }
  const cleanWhy = (s: string) =>
    s.replace(/qubit-(\d+)/g, "Qubit $1").replace(/\$QDAY/g, "coins").replace(/ \(0% shield\)/, "");

  // ----- shield

  function openShield() {
    show("shield", "", "Shield", `
      <div class="who"><span class="av big icon gold">${I.shield}</span><div><h2 class="s-title">Shield</h2><p class="who-sub" id="sh-now"></p></div></div>
      <p class="s-text">Burn a slice of your bag for a shield that cuts what any raid takes, until the next harvest. Burning 1% gives 10%, 4% gives 20%, 9% gives 30%.</p>
      <label class="s-range"><span>Burn</span><input type="range" id="sh-r" min="0" max="900" step="25" value="400"/></label>
      <p class="s-calc" id="sh-calc"></p>
      <button class="btn wide" id="sh-go">Charge shield</button>
      <p class="s-msg" id="sh-msg" role="status"></p>`, "gold");
    const r = sheet!.body.querySelector<HTMLInputElement>("#sh-r")!;
    r.addEventListener("input", updateShield);
    move(sheet!.body.querySelector("#sh-go")!, sheet!.body.querySelector("#sh-msg")!, () => chain.chargeShield(bps(w.vaultBal, Number(r.value)).toString()), (v) => `Shield up: ${pct(Number(v ?? 0))} until the next harvest.`, "shield");
    updateShield();
  }
  function updateShield() {
    const B = sheet!.body, v = w.vault, st = w.stats;
    if (!v || !st) return;
    const share = Number(B.querySelector<HTMLInputElement>("#sh-r")!.value);
    const amt = bps(w.vaultBal, share);
    const str = Math.min(Number(isqrt(BigInt(share) * 10000n)), P(c(), "max_shield_bps"));
    const left = span(Number(st.epoch_ends_ms) - chainNow());
    B.querySelector<HTMLElement>("#sh-now")!.textContent = v.shield_bps ? `Up now: ${pct(v.shield_bps)} for ${left}` : "No shield up";
    B.querySelector<HTMLElement>("#sh-calc")!.innerHTML = share === 0 ? "Slide to choose how much to burn." : `Burn <b>${pct(share)}</b> (${full(amt)}) for a <b class="yel">${pct(str)}</b> shield until the next harvest in ${left}.`;
    const go = B.querySelector<HTMLButtonElement>("#sh-go")!;
    if (!go.classList.contains("busy")) {
      go.disabled = amt === 0n || str <= v.shield_bps;
      go.textContent = str <= v.shield_bps && share > 0 ? "Your shield is already stronger" : "Charge shield";
    }
  }

  // ----- satoshi

  function openSatoshi() {
    show("satoshi", "", "Satoshi", `
      <div class="who"><span class="av big">${satoshiAvatar()}</span><div><h2 class="s-title">Satoshi</h2><p class="who-sub">An old exposed stash that can never move or defend.</p></div></div>
      <div class="stash"><span>Stash</span><b id="bs-stash"></b></div>
      <p class="s-text" id="bs-rule"></p>
      <p class="s-calc" id="bs-next"></p>
      <button class="btn wide" id="bs-go">Hit Satoshi</button>
      <p class="s-msg" id="bs-msg" role="status"></p>`, "gold");
    move(sheet!.body.querySelector("#bs-go")!, sheet!.body.querySelector("#bs-msg")!, () => chain.bossRaid(), (v) => `You hit Satoshi: +${full(String(v ?? "0"))}.`, "boss");
    updateSatoshi();
  }
  function updateSatoshi() {
    const B = sheet!.body, v = w.vault, st = w.stats;
    if (!v || !st) return;
    const stash = BigInt(st.satoshi_tokens);
    const hit = minB(bps(stash, P(c(), "boss_bps")), PB(c(), "boss_cap"));
    const keep = hit - bps(hit, P(c(), "boss_burn_bps"));
    B.querySelector<HTMLElement>("#bs-stash")!.textContent = full(stash);
    B.querySelector<HTMLElement>("#bs-rule")!.textContent = `Hit once ${every(P(c(), "epoch_ms"))} for ${pct(P(c(), "boss_bps"))} of the stash (up to ${full(PB(c(), "boss_cap"))}). You keep ${full(keep)} of a hit now; ${pct(P(c(), "boss_burn_bps"))} burns.`;
    const enough = w.vaultBal >= PB(c(), "boss_min_balance");
    B.querySelector<HTMLElement>("#bs-next")!.innerHTML = !enough ? `Your vault needs ${full(PB(c(), "boss_min_balance"))} coins to hit Satoshi.` : v.boss_ready ? `<b class="yel">Ready now.</b>` : `Next hit ready in <b>${span(Number(st.epoch_ends_ms) - chainNow())}</b>.`;
    const go = B.querySelector<HTMLButtonElement>("#bs-go")!;
    if (!go.classList.contains("busy")) go.disabled = !(enough && v.boss_ready);
  }

  // ----- market

  let mkNear = 0.25;
  function openMarket() {
    show("market", "", "Market", `
      <div class="who"><span class="av big icon">${I.market}</span><div><h2 class="s-title">Market</h2><p class="who-sub" id="mk-have"></p></div></div>
      <div class="seg2" role="group" aria-label="Buy or sell"><button type="button" data-tab="buy" aria-pressed="true">Buy</button><button type="button" data-tab="sell" aria-pressed="false">Sell</button></div>
      <div id="mk-buy">
        <div class="pick" role="group" aria-label="NEAR to spend">${[0.25, 0.5, 1].map((n) => `<button type="button" data-n="${n}" aria-pressed="${n === mkNear}">${n} NEAR</button>`).join("")}</div>
        <p class="s-calc" id="mk-bq"></p>
        <button class="btn wide" id="mk-bgo">Buy</button>
      </div>
      <div id="mk-sell" hidden>
        <label class="s-range"><span>Sell</span><input type="range" id="mk-sr" min="0" max="100" step="1" value="25"/></label>
        <p class="s-calc" id="mk-sq"></p>
        <button class="btn wide ghost" id="mk-sgo">Sell</button>
      </div>
      <p class="s-msg" id="mk-msg" role="status"></p>`);
    const B = sheet!.body;
    for (const t of B.querySelectorAll<HTMLButtonElement>("[data-tab]"))
      t.onclick = () => {
        for (const x of B.querySelectorAll<HTMLButtonElement>("[data-tab]")) x.setAttribute("aria-pressed", String(x === t));
        B.querySelector<HTMLElement>("#mk-buy")!.hidden = t.dataset.tab !== "buy";
        B.querySelector<HTMLElement>("#mk-sell")!.hidden = t.dataset.tab !== "sell";
      };
    for (const b of B.querySelectorAll<HTMLButtonElement>("[data-n]"))
      b.onclick = () => { mkNear = Number(b.dataset.n); for (const x of B.querySelectorAll<HTMLButtonElement>("[data-n]")) x.setAttribute("aria-pressed", String(x === b)); quoteBuy(); updateMarket(); };
    const sr = B.querySelector<HTMLInputElement>("#mk-sr")!;
    let t = 0;
    sr.addEventListener("input", () => { clearTimeout(t); updateSellText(null); t = window.setTimeout(quoteSell, 250); });
    const out = B.querySelector<HTMLElement>("#mk-msg")!;
    move(B.querySelector("#mk-bgo")!, out, async () => {
      const payer = buyPayer();
      if (payer === "vault") return chain.buy(mkNear, "vault");
      if (payer !== "wallet") throw new Error("balance");
      const r = await chain.buy(mkNear, "wallet");
      if (sess().vault) { keepReceipt("buy", r.hash); return chain.migrate(); }
      return r;
    }, () => (sess().vault ? "Bought, and it's in your vault." : "Bought."), sess().vault && buyPayer() === "wallet" ? "migrate" : "buy");
    move(B.querySelector("#mk-sgo")!, out, () => chain.sell(sellAmount().toString(), sess().vault ? "vault" : "wallet"), (v) => `Sold for ${chain.fmtNear(String(v ?? "0"), 3)} NEAR.`, "sell", () => { sr.value = "0"; });
    quoteBuy();
    quoteSell();
    updateMarket();
  }
  const spendable = (y: bigint | null) => (y ?? 0n) - BigInt(chain.nearToYocto(0.05));
  function buyPayer(): "vault" | "wallet" | null {
    const need = BigInt(chain.nearToYocto(mkNear));
    if (sess().vault && spendable(w.vaultNear) >= need) return "vault";
    if (sess().wallet && spendable(w.walletNear) >= need) return "wallet";
    return null;
  }
  const sellBag = () => (sess().vault ? w.vaultBal : w.walletBal);
  const sellAmount = () => bps(sellBag(), Number(sheet!.body.querySelector<HTMLInputElement>("#mk-sr")!.value) * 100);
  async function quoteBuy() {
    const el = sheet?.body.querySelector<HTMLElement>("#mk-bq");
    if (!el) return;
    try {
      const q = await chain.quoteBuy(chain.nearToYocto(mkNear));
      el.innerHTML = q ? `Get about <b class="yel">${full(q)}</b> coins${sess().vault ? ", straight into your vault" : ""}.` : "The market is full right now.";
    } catch { el.textContent = "Can't reach NEAR for a price right now."; }
  }
  let sellQuote: string | null = null;
  function updateSellText(q: string | null | undefined) {
    const el = sheet?.body.querySelector<HTMLElement>("#mk-sq");
    if (!el) return;
    const a = sellAmount();
    if (a === 0n) { el.textContent = "Slide to choose how much to sell."; return; }
    const fee = pct(P(c(), "sell_fee_bps"));
    el.innerHTML = `Sell <b>${full(a)}</b> coins for about <b class="yel">${q ? chain.fmtNear(q, 3) : "…"}</b> NEAR. A ${fee} fee is taken in coins: half burns, half goes to vault holders.`;
  }
  async function quoteSell() {
    const a = sellAmount();
    if (a === 0n) { updateSellText(null); return; }
    try { sellQuote = await chain.quoteSell(a.toString()); updateSellText(sellQuote); } catch { updateSellText(null); }
  }
  function updateMarket() {
    const B = sheet!.body;
    const f2 = (y: bigint | null) => (y === null ? "0" : chain.fmtNear(y, 2));
    B.querySelector<HTMLElement>("#mk-have")!.textContent = sess().vault
      ? `Testnet NEAR: vault ${f2(w.vaultNear)}${sess().wallet ? `, wallet ${f2(w.walletNear)}` : ""}`
      : `Testnet NEAR in your wallet: ${f2(w.walletNear)}`;
    for (const b of B.querySelectorAll<HTMLButtonElement>("[data-n]")) {
      const need = BigInt(chain.nearToYocto(Number(b.dataset.n)));
      b.disabled = !((sess().vault && spendable(w.vaultNear) >= need) || (sess().wallet && spendable(w.walletNear) >= need));
    }
    const bgo = B.querySelector<HTMLButtonElement>("#mk-bgo")!;
    if (!bgo.classList.contains("busy")) {
      const p = buyPayer();
      bgo.disabled = !p;
      bgo.textContent = p ? `Buy for ${mkNear} NEAR` : "Not enough testnet NEAR";
    }
    const sgo = B.querySelector<HTMLButtonElement>("#mk-sgo")!;
    if (!sgo.classList.contains("busy")) sgo.disabled = sellAmount() === 0n || !!w.stats?.after_q_day && !inVault();
    updateSellText(sellQuote);
  }

  // ----- settings

  function openSettings() {
    const s = sess();
    const theme = document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    show("settings", "", "Menu", `
      <h2 class="s-title">Menu</h2>
      <div class="set-row"><span class="set-k">Your vault</span><b>${s.vault ? esc(nameOf(s.vault.accountId)) : "No vault yet"}</b></div>
      ${s.vault ? `<div class="set-block${prog().backedUp === s.vault.accountId ? "" : " warn"}">
        <div class="set-h"><b>Back up vault key</b>${prog().backedUp === s.vault.accountId ? `<span class="chip vault">Saved</span>` : `<span class="chip exposed">Not saved</span>`}</div>
        <p class="s-text">Your vault key lives sealed in this browser. The recovery code opens your vault on any device. Keep it somewhere safe and never share it.</p>
        <div id="bk"><button type="button" class="btn wide ghost" id="bk-show">Show recovery code</button></div>
      </div>` : ""}
      <div class="set-list">
        <button type="button" class="set-item" id="st-act"><span>Activity</span><span>›</span></button>
        <button type="button" class="set-item" id="st-theme"><span>Theme</span><span>${theme === "dark" ? "Dark" : "Light"}</span></button>
        <details class="set-item det"><summary><span>Restore a vault from a code</span><span>›</span></summary>
          <div class="restore"><label class="m-field"><span>Vault name</span><input id="rs-n" autocomplete="off" autocapitalize="off" spellcheck="false"/></label>
          <label class="m-field"><span>Recovery code</span><input id="rs-c" autocomplete="off" autocapitalize="characters" spellcheck="false"/></label>
          <button type="button" class="btn wide ghost" id="rs-go">Restore vault</button></div></details>
        <a class="set-item" href="/proof" data-link><span>Under the hood</span><span>›</span></a>
        ${s.wallet || s.vault ? `<button type="button" class="set-item danger" id="st-forget"><span>Forget this device</span><span></span></button>` : ""}
      </div>
      <p class="s-msg" id="st-msg" role="status"></p>`);
    const B = sheet!.body;
    const out = B.querySelector<HTMLElement>("#st-msg")!;
    B.querySelector<HTMLButtonElement>("#st-act")!.onclick = () => openActivity();
    B.querySelector<HTMLButtonElement>("#st-theme")!.onclick = (e) => {
      const next = (document.documentElement.getAttribute("data-theme") || theme) === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("qday.theme", next); } catch {}
      (e.currentTarget as HTMLElement).lastElementChild!.textContent = next === "dark" ? "Dark" : "Light";
    };
    const show2 = B.querySelector<HTMLButtonElement>("#bk-show");
    if (show2) show2.onclick = async () => {
      const code = await chain.vaultRecoveryCode();
      const bk = B.querySelector<HTMLElement>("#bk")!;
      if (!code) { bk.innerHTML = `<p class="s-msg bad">This browser can't open the sealed key. Use the code you saved before.</p>`; return; }
      bk.innerHTML = `<div class="code">${code.split("-").map((b, i) => `<span><i>${i + 1}</i>${b}</span>`).join("")}</div>
        <div class="row2"><button type="button" class="btn ghost" id="bk-copy">Copy</button><button type="button" class="btn ghost" id="bk-dl">Download</button></div>`;
      const mark = () => { setProg({ backedUp: sess().vault!.accountId }); renderHud(); };
      bk.querySelector<HTMLButtonElement>("#bk-copy")!.onclick = async () => {
        try { await navigator.clipboard.writeText(code); out.className = "s-msg ok"; out.textContent = "Copied. Paste it somewhere safe."; mark(); }
        catch { out.className = "s-msg"; out.textContent = "Copy is blocked here. Write the 8 blocks down or download them."; }
      };
      bk.querySelector<HTMLButtonElement>("#bk-dl")!.onclick = () => {
        const vname = nameOf(sess().vault!.accountId);
        const text = `Q-DAY vault recovery code\n\nVault: ${vname}\nCode: ${code}\n\nThis code opens your vault on any device. Keep it private.\n`;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        a.download = `qday-vault-${vname}.txt`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        out.className = "s-msg ok"; out.textContent = "Saved as a text file."; mark();
      };
    };
    B.querySelector<HTMLButtonElement>("#rs-go")!.onclick = async () => {
      const n = B.querySelector<HTMLInputElement>("#rs-n")!.value.trim();
      const code = B.querySelector<HTMLInputElement>("#rs-c")!.value.trim();
      if (!n) { out.className = "s-msg bad"; out.textContent = "Type the vault name."; return; }
      out.className = "s-msg"; out.textContent = "Checking the code…";
      try { await chain.restoreVault(n, code); setProg({ backedUp: chain.session().vault!.accountId, vault: chain.session().vault!.accountId, stage: "free" }); out.className = "s-msg ok"; out.textContent = "Vault restored on this device."; missionKey = ""; await refresh(); }
      catch (e) { out.className = "s-msg bad"; out.textContent = plainError(e); }
    };
    const fg = B.querySelector<HTMLButtonElement>("#st-forget");
    let armed = false;
    if (fg) fg.onclick = () => {
      if (!armed) { armed = true; fg.firstElementChild!.textContent = "Tap again: without your code this vault is gone"; setTimeout(() => { armed = false; if (fg.isConnected) fg.firstElementChild!.textContent = "Forget this device"; }, 6000); return; }
      chain.forget();
      try { localStorage.removeItem(LS); } catch {}
      sheet?.close();
      missionKey = "";
      lastBag = -1n;
      refresh();
    };
  }

  function openActivity() {
    show("activity", "", "Activity", `<h2 class="s-title">Activity</h2><ul class="log">${activityHtml(30)}</ul>`);
  }

  // ---------------------------------------------------------------- render

  function render() {
    if (!w.ok && !loaded) { renderMission(); renderRadar(); return; }
    renderHud();
    renderMission();
    renderRadar();
    renderPinned();
    renderStats();
    renderActions();
    renderLog();
    feedEvents();
    updateSheet();
  }

  // ---------------------------------------------------------------- timers

  const clockT = window.setInterval(() => {
    const now = chainNow();
    let due = false;
    for (const el of root.querySelectorAll<HTMLElement>("[data-until]")) {
      const u = Number(el.dataset.until);
      if (!u) continue;
      const left = u - now;
      const t = el.id === "h-qday" ? hudClock(left) : el.closest(".act") ? hudClock(left) : el.closest(".stats, .s-calc, .who-sub") ? span(left) : clock(left);
      if (el.textContent !== t) el.textContent = t;
      if (left <= 0 && left > -1200) due = true;
    }
    radar.tickLabels(now);
    if (sheetKind === "shield" || sheetKind === "satoshi" || sheetKind === "under") updateSheet();
    if (due) refresh();
  }, 1000);

  const pollT = (() => {
    let stopped = false;
    let t: number | undefined;
    const run = async () => {
      if (stopped) return;
      try { await chain.loadSession(); await refresh(); } catch (e) { console.warn(e); }
      if (!stopped) t = window.setTimeout(run, document.hidden ? 15000 : 5000);
    };
    run();
    return () => { stopped = true; if (t) clearTimeout(t); };
  })();
  vaultName = suggestVaultName(sess().wallet?.accountId || String(Date.now()));
  render();
  tick(false);
  // While the game is open, wake the NPCs once a minute: they settle closed raids,
  // run the harvest when it is due, and answer raids on their own vaults.
  const npcBeat = window.setInterval(() => tick(false), 60_000);

  return () => {
    alive = false;
    pollT();
    clearInterval(clockT);
    clearInterval(npcBeat);
    bleed.destroy();
    sheet?.close();
    document.body.classList.remove("in-game");
  };
}
