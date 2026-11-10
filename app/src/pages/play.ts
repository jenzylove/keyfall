// /play: the arena. You steer your bag with your thumb; every holder is a
// body; contact fires the real chain call. Every number is read from the
// chain through chain.ts; movement is local, money is not.

import * as chain from "../chain";
import { apiUrl, txLink, type FeedItem, type Holder, type Params, type Raid, type Stats } from "../chain";
import { ago, chainNow, esc, syncClock } from "../ui/dom";
import { Arena, type ArenaBody } from "../ui/arena";
import { avatar, satoshiAvatar } from "../ui/avatars";
import { hash32, isNpc, nameOf, suggestVaultName } from "../ui/names";
import { openSheet, currentSheet, type Sheet } from "../ui/sheet";
import { P, PB, clock, every, full, hudClock, minutes, pct, plainError, short, span, whole } from "../ui/plain";
import { explainRaid, npcName } from "../../npc/rules.mjs";
import * as sfx from "../ui/sound";
import * as fx from "../ui/fx";
import { line } from "../ui/lines";
import { ART_DOOR, ART_QC, ART_SATOSHI_RED, ART_VAULT, MARK } from "../ui/pixels";
import qrcode from "qrcode-generator";

const MAIN = chain.IS_MAINNET;
const VAULT_RESERVE = 0.35; // NEAR kept back for the vault account and gas
const SOURCES: { id: Parameters<typeof chain.fundingQuote>[0]; label: string; chain: string }[] = [
  { id: "usdc-sol", label: "USDC", chain: "Solana" },
  { id: "usdt-sol", label: "USDT", chain: "Solana" },
  { id: "sol", label: "SOL", chain: "Solana" },
  { id: "usdc-base", label: "USDC", chain: "Base" },
  { id: "eth-base", label: "ETH", chain: "Base" },
];
/** A crisp QR as inline SVG. */
function qrSvg(text: string): string {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="Deposit address as a QR code"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
const NEAR_NAME = /^([a-z0-9]+([_-][a-z0-9]+)*\.)+near$|^[0-9a-f]{64}$/;

const bps = (x: bigint, b: number | bigint) => (x * BigInt(b)) / 10000n;
const isqrt = (n: bigint) => { if (n < 2n) return n; let x = BigInt(Math.floor(Math.sqrt(Number(n)))); while (x * x > n) x--; while ((x + 1n) * (x + 1n) <= n) x++; return x; };
const minB = (a: bigint, b: bigint) => (a < b ? a : b);
const maxB = (a: bigint, b: bigint) => (a > b ? a : b);
const NAME_RE = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
const GAME = "KEYFALL";
const NET_LABEL = (chain.NETWORK as string) === "mainnet" ? "Mainnet" : "Practice";

/** Wake the NPCs now, and again after the function throttle so a fresh bag is seen.
 * Held back while the first run guide is teaching: nobody hunts a new player then. */
let holdTicks: () => boolean = () => false;
function tick(twice = true) {
  if (holdTicks()) return;
  const once = () => fetch(apiUrl("/api/tick"), { method: "POST" }).catch(() => {});
  once();
  if (twice) setTimeout(once, 25_000);
}

// ------------------------------------------------------------------ the first run guide (per network)

const LS_G = `qday.guide.v1.${chain.NETWORK}`;
interface GuideSave { step: number; done?: boolean }
function guideSave(): GuideSave { try { return JSON.parse(localStorage.getItem(LS_G) || "null") || { step: 0 }; } catch { return { step: 0, done: true }; } }
function setGuideSave(g: GuideSave) { try { localStorage.setItem(LS_G, JSON.stringify(g)); } catch {} }
/** How long a card stays before it moves on by itself: never under 4 s, and long enough to read. */
const readMs = (text: string) => Math.max(4000, text.split(/\s+/).length * 330);

// ------------------------------------------------------------------ what you paid (mainnet money line)

const LS_PAID = `qday.paid.v1.${chain.NETWORK}`;
function paidNear(): number { try { return Number(localStorage.getItem(LS_PAID) || 0) || 0; } catch { return 0; } }
function addPaid(near: number) { try { localStorage.setItem(LS_PAID, String(paidNear() + near)); } catch {} }

// ------------------------------------------------------------------ local progress

interface Progress { stage?: "strike" | "done" | "free"; vault?: string; escapeId?: string; backedUp?: string; raids?: string[]; stripHidden?: string }
const LS = "qday.game.v2";
function prog(): Progress { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch { return {}; } }
function setProg(p: Partial<Progress>) { try { localStorage.setItem(LS, JSON.stringify({ ...prog(), ...p })); } catch {} }

// Titles are earned only from confirmed results seen in this browser.
type TitleKey = "native" | "escape" | "shield" | "slayer" | "raider" | "wall";
const TITLES: Record<TitleKey, [string, string]> = {
  native: ["Quantum Native", "You own a quantum vault"],
  escape: ["Escape Artist", "A raid on your old wallet found nothing"],
  shield: ["Shield Up", "You charged a shield"],
  slayer: ["Satoshi Slayer", "You hit Satoshi"],
  raider: ["Raider", "One of your raids took coins"],
  wall: ["Wall", "You defended a raid"],
};
const LS_T = "qday.titles.v1";
function titles(): TitleKey[] { try { return JSON.parse(localStorage.getItem(LS_T) || "[]"); } catch { return []; } }
const LS_INTRO = "qday.intro.v2";

interface Receipt { kind: string; at: number; hash: string }
const LS_R = "qday.receipts.v1";
function receipts(): Receipt[] { try { return JSON.parse(localStorage.getItem(LS_R) || "[]"); } catch { return []; } }
function keepReceipt(kind: string, hash?: string) {
  if (!hash) return;
  try { localStorage.setItem(LS_R, JSON.stringify([...receipts(), { kind, at: chainNow(), hash }].slice(-60))); } catch {}
}

// ------------------------------------------------------------------ icons

const I = {
  shield: `<svg viewBox="0 0 24 24" shape-rendering="crispEdges"><path d="M4 3h16v9h-2v4h-2v2h-2v2h-4v-2H8v-2H6v-4H4z M6 5v6h2v4h2v2h4v-2h2v-4h2V5z" fill="currentColor" fill-rule="evenodd"/><rect x="11" y="7" width="2" height="8" fill="currentColor"/></svg>`,
  market: `<svg viewBox="0 0 24 24" shape-rendering="crispEdges"><path d="M3 15h3v4H3zM8 11h3v8H8zM13 13h3v6h-3zM18 6h3v13h-3z" fill="currentColor"/><path d="M14 4h6v6h-2V7h-2v2h-2z" fill="currentColor"/></svg>`,
  dash: `<svg viewBox="0 0 24 24" shape-rendering="crispEdges"><path d="M13 2h3v2h2v2h2v2h2v4h-2v2h-2v2h-2v2h-3v-4H8v-4h5zM2 9h4v2H2zM3 13h4v2H3zM1 17h4v2H1z" fill="currentColor"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" shape-rendering="crispEdges"><path d="M4 6h16v2H4zM4 11h16v2H4zM4 16h16v2H4z" fill="currentColor"/></svg>`,
  shoot: `<svg viewBox="0 0 24 24" shape-rendering="crispEdges"><path d="M11 2h2v5h-2zM11 17h2v5h-2zM2 11h5v2H2zM17 11h5v2h-5zM9 9h6v6H9zM11 11h2v2h-2z" fill="currentColor" fill-rule="evenodd"/></svg>`,
  share: `<svg viewBox="0 0 24 24" shape-rendering="crispEdges"><path d="M13 3h8v8h-2V7h-2v2h-2v2h-2v2H9v-2h2V9h2V7h2V5h-2zM3 7h6v2H5v10h10v-4h2v6H3z" fill="currentColor"/></svg>`,
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
  sellQuote: bigint | null; // what the whole bag sells for now, in yocto (mainnet goal line)
}

type Mission =
  | { k: "load" }
  | { k: "grab"; buyOnly: boolean }
  | { k: "exposed" }
  | { k: "build"; raid: Raid | null }
  | { k: "movein"; raid: Raid | null }
  | { k: "defend"; raid: Raid }
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
        <button type="button" class="hud-net ${NET_LABEL.toLowerCase()}" id="h-net" aria-label="${NET_LABEL} arena. Switch arena">${MARK}<span>${NET_LABEL}</span></button>
        <div class="hud-cell"><span class="hud-k">Q-Day in</span><span class="hud-v" id="h-qday">··</span></div>
        <div class="hud-cell bag" role="button" tabindex="0" aria-label="Your bag. Open the numbers"><span class="hud-k">Your bag ›</span><span class="hud-v"><span id="h-bag">··</span><span class="chip" id="h-chip"></span></span><span class="hud-pips" id="h-pips" hidden></span></div>
        <div class="hud-cell rank"><span class="hud-k">Rank</span><span class="hud-v" id="h-rank">··</span></div>
        <button class="hud-snd" type="button" id="h-snd" aria-label="Sound"></button>
        <button class="hud-menu" type="button" id="h-menu" aria-label="Menu">${I.menu}<i class="rdot" hidden></i></button>
      </header>
      <p class="goal" id="goal"><b>Goal</b><span class="goal-t">Richest vault at Q-Day wins</span><span class="goal-you" id="goal-you"></span></p>
      <aside class="side left">
        <section class="stats panel" id="stats" aria-label="Your stats"></section>
      </aside>
      <main class="field" id="field">
        <div class="strip-slot" id="mission"></div>
        <div class="guide-slot" id="guide"></div>
        <div class="events" id="events" aria-live="polite"></div>
        <ul class="raid-trk" id="raid-trk" aria-label="Your raids" hidden></ul>
        <div class="field-msg" id="field-msg" hidden></div>
        <div class="start" id="start" hidden></div>
        <p class="keys" aria-hidden="true" hidden>WASD or arrows to move · Space to shoot · Shift to dash</p>
      </main>
      <nav class="actions" id="actions" aria-label="Moves">
        <button type="button" class="act" data-act="shield"><span class="act-fill"></span><span class="act-ic">${I.shield}</span><span class="act-nm">shield</span><span class="act-st" id="a-shield">·</span></button>
        <button type="button" class="act" data-act="market"><span class="act-fill"></span><span class="act-ic">${I.market}</span><span class="act-nm">market</span><span class="act-st" id="a-market">·</span></button>
        <button type="button" class="act dash" data-act="dash" id="a-dash"><span class="act-ic"><i class="act-ring"></i>${I.dash}</span><span class="act-nm">dash</span></button>
        <button type="button" class="act shoot" data-act="shoot" id="shoot-btn"><span class="act-ic">${I.shoot}</span><span class="act-nm">shoot</span><span class="act-st" id="a-shoot">·</span></button>
      </nav>
      <aside class="side right">
        <section class="panel activity"><header><h2>Activity</h2><span class="live"><i></i>live</span></header><ul class="log" id="log"></ul></section>
      </aside>
      <div class="g-arrow" id="g-arrow" hidden aria-hidden="true"><svg viewBox="0 0 24 24" shape-rendering="crispEdges"><path d="M3 4h18v4h-3v4h-3v4h-3v4h-3v-4H6v-4H3z" fill="#0c0c0b"/><path d="M5 6h14v3h-3v3h-3v3h-2v-3H8V9H5z" fill="currentColor"/></svg></div>
    </div>`;

  const field = root.querySelector<HTMLElement>("#field")!;
  try { root.querySelector<HTMLElement>(".keys")!.hidden = matchMedia("(pointer: coarse)").matches || !matchMedia("(hover: hover)").matches; } catch {} // keys are desktop words
  const missionEl = root.querySelector<HTMLElement>("#mission")!;
  const startEl = root.querySelector<HTMLElement>("#start")!;
  const game = root.querySelector<HTMLElement>(".game")!;

  // the arena: contact is the controller
  const arena = new Arena(field, {
    onTouch: (id, b) => touched(id, b),
    onGate: () => gateTouched(),
    onShot: (id) => shot(id),
    onPulse: () => { sfx.play("deny"); sfx.vibrate(30); arena.say("me", "oof"); },
    chainNow,
  });
  arena.quiet = () => stripOpen() || !!showing || guideOn();
  /** One message at a time: a line for you goes on the guide card while it teaches, else as a bubble. */
  const tell = (text: string, ms = 3600) => arena.say("me", text, ms, true); // refusals are bubbles at the body, never text on the guide card
  arena.setGateArt(ART_VAULT);
  arena.setBossArt(ART_SATOSHI_RED);
  field.insertBefore(arena.el, field.firstChild);
  arena.onDash = (fill) => dashBtn.style.setProperty("--fill", String(fill));
  const dashBtn = root.querySelector<HTMLButtonElement>("#a-dash")!;
  const doDash = (e?: Event) => { e?.preventDefault(); if (arena.dash()) { sfx.play("whoosh"); sfx.vibrate(15); dashBtn.classList.add("used"); setTimeout(() => dashBtn.classList.remove("used"), 3000); } };
  dashBtn.addEventListener("pointerdown", doDash);
  dashBtn.addEventListener("click", (e) => e.preventDefault());
  // SHOOT: a shot is local and free; only a hit on an open target reaches the chain
  const shootBtn = root.querySelector<HTMLButtonElement>("#shoot-btn")!;
  /** Every SHOOT press answers within a frame: a shot, a switch of lock, or a bubble that says why not. */
  const doShoot = (e?: Event, auto = false) => {
    e?.preventDefault();
    sfx.unlock();
    const s = sess();
    const nudge = () => { shootBtn.classList.remove("nudge"); void shootBtn.offsetWidth; shootBtn.classList.add("nudge"); };
    if (!s.wallet && !s.vault) { sfx.play("deny"); arena.say("me", "Grab a bag first.", 2400, true); return; }
    if (!inVault()) { sfx.play("deny"); nudge(); arena.say("me", "Get gold first. Only gold can shoot.", 2600, true); return; }
    if (busy) { if (!auto) nudge(); return; } // the button reads SIGNING… while a move is on its way
    if (!arena.shootReady) return;
    const open = (id: string) => arena.targets.has(id) && !w.myRaids.some((r) => r.status === "open" && r.target === id);
    const lock = arena.lockId;
    const mineOn = lock ? w.myRaids.find((r) => r.status === "open" && r.target === lock) : null;
    if (lock && mineOn) {
      // the locked body is already being robbed by you: switch to the next open target in range, else say so
      const next = [...arena.targets].filter((id) => id !== lock && id !== "satoshi" && open(id) && arena.distTo(id) <= arena.viewSpan).sort((a, b) => arena.distTo(a) - arena.distTo(b))[0];
      if (next) arena.lockOn(next);
      else { if (auto) return; sfx.play("deny"); nudge(); arena.say("me", `Already robbing ${nameOf(lock, mine())} · coins in ${clock(mineOn.deadline - chainNow())}`, 3000, true); return; }
    }
    const left = w.vault?.raids_left || 0;
    const canDefend = !!w.incoming && w.incoming.target === s.vault?.accountId;
    if (left <= 0 && !canDefend && !arena.targets.has("satoshi")) { if (auto) return; sfx.play("deny"); nudge(); arena.say("me", `No shots left · new round in ${clock(Number(w.stats!.epoch_ends_ms) - chainNow())}`, 3000, true); return; }
    if (!arena.aimTarget()) {
      if (auto) return;
      sfx.play("deny"); nudge();
      arena.say("me", "Nothing to shoot here · red marks are targets", 3000, true);
      const nearest = [...arena.targets].filter((id) => id !== "satoshi").sort((a, b) => arena.distTo(a) - arena.distTo(b))[0] || (arena.targets.has("satoshi") ? "satoshi" : null);
      if (nearest) arena.pointAt(nearest, 3500);
      return;
    }
    if (arena.shoot()) { sfx.play("zap"); sfx.vibrate(12); shootBtn.classList.add("used"); setTimeout(() => shootBtn.classList.remove("used"), 600); }
  };
  shootBtn.addEventListener("pointerdown", doShoot);
  shootBtn.addEventListener("click", (e) => e.preventDefault());
  arena.onShootKey = () => doShoot();
  // tap a body to lock on: while it can be raided your shots go to it on their own
  arena.onAutoFire = () => doShoot(undefined, true);
  // a raider's shot landed on you: pin the strip right away so the hit and its words arrive together
  arena.onHitMe = () => { renderPinned(); };
  arena.onLock = (id) => {
    sfx.unlock();
    if (!id) return;
    sfx.play("blip"); sfx.vibrate(8);
    if (!inVault()) { arena.say("me", "Get gold first. Only gold can shoot.", 2400, true); return; }
    if (arena.targets.has(id)) return; // it fires on its own
    if (id === "satoshi") { arena.say("satoshi", bossLine(), 2400, true); return; }
    const h = w.holders.find((x) => x.account === id);
    if (!h) return;
    const bl = blocker(h);
    const why = hintFor(h, bl.state) || bl.why;
    if (why) arena.say(id, why, 2400, true);
  };

  // sound toggle in the HUD
  const sndBtn = root.querySelector<HTMLButtonElement>("#h-snd")!;
  const sndLabel = (m: boolean) => { sndBtn.innerHTML = m ? sfx.SPEAKER_OFF : sfx.SPEAKER; sndBtn.classList.toggle("off", m); sndBtn.setAttribute("aria-label", m ? "Sound off. Turn on" : "Sound on. Mute"); };
  sndLabel(sfx.isMuted());
  const offMute = sfx.onMute(sndLabel);
  sndBtn.onclick = () => { sfx.unlock(); sfx.toggleMute(); if (!sfx.isMuted()) sfx.play("blip"); };
  // any touch unlocks sound
  field.addEventListener("pointerdown", () => sfx.unlock(), { passive: true, once: true });

  // ---------------------------------------------------------------- cold open (once)
  let introDone = (() => { try { return localStorage.getItem(LS_INTRO) === "1"; } catch { return true; } })();
  function coldOpen(): Promise<void> {
    return new Promise((res) => {
      const panels: [string, string][] = [
        [ART_QC, "2031. A quantum computer wakes up."],
        [ART_DOOR, "Every old crypto key is now a door left open. Including yours."],
        [ART_VAULT, "Run your coins to a quantum vault. Then hunt everyone who didn't."],
      ];
      const ov = document.createElement("div");
      ov.className = "intro";
      ov.innerHTML = `<div class="intro-art" id="in-art"></div><p class="intro-text" id="in-text"></p><p class="intro-hint" id="in-hint">Tap to continue</p><button type="button" class="intro-skip" id="in-skip">Skip</button>`;
      game.appendChild(ov);
      const art = ov.querySelector<HTMLElement>("#in-art")!, text = ov.querySelector<HTMLElement>("#in-text")!, hint = ov.querySelector<HTMLElement>("#in-hint")!;
      let i = -1, tw: ReturnType<typeof fx.typewriter> | null = null, ended = false, timer = 0;
      const finish = () => {
        if (ended) return;
        ended = true;
        tw?.cancel();
        clearTimeout(timer);
        try { localStorage.setItem(LS_INTRO, "1"); } catch {}
        ov.classList.add("out");
        field.classList.add("power-on");
        sfx.play("chime");
        setTimeout(() => { ov.remove(); res(); }, 500);
        setTimeout(() => field.classList.remove("power-on"), 2600);
      };
      const next = () => {
        if (ended) return;
        if (tw && text.textContent !== panels[i][1]) { tw.cancel(); hint.hidden = false; return; }
        i++;
        if (i >= panels.length) { finish(); return; }
        clearTimeout(timer);
        hint.hidden = true;
        art.innerHTML = panels[i][0];
        art.className = `intro-art p${i}`;
        tw = fx.typewriter(text, panels[i][1], () => sfx.play("tick"));
        tw.done.then(() => { if (!ended && i < panels.length) { hint.hidden = false; timer = window.setTimeout(next, 3200); } });
      };
      ov.addEventListener("click", (e) => { if ((e.target as HTMLElement).id === "in-skip") finish(); else next(); });
      next();
    });
  }

  let alive = true;
  let w: World = { ok: false, stats: null, config: null, wallet: null, vault: null, walletBal: 0n, vaultBal: 0n, walletNear: null, vaultNear: null, holders: [], open: [], feed: [], myRaids: [], incoming: null, escape: null, sellQuote: null };
  let loaded = false;
  let busy = ""; // a move in flight, by name
  let busyText = "";
  let lastFeed = -1;
  let lastBag = -1n;
  let missionKey = "";
  let refreshing: Promise<void> | null = null;
  let sheetKind = "";
  let sheetArg = "";
  let sheet: Sheet | null = null;
  let pendingRaid = ""; // target of a raid in flight (sent, not yet confirmed)
  let prevState = "";
  let prevThreat = false;
  let prevRank = 0;
  let rankArrow = "";
  let rankArrowT = 0;
  let prevShield = -1;
  let prevHunters = "";
  let huntAt = 0;
  let huntBusy = false;
  let stripT = 0;
  let prevRaider = "";
  let prevBossKey = "";
  const stripOpen = () => !!root.querySelector(".strip");

  // ---------------------------------------------------------------- titles
  function earn(k: TitleKey) {
    const have = titles();
    if (have.includes(k)) return;
    try { localStorage.setItem(LS_T, JSON.stringify([...have, k])); } catch {}
    const [name, why] = TITLES[k];
    // one message channel: a slim gold pill that waits its turn (after the strip collapses)
    toast({ tone: "gold", cls: "ev-title", title: `<b>Title earned</b> · ${esc(name)} · ${esc(why)}`, open: () => openSettings(), onShow: () => { sfx.play("fanfare"); sfx.vibrate([30, 40, 30, 40, 80]); } });
  }

  const sess = () => chain.session();
  const mine = () => [sess().wallet?.accountId, sess().vault?.accountId].filter(Boolean) as string[];
  const N = (a: string | null | undefined) => esc(nameOf(a, mine()));
  const c = () => w.config;

  // ---------------------------------------------------------------- data

  async function load() {
    const s = sess();
    const safe = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };
    const keep = async <T,>(p: Promise<T>, prev: T): Promise<T> => { try { return await p; } catch { return prev; } };
    const [stats, config, wallet, vault, walletNear, vaultNear, feed, open, count] = await Promise.all([
      safe(chain.getStats()),
      w.config ? Promise.resolve(w.config) : safe(chain.getConfig()),
      s.wallet ? keep(chain.getHolder(s.wallet.accountId), w.wallet) : Promise.resolve(null),
      s.vault ? keep(chain.getHolder(s.vault.accountId), w.vault) : Promise.resolve(null),
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
    // mainnet only: what the bag would sell for right now, from the contract's own quote
    let sellQuote: bigint | null = null;
    {
      const bag = vault ? BigInt(vault.balance) : wallet ? BigInt(wallet.balance) : 0n;
      if (bag > 0n) { const q = await safe(chain.quoteSell(bag.toString())); sellQuote = q ? BigInt(q) : null; }
    }
    w = {
      ok: true, stats, config, wallet, vault,
      walletBal: wallet ? BigInt(wallet.balance) : 0n,
      vaultBal: vault ? BigInt(vault.balance) : 0n,
      walletNear, vaultNear,
      holders: holders ?? w.holders,
      open: open ?? w.open,
      feed: feed ?? w.feed,
      myRaids,
      incoming: incoming && incoming.status === "open" ? incoming : null,
      escape,
      sellQuote,
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
  const threat = () => !!w.incoming && !(w.incoming.target === sess().wallet?.accountId && w.walletBal === 0n);
  const inVault = () => !!sess().vault && !!w.vault;
  const myId = () => (inVault() ? sess().vault!.accountId : sess().wallet?.accountId || "");

  function rawTake(h: Holder) {
    return bps(bps(BigInt(h.balance), h.kind === "vault" ? P(c(), "vault_take_bps") : P(c(), "take_bps")), 10000 - (h.shield_bps || 0));
  }

  /** Why you can't raid this holder right now, in words, or "" if you can. */
  function blocker(h: Holder): { state: ArenaBody["state"]; why: string } {
    const now = chainNow();
    if (w.stats?.after_q_day) return { state: h.kind === "exposed" ? "frozen" : "idle", why: "Q-Day has passed. Raids are over." };
    if (h.under_raid) return { state: "busy", why: "Already under raid. Wait for it to settle." };
    if (Number(h.immune_until) > now) return { state: "rest", why: `Resting ${span(Number(h.immune_until) - now)} after a raid.` };
    if (BigInt(h.balance) < PB(c(), "min_target_balance")) return { state: "small", why: `Too small to raid: bags under ${full(PB(c(), "min_target_balance"))} are left alone.` };
    if (!inVault()) return { state: "idle", why: "" };
    if (w.vault?.under_raid) return { state: "idle", why: "You are under raid. Shoot the raider first." }; // the contract refuses a raid from a vault under raid
    if (BigInt(h.balance) * BigInt(P(c(), "punch_down_band")) < w.vaultBal) return { state: "down", why: "Too small for your bag: no punching down." };
    return { state: w.vault && w.vault.raids_left > 0 ? "open" : "idle", why: "" };
  }
  /** The same rule in three or four words, drawn under a body as you come close. */
  function hintFor(h: Holder, state: ArenaBody["state"]): string {
    if (!inVault()) return "";
    switch (state) {
      case "open": return "Shoot to rob";
      case "busy": return w.myRaids.some((r) => r.status === "open" && r.target === h.account) ? "" : "Already being raided"; // your own raid has its ROBBING badge
      case "rest": return `Resting ${span(Number(h.immune_until) - chainNow())}`;
      case "small": return "Too small to rob";
      case "down": return "Too small for you";
      case "frozen": return "Frozen";
      default: return w.vault && w.vault.raids_left <= 0 ? "No raids left" : "";
    }
  }
  /** Satoshi's line as you come close: why you cannot hit him yet, or that you can. */
  function bossLine(): string {
    const v = w.vault, st = w.stats;
    if (!inVault() || !v || !st) return "Get gold first";
    if (w.vaultBal < PB(c(), "boss_min_balance")) return `Your vault needs ${full(PB(c(), "boss_min_balance"))} coins`;
    if (!v.boss_ready) return `next hit in ${clock(Number(st.epoch_ends_ms) - chainNow())}`;
    return "SHOOT HIM";
  }
  /** What a boss hit takes right now: boss_bps of his stash, capped by boss_cap (the contract's rule). */
  function bossHitNow(): bigint {
    const st = w.stats; if (!st) return 0n;
    return minB(bps(BigInt(st.satoshi_tokens), P(c(), "boss_bps")), PB(c(), "boss_cap"));
  }

  function rivals(): Holder[] {
    const own = mine();
    return w.holders.filter((h) => !own.includes(h.account) && BigInt(h.balance) > 0n && h.account !== "satoshi");
  }

  function vaultsRanked(): Holder[] {
    return w.holders.filter((h) => h.kind === "vault").sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : BigInt(b.balance) < BigInt(a.balance) ? -1 : 0));
  }

  /** Which NPCs are coming for you right now. Mirrors app/npc/rules.mjs:
   * a Qubit greets you while you are exposed and raidable (and Shor too when
   * you hold the biggest exposed bag it may raid); Grover hunts you when your
   * vault is the least shielded one it may raid. */
  function hunters(): Set<string> {
    const out = new Set<string>();
    const cfg = c();
    if (!cfg || !w.stats || w.stats.after_q_day || !loaded) return out;
    if (guideHolds()) return out; // nobody hunts you while the guide teaches
    const me = inVault() ? w.vault : w.wallet;
    if (!me) return out;
    const now = chainNow();
    const bal = BigInt(me.balance);
    if (me.under_raid || Number(me.immune_until) > now || bal < PB(cfg, "min_target_balance")) return out;
    const band = BigInt(P(cfg, "punch_down_band"));
    const npcs = w.holders.filter((h) => isNpc(h.account) && h.kind === "vault");
    const can = (n: Holder) => n.raids_left > 0 && !n.under_raid && bal * band >= BigInt(n.balance) && !w.open.some((r) => r.attacker === n.account && r.deadline > now);
    const eligible = (h: Holder, att: Holder) => !isNpc(h.account) && !h.under_raid && Number(h.immune_until) <= now && BigInt(h.balance) >= PB(cfg, "min_target_balance") && BigInt(h.balance) * band >= BigInt(att.balance);
    const desc = (a: Holder, b: Holder) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : BigInt(b.balance) < BigInt(a.balance) ? -1 : 0);
    if (!inVault()) {
      const qs = npcs.filter((n) => npcName(n.account).startsWith("qubit-") && can(n)).sort((a, b) => hash32(me.account + a.account) - hash32(me.account + b.account));
      if (qs[0]) out.add(qs[0].account);
      const shor = npcs.find((n) => npcName(n.account) === "shor");
      if (!qs[0] && shor && can(shor)) { // one hunter at a time: Shor only steps in when no Qubit is free
        const top = w.holders.filter((h) => h.kind === "exposed" && eligible(h, shor)).sort(desc)[0];
        if (top?.account === me.account) out.add(shor.account);
      }
    } else {
      const grover = npcs.find((n) => npcName(n.account) === "grover");
      if (grover && can(grover)) {
        const weakest = w.holders.filter((h) => h.kind === "vault" && eligible(h, grover)).sort((a, b) => (a.shield_bps || 0) - (b.shield_bps || 0) || desc(a, b))[0];
        if (weakest?.account === me.account) out.add(grover.account);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- missions

  function mission(): Mission {
    if (!loaded) return { k: "load" };
    const s = sess();
    if (w.stats?.after_q_day) return { k: "over" };
    const pr = prog();
    const raid = w.incoming && w.incoming.target === s.wallet?.accountId ? w.incoming : null;
    if (s.vault && w.incoming && w.incoming.target === s.vault.accountId && w.incoming.status === "open" && w.incoming.deadline > chainNow()) return { k: "defend", raid: w.incoming };
    if (!s.vault) {
      if (!s.wallet || w.walletBal === 0n) return { k: "grab", buyOnly: !!s.wallet };
      if (raid) return { k: "build", raid };
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
    const i = k === "movein" ? 2 : k === "defend" ? 3 : STEPS.indexOf(k);
    return `<span class="pips" aria-label="Mission ${i + 1} of 5">${STEPS.map((_, j) => `<i class="${j < i ? "d" : j === i ? "n" : ""}"></i>`).join("")}</span>`;
  }

  /** The mission strip: one line under the HUD that tells you where to go. */
  function renderMission() {
    const m = mission();
    const raid = (m.k === "build" || m.k === "movein" || m.k === "defend") && m.raid ? m.raid : null;
    const esc2 = w.escape;
    const key = [m.k, raid?.id ?? "", busy, esc2 ? `${esc2.id}:${esc2.status}` : "", m.k === "grab" && m.buyOnly, pendingRaid, prog().stripHidden, guideOn()].join("|");
    root.classList.toggle("has-mission", m.k !== "none" && m.k !== "load");
    if (guideOn() && m.k !== "grab" && m.k !== "load") { // the guide card speaks alone
      missionKey = key;
      clearTimeout(stripT);
      missionEl.innerHTML = "";
      startEl.hidden = true;
      return;
    }
    if (key === missionKey) { updateLive(); return; }
    missionKey = key;
    const strip = (tone: string, head: string, text: string, act = "") =>
      `<section class="strip tone-${tone}" data-k="${m.k}"><div class="strip-head">${head}</div><p class="strip-text">${text}</p>${act ? `<div class="strip-act">${act}</div>` : ""}<button type="button" class="strip-x" id="m-x" aria-label="Hide">×</button></section>`;
    const alarm = m.k === "defend" || (!!raid && m.k !== "movein");
    const chipHide = prog().stripHidden === m.k ? `<button type="button" class="strip-chip${alarm ? " alarm" : ""}" id="m-show" data-k="${m.k}">${alarm ? `<i class="dot"></i>` : ""}${alarm ? `${N(raid!.attacker)} <b data-until="${raid!.deadline}">${clock(raid!.deadline - chainNow())}</b>` : "Mission"}</button>` : "";
    // the strip collapses to a chip on its own after a few seconds
    clearTimeout(stripT);
    if (prog().stripHidden !== m.k && m.k !== "grab" && m.k !== "load") stripT = window.setTimeout(() => { if (alive && mission().k === m.k) { setProg({ stripHidden: m.k }); missionKey = ""; renderMission(); } }, m.k === "exposed" ? 7000 : 5000);
    let html = "";
    startEl.hidden = true;
    const backup = raid ? `<button type="button" class="btn ghost small" id="m-backup">${I.share} Backup</button>` : "";
    switch (m.k) {
      case "load":
        html = strip("ink", `<span class="m-count">Reading the chain</span>`, `Loading the arena<span class="ell"></span>`);
        break;
      case "grab": {
        html = "";
        startEl.hidden = false;
        const funded = MAIN && (w.walletNear ?? 0n) >= BigInt(chain.nearToYocto(VAULT_RESERVE + 0.1));
        const nearTxt = MAIN && w.walletNear !== null && w.walletNear > 0n ? `Your wallet holds <b>${chain.fmtNear(w.walletNear, 2)} NEAR</b>. ` : "";
        startEl.innerHTML = `<div class="start-card">
          <p class="kick gold">${NET_LABEL} arena · ${MAIN ? "real NEAR, real $KEYFALL" : "free, no wallet"}</p>
          <h2 class="start-title">Grab a bag</h2>
          <p class="s-text">${MAIN
            ? `${nearTxt}${funded ? "Choose how much NEAR goes into your bag." : "Top up this device's wallet with NEAR, from another chain or from any NEAR wallet, then buy your first bag."} Then run it to the vault gate before a hunter catches you.`
            : `You need coins to enter the arena. ${m.buyOnly ? "Buy your first bag." : "We make you a free practice wallet and buy your first bag."} Then run it to the vault gate before a hunter catches you.`}</p>
          <button class="btn wide big" id="m-go">${busy === "grab" ? esc(busyText) : MAIN ? (funded ? "Buy my bag" : "Top up") : m.buyOnly ? "Buy my bag" : "Grab my bag"}</button>
          ${MAIN ? `<button type="button" class="btn ghost wide small" id="m-practice">Practice for free instead</button>` : chain.MAINNET_READY ? `<button type="button" class="btn ghost wide small" id="m-real">Play for real on mainnet</button>` : ""}
          <p class="m-msg" id="m-msg" role="status"></p></div>`;
        break;
      }
      case "exposed":
        html = strip("hot", `${pips("exposed")}<span class="m-count">Exposed</span>`,
          `Your coins sit behind an old key and hunters are coming. <b>Run to the gold gate</b> (top right on the map) and your bag is safe. That is the smart play.`);
        break;
      case "build":
      case "movein":
        if (raid)
          html = strip("alarm", `<span class="m-count">${N(raid.attacker)} has you</span><span class="m-clock" data-until="${raid.deadline}">${clock(raid.deadline - chainNow())}</span>`,
            `Reach the gate before the clock ends.`, backup);
        else
          html = strip("gold", `${pips(m.k)}<span class="m-count">${m.k === "movein" ? "Move in" : "Vault"}</span>`,
            m.k === "movein" ? `Your vault is ready. <b>Touch the gate</b> to move your coins in.` : `Touch the gold gate to build your vault and move in.`);
        break;
      case "defend": {
        const r = m.raid!;
        html = strip("alarm", `<span class="m-count">${N(r.attacker)} charges you</span><span class="m-clock" data-until="${r.deadline}">${clock(r.deadline - chainNow())}</span>`,
          `<b>Shoot it</b> and its stake of ${full(r.stake)} is yours.`, backup);
        break;
      }
      case "safe": {
        let text = "Safe from bleed and freeze, and red bags now pay you. <b>Tap a marked rival</b> to rob it.";
        if (esc2 && esc2.target === sess().wallet?.accountId) {
          if (esc2.status === "open") text = `Safe. ${N(esc2.attacker)}'s raid finds nothing. Clock: <b data-until="${esc2.deadline}">${clock(esc2.deadline - chainNow())}</b>.`;
          else if (BigInt(esc2.take) === 0n) { text = `Escaped: the raid took 0. <b>Tap a marked rival</b> to rob it.`; earn("escape"); }
          else text = `The raid took ${full(esc2.take)} before you moved in. <b>Tap a marked rival</b> to rob it.`;
        }
        html = strip("gold", `${pips("safe")}<span class="m-count">Quantum safe</span>`, text);
        break;
      }
      case "strike":
        html = strip("gold", `${pips("strike")}<span class="m-count">Strike back</span>`,
          pendingRaid ? `Your shot is in flight to ${N(pendingRaid)}. Waiting for the chain to confirm.` : `Tap a marked rival to lock on, then chase it: red bags run. Each raid you land ticks in the corner until the coins fly to you.`);
        break;
      case "done":
        html = strip("gold", `<span class="m-count">Free play</span>`, !MAIN && chain.MAINNET_READY ? `You know the arena. Play for real on mainnet with your own NEAR, or keep practising.` : `Shoot Satoshi's core when it glows, shield up before others raid you, and climb the board.`,
          `${!MAIN && chain.MAINNET_READY ? `<button type="button" class="btn small hot" id="m-real">Play for real</button>` : ""}<button type="button" class="btn small ghost" id="m-go">Got it</button>`);
        break;
      case "over": {
        const top = vaultsRanked().slice(0, 3);
        html = strip("ink", `<span class="m-count">Season over</span>`, `Q-Day has come. Exposed coins are frozen for good. Top vaults: ${top.map((h) => `<b>${N(h.account)}</b> ${short(h.balance)}`).join(", ")}.`);
        break;
      }
      case "none":
        html = "";
    }
    missionEl.innerHTML = prog().stripHidden === m.k && html ? chipHide : html;
    if (html && prog().stripHidden !== m.k && showing) { showing.remove(); showing = null; } // the strip speaks alone
    wireMission(m);
  }

  function wireMission(m: Mission) {
    const go = root.querySelector<HTMLButtonElement>("#m-go");
    const msg = root.querySelector<HTMLElement>("#m-msg");
    if (busy && go) { go.disabled = true; go.classList.add("busy"); }
    if (m.k === "grab" && go) go.onclick = () => {
      sfx.unlock();
      if (MAIN) {
        if (!sess().wallet) chain.join().catch(() => {});
        const funded = (w.walletNear ?? 0n) >= BigInt(chain.nearToYocto(VAULT_RESERVE + 0.1));
        if (funded) openBuy(); else openTopUp();
        return;
      }
      flow("grab", msg, async (say) => {
        if (!sess().wallet) { say("Making your wallet…"); await chain.join(); }
        say("Buying your bag…");
        const r = await chain.buy(1);
        keepReceipt("buy", r.hash);
        if (guideSave().done) tick(); // a first run learns the arena before the NPCs wake
        return "Your bag landed. Run to the gate.";
      });
    };
    const real = root.querySelector<HTMLButtonElement>("#m-real");
    if (real) real.onclick = () => chain.switchNetwork("mainnet");
    const prac = root.querySelector<HTMLButtonElement>("#m-practice");
    if (prac) prac.onclick = () => chain.switchNetwork("testnet");
    const bk = root.querySelector<HTMLButtonElement>("#m-backup");
    if (bk && (m.k === "build" || m.k === "movein" || m.k === "defend") && m.raid) bk.onclick = () => shareRaid(m.raid!);
    if (m.k === "done" && go) go.onclick = () => { setProg({ stage: "free" }); missionKey = ""; render(); };
    const x = root.querySelector<HTMLButtonElement>("#m-x");
    if (x) x.onclick = () => { setProg({ stripHidden: m.k }); missionKey = ""; renderMission(); };
    const show = root.querySelector<HTMLButtonElement>("#m-show");
    if (show) show.onclick = () => { setProg({ stripHidden: "" }); missionKey = ""; renderMission(); clearTimeout(stripT); stripT = window.setTimeout(() => { if (alive) { setProg({ stripHidden: m.k }); missionKey = ""; renderMission(); } }, 8000); };
  }

  function updateLive() {
    const b = root.querySelector<HTMLButtonElement>("#m-go");
    if (b && busy && busyText) b.textContent = busyText;
  }

  /** Run a multi step move with progress text. */
  async function flow(name: string, msg: HTMLElement | null, fn: (say: (t: string) => void) => Promise<string>) {
    if (busy) return;
    busy = name;
    busyText = "Working…";
    if (msg) { msg.textContent = ""; msg.className = "m-msg"; }
    missionKey = "";
    renderMission();
    renderArena();
    const say = (t: string) => { busyText = t; updateLive(); renderArena(); };
    try {
      const done = await fn(say);
      toast({ tone: "gold", title: done });
      if (name === "grab") { sfx.play("coins"); }
      busy = "";
      missionKey = "";
      await refresh();
    } catch (e) {
      console.warn(e);
      sfx.play("deny");
      busy = "";
      missionKey = "";
      await refresh();
      const m2 = root.querySelector<HTMLElement>("#m-msg");
      if (m2) { m2.textContent = plainError(e); m2.className = "m-msg bad"; }
      else tell(plainError(e));
    }
  }

  /** One contact move: spinner on your body while the chain confirms, result only after. */
  async function act(name: string, text: string, fn: () => Promise<{ hash?: string; value?: unknown }>, ok: (v: any) => void) {
    if (busy) return false;
    busy = name;
    busyText = text;
    renderArena();
    try {
      const r = await fn();
      keepReceipt(name, r.hash);
      busy = "";
      ok(r.value);
      await refresh();
    } catch (e) {
      console.warn(e);
      busy = "";
      sfx.play("deny");
      tell(plainError(e), 4200);
      await refresh();
    }
    return true;
  }

  // ---------------------------------------------------------------- the guide: the first minute, one card at a time

  let gstep = 0; // 0 = not running (not started yet, or done)
  let gAt = 0; // when the current card came up
  let gKey = "";
  let gVariant = ""; // step 5: "body" | "boss"
  let gTarget = ""; // step 5: the body the arrow points at
  let gNote = ""; let gNoteT = 0;
  let gExpanded = false; // a tap on a compact card opens it again for a moment
  let gShownStep = 0;
  let guideRaided = false;
  let guideBossHit = false;
  const guideEl = root.querySelector<HTMLElement>("#guide")!;
  const gArrow = root.querySelector<HTMLElement>("#g-arrow")!;
  const guideOn = () => gstep > 0;
  /** Steps 1 to 5: nobody hunts you and the NPCs are not woken by this client. */
  const guideHolds = () => gstep > 0 && gstep < 6;

  const TOUCH = (() => { try { return matchMedia("(pointer: coarse)").matches || !matchMedia("(hover: hover)").matches; } catch { return true; } })();
  const CARDS: Record<number, { title: string; text: string; tap?: boolean }> = {
    1: { title: "This is you.", text: TOUCH ? "Drag anywhere to move." : "WASD or the arrow keys to move." },
    2: { title: "You are red.", text: "Your coins sit behind an old key. A quantum computer can crack it, so anyone can rob you, and red bags leak coins over time.", tap: true },
    3: { title: "Get to the gold door.", text: "It makes a new account locked by an ML-DSA-65 key, made in your phone. A quantum computer cannot crack it." },
    4: { title: "You are gold now. Safe.", text: "Every move you make now is signed with that quantum key. Red bags leak coins to you every round.", tap: true },
    5: { title: "Rob a red bag.", text: TOUCH ? "Tap a player with a red target mark to lock on. Get close and your shots fire on their own." : "Click a player with a red target mark to lock on. Get close and your shots fire on their own." },
    6: { title: "Now they hunt you too.", text: "When a raider comes for your vault you lock onto it: shoot it back to win its stake. A SHIELD makes their raids take less, DASH gets you away.", tap: true },
    7: { title: "Your goal:", text: "Be the richest vault when Q-Day hits. Red bags freeze forever that day. Satoshi is the boss: every round each vault can shoot his stash once.", tap: true },
  };

  /** The nearest real body you can raid right now, or null. */
  function guideRaidTarget(): string | null {
    if (!inVault() || !w.vault || w.vault.raids_left <= 0) return null;
    let best: string | null = null, bd = Infinity;
    for (const h of rivals()) {
      if (blocker(h).state !== "open") continue;
      const d = arena.distTo(h.account);
      if (d < bd) { bd = d; best = h.account; }
    }
    return best;
  }
  const bossReadyForMe = () => inVault() && !!w.vault?.boss_ready && w.vaultBal >= PB(c(), "boss_min_balance");

  function guideGo(step: number) {
    if (step === gstep) return;
    gstep = step;
    gAt = Date.now();
    gNote = "";
    gExpanded = false;
    setGuideSave({ step });
    sfx.play("blip");
    renderGuide();
  }
  function guideFinish() {
    setGuideSave({ step: 7, done: true });
    gstep = 0;
    gKey = "";
    guideEl.innerHTML = "";
    gArrow.hidden = true;
    arena.setGuide(null);
    arena.cardOn = false;
    arena.topInset = 0;
    missionKey = "";
    render();
    tick(); // the NPCs may come now
  }
  void gNoteT; // the card keeps its note slot for the in flight line only; refusals are bubbles at the body

  /** Advance on the real event. Runs every 300 ms and after each render. */
  function guideTick() {
    if (!alive || !loaded || !w.ok) return;
    const save = guideSave();
    if (save.done) { if (gstep) { gstep = 0; guideEl.innerHTML = ""; gArrow.hidden = true; arena.setGuide(null); arena.cardOn = false; arena.topInset = 0; } return; }
    const s = sess();
    const kind = inVault() ? "vault" : s.wallet && w.walletBal > 0n ? "exposed" : "none";
    if (kind === "none") return; // the guide starts once you hold a bag
    if (gstep === 0) {
      gstep = Math.max(1, Math.min(7, save.step || 1));
      if (kind === "vault" && gstep < 4) gstep = 4;
      if (w.myRaids.length && gstep < 6) gstep = 6;
      gAt = Date.now();
      setGuideSave({ step: gstep });
      renderGuide();
    }
    // the chain is the truth: a vault with coins moved in is past step 3; a vault still holding red coins is at step 3
    if (kind === "vault" && gstep < 4) { if (w.walletBal === 0n) guideGo(4); else if (gstep < 3) guideGo(3); }
    if (kind === "exposed" && gstep > 3) { guideGo(3); } // the vault vanished from this browser: back to the door
    const card = CARDS[gstep];
    switch (gstep) {
      case 1: if (arena.travelled > 60) guideGo(2); break;
      case 2: case 4: case 6: if (Date.now() - gAt > readMs(card.text) && !currentSheet()) guideGo(gstep + 1); break;
      case 3: break; // the gate touch and its real transactions move this on (above)
      case 5: {
        if (guideRaided || guideBossHit) { guideGo(6); break; }
        const t = guideRaidTarget();
        if (t) { gVariant = "body"; gTarget = t; }
        else if (bossReadyForMe()) { gVariant = "boss"; gTarget = ""; }
        else { guideGo(6); break; }
        break;
      }
      case 7: break; // tap only
    }
    renderGuide();
  }

  function renderGuide() {
    if (!gstep) return;
    const card = CARDS[gstep];
    const variant = gstep === 5 ? gVariant : "";
    const waiting = gstep === 3 && !!busy;
    // after the first read, the cards that point into the world shrink to their title so the target stays in the clear
    const compact = !card.tap && gstep !== 1 && !gExpanded && Date.now() - gAt > readMs(card.text) + 1500;
    const key = `${gstep}|${variant}|${gTarget}|${waiting}|${gNote}|${w.vault?.raids_left ?? ""}|${compact}`;
    // the arrow in the world
    arena.setGuide(gstep === 1 || gstep === 2 || gstep === 4 ? { kind: "me" } : gstep === 3 ? { kind: "gate" } : gstep === 5 ? (variant === "boss" ? { kind: "boss" } : gTarget ? { kind: "body", id: gTarget } : null) : null);
    placeGuideArrow();
    arena.cardOn = true;
    if (key === gKey) return;
    gKey = key;
    guideEl.classList.toggle("low", gstep === 7); // room for the arrow under the goal bar
    const tone = gstep === 2 || gstep === 5 ? "red" : gstep === 1 || gstep === 6 ? "cyan" : "gold";
    const shots = w.vault?.raids_left ?? 0;
    const ammo = ` You have ${shots} shot${shots === 1 ? "" : "s"} this round.`;
    const text = gstep === 5 ? (variant === "boss" ? `Nobody you can rob is near. Satoshi is always there: tap him to lock on, then get close.${ammo}` : card.text + ammo) : card.text;
    const wait = gstep === 1 ? "Waiting for you to move" : gstep === 3 ? (waiting ? esc(busyText) : "Touch the door when you reach it") : gstep === 5 ? (variant === "boss" ? "Tap Satoshi to lock on" : "Tap the marked player to lock on") : "";
    const still = gShownStep === gstep; // the same card redrawn: no entrance animation again
    gShownStep = gstep;
    guideEl.innerHTML = `<section class="guide tone-${tone}${compact ? " compact" : ""}${still ? " still" : ""}" data-step="${gstep}" aria-live="polite">
      <header class="g-head"><span class="g-step">Step ${gstep} of 7</span><button type="button" class="g-skip" id="g-skip">Skip guide</button></header>
      <h2 class="g-title">${esc(card.title)}</h2>
      <p class="g-text">${esc(text)}</p>
      <div class="g-foot">${card.tap ? `<button type="button" class="btn small g-next" id="g-next">${gstep === 7 ? "Play" : "Got it"}</button>` : `<span class="g-wait">${wait}</span>`}<span class="g-note" id="g-note">${esc(gNote)}</span></div>
    </section>`;
    arena.topInset = Math.round(guideEl.getBoundingClientRect().height) + 16; // pointers and labels keep clear of the card
    guideEl.querySelector<HTMLButtonElement>("#g-skip")!.onclick = () => guideFinish();
    const sec = guideEl.querySelector<HTMLElement>(".guide")!;
    sec.onclick = (e) => { if ((e.target as HTMLElement).closest("button")) return; if (compact) { gExpanded = true; gKey = ""; renderGuide(); setTimeout(() => { gExpanded = false; gKey = ""; if (alive) renderGuide(); }, 6000); } };
    const next = guideEl.querySelector<HTMLButtonElement>("#g-next");
    if (next) next.onclick = () => { if (gstep === 7) guideFinish(); else guideGo(gstep + 1); };
  }

  /** The arrow for things outside the world: the DASH button and the goal bar. */
  function placeGuideArrow() {
    const target = gstep === 6 ? dashBtn : gstep === 7 ? root.querySelector<HTMLElement>("#goal-you") : null;
    if (!target) { gArrow.hidden = true; return; }
    const gr = game.getBoundingClientRect(), tr = target.getBoundingClientRect();
    const up = gstep === 7; // the goal bar sits at the top: point up from under it
    gArrow.hidden = false;
    gArrow.classList.toggle("up", up);
    gArrow.style.left = `${Math.round(tr.left + tr.width / 2 - gr.left)}px`;
    gArrow.style.top = `${Math.round(up ? tr.bottom - gr.top + 6 : tr.top - gr.top - 44)}px`;
  }

  // ---------------------------------------------------------------- contact

  /** Only a hunter's touch means anything: the server decides whether it is a raid. */
  function touched(id: string, b: ArenaBody) {
    const h = w.holders.find((x) => x.account === id);
    if (!h) return;
    if (b.hunting) { hunted(id); return; }
    if (b.raidingMe) arena.say(id, line(id, "idle", String(Math.random())), 1800); // the one who has you, bumping along
  }

  /** Your shot landed on a body. Open target: the real raid. The raider: defend. Satoshi: boss hit. Else it deflects with the reason. */
  function shot(id: string): { ok: boolean; why?: string } {
    if (id === "satoshi") return bossShot();
    const h = w.holders.find((x) => x.account === id);
    if (!h) return { ok: false };
    if (!inVault()) return { ok: false, why: "Get gold first. Only gold can attack." };
    if (w.incoming && w.incoming.attacker === id && inVault() && w.incoming.target === sess().vault?.accountId) { void defendByShot(w.incoming); return { ok: true }; }
    if (busy) return { ok: false, why: "Signing the last move…" };
    const bl = blocker(h);
    if (bl.state === "open") { void raidByShot(h); return { ok: true }; }
    sfx.play("deny");
    const why = bl.state === "idle" && !bl.why ? (w.vault?.under_raid ? "You are under raid. Shoot the raider first." : `No shots left. Back in ${span(Number(w.stats!.epoch_ends_ms) - chainNow())}.`) : shortWhy(h, bl.state, bl.why);
    return { ok: false, why };
  }
  const shortWhy = (h: Holder, state: ArenaBody["state"], why: string) => hintFor(h, state) || why;

  /** A hunter touched you: the server lets that NPC raid you only if the rules allow it. */
  async function hunted(id: string) {
    if (huntBusy || Date.now() - huntAt < 15_000) return;
    huntBusy = true;
    huntAt = Date.now();
    sfx.play("alarm"); sfx.vibrate([60, 60, 60]);
    arena.shake(); arena.flash();
    arena.say(id, line(id, "raids"));
    const target = myId();
    try {
      const r = await fetch(apiUrl("/api/hunt"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target, hunter: npcName(id) }) });
      if (r.status === 404 || r.status === 405) {
        // the hunt endpoint is not deployed here yet: the regular NPC tick greets new bags
        await fetch(apiUrl("/api/tick"), { method: "POST" }).catch(() => {});
      } else {
        const j = await r.json().catch(() => ({}));
        if (j.skipped && /new player/i.test(String(j.skipped))) { sfx.play("deny"); arena.say(id, "You're new. Next time I take coins.", 3200, true); } // the server refused: your first minutes are yours
        else if (j.skipped) toast({ tone: "ink", who: id, title: `${N(id)} caught you but could not raid: ${esc(String(j.skipped).replace(/\.$/, "").toLowerCase())}.` });
        else if (j.error && !j.hash) toast({ tone: "ink", who: id, title: `${N(id)} caught you but the raid did not go through.` });
      }
    } catch {
      await fetch(apiUrl("/api/tick"), { method: "POST" }).catch(() => {});
    } finally {
      huntBusy = false;
      await refresh();
      setTimeout(() => refresh(), 4000);
    }
  }

  async function raidByShot(h: Holder) {
    if (busy) return;
    const raw = rawTake(h);
    const mult = BigInt(P(c(), "stake_mult"));
    const min = PB(c(), "min_stake");
    const best = maxB(min, (raw + mult - 1n) / mult);
    const stake = minB(best, w.vaultBal);
    if (stake < min) { arena.say("me", `You need at least ${full(min)} in your vault to raid.`, 3600, true); return; }
    pendingRaid = h.account;
    sfx.play("crunch"); sfx.vibrate(20);
    renderArena();
    const p = arena.screenOf(h.account);
    if (p) fx.pop(field, `stake ${short(stake)}`, "cyan", p);
    await act("raid", "signing with your quantum key…", () => chain.raid(h.account, stake.toString()), (v) => {
      const rid = String(v ?? "");
      if (rid) setProg({ raids: [...(prog().raids || []), rid].slice(-20) });
      if (prog().stage === "strike") setProg({ stage: "done" });
      guideRaided = true;
      arena.say(h.account, line(h.account, "raided"));
      toast({ tone: "gold", who: h.account, title: `Raid on ${N(h.account)} is on. ${h.kind === "vault" ? "It has" : "They have"} ${minutes(P(c(), "defend_window_ms"))} to ${h.kind === "vault" ? "defend" : "escape"}.` });
    });
    pendingRaid = "";
    missionKey = "";
    render();
  }

  async function defendByShot(r: Raid) {
    if (busy) return;
    sfx.play("blip");
    await act("defend", "signing with your quantum key…", () => chain.defend(r.id), () => {
      sfx.play("clang"); sfx.vibrate([40, 30, 40]);
      arena.burst("me", "#27f0ff", 16);
      arena.badge(r.attacker, "BLOCKED", "#27f0ff", 2000);
      arena.fly(r.attacker, "me", "#ffd60a", 12);
      const won = BigInt(r.stake) - bps(BigInt(r.stake), P(c(), "raid_burn_bps"));
      setTimeout(() => { fx.pop(field, `+${full(won)}`, "gold", arena.screenOf("me") || undefined); sfx.play("coins"); }, 500);
      fx.banner(field, "DEFENDED", `${nameOf(r.attacker, mine())}'s stake is yours`, "gold");
      arena.say(r.attacker, line(r.attacker, "defended"));
      earn("wall");
    });
  }

  function gateTouched() {
    const s = sess();
    if (!s.wallet && !s.vault) return;
    if (busy) return;
    if (!s.vault) { openNameSheet(); return; }
    if (w.walletBal > 0n && s.wallet) { moveIn(); return; }
    sfx.play("blip");
    tell("Your coins are already inside.", 2200);
  }

  async function moveIn() {
    sfx.play("blip");
    await act("migrate", "moving your coins in…", () => chain.migrate(), () => {
      setProg({ vault: chain.session().vault!.accountId });
      slam();
    });
  }
  function slam() {
    sfx.play("powerup"); sfx.vibrate([20, 30, 60]);
    arena.burst("me", "#ffd60a", 22);
    arena.flash("#ffd60a");
    fx.banner(field, "QUANTUM SAFE", "red turned gold. Now you hunt.", "gold");
  }

  function bossShot(): { ok: boolean; why?: string } {
    const v = w.vault, st = w.stats;
    if (!inVault() || !v || !st) { sfx.play("deny"); return { ok: false, why: "Get gold first" }; }
    if (busy) return { ok: false, why: "Signing the last move…" };
    const enough = w.vaultBal >= PB(c(), "boss_min_balance");
    if (!enough) { sfx.play("deny"); return { ok: false, why: `Your vault needs ${full(PB(c(), "boss_min_balance"))} coins` }; }
    if (!v.boss_ready) { sfx.play("deny"); return { ok: false, why: `Ready in ${span(Number(st.epoch_ends_ms) - chainNow())}` }; }
    void act("boss", "signing with your quantum key…", () => chain.bossRaid(), (val) => {
      guideBossHit = true;
      const kept = BigInt(String(val ?? "0"));
      const burn = BigInt(P(c(), "boss_burn_bps"));
      const dealt = burn > 0n ? (kept * 10000n + (10000n - burn) - 1n) / (10000n - burn) : kept;
      arena.shake(); fx.freeze(game, 120); sfx.play("thud"); sfx.vibrate([90, 30, 50]);
      arena.fly("satoshi", "me", "#ffd60a", 14);
      arena.badge("satoshi", `−${full(dealt)}`, "#ff3d2e", 2400);
      setTimeout(() => { fx.pop(field, `+${full(kept)}`, "gold", arena.screenOf("me") || undefined); sfx.play("coins"); }, 600);
      arena.say("satoshi", line("satoshi", "hit", String(Math.random())));
      earn("slayer");
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------- the vault name (first gate touch)

  let vaultName = "";
  function openNameSheet() {
    show("name", "", "Name your vault", `
      <p class="kick gold">The gate</p>
      <h2 class="s-title">Name your vault</h2>
      <p class="s-text">A vault is a new account that only a quantum safe key can open. It uses 0.3 of the ${NET_LABEL.toLowerCase()} NEAR in your wallet. Your coins move in right after.</p>
      <label class="m-field"><span>Vault name</span><input id="m-name" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(vaultName)}"/></label>
      <p class="m-hint" id="m-hint"></p>
      <button class="btn wide hot" id="n-go">Build vault & move in</button>
      <ol class="n-steps" id="n-steps" hidden>
        <li data-step="1"><i></i><span>Creating your vault account</span><b></b></li>
        <li data-step="2"><i></i><span>Adding your quantum key</span><b></b></li>
        <li data-step="3"><i></i><span>Moving your coins in</span><b></b></li>
      </ol>
      <p class="s-msg" id="n-msg" role="status"></p>`, "gold");
    const B = sheet!.body;
    const name = B.querySelector<HTMLInputElement>("#m-name")!, hint = B.querySelector<HTMLElement>("#m-hint")!, go = B.querySelector<HTMLButtonElement>("#n-go")!;
    let n = 0;
    const check = () => {
      vaultName = name.value.trim().toLowerCase();
      const ok = vaultName.length > 0 && vaultName.length <= 20 && NAME_RE.test(vaultName);
      hint.className = `m-hint${ok ? "" : " bad"}`;
      hint.textContent = ok ? "Your name on the board." : "Use lowercase letters and digits only.";
      if (!go.classList.contains("busy")) go.disabled = !ok;
      const id = ++n;
      if (ok) setTimeout(async () => {
        if (id !== n) return;
        const taken = await chain.getHolder(`${vaultName}.${chain.CONTRACT}`).catch(() => null);
        if (id === n && taken) { hint.className = "m-hint bad"; hint.textContent = "That name is taken. Try another."; if (!go.classList.contains("busy")) go.disabled = true; }
      }, 350);
    };
    name.addEventListener("input", check);
    check();
    // three named steps that tick as each confirms, with the seconds each one took
    const steps = B.querySelector<HTMLElement>("#n-steps")!;
    let stepT = 0, stepTimer = 0;
    const stepOn = (n: number) => {
      steps.hidden = false;
      stepT = Date.now();
      for (const li of steps.querySelectorAll<HTMLElement>("li")) { const k = Number(li.dataset.step); li.className = k < n ? "done" : k === n ? "now" : ""; }
      clearInterval(stepTimer);
      stepTimer = window.setInterval(() => { const li = steps.querySelector<HTMLElement>(`li[data-step="${n}"] b`); if (li) li.textContent = `${((Date.now() - stepT) / 1000).toFixed(0)} s`; }, 250);
    };
    const stepDone = (n: number) => { const li = steps.querySelector<HTMLElement>(`li[data-step="${n}"]`); if (li) { li.className = "done"; li.querySelector("b")!.textContent = `${((Date.now() - stepT) / 1000).toFixed(1)} s`; } };
    const buildT0 = { t: 0 };
    move(go, B.querySelector("#n-msg")!, async () => {
      const nm = vaultName;
      buildT0.t = Date.now();
      busy = "build"; busyText = "creating your vault account…"; renderArena();
      stepOn(1);
      const { seed } = chain.newVaultSeed();
      const r = await chain.createVault(nm, seed, () => { stepDone(1); stepOn(2); busyText = "adding your quantum key…"; renderArena(); });
      stepDone(2);
      keepReceipt("vault", r.hash);
      setProg({ vault: r.accountId });
      earn("native");
      stepOn(3);
      busyText = "moving your coins in…"; renderArena();
      const m = await chain.migrate();
      stepDone(3);
      clearInterval(stepTimer);
      busy = "";
      (field as any).__buildMs = Date.now() - buildT0.t; // measured by the spike
      return m;
    }, () => `You moved in. Your coins are quantum safe. ${((Date.now() - buildT0.t) / 1000).toFixed(0)} s all in.`, "migrate", () => { slam(); setTimeout(() => sheet?.close(), 900); }, () => { busy = ""; clearInterval(stepTimer); });
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
      if (i >= 0 && prevRank && i + 1 !== prevRank) {
        rankArrow = i + 1 < prevRank ? "up" : "down";
        rankArrowT = Date.now();
        if (rankArrow === "up") sfx.play("chime");
      }
      if (i >= 0) prevRank = i + 1;
      const arrow = rankArrow && Date.now() - rankArrowT < 6000 ? `<i class="rk-arrow ${rankArrow}">${rankArrow === "up" ? "▲" : "▼"}</i>` : "";
      rank.innerHTML = i >= 0 ? `#${i + 1}${arrow}<small> of ${list.length}</small>` : "··";
    } else rank.innerHTML = `··<small> no vault</small>`;
    root.querySelector<HTMLElement>(".rdot")!.hidden = !(s.vault && prog().backedUp !== s.vault.accountId);
    // shots left this epoch (your raids left): bullets by your bag, words when none are left
    const pips = root.querySelector<HTMLElement>("#h-pips")!;
    if (inVault() && w.vault) {
      const max = P(c(), "max_raids_per_epoch"), left = w.vault.raids_left;
      // (the next harvest is shown in the goal bar)
      const harv = ""; // the next harvest lives in the goal bar and the YOUR BAG sheet; the HUD cell is too narrow for it
      const html = left > 0
        ? `${Array.from({ length: max }, (_, i) => `<i class="${i < left ? "on" : ""}"></i>`).join("")}<span class="hp-k">${left} shot${left === 1 ? "" : "s"}</span>${harv}`
        : `<span class="hp-k none">0 shots</span>${harv}`;
      pips.hidden = false;
      pips.setAttribute("aria-label", left > 0 ? `${left} of ${max} shots left` : "No shots left");
      if (pips.innerHTML !== html) pips.innerHTML = html;
    } else pips.hidden = true;
    renderGoal();
  }

  /** The next harvest for you. Exposed: it takes harvest_bps of your bag. In a vault: half of what it takes
   * from every exposed bag (Satoshi included) is shared across vaults by size. Same arithmetic as core harvest(). */
  function harvestFlow(): { gain: boolean; amount: bigint } | null {
    const st = w.stats, cfg = c();
    if (!st || !cfg || st.after_q_day) return null;
    const hb = BigInt(P(cfg, "harvest_bps"));
    if (inVault()) {
      const q = BigInt(st.vault_tokens);
      if (q <= 0n || w.vaultBal <= 0n) return null;
      const h = bps(BigInt(st.exposed_tokens), Number(hb));
      const toVaults = h - h / 2n;
      const amount = (toVaults * w.vaultBal) / q;
      return amount > 0n ? { gain: true, amount } : null;
    }
    if (sess().wallet && w.walletBal > 0n) {
      const amount = bps(w.walletBal, Number(hb));
      return amount > 0n ? { gain: false, amount } : null;
    }
    return null;
  }

  /** The goal bar under the HUD: the win condition and where you stand, every number from the chain. */
  let goalKey = "";
  function renderGoal() {
    const s = sess();
    const you = root.querySelector<HTMLElement>("#goal-you")!;
    let text: string;
    if (w.stats?.after_q_day) text = "Q-Day has come";
    else if (!s.wallet && !s.vault) text = "grab a bag to enter";
    else if (!inVault()) text = w.walletBal > 0n ? "get gold to be ranked" : "grab a bag to enter";
    else {
      const list = vaultsRanked();
      const i = list.findIndex((h) => h.account === s.vault!.accountId);
      text = i >= 0 ? `you are #${i + 1} of ${list.length}` : `${list.length} vaults on the board`;
    }
    // what the next harvest does to you, from the chain's own numbers (the contract's harvest rule, worked out here)
    const hv = harvestFlow();
    if (hv) text += hv.gain ? ` · +${short(hv.amount)} next harvest` : ` · −${short(hv.amount)} next harvest`;
    // mainnet: what you paid (your own confirmed buys in this browser) against what the bag sells for now (the contract's quote)
    if (MAIN && (s.wallet || s.vault)) {
      const paid = paidNear();
      if (paid > 0 && w.sellQuote !== null) text += ` · paid ${paid.toFixed(2)} NEAR, sells for ${chain.fmtNear(w.sellQuote, 2)} NEAR now`;
    }
    if (text === goalKey) return;
    goalKey = text;
    you.textContent = text;
    root.querySelector<HTMLElement>("#goal")!.classList.toggle("has-you", !!text);
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
      if (nearV !== null) rows.push([`${NET_LABEL} NEAR`, chain.fmtNear(nearV, 2)]);
    }
    rows.push(["Hunting you", arena.hunters.length ? arena.hunters.map((id) => N(id)).join(", ") : "Nobody"]);
    rows.push(["Next harvest", `<span data-until="${st.epoch_ends_ms}">${span(Number(st.epoch_ends_ms) - chainNow())}</span>`]);
    el.innerHTML = `<header><h2>${s.wallet || s.vault ? "You" : "The arena"}</h2></header><dl>${rows.map(([k, v2]) => `<div><dt>${k}</dt><dd>${v2}</dd></div>`).join("")}</dl>`;
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
    dashBtn.classList.toggle("off", !(s.wallet || s.vault) || (!inVault() && w.walletBal === 0n));
    if (!v || !inVault()) {
      const why = s.wallet || s.vault ? "Vaults only" : "Get a bag";
      set("shield", why, true);
      set("market", s.wallet ? "Buy · sell" : "Get a bag", !s.wallet);
      set("shoot", s.wallet || s.vault ? "Get gold first" : "Get a bag", true);
      return;
    }
    const epochMs = P(c(), "epoch_ms") || 1;
    const leftMs = st ? Number(st.epoch_ends_ms) - chainNow() : 0;
    set("shield", v.shield_bps ? `${pct(v.shield_bps)} less` : "None", over, v.shield_bps ? leftMs / epochMs : 0, false);
    set("market", "Buy · sell", false);
    const left = v.raids_left;
    // the button always says what a press will do: SIGNING… while a move is out, the round clock when you are out of shots
    const roundIn = st ? `<b data-until="${st.epoch_ends_ms}">${clock(Number(st.epoch_ends_ms) - chainNow())}</b>` : "";
    const status = over ? "Over" : busy ? "SIGNING…" : left > 0 ? `${left} shot${left === 1 ? "" : "s"}` : (w.incoming && w.incoming.target === sess().vault?.accountId) ? "Shoot back" : `next round ${roundIn}`;
    set("shoot", status, over, 0, left > 0 && !busy);
    shootBtn.classList.toggle("signing", !!busy && !over);
    shootBtn.classList.toggle("empty", !busy && left <= 0 && !arena.targets.size);
  }

  root.querySelector("#actions")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".act");
    if (!b || b.dataset.act === "dash" || b.dataset.act === "shoot") return;
    const k = b.dataset.act!;
    if (b.classList.contains("off")) {
      const s = sess();
      toast({ tone: "ink", title: s.wallet || s.vault ? "Vaults only. Get gold first." : "Grab a free bag first." });
      return;
    }
    if (k === "shield") openShield();
    if (k === "market") openMarket();
  });
  root.querySelector("#h-menu")!.addEventListener("click", () => openSettings());
  root.querySelector(".hud-cell.bag")!.addEventListener("click", () => { if (sess().wallet || sess().vault) openBag(); });
  root.querySelector("#h-net")!.addEventListener("click", () => openNetwork());

  // ---------------------------------------------------------------- arenas, top up, buy, cash out (mainnet)

  function openNetwork() {
    show("net", "", "Choose your arena", `
      <h2 class="s-title">Two arenas, one game</h2>
      <div class="net-pick">
        <button type="button" class="net-opt ${MAIN ? "on" : ""}" data-net="mainnet" ${chain.MAINNET_READY ? "" : "disabled"}><b>Mainnet</b><span>Real NEAR, real $KEYFALL. Your own wallet on this device.</span>${chain.MAINNET_READY ? "" : `<small>Opening soon</small>`}</button>
        <button type="button" class="net-opt ${MAIN ? "" : "on"}" data-net="testnet"><b>Practice</b><span>Free. A practice wallet is made for you. Coins have no value.</span></button>
      </div>
      <p class="m-hint">Each arena keeps its own wallet and vault on this device.</p>`);
    for (const b of sheet!.body.querySelectorAll<HTMLButtonElement>(".net-opt")) b.onclick = () => { const n = b.dataset.net as "mainnet" | "testnet"; if ((n === "mainnet") !== MAIN) chain.switchNetwork(n); else sheet?.close(); };
  }

  let fundSource = SOURCES[0].id;
  let fundNear = 1;
  let fundPoll = 0;
  function openTopUp() {
    clearInterval(fundPoll);
    const wallet = sess().wallet?.accountId || chain.mainnetWallet().accountId;
    show("topup", "", "Top up", `
      <p class="kick gold">Mainnet</p>
      <h2 class="s-title">Top up your wallet</h2>
      <p class="s-text">Your bag, your vault and every move run on NEAR. 1 NEAR covers a bag, the vault and plenty of moves.</p>
      <div class="pick" role="group" aria-label="How much NEAR">${[1, 2, 5].map((n) => `<button type="button" data-near="${n}" aria-pressed="${n === fundNear}">${n} NEAR</button>`).join("")}</div>
      <label class="m-field"><span>Pay with</span><select id="tu-src">${SOURCES.map((s) => `<option value="${s.id}" ${s.id === fundSource ? "selected" : ""}>${s.label} on ${s.chain}</option>`).join("")}</select></label>
      <button class="btn wide" id="tu-go">Get a deposit address</button>
      <p class="s-msg" id="tu-msg" role="status"></p>
      <div id="tu-quote" hidden></div>
      <div class="set-block">
        <div class="set-h"><b>Or send NEAR directly</b></div>
        <p class="s-text">From any NEAR wallet or exchange, send NEAR to this device's wallet:</p>
        <div class="addr"><code id="tu-wallet">${esc(wallet)}</code><button type="button" class="btn ghost small" data-copy="${esc(wallet)}">Copy</button></div>
        <p class="m-hint" id="tu-bal">Waiting for NEAR to arrive…</p>
      </div>`, "gold");
    const B = sheet!.body;
    for (const b of B.querySelectorAll<HTMLButtonElement>("[data-near]")) b.onclick = () => { fundNear = Number(b.dataset.near); for (const x of B.querySelectorAll<HTMLButtonElement>("[data-near]")) x.setAttribute("aria-pressed", String(x === b)); };
    B.querySelector<HTMLSelectElement>("#tu-src")!.onchange = (e) => { fundSource = (e.target as HTMLSelectElement).value as typeof fundSource; };
    const out = B.querySelector<HTMLElement>("#tu-msg")!;
    const go = B.querySelector<HTMLButtonElement>("#tu-go")!;
    go.onclick = async () => {
      go.disabled = true; go.classList.add("busy"); go.textContent = "Getting a quote";
      out.className = "s-msg"; out.textContent = "";
      try {
        const q = await chain.fundingQuote(fundSource, fundNear);
        const src = SOURCES.find((s) => s.id === fundSource)!;
        const until = new Date(q.deadline);
        B.querySelector<HTMLElement>("#tu-quote")!.hidden = false;
        B.querySelector<HTMLElement>("#tu-quote")!.innerHTML = `
          <div class="quote">
            <p class="s-text">Send exactly <b class="yel">${esc(q.amountInFormatted)} ${esc(src.label)}</b> on <b>${esc(src.chain)}</b> to this address. ${chain.fmtNear(q.amountOut, 2)} NEAR lands in your wallet, usually within a few minutes.</p>
            <div class="qr">${qrSvg(q.depositAddress)}</div>
            <div class="addr"><code>${esc(q.depositAddress)}</code><button type="button" class="btn ghost small" data-copy="${esc(q.depositAddress)}">Copy</button></div>
            <p class="m-hint">Good until ${until.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}. Send the exact amount in one transfer.</p>
            <p class="s-calc" id="tu-status"><i class="dot"></i> Waiting for your deposit…</p>
          </div>`;
        wireCopy(B);
        let last = "";
        clearInterval(fundPoll);
        fundPoll = window.setInterval(async () => {
          if (!B.isConnected) { clearInterval(fundPoll); return; }
          const st = await chain.fundingStatus(q.depositAddress);
          const el = B.querySelector<HTMLElement>("#tu-status");
          if (!el) return;
          const words: Record<string, string> = { PENDING_DEPOSIT: "Waiting for your deposit…", KNOWN_DEPOSIT_TX: "Deposit seen. Confirming…", PROCESSING: "Swapping to NEAR…", SUCCESS: "NEAR delivered. Opening your wallet…", REFUNDED: "The swap was refunded. Try another amount.", FAILED: "The swap failed. Nothing was lost; try again.", INCOMPLETE_DEPOSIT: "The deposit was short. Send the rest to the same address." };
          if (st !== last) { last = st; el.innerHTML = `<i class="dot${st === "SUCCESS" ? " safe" : ""}"></i> ${esc(words[st] || "Waiting for your deposit…")}`; }
        }, 5000);
      } catch (e) {
        const msg = String((e as any)?.message || "");
        out.className = "s-msg bad";
        out.textContent = /404|405|failed \(/.test(msg) ? "Paying from another chain is not switched on yet. Send NEAR to the wallet below instead." : plainError(e);
      } finally {
        go.disabled = false; go.classList.remove("busy"); go.textContent = "Get a deposit address";
      }
    };
    wireCopy(B);
    // the wallet balance: the moment NEAR arrives we move on to the bag
    const balPoll = window.setInterval(async () => {
      if (!B.isConnected) { clearInterval(balPoll); clearInterval(fundPoll); return; }
      const bal = await chain.nearBalance(wallet);
      const el = B.querySelector<HTMLElement>("#tu-bal");
      if (el) el.textContent = bal > 0n ? `Wallet holds ${chain.fmtNear(bal, 2)} NEAR.` : "Waiting for NEAR to arrive…";
      if (bal >= BigInt(chain.nearToYocto(VAULT_RESERVE + 0.1))) {
        clearInterval(balPoll); clearInterval(fundPoll);
        sfx.play("coins");
        toast({ tone: "gold", title: `${chain.fmtNear(bal, 2)} NEAR arrived in your wallet.` });
        await refresh();
        openBuy();
      }
    }, 5000);
  }
  function wireCopy(B: HTMLElement) {
    for (const b of B.querySelectorAll<HTMLButtonElement>("[data-copy]")) b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy!); b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy"; }, 1600); }
      catch { b.textContent = "Select it"; }
    };
  }

  /** Mainnet: how much of the wallet's NEAR goes into the first bag. */
  function openBuy() {
    const have = Number(chain.fmtNear(w.walletNear ?? 0n, 3).replace(/,/g, ""));
    const max = Math.max(0.1, Math.floor((have - VAULT_RESERVE) * 100) / 100);
    show("buy", "", "Buy your bag", `
      <p class="kick gold">Mainnet</p>
      <h2 class="s-title">Buy your bag</h2>
      <p class="s-text">Your wallet holds <b>${have.toFixed(2)} NEAR</b>. ${VAULT_RESERVE} NEAR stays back for your vault and gas.</p>
      <label class="s-range"><span>NEAR into the bag</span><input type="range" id="by-r" min="0.1" max="${max}" step="0.05" value="${Math.min(max, 0.5)}"/></label>
      <p class="s-calc" id="by-calc"></p>
      <button class="btn wide" id="by-go">Buy</button>
      <p class="s-msg" id="by-msg" role="status"></p>`, "gold");
    const B = sheet!.body;
    const r = B.querySelector<HTMLInputElement>("#by-r")!;
    let t = 0;
    const update = async () => {
      const n = Number(r.value);
      const calc = B.querySelector<HTMLElement>("#by-calc")!;
      calc.innerHTML = `Spend <b>${n.toFixed(2)} NEAR</b>, keep ${(have - n).toFixed(2)} NEAR.`;
      const q = await chain.quoteBuy(chain.nearToYocto(n)).catch(() => null);
      if (B.isConnected && Number(r.value) === n) calc.innerHTML = `Spend <b>${n.toFixed(2)} NEAR</b> for about <b class="yel">${q ? full(q) : "…"}</b> $KEYFALL. Keep ${(have - n).toFixed(2)} NEAR for the vault and moves.`;
      B.querySelector<HTMLButtonElement>("#by-go")!.textContent = `Buy for ${n.toFixed(2)} NEAR`;
    };
    r.addEventListener("input", () => { clearTimeout(t); t = window.setTimeout(update, 200); });
    move(B.querySelector("#by-go")!, B.querySelector("#by-msg")!, async () => { const res = await chain.buy(Number(r.value)); addPaid(Number(r.value)); tick(); return res; }, () => "Your bag landed. Run to the gate.", "buy", () => { sfx.play("coins"); setTimeout(() => sheet?.close(), 700); });
    update();
  }

  /** Mainnet: send NEAR from the vault to any NEAR account. */
  function openCashOut() {
    const have = w.vaultNear ?? 0n;
    const spendableY = have - BigInt(chain.nearToYocto(0.05));
    show("cashout", "", "Cash out", `
      <p class="kick gold">Mainnet</p>
      <h2 class="s-title">Cash out</h2>
      <p class="s-text">Your vault holds <b>${chain.fmtNear(have, 3)} NEAR</b>. Sell $KEYFALL for NEAR in the market first if you want more, then send NEAR to a NEAR account you control.</p>
      <label class="m-field"><span>Send to (NEAR account)</span><input id="co-to" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="yourname.near"/></label>
      <p class="m-hint" id="co-hint">Type the account that should receive the NEAR.</p>
      <label class="s-range"><span>NEAR to send</span><input type="range" id="co-r" min="0" max="${Math.max(0, Number(chain.fmtNear(spendableY, 3).replace(/,/g, "")))}" step="0.01" value="0"/></label>
      <p class="s-calc" id="co-calc">Slide to choose how much to send.</p>
      <button class="btn wide hot" id="co-go" disabled>Send</button>
      <p class="s-msg" id="co-msg" role="status"></p>`, "gold");
    const B = sheet!.body;
    const to = B.querySelector<HTMLInputElement>("#co-to")!, hint = B.querySelector<HTMLElement>("#co-hint")!, r = B.querySelector<HTMLInputElement>("#co-r")!, go = B.querySelector<HTMLButtonElement>("#co-go")!;
    let okTo = false, n = 0;
    const check = async () => {
      const v = to.value.trim().toLowerCase();
      okTo = false;
      if (!v) { hint.className = "m-hint"; hint.textContent = "Type the account that should receive the NEAR."; return gate(); }
      if (!NEAR_NAME.test(v)) { hint.className = "m-hint bad"; hint.textContent = "That is not a NEAR account name (like yourname.near)."; return gate(); }
      const id = ++n;
      hint.className = "m-hint"; hint.textContent = "Checking that account exists…";
      const bal = await chain.nearBalance(v);
      if (id !== n) return;
      if (bal > 0n) { okTo = true; hint.className = "m-hint"; hint.textContent = `Found. ${v} holds ${chain.fmtNear(bal, 2)} NEAR.`; }
      else { hint.className = "m-hint bad"; hint.textContent = "That account does not exist on NEAR. Sending there would lose the NEAR, so it is blocked."; }
      gate();
    };
    const gate = () => { const amt = Number(r.value); B.querySelector<HTMLElement>("#co-calc")!.textContent = amt > 0 ? `Send ${amt.toFixed(2)} NEAR. About ${chain.fmtNear(spendableY - BigInt(chain.nearToYocto(amt)), 2)} NEAR stays for moves.` : "Slide to choose how much to send."; if (!go.classList.contains("busy")) go.disabled = !(okTo && amt > 0); };
    to.addEventListener("input", () => { clearTimeout(n); check(); });
    r.addEventListener("input", gate);
    move(go, B.querySelector("#co-msg")!, () => chain.cashOut(to.value.trim().toLowerCase(), chain.nearToYocto(Number(r.value))), () => `Sent ${Number(r.value).toFixed(2)} NEAR to ${to.value.trim()}.`, "cashout", () => { sfx.play("coins"); });
  }

  // ---------------------------------------------------------------- arena

  function renderArena() {
    const s = sess();
    const raider = w.incoming?.attacker;
    const hunt = hunters();
    const me = mine();
    const myOpen = new Map(w.myRaids.filter((r) => r.status === "open").map((r) => [r.target, r] as const));
    const all = rivals();
    const bl = new Map(all.map((h) => [h.account, blocker(h)] as const));
    // cap the drawn set (fewer on a phone): you, everyone tied to you, what you can raid, NPCs, then the largest bags
    const score = (h: Holder) => (h.account === raider || myOpen.has(h.account) || hunt.has(h.account) || h.account === pendingRaid ? 4e18 : bl.get(h.account)!.state === "open" ? 3e18 : isNpc(h.account) ? 2e18 : 0) + whole(h.balance);
    const picked = all.sort((a, b) => score(b) - score(a)).slice(0, arena.bodyCap);
    const reach = arena.viewSpan * 1.5;
    const bodies: ArenaBody[] = picked.map((h) => {
      const b = bl.get(h.account)!;
      const tied = h.account === raider || myOpen.has(h.account) || hunt.has(h.account) || h.account === pendingRaid;
      const focus = tied || (inVault() && b.state === "open" && arena.distTo(h.account) < reach);
      const npc = isNpc(h.account) ? (npcName(h.account) === "shor" ? "shor" : npcName(h.account) === "grover" ? "grover" : "qubit") : "";
      const mineRaid = myOpen.get(h.account) || (pendingRaid === h.account ? { deadline: 0 } as Raid : null);
      return {
        id: h.account, name: nameOf(h.account, me), bag: short(h.balance), kind: h.kind, balance: whole(h.balance),
        state: b.state, shieldBps: h.shield_bps || 0, immune: Number(h.immune_until) > chainNow(), npc,
        hunting: hunt.has(h.account) && !busy,
        raidingMe: h.account === raider && !!w.incoming,
        raidedByMe: !!mineRaid,
        until: h.account === raider ? w.incoming!.deadline : mineRaid?.deadline || undefined,
        svg: avatar(h.account),
        focus, showBag: tied || (inVault() && b.state === "open"), // what you can rob shows what it holds
        hint: hintFor(h, b.state),
      };
    });
    arena.setBodies(bodies);
    const kind: "none" | "exposed" | "vault" = inVault() ? "vault" : s.wallet && w.walletBal > 0n ? "exposed" : "none";
    // what a shot may snap to: open bodies, the raider charging your vault, Satoshi when your hit is ready
    const targets = new Set<string>();
    if (kind === "vault") {
      for (const b of bodies) if (b.state === "open" || (b.raidingMe && w.incoming?.target === s.vault?.accountId)) targets.add(b.id);
      if (w.vault?.boss_ready && w.vaultBal >= PB(c(), "boss_min_balance")) targets.add("satoshi");
    }
    arena.targets = targets;
    // a new raid on you: the raider fires (the raid is already on chain); in a vault you lock straight onto it, so your shots defend on their own
    if (raider && raider !== prevRaider && kind !== "none") {
      arena.npcShot(raider);
      if (kind === "vault" && w.incoming?.target === s.vault?.accountId) arena.lockOn(raider);
    }
    prevRaider = raider || "";
    const idForArt = s.vault?.accountId || s.wallet?.accountId || "you";
    arena.setMe({
      kind, bag: kind === "none" ? "" : short(myBag()), balance: whole(myBag()), shieldBps: inVault() ? w.vault?.shield_bps || 0 : 0,
      raidsLeft: w.vault?.raids_left || 0, maxRaids: P(c(), "max_raids_per_epoch"),
      inFlight: busy && busy !== "grab" ? busyText : "", svg: avatar(idForArt),
    });
    const st = w.stats;
    const supply = PB(c(), "satoshi_supply");
    arena.setPlaces({
      gate: kind === "none" ? "hidden" : kind === "exposed" || (s.vault && w.walletBal > 0n) ? "open" : "home",
      boss: {
        visible: inVault() || arena.bossDist < 420, hint: kind !== "none" && arena.bossDist < 520, line: bossLine(),
        ready: bossReadyForMe(),
        hp: st && supply > 0n ? Number((BigInt(st.satoshi_tokens) * 10000n) / supply) / 10000 : 1,
        hpText: st ? `${short(st.satoshi_tokens)} / ${short(supply)}` : "",
        badge: `SHOOT HIM · +~${full(bossHitNow() - bps(bossHitNow(), P(c(), "boss_burn_bps")))}`,
      },
    });
    // the boss is ready for you: say so once per round
    const bossKey = bossReadyForMe() ? `${st?.epoch}` : "";
    if (bossKey && bossKey !== prevBossKey) toast({ tone: "hot", who: "satoshi", title: `Satoshi is ready for you: shoot his stash for about +${full(bossHitNow() - bps(bossHitNow(), P(c(), "boss_burn_bps")))}.` });
    prevBossKey = bossKey;
    guideTick();

    // hunters: siren when a new one turns toward you
    const hk = [...hunt].sort().join("|");
    if (hk && hk !== prevHunters && kind !== "none") {
      sfx.play("siren"); sfx.vibrate(40);
      for (const id of hunt) if (!prevHunters.includes(id)) arena.say(id, line(id, "idle", String(Math.random())) || "hi!");
      field.classList.add("hunted"); setTimeout(() => field.classList.remove("hunted"), 1800);
    }
    prevHunters = hk;

    // under raid: the arena edge flashes red and the siren blips once
    const th = threat();
    field.classList.toggle("alarm", th);
    if (th && !prevThreat) { sfx.play("alarm"); sfx.vibrate([60, 60, 60]); }
    prevThreat = th;

    if (prevState === "exposed" && kind === "vault") slam();
    const shieldBps = inVault() ? w.vault?.shield_bps || 0 : 0;
    if (prevShield >= 0 && shieldBps > prevShield) { sfx.play("clang"); arena.burst("me", "#27f0ff", 12); }
    prevShield = shieldBps;
    prevState = kind;
    const bag = myBag();
    if (lastBag >= 0n && bag > lastBag && lastBag > 0n) arena.burst("me", "#ffd60a", 8);
    lastBag = bag;
    const fm = root.querySelector<HTMLElement>("#field-msg")!;
    fm.hidden = w.ok;
    if (!w.ok) fm.textContent = "Can't reach NEAR right now. Retrying…";
  }

  // ---------------------------------------------------------------- events

  interface Ev { tone: "hot" | "gold" | "ink"; title: string; who?: string; open?: () => void; cls?: string; onShow?: () => void }
  const queue: Ev[] = [];
  let showing: HTMLElement | null = null;
  const evHost = root.querySelector<HTMLElement>("#events")!;

  function toast(ev: Ev) {
    queue.push(ev);
    if (!showing) nextToast();
  }
  function nextToast() {
    if (stripOpen() || arena.meSpeaking || guideOn()) { showing = null; setTimeout(() => { if (alive && !showing && queue.length) nextToast(); }, 1200); return; }
    const ev = queue.shift();
    if (!ev) { showing = null; return; }
    const el = document.createElement("button");
    el.type = "button";
    el.className = `ev tone-${ev.tone}${ev.cls ? ` ${ev.cls}` : ""}`;
    ev.onShow?.();
    el.innerHTML = `${ev.who ? `<span class="av">${ev.who === "satoshi" ? satoshiAvatar() : avatar(ev.who)}</span>` : ""}<span class="ev-t">${ev.title}</span>`;
    el.onclick = () => { ev.open?.(); dismiss(); };
    evHost.appendChild(el);
    showing = el;
    let gone = false;
    const dismiss = () => { if (gone) return; gone = true; el.classList.add("out"); setTimeout(() => { el.remove(); if (showing === el) nextToast(); }, 260); };
    setTimeout(dismiss, 5200);
  }

  function feedEvents() {
    if (!w.feed.length) return;
    const top = Math.max(...w.feed.map((f) => Number(f.n)));
    if (lastFeed < 0) { lastFeed = top; return; }
    const fresh = w.feed.filter((f) => Number(f.n) > lastFeed).sort((a, b) => Number(a.n) - Number(b.n));
    lastFeed = top;
    const me = mine();
    const at = (id: string | null) => { const p = (id && arena.screenOf(id)) || arena.screenOf("me") || { x: 50, y: 50 }; return id === "me" || !id ? { ...p, y: p.y - 9 } : p; }; // coins you win pop above your head, not on it
    for (const f of fresh) {
      const amt = full(f.amount);
      const won = BigInt(f.amount) > 0n;
      if (f.kind === "harvest") toast({ tone: "ink", title: `Harvest: exposed bags bled ${amt}. Half went to vaults.` });
      else if (f.kind === "raid" && me.includes(f.target || "")) arena.say(f.actor, line(f.actor, "raids")); // the strip carries the raid; no toast on top
      else if (f.kind === "resolve" && me.includes(f.actor)) {
        toast({ tone: "gold", who: f.target || undefined, title: won ? `Your raid on ${N(f.target)} landed: took ${amt}` : `Your raid on ${N(f.target)} took nothing` });
        if (won) {
          // the robbed body flies apart, the coins stream to you, the real take pops big at you, then it reforms
          if (f.target) arena.shatter(f.target, true);
          setTimeout(() => { fx.pop(field, `+${amt}`, "gold", at("me"), "big"); sfx.play("coins"); arena.burst("me", "#ffd60a", 10); }, 700);
          if (f.target) arena.say(f.target, line(f.target, "defended"));
          earn("raider");
        } else { fx.pop(field, "took nothing", "ink", at(f.target)); if (f.target) arena.badge(f.target, "NOTHING", "#8b90a3", 1600, false); }
      } else if (f.kind === "resolve" && me.includes(f.target || "")) {
        if (won) {
          toast({ tone: "hot", who: f.actor, title: `${N(f.actor)}'s raid took ${amt} from you` });
          arena.shake(); fx.freeze(game); sfx.play("crunch"); sfx.vibrate([80, 40, 80]);
          arena.fly("me", f.actor, "#ff3d2e", 12);
          fx.pop(field, `−${amt}`, "red", at("me"));
          arena.say(f.actor, line(f.actor, "won"));
        } else {
          toast({ tone: "gold", who: f.actor, title: `Escaped. ${N(f.actor)}'s raid took 0` });
          fx.banner(field, "ESCAPED", `${nameOf(f.actor, me)}'s raid took 0`, "gold");
          sfx.play("fanfare"); sfx.vibrate([30, 30, 30]);
          arena.say(f.actor, line(f.actor, "escaped"));
          earn("escape");
        }
      } else if (f.kind === "defend" && me.includes(f.target || "")) {
        // they blocked your raid: a counter shot comes back at you, BLOCKED on them, your stake pops red at you
        const r = w.myRaids.find((x) => x.target === f.actor && (x.status === "defended" || x.status === "open"));
        const lost = r ? full(r.stake) : amt;
        toast({ tone: "hot", who: f.actor, title: `${N(f.actor)} blocked your raid and took your ${lost} stake` });
        arena.npcShot(f.actor, true);
        arena.badge(f.actor, "BLOCKED", "#ff3d2e", 2200);
        setTimeout(() => { fx.pop(field, `−${lost}`, "red", at("me"), "big"); sfx.play("deny"); }, 650);
        arena.say(f.actor, line(f.actor, "defends"));
      } else if (f.kind === "defend" && me.includes(f.actor)) {
        if (f.target) arena.fly(f.target, "me", "#ffd60a", 10);
        setTimeout(() => { fx.pop(field, `+${amt}`, "gold", at("me")); sfx.play("coins"); }, 600);
        if (f.target) arena.say(f.target, line(f.target, "defended"));
        earn("wall");
      }
    }
  }

  // Rivals talk: an idle taunt now and then from an NPC near you.
  const tauntT = window.setInterval(() => {
    if (document.hidden || !w.ok) return;
    if (stripOpen() || showing || arena.meSpeaking || guideOn()) return;
    const npcs = rivals().filter((h) => isNpc(h.account) && arena.hunters.includes(h.account));
    if (!npcs.length) return;
    const h = npcs[Math.floor(Math.random() * npcs.length)];
    arena.say(h.account, line(h.account, "idle", String(Math.random())));
  }, 26_000);

  /** CALL FOR BACKUP: share the defend link. */
  async function shareRaid(r: Raid) {
    const url = `${location.origin}/d/${r.id}`;
    const who = nameOf(r.attacker, mine());
    const left = Math.max(1, Math.round((r.deadline - chainNow()) / 60000));
    const text = `${who} is raiding my ${r.target_kind === "vault" ? "vault" : "bag"} in ${GAME}. ${left} minute${left === 1 ? "" : "s"} left.`;
    try {
      if (navigator.share) { await navigator.share({ title: GAME, text, url }); return; }
    } catch { return; }
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener");
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
    if (!w.feed.length) return `<li class="empty">No moves yet.</li>`;
    return w.feed.slice(0, limit).map((f) => {
      const mineRow = me.includes(f.actor) || (f.kind === "migrate" && me.includes(f.target || ""));
      let receipt = "";
      if (me.includes(f.actor)) {
        const i = rs.findIndex((r, j) => !used.has(j) && r.kind === f.kind && Math.abs(r.at - Number(f.at)) < 180_000);
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
  function move(btn: HTMLButtonElement, out: HTMLElement, fn: () => Promise<{ hash?: string; value?: unknown }>, ok: (v: any) => string, kind: string, after?: (v: any) => void, fin?: () => void) {
    btn.onclick = async () => {
      if (btn.classList.contains("busy")) return;
      const label = btn.innerHTML;
      btn.classList.add("busy");
      btn.disabled = true;
      btn.textContent = "In flight";
      out.className = "s-msg";
      out.textContent = "Waiting for the chain to confirm…";
      try {
        const r = await fn();
        keepReceipt(kind, r.hash);
        const text = ok(r.value);
        out.className = "s-msg ok";
        out.textContent = text;
        toast({ tone: "gold", title: esc(text) });
        after?.(r.value);
        btn.classList.remove("busy");
        btn.disabled = false;
        btn.innerHTML = label;
        await refresh();
      } catch (e) {
        console.warn(e);
        sfx.play("deny");
        out.className = "s-msg bad";
        out.textContent = plainError(e);
      } finally {
        fin?.();
        btn.classList.remove("busy");
        btn.disabled = false;
        btn.innerHTML = label;
        updateSheet();
      }
    };
  }

  function updateSheet() {
    if (!sheet || sheet.closed || currentSheet() !== sheet) return;
    if (sheetKind === "shield") updateShield();
    if (sheetKind === "bag") updateBag();
    if (sheetKind === "satoshi") updateSatoshi();
    if (sheetKind === "under") updateUnderRaid();
    if (sheetKind === "market") updateMarket();
    if (sheetKind === "activity") { const l = sheet.body.querySelector<HTMLElement>(".log"); if (l) { const h = activityHtml(30); if (l.innerHTML !== h) l.innerHTML = h; } }
  }

  // ----- under raid card (from a toast)

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
    const act2 = B.querySelector<HTMLElement>("#ur-act")!;
    const out = B.querySelector<HTMLElement>("#ur-msg")!;
    if (closed) {
      act2.innerHTML = `<p class="s-text">Time is up. The raid settles in a moment.</p><button class="btn wide ghost" id="ur-go">Settle it now</button>`;
      move(act2.querySelector("#ur-go")!, out, () => chain.resolve(r.id), (v) => `Settled. The raid took ${full(String(v ?? "0"))}.`, "resolve");
    } else if (!exposed) {
      act2.innerHTML = `<p class="s-text">Shoot the raider in the arena, or defend from here: their stake of ${full(r.stake)} is yours, less a ${pct(P(c(), "raid_burn_bps"))} burn.</p><button class="btn wide" id="ur-go">Defend</button><button type="button" class="btn ghost wide small" id="ur-share">${I.share} Call for backup</button>`;
      act2.querySelector<HTMLButtonElement>("#ur-share")!.onclick = () => shareRaid(r);
      act2.querySelector<HTMLButtonElement>("#ur-go")!.onclick = () => { sheet?.close(); defendByShot(r); };
    } else if (w.walletBal === 0n) {
      act2.innerHTML = `<p class="s-text">Your coins are already in your vault. Watch the clock.</p>`;
    } else {
      act2.innerHTML = `<p class="s-text">Exposed coins can't defend. They can run: reach the gold gate in the arena before the clock runs out and the raid gets nothing.</p><button class="btn wide hot" id="ur-go">Back to the arena</button><button type="button" class="btn ghost wide small" id="ur-share">${I.share} Call for backup</button>`;
      act2.querySelector<HTMLButtonElement>("#ur-share")!.onclick = () => shareRaid(r);
      act2.querySelector<HTMLButtonElement>("#ur-go")!.onclick = () => sheet?.close();
    }
  }
  const cleanWhy = (s: string) =>
    s.replace(/qubit-(\d+)/g, "Qubit $1").replace(/\$(QDAY|KEYFALL)/g, "coins").replace(/ \(0% shield\)/, "");

  // ----- your bag: the memecoin loop in numbers, every one from the chain

  function openBag() {
    show("bag", "", "Your bag", `
      <p class="kick gold">${NET_LABEL} arena</p>
      <h2 class="s-title">Your bag</h2>
      <div class="bag-grid" id="bag-grid"></div>
      <div class="set-block"><div class="set-h"><b>Your keys</b></div><div id="bag-keys" class="keys-list"></div></div>
      <p class="s-text dim">Red bags leak to vaults every round and freeze at Q-Day. The coin is your score, your ammo (stakes) and your armour (shields).</p>`, "gold");
    updateBag();
  }
  function updateBag() {
    const B = sheet?.body; if (!B || sheetKind !== "bag") return;
    const s = sess(), st = w.stats;
    const grid = B.querySelector<HTMLElement>("#bag-grid")!;
    const me = mine();
    const bag = myBag();
    const rows: [string, string, string?][] = [];
    rows.push(["Coins now", `<b>${full(bag)}</b>`]);
    rows.push(["Sells for now", w.sellQuote !== null ? `<b>${chain.fmtNear(w.sellQuote, 3)} NEAR</b>` : "…", "the contract's own sell quote for the whole bag"]);
    if (MAIN && paidNear() > 0) rows.push(["You paid", `${paidNear().toFixed(2)} NEAR`]);
    const hv = harvestFlow();
    if (hv && st) rows.push([inVault() ? "Next harvest to you" : "Next harvest leak", `<b class="${hv.gain ? "yel" : "red"}">${hv.gain ? "+" : "−"}${full(hv.amount)}</b> <small>in <span data-until="${st.epoch_ends_ms}">${span(Number(st.epoch_ends_ms) - chainNow())}</span></small>`]);
    // your raids this session, from the chain's raid records
    const won = w.myRaids.filter((r) => r.status === "resolved" && BigInt(r.take) > 0n);
    const blocked = w.myRaids.filter((r) => r.status === "defended");
    const sum = (xs: string[]) => xs.reduce((a, x) => a + BigInt(x), 0n);
    rows.push(["Raids won", won.length ? `<b class="yel">+${full(sum(won.map((r) => r.take)))}</b> <small>${won.length} raid${won.length === 1 ? "" : "s"}</small>` : "none yet"]);
    rows.push(["Raids blocked", blocked.length ? `<b class="red">−${full(sum(blocked.map((r) => r.stake)))}</b> <small>${blocked.length} stake${blocked.length === 1 ? "" : "s"} lost</small>` : "none"]);
    const onMe = w.feed.filter((f) => f.kind === "resolve" && me.includes(f.target || ""));
    rows.push(["Raids on you", onMe.length ? `<b class="red">−${full(sum(onMe.map((f) => f.amount)))}</b> <small>${onMe.length} recent</small>` : "none recent"]);
    grid.innerHTML = rows.map(([k, v, note]) => `<div><dt>${k}${note ? `<small>${note}</small>` : ""}</dt><dd>${v}</dd></div>`).join("");
    const keys = B.querySelector<HTMLElement>("#bag-keys")!;
    const signed = receipts().filter((r) => ["raid", "defend", "shield", "boss"].includes(r.kind)).length;
    keys.innerHTML = `
      ${s.wallet ? `<a class="key-row" href="${chain.accountLink(s.wallet.accountId)}" target="_blank" rel="noopener"><b class="red">Wallet key: ed25519</b><span>an old key, a quantum computer can crack it</span></a>` : ""}
      ${s.vault ? `<a class="key-row" href="${chain.accountLink(s.vault.accountId)}" target="_blank" rel="noopener"><b class="yel">Vault key: ML-DSA-65</b><span>quantum safe, it signed ${signed} of your move${signed === 1 ? "" : "s"}</span></a>` : `<p class="m-hint">No vault yet: the gold door makes one with a quantum safe key.</p>`}`;
  }

  // ----- shield

  function openShield() {
    show("shield", "", "Shield", `
      <div class="who"><span class="av big icon gold">${I.shield}</span><div><h2 class="s-title">Shield</h2><p class="who-sub" id="sh-now"></p></div></div>
      <p class="s-text">Shield: shots on you take less. Burn a slice of your bag for a shield that cuts what any raid takes, until the next harvest. Burning 1% gives 10%, 4% gives 20%, 9% gives 30%.</p>
      <label class="s-range"><span>Burn</span><input type="range" id="sh-r" min="0" max="900" step="25" value="400"/></label>
      <p class="s-calc" id="sh-calc"></p>
      <button class="btn wide" id="sh-go">Charge shield</button>
      <p class="s-msg" id="sh-msg" role="status"></p>`, "gold");
    const r = sheet!.body.querySelector<HTMLInputElement>("#sh-r")!;
    r.addEventListener("input", updateShield);
    move(sheet!.body.querySelector("#sh-go")!, sheet!.body.querySelector("#sh-msg")!, () => chain.chargeShield(bps(w.vaultBal, Number(r.value)).toString()), (v) => `Shield up: ${pct(Number(v ?? 0))} until the next harvest.`, "shield", () => { sfx.vibrate(40); earn("shield"); setTimeout(() => sheet?.close(), 900); });
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

  // ----- satoshi (the boss sheet, from the menu; the hit itself is by touch in the arena)

  function openSatoshi() {
    show("satoshi", "", "Satoshi boss fight", `
      <div class="boss">
        <p class="kick gold">Boss fight</p>
        <div class="boss-art" id="bs-art">${ART_SATOSHI_RED}<span class="bp-say boss-say" id="bs-say" hidden></span></div>
        <h2 class="s-title center">Satoshi</h2>
        <div class="hp"><div class="hp-bar"><i id="bs-hp"></i></div><div class="hp-nums"><b id="bs-stash">··</b><span id="bs-of"></span></div></div>
        <p class="s-text center" id="bs-rule"></p>
        <p class="s-calc center" id="bs-next"></p>
        <button class="btn wide hot big" id="bs-go">HIT</button>
        <p class="s-msg center" id="bs-msg" role="status"></p>
        <div class="boss-log"><span class="label">Last hits</span><ul id="bs-log"></ul></div>
      </div>`, "gold");
    sheet!.el.classList.add("boss-sheet");
    move(sheet!.body.querySelector("#bs-go")!, sheet!.body.querySelector("#bs-msg")!, () => chain.bossRaid(), (v) => {
      const kept = BigInt(String(v ?? "0"));
      const burn = BigInt(P(c(), "boss_burn_bps"));
      const dealt = burn > 0n ? (kept * 10000n + (10000n - burn) - 1n) / (10000n - burn) : kept;
      return `You dealt ${full(dealt)} · kept ${full(kept)}`;
    }, "boss", (v) => {
      const B = sheet?.body;
      if (B?.isConnected) {
        const art = B.querySelector<HTMLElement>("#bs-art")!;
        art.classList.add("hit"); setTimeout(() => art.classList.remove("hit"), 700);
        fx.pop(B.querySelector<HTMLElement>(".boss")!, `−${full(String(v ?? "0"))}`, "red", { x: 50, y: 22 });
        const sy = B.querySelector<HTMLElement>("#bs-say")!;
        sy.textContent = line("satoshi", "hit", String(Math.random())); sy.hidden = false;
        setTimeout(() => { sy.hidden = true; }, 3800);
      }
      fx.shake(game, true); fx.freeze(game, 120); sfx.play("thud"); sfx.vibrate([90, 30, 50]);
      earn("slayer");
    });
    updateSatoshi();
  }
  function updateSatoshi() {
    const B = sheet!.body, v = w.vault, st = w.stats;
    if (!st || !B.isConnected) return;
    const stash = BigInt(st.satoshi_tokens);
    const supply = PB(c(), "satoshi_supply");
    const hit = minB(bps(stash, P(c(), "boss_bps")), PB(c(), "boss_cap"));
    const keep = hit - bps(hit, P(c(), "boss_burn_bps"));
    B.querySelector<HTMLElement>("#bs-stash")!.textContent = full(stash);
    B.querySelector<HTMLElement>("#bs-of")!.textContent = supply > 0n ? `of ${full(supply)}` : "";
    B.querySelector<HTMLElement>("#bs-hp")!.style.width = `${supply > 0n ? Number((stash * 10000n) / supply) / 100 : 0}%`;
    B.querySelector<HTMLElement>("#bs-rule")!.textContent = `Every player can hit once ${every(P(c(), "epoch_ms"))}. A hit takes ${pct(P(c(), "boss_bps"))} of the stash, up to ${full(PB(c(), "boss_cap"))}. ${pct(P(c(), "boss_burn_bps"))} burns. In the arena, touch his core.`;
    const enough = !!v && w.vaultBal >= PB(c(), "boss_min_balance");
    B.querySelector<HTMLElement>("#bs-next")!.innerHTML = !v ? "Only a vault can hit Satoshi." : !enough ? `Your vault needs ${full(PB(c(), "boss_min_balance"))} coins to hit Satoshi.` : v.boss_ready ? `A hit now takes <b class="yel">${full(hit)}</b>. You keep <b class="yel">${full(keep)}</b>.` : `Next hit ready in <b data-until="${st.epoch_ends_ms}">${span(Number(st.epoch_ends_ms) - chainNow())}</b>.`;
    const go = B.querySelector<HTMLButtonElement>("#bs-go")!;
    if (!go.classList.contains("busy")) { go.disabled = !(v && enough && v.boss_ready); go.textContent = v?.boss_ready ? "HIT" : "HIT · on cooldown"; }
    const hits = w.feed.filter((f) => f.kind === "boss").slice(0, 5);
    B.querySelector<HTMLElement>("#bs-log")!.innerHTML = hits.map((f) => `<li><span class="av">${avatar(f.actor)}</span><span>${N(f.actor)} hit for <b>${full(f.amount)}</b></span><small>${ago(Number(f.at))}</small></li>`).join("") || `<li class="empty">Nobody has hit Satoshi yet.</li>`;
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
      if (payer === "vault") { const r = await chain.buy(mkNear, "vault"); if (MAIN) addPaid(mkNear); return r; }
      if (payer !== "wallet") throw new Error("balance");
      const r = await chain.buy(mkNear, "wallet");
      if (MAIN) addPaid(mkNear);
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
      ? `${NET_LABEL} NEAR: vault ${f2(w.vaultNear)}${sess().wallet ? `, wallet ${f2(w.walletNear)}` : ""}`
      : `${NET_LABEL} NEAR in your wallet: ${f2(w.walletNear)}`;
    for (const b of B.querySelectorAll<HTMLButtonElement>("[data-n]")) {
      const need = BigInt(chain.nearToYocto(Number(b.dataset.n)));
      b.disabled = !((sess().vault && spendable(w.vaultNear) >= need) || (sess().wallet && spendable(w.walletNear) >= need));
    }
    const bgo = B.querySelector<HTMLButtonElement>("#mk-bgo")!;
    if (!bgo.classList.contains("busy")) {
      const p = buyPayer();
      bgo.disabled = !p;
      bgo.textContent = p ? `Buy for ${mkNear} NEAR` : `Not enough ${NET_LABEL.toLowerCase()} NEAR`;
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
      <div class="set-row"><span class="set-k">Arena</span><b>${NET_LABEL}${(chain.NETWORK as string) === "mainnet" ? "" : " · free play"}</b></div>
      <div class="set-row"><span class="set-k">Your vault</span><b>${s.vault ? esc(nameOf(s.vault.accountId)) : "No vault yet"}</b></div>
      ${s.vault ? `<div class="set-block${prog().backedUp === s.vault.accountId ? "" : " warn"}">
        <div class="set-h"><b>Back up vault key</b>${prog().backedUp === s.vault.accountId ? `<span class="chip vault">Saved</span>` : `<span class="chip exposed">Not saved</span>`}</div>
        <p class="s-text">Your vault key lives sealed in this browser. The recovery code opens your vault on any device. Keep it somewhere safe and never share it.</p>
        <div id="bk"><button type="button" class="btn wide ghost" id="bk-show">Show recovery code</button></div>
      </div>` : ""}
      <div class="titles"><span class="set-k">Your titles</span><div class="title-row">${(Object.keys(TITLES) as TitleKey[]).map((k) => `<span class="ttl ${titles().includes(k) ? "on" : ""}" title="${TITLES[k][1]}">${TITLES[k][0]}</span>`).join("")}</div>
        ${titles().length ? `<button type="button" class="btn ghost wide small" id="st-share">${I.share} Share your titles</button>` : `<p class="m-hint">Earn titles by playing: build a vault, escape a raid, shield, defend, raid, hit Satoshi.</p>`}</div>
      <div class="set-list">
        <button type="button" class="set-item" id="st-act"><span>Activity</span><span>›</span></button>
        <button type="button" class="set-item" id="st-boss"><span>Satoshi boss fight</span><span>›</span></button>
        <button type="button" class="set-item" id="st-net"><span>Switch arena</span><span>${MAIN ? "Mainnet" : "Practice"}</span></button>
        ${MAIN && s.vault ? `<button type="button" class="set-item" id="st-cash"><span>Cash out NEAR</span><span>›</span></button>` : ""}
        ${MAIN && s.wallet && !s.vault ? `<button type="button" class="set-item" id="st-topup"><span>Top up wallet</span><span>›</span></button>` : ""}
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
    B.querySelector<HTMLButtonElement>("#st-boss")!.onclick = () => openSatoshi();
    B.querySelector<HTMLButtonElement>("#st-net")!.onclick = () => openNetwork();
    const cash = B.querySelector<HTMLButtonElement>("#st-cash");
    if (cash) cash.onclick = () => openCashOut();
    const tu = B.querySelector<HTMLButtonElement>("#st-topup");
    if (tu) tu.onclick = () => openTopUp();
    const shareT = B.querySelector<HTMLButtonElement>("#st-share");
    if (shareT) shareT.onclick = async () => {
      const names = titles().map((k) => TITLES[k][0]).join(", ");
      const text = `I'm ${names} in ${GAME}. Run your coins into a quantum vault before Q-Day.`;
      const url = location.origin;
      try { if (navigator.share) { await navigator.share({ title: GAME, text, url }); return; } } catch { return; }
      window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener");
    };
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
        const text = `${GAME} vault recovery code\n\nVault: ${vname}\nCode: ${code}\n\nThis code opens your vault on any device. Keep it private.\n`;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        a.download = `keyfall-vault-${vname}.txt`;
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
      prevState = "";
      refresh();
    };
  }

  function openActivity() {
    show("activity", "", "Activity", `<h2 class="s-title">Activity</h2><ul class="log">${activityHtml(30)}</ul>`);
  }

  // pinned raid toast: tap for the detail sheet
  /** Your open raids, top right under the map: who, and the clock until it lands. Coins fly to you when one settles. */
  let trkKey = "";
  function renderRaidTracker() {
    const el = root.querySelector<HTMLElement>("#raid-trk")!;
    const all = w.myRaids.filter((r) => r.status === "open").sort((a, b) => a.deadline - b.deadline);
    const open = all.slice(0, 2); // two rows at most: the ROBBING badges in the world carry the rest
    const key = all.map((r) => `${r.id}:${r.deadline}`).join("|") + (guideOn() ? "g" : "");
    if (key === trkKey) return;
    trkKey = key;
    el.hidden = !open.length || guideOn();
    el.innerHTML = open.map((r) => `<li class="rt${r.target_kind === "vault" ? " v" : ""}"><span class="av">${avatar(r.target)}</span><span class="rt-n">${N(r.target)}</span><b data-until="${r.deadline}">${clock(r.deadline - chainNow())}</b></li>`).join("") + (all.length > 2 ? `<li class="rt more">+${all.length - 2} more robbing</li>` : "");
  }

  function renderPinned() {
    const r = w.incoming;
    let pin = evHost.querySelector<HTMLButtonElement>(".ev.pin");
    const m = mission();
    const covered = ((m.k === "build" || m.k === "movein") && !!m.raid) || m.k === "defend"; // the strip already shows this raid
    if (!r || covered || stripOpen() || guideOn()) { pin?.remove(); return; } // the guide card speaks alone
    const live = threat();
    if (!pin || pin.dataset.id !== `${r.id}:${live}`) {
      pin?.remove();
      pin = document.createElement("button");
      pin.type = "button";
      pin.className = `ev pin ${live ? "tone-hot" : "calm"}`;
      pin.dataset.id = `${r.id}:${live}`;
      const onVault = r.target === sess().vault?.accountId;
      const shield = onVault && (w.vault?.shield_bps || 0) > 0 ? ` · shield takes ${pct(w.vault!.shield_bps)} off` : "";
      const what = live ? `${N(r.attacker).toUpperCase()} IS ROBBING YOU${shield} · ${onVault ? "SHOOT BACK" : "RUN TO THE GOLD DOOR"}` : `${N(r.attacker)}'s raid finds an empty wallet`;
      pin.innerHTML = `<span class="av">${avatar(r.attacker)}</span><span class="ev-t">${what}</span><b class="ev-clock" data-until="${r.deadline}">${clock(r.deadline - chainNow())}</b>`;
      pin.onclick = () => openUnderRaid();
      evHost.appendChild(pin);
    }
  }

  // ---------------------------------------------------------------- render

  function render() {
    if (!w.ok && !loaded) { renderMission(); renderArena(); return; }
    renderHud();
    renderMission();
    renderArena();
    renderPinned();
    renderRaidTracker();
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
    if (sheetKind === "shield" || sheetKind === "satoshi" || sheetKind === "under") updateSheet();
    settleDue(now);
    if (due) refresh();
  }, 1000);

  /** A raid of yours (or on you) whose clock ran out: settle it from this browser right away, so the coins
   * fly at zero instead of whenever the next crank runs. resolve() is permissionless and the contract checks the clock. */
  const settling = new Set<number>();
  function settleDue(now: number) {
    if (!sess().wallet && !sess().vault) return;
    const due = [...w.myRaids, ...(w.incoming ? [w.incoming] : []), ...(w.escape ? [w.escape] : [])]
      .filter((r) => r.status === "open" && Number(r.deadline) + 2500 < now && !settling.has(r.id));
    for (const r of due.slice(0, 2)) {
      settling.add(r.id);
      chain.resolve(r.id).then(() => refresh()).catch(() => { setTimeout(() => settling.delete(r.id), 15_000); });
    }
  }

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
  if (!introDone) { introDone = true; coldOpen(); }
  tick(false);
  // While the game is open, wake the NPCs once a minute: they settle closed raids,
  // run the harvest when it is due, and answer raids on their own vaults.
  const npcBeat = window.setInterval(() => tick(false), 30_000); // rounds are short now: wake the bots every 30 s

  const guideT = window.setInterval(() => { if (alive) guideTick(); }, 300);
  holdTicks = () => guideHolds() || (!guideSave().done && !!sess().wallet && !sess().vault); // a red first timer is never pointed at

  // debugging and acceptance: fps and world on the element
  (field as any).__arena = arena;
  (field as any).__toastTitle = (k: TitleKey) => { const [name, why] = TITLES[k]; toast({ tone: "gold", cls: "ev-title", title: `<b>Title earned</b> · ${esc(name)} · ${esc(why)}` }); }; // styling check only: stores nothing
  (field as any).__guide = () => ({ step: gstep, on: guideOn(), holds: guideHolds(), target: gTarget, variant: gVariant });
  (field as any).__world = () => ({ incoming: w.incoming, myRaids: w.myRaids.length, walletBal: String(w.walletBal), vaultBal: String(w.vaultBal), vault: sess().vault?.accountId, wallet: sess().wallet?.accountId, holders: w.holders.length, raidsLeft: w.vault?.raids_left });

  return () => {
    alive = false;
    pollT();
    clearInterval(clockT);
    clearInterval(npcBeat);
    clearInterval(tauntT);
    clearInterval(guideT);
    holdTicks = () => false;
    offMute();
    arena.destroy();
    sheet?.close();
    document.body.classList.remove("in-game");
  };
}
