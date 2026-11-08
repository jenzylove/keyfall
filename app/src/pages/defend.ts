import * as chain from "../chain";
import { fmtTokens, type Raid, type Params } from "../chain";
import { $, act, chainNow, esc, failIn, isNpc, maybe, poll, short, syncClock, text } from "../ui/dom";
import { countdown } from "../ui/widgets";
import { restoreForm } from "../ui/vaultform";
import { numParam, pct } from "../ui/params";

export function defendPage(root: HTMLElement, params: Record<string, string>) {
  const id = params.id;
  root.innerHTML = `
    <section class="wrap page-title">
      <p class="eyebrow"><span class="dot"></span>Defend link · raid ${esc(id)}</p>
      <h1 class="display h2" id="d-title">Raid ${esc(id)}</h1>
      <div class="calc" id="d-facts"><div><span class="dim">reading the chain…</span></div></div>
    </section>
    <section class="wrap" style="padding-bottom:28px"><span class="label" id="d-cd-label">Defend window</span><div id="d-cd" style="margin-top:10px"></div></section>
    <section class="band" style="padding-top:36px"><div class="wrap cold" id="d-act"></div></section>`;

  const cd = countdown($("#d-cd", root), { compact: true, onZero: () => refresh() });
  let config: Params | null = null;
  let key = "";

  async function refresh() {
    let r: Raid | null;
    try {
      const [s, raid] = await Promise.all([chain.getStats(), chain.getRaid(id)]);
      syncClock(s.now_ms);
      r = raid;
      config = config || (await chain.getConfig().catch(() => null));
    } catch {
      failIn(maybe("#d-facts", root));
      return;
    }
    if (!r) {
      text($("#d-title", root), "No such raid");
      $("#d-cd-label", root).hidden = true;
      $("#d-facts", root).innerHTML = `<div><span>There is no raid ${esc(id)} on this contract.</span></div>`;
      $("#d-act", root).innerHTML = `<div><a class="btn" href="/play" data-link>Play Q-DAY <span class="arrow">→</span></a></div>`;
      return;
    }
    await chain.loadSession();
    const s = chain.session();
    const mine = s.vault?.accountId === r.target;
    const mineWallet = s.wallet?.accountId === r.target;
    const open = r.status === "open";
    const closed = Number(r.deadline) < chainNow();
    const tName = (a: string) => `${esc(short(a, 26))}${isNpc(a) ? '<span class="tag npc">NPC</span>' : ""}`;
    text($("#d-title", root), open ? (closed ? "Window closed" : mine || mineWallet ? "You are under raid" : "Raid in progress") : r.status === "defended" ? "Defended" : "Settled");
    const take = r.target_kind === "vault" ? numParam(config || {}, "vault_take_bps") : numParam(config || {}, "take_bps");
    $("#d-facts", root).innerHTML = `
      <div><span>Raider</span><b>${tName(r.attacker)}</b></div>
      <div><span>Target</span><b>${tName(r.target)} <span class="tag ${r.target_kind === "vault" ? "qv" : "ex"}">${r.target_kind}</span></b></div>
      <div><span>Stake</span><b>${fmtTokens(r.stake)} $QDAY</b></div>
      <div><span>Status</span><b>${open ? (closed ? "window closed, waiting to settle" : "open") : r.status === "defended" ? `defended, the stake went to the target` : `settled, took ${fmtTokens(r.take)} $QDAY`}</b></div>
      ${open && config ? `<div><span>At stake for the target</span><b>${pct(take)} of the bag, capped at ${numParam(config, "stake_mult")}× stake</b></div>` : ""}`;
    if (open && !closed) { cd.set(Number(r.deadline)); text($("#d-cd-label", root), "Defend window"); }
    else { cd.set(Number(r.deadline)); text($("#d-cd-label", root), open ? "Window closed" : "Over"); }
    document.body.classList.toggle("alert", open && !closed && (mine || mineWallet));

    const k = `${r.status}:${closed}:${mine}:${mineWallet}:${!!s.vault}:${!!s.wallet}`;
    if (k === key) return;
    key = k;
    const host = $("#d-act", root);
    if (!open) {
      host.innerHTML = `<p>This raid is over.</p><div><a class="btn" href="/play" data-link>Play Q-DAY <span class="arrow">→</span></a></div>`;
    } else if (closed) {
      host.innerHTML = `<p>The window has closed. Anyone can settle the raid now${s.wallet || s.vault ? "" : ". This makes you a free testnet wallet first"}.</p><div><button class="btn hot" id="d-go">Settle <span class="arrow">→</span></button></div><p class="msg" id="d-msg"></p>`;
      const b = $<HTMLButtonElement>("#d-go", host);
      b.onclick = () => act(b, $("#d-msg", host), async () => {
        if (!chain.session().wallet && !chain.session().vault) await chain.join();
        return chain.resolve(r!.id);
      }, (x: any) => `Settled. Take: ${fmtTokens(String(x?.value ?? "0"))}.`).then(() => { key = ""; refresh(); });
    } else if (mine) {
      host.innerHTML = `<p>This device holds the target vault. Defend now and the raider's stake is yours, minus a burn.</p><div><button class="btn wide" id="d-go">Defend <span class="arrow">→</span></button></div><p class="msg" id="d-msg"></p>`;
      const b = $<HTMLButtonElement>("#d-go", host);
      b.onclick = () => act(b, $("#d-msg", host), () => chain.defend(r!.id), () => "Defended. The stake is yours.").then(() => { key = ""; refresh(); });
    } else if (mineWallet) {
      host.innerHTML = `<p>This is your exposed wallet. It cannot defend, but it can escape into a vault before the clock runs out.</p><div><a class="btn" href="/play" data-link>Escape on the game screen <span class="arrow">→</span></a></div>`;
    } else {
      host.innerHTML = `
        <h2 class="display h3">Is this your vault?</h2>
        <p>Restore it on this device with your recovery code, then defend.</p>
        <div id="d-restore" style="display:grid;gap:14px"></div>
        <div class="or">or</div>
        <div><a class="btn" href="/play" data-link>Play Q-DAY <span class="arrow">→</span></a></div>`;
      restoreForm($("#d-restore", host), { name: r.target_kind === "vault" ? r.target : "", onDone: () => { key = ""; refresh(); } });
    }
  }

  const stop = poll(refresh, 5000);
  return () => { stop(); cd.stop(); document.body.classList.remove("alert"); };
}
