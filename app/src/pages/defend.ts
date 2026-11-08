// /d/:id: the defend link. Works opened cold from a DM or a post.

import * as chain from "../chain";
import { type Raid, type Params } from "../chain";
import { chainNow, esc, poll, syncClock } from "../ui/dom";
import { avatar } from "../ui/avatars";
import { isNpc, nameOf } from "../ui/names";
import { P, clock, full, minutes, pct, plainError } from "../ui/plain";

export function defendPage(root: HTMLElement, params: Record<string, string>) {
  const id = params.id;
  root.innerHTML = `
    <section class="defend">
      <div class="d-card" id="d-card">
        <p class="kick red" id="d-kick">Defend link</p>
        <h1 class="s-title" id="d-title">Reading the raid…</h1>
        <div class="d-vs" id="d-vs"></div>
        <div class="big-clock" id="d-clock" hidden></div>
        <div class="d-facts" id="d-facts"></div>
        <div class="d-act" id="d-act"></div>
        <p class="s-msg" id="d-msg" role="status"></p>
      </div>
    </section>`;

  let config: Params | null = null;
  let raid: Raid | null = null;
  let key = "";
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;

  async function refresh() {
    try {
      const [s, r] = await Promise.all([chain.getStats(), chain.getRaid(id)]);
      syncClock(s.now_ms);
      raid = r;
      config = config || (await chain.getConfig().catch(() => null));
    } catch {
      if (!raid) $("#d-title").textContent = "Can't reach NEAR right now";
      return;
    }
    const r = raid;
    if (!r) {
      $("#d-title").textContent = "No such raid";
      $("#d-kick").textContent = "Defend link";
      $("#d-act").innerHTML = `<a class="btn wide" href="/play" data-link>Play Q-DAY</a>`;
      return;
    }
    await chain.loadSession();
    const s = chain.session();
    const mine = [s.wallet?.accountId, s.vault?.accountId].filter(Boolean) as string[];
    const myVault = s.vault?.accountId === r.target;
    const myWallet = s.wallet?.accountId === r.target;
    const open = r.status === "open";
    const closed = r.deadline < chainNow();
    const N = (a: string) => esc(nameOf(a, mine));
    $("#d-card").className = `d-card ${open && !closed ? "hot" : r.status === "defended" ? "gold" : ""}`;
    $("#d-kick").textContent = open ? (closed ? "Time is up" : "Raid in progress") : "Raid over";
    $("#d-title").innerHTML = open
      ? closed ? "The window has closed" : myVault || myWallet ? "You are being raided" : `${N(r.attacker)} is raiding ${N(r.target)}`
      : r.status === "defended" ? `${N(r.target)} defended` : BigInt(r.take) > 0n ? `The raid took ${full(r.take)}` : "The raid took nothing";
    $("#d-vs").innerHTML = `<div><span class="av">${avatar(r.attacker)}</span><b>${N(r.attacker)}${isNpc(r.attacker) ? `<span class="tag">NPC</span>` : ""}</b></div><span class="vs">vs</span><div><span class="av">${avatar(r.target)}</span><b>${N(r.target)}</b><span class="chip ${r.target_kind}">${r.target_kind === "vault" ? "Vault" : "Exposed"}</span></div>`;
    const ck = $("#d-clock");
    ck.hidden = !(open && !closed);
    ck.dataset.until = String(r.deadline);
    ck.textContent = clock(r.deadline - chainNow());
    const share = r.target_kind === "vault" ? P(config, "vault_take_bps") : P(config, "take_bps");
    $("#d-facts").innerHTML = `
      <div><span>Raider's stake</span><span>${full(r.stake)}</span></div>
      ${open ? `<div><span>At risk</span><span>${pct(share)} of the bag, up to ${P(config, "stake_mult")} times the stake</span></div>` : ""}
      ${open ? `<div><span>Defend window</span><span>${minutes(P(config, "defend_window_ms"))}</span></div>` : ""}`;

    const k = `${r.status}:${closed}:${myVault}:${myWallet}:${!!s.vault}:${!!s.wallet}`;
    if (k === key) return;
    key = k;
    const host = $("#d-act");
    const msg = $("#d-msg");
    const run = (btn: HTMLButtonElement, fn: () => Promise<unknown>, ok: (v: any) => string) => {
      btn.onclick = async () => {
        if (btn.classList.contains("busy")) return;
        btn.classList.add("busy"); btn.disabled = true; msg.className = "s-msg"; msg.textContent = "Sending…";
        try { const v: any = await fn(); msg.className = "s-msg ok"; msg.textContent = ok(v?.value); key = ""; await refresh(); }
        catch (e) { msg.className = "s-msg bad"; msg.textContent = plainError(e); }
        finally { btn.classList.remove("busy"); btn.disabled = false; }
      };
    };
    if (!open) {
      host.innerHTML = `<a class="btn wide" href="/play" data-link>Play Q-DAY</a>`;
    } else if (closed) {
      host.innerHTML = `<p class="s-text">Anyone can settle the raid now${s.wallet || s.vault ? "" : ". We'll make you a free testnet wallet first"}.</p><button class="btn wide hot" id="d-go">Settle it</button>`;
      run($<HTMLButtonElement>("#d-go"), async () => { if (!chain.session().wallet && !chain.session().vault) await chain.join(); return chain.resolve(r.id); }, (v) => `Settled. The raid took ${full(String(v ?? "0"))}.`);
    } else if (myVault) {
      host.innerHTML = `<p class="s-text">Defend now and their stake is yours, less a ${pct(P(config, "raid_burn_bps"))} burn.</p><button class="btn wide" id="d-go">Defend</button>`;
      run($<HTMLButtonElement>("#d-go"), () => chain.defend(r.id), () => "You defended! Their stake is yours.");
    } else if (myWallet) {
      host.innerHTML = `<p class="s-text">Exposed coins can't defend, but they can escape into a vault before the clock runs out.</p><a class="btn wide hot" href="/play" data-link>Escape in the game</a>`;
    } else {
      host.innerHTML = `
        <p class="s-text">Is this your vault? Restore it on this device with your recovery code, then defend.</p>
        <label class="m-field"><span>Vault name</span><input id="d-n" autocomplete="off" autocapitalize="off" spellcheck="false" value="${r.target_kind === "vault" ? esc(nameOf(r.target)) : ""}"/></label>
        <label class="m-field"><span>Recovery code</span><input id="d-c" autocomplete="off" autocapitalize="characters" spellcheck="false"/></label>
        <button class="btn wide ghost" id="d-rs">Restore vault</button>
        <a class="btn wide" href="/play" data-link>Play Q-DAY</a>`;
      run($<HTMLButtonElement>("#d-rs"), () => chain.restoreVault($<HTMLInputElement>("#d-n").value.trim(), $<HTMLInputElement>("#d-c").value.trim()), () => "Vault restored on this device.");
    }
  }

  const stop = poll(refresh, 5000);
  const t = window.setInterval(() => {
    const ck = root.querySelector<HTMLElement>("#d-clock");
    if (ck && !ck.hidden) { const left = Number(ck.dataset.until) - chainNow(); ck.textContent = clock(left); if (left <= 0 && left > -1200) { key = ""; refresh(); } }
  }, 1000);
  return () => { stop(); clearInterval(t); };
}
