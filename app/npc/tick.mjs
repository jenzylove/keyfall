// One NPC tick: read the chain, ask rules.mjs what to do, send the moves.
// Shared by the Vercel function (app/api/tick.ts) and the GitHub Actions crank
// (scripts/crank.mjs). Never logs a seed.

import * as near from "@fastnear/api";
import { signerFromSeed } from "@fastnear/ml-dsa-65";
import { signerFromPrivateKey } from "@fastnear/utils";
import { decide, decideHunt, ROSTER, bagholdersOf } from "./rules.mjs";

const TGAS = (n) => (BigInt(n) * 10n ** 12n).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16)));

function unwrap(res) {
  return res && res.result ? res.result : res;
}
function txHash(res) {
  const r = unwrap(res);
  return r?.transaction?.hash || r?.transaction_outcome?.id || null;
}
function failure(res) {
  const r = unwrap(res);
  if (r?.status?.Failure) return JSON.stringify(r.status.Failure);
  for (const o of r?.receipts_outcome || []) {
    if (o?.outcome?.status?.Failure) return JSON.stringify(o.outcome.status.Failure);
  }
  return null;
}

async function sendCall({ network, signerId, signer, contract, methodName, args, gas = 100, deposit = "0" }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await near.sendTx({
        signerId,
        signer,
        receiverId: contract,
        actions: [near.actions.functionCall({ methodName, args, gas: TGAS(gas), deposit })],
        waitUntil: "EXECUTED_OPTIMISTIC",
        network,
      });
      return { hash: txHash(res), error: failure(res) };
    } catch (e) {
      const msg = String(e?.message || e);
      if (attempt < 2 && /fetch|ECONN|timeout|503|502|429/i.test(msg)) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      return { hash: null, error: msg.slice(0, 300) };
    }
  }
}

/** All holders, in registration order, page by page. */
async function allHolders(view) {
  const count = Number(await view("holder_count"));
  const out = [];
  for (let from = 0; from < count; from += 200) out.push(...(await view("holders", { from_index: from, limit: 200 })));
  return out;
}

/** First time we can see each account in the on-chain feed (the last 64 moves). */
async function firstSeenFromFeed(view) {
  const seen = {};
  const feed = await view("feed", { limit: 64 });
  for (const f of [...feed].reverse()) {
    for (const a of [f.actor, f.target]) if (a && seen[a] === undefined && (f.kind === "buy" || f.kind === "vault")) seen[a] = Number(f.at);
  }
  return seen;
}

export async function tick({ contract, seeds, network = "testnet", dryRun = false }) {
  const view = (methodName, args = {}) => near.view({ contractId: contract, methodName, args, network });
  const [config, stats, holders, openRaids] = await Promise.all([
    view("config"),
    view("stats"),
    allHolders(view),
    view("open_raids", { scan: 100 }),
  ]);

  const names = ROSTER.map((r) => r.name).filter((n) => seeds[n]);
  const npcViews = (await Promise.all(names.map((n) => view("holder", { account_id: `${n}.${contract}` })))).filter(Boolean);
  const firstSeen = await firstSeenFromFeed(view).catch(() => ({}));
  // red bots: their own accounts (not vaults); seeds keyed by the full account id, "ed25519:..."
  const bagIds = bagholdersOf(contract).filter((id) => seeds[id]);
  const bagViews = (await Promise.all(bagIds.map((id) => view("holder", { account_id: id }).then((h) => h || { account: id, balance: "0", kind: "exposed" })))).filter(Boolean);

  const fuel = {};
  await Promise.all(
    [...npcViews, ...bagViews].map(async (n) => {
      try {
        fuel[n.account] = BigInt(unwrap(await near.queryAccount({ accountId: n.account, network })).amount);
      } catch {
        /* unknown: decide() skips it */
      }
    }),
  );

  // After Q-Day, write the season result on chain once (permissionless finalize).
  const season = stats.after_q_day ? await view("season").catch(() => null) : null;
  const plannedExtra = stats.after_q_day && !season ? [{ npc: "*", action: "finalize", reason: "Q-Day has passed and the season result is not written yet." }] : [];

  const planned = [...plannedExtra, ...decide({ now: Number(stats.now_ms), config, stats, npcs: npcViews, holders, openRaids, firstSeen, contract, fuel, bags: bagViews })];

  const signers = {};
  const signerFor = (name) => (signers[name] ||= String(seeds[name]).startsWith("ed25519:") ? signerFromPrivateKey(seeds[name]) : signerFromSeed(hexToBytes(seeds[name])));
  const signerIdOf = (name) => (name.includes(".") ? name : `${name}.${contract}`); // bagholders are named by their full account id
  // Cranks (harvest, resolve) are paid by the NPC with the most NEAR left.
  const richest = [...npcViews].sort((a, b) => ((fuel[b.account] ?? 0n) > (fuel[a.account] ?? 0n) ? 1 : -1))[0];
  const crankNpc = richest ? richest.account.split(".")[0] : null;

  const moves = [];
  try {
    for (const m of planned) {
      const who = m.npc === "*" ? crankNpc : m.npc;
      const out = { npc: m.npc, action: m.action, reason: m.reason };
      if (m.target) out.target = m.target;
      if (m.stake) out.stake = m.stake;
      if (m.raidId) out.raidId = m.raidId;
      if (m.amount) out.amount = m.amount;
      if (dryRun) out.dryRun = true;
      else if (!who || !seeds[who]) out.error = "no NPC signer available";
      else {
        const args =
          m.action === "raid" ? { target: m.target, stake: m.stake } :
          m.action === "defend" || m.action === "block" || m.action === "resolve" ? { raid_id: m.raidId } :
          m.action === "sell" ? { amount: m.amount } : {};
        const methodName = m.action === "boss" ? "boss_raid" : m.action;
        const deposit = m.action === "buy" ? (BigInt(m.near) * 10n ** 24n).toString() : "0";
        const r = await sendCall({ network, signerId: signerIdOf(who), signer: signerFor(who), contract, methodName, args, gas: m.action === "finalize" ? 250 : m.action === "buy" ? 50 : 100, deposit });
        if (r.hash) out.hash = r.hash;
        if (r.error) out.error = r.error;
      }
      moves.push(out);
    }
  } finally {
    for (const s of Object.values(signers)) s.destroy?.();
  }
  return { at: new Date().toISOString(), moves };
}

/** The arena chase (app/api/hunt.ts): an NPC body caught `target` on the
 * player's screen. Reads the same chain state as a tick, asks rules.mjs
 * whether that NPC (or another one) may raid the target right now, and sends
 * the one raid if so. Never more than one move. */
export async function hunt({ contract, seeds, network = "testnet", target, hunter }) {
  const view = (methodName, args = {}) => near.view({ contractId: contract, methodName, args, network });
  const [config, stats, holders, openRaids] = await Promise.all([
    view("config"),
    view("stats"),
    allHolders(view),
    view("open_raids", { scan: 100 }),
  ]);
  const names = ROSTER.map((r) => r.name).filter((n) => seeds[n]);
  const npcViews = (await Promise.all(names.map((n) => view("holder", { account_id: `${n}.${contract}` })))).filter(Boolean);
  const firstSeen = await firstSeenFromFeed(view).catch(() => ({}));
  const move = decideHunt({ now: Number(stats.now_ms), config, stats, npcs: npcViews, holders, openRaids, target, hunter, contract, firstSeen });
  const out = { at: new Date().toISOString(), target, hunter: hunter || null };
  if (!move || move.skipped) return { ...out, skipped: move?.skipped || "Nothing to do." };
  const signer = signerFromSeed(hexToBytes(seeds[move.npc]));
  try {
    const r = await sendCall({ network, signerId: `${move.npc}.${contract}`, signer, contract, methodName: "raid", args: { target: move.target, stake: move.stake }, gas: 100 });
    return { ...out, npc: move.npc, stake: move.stake, reason: move.reason, hash: r.hash || null, error: r.error || undefined };
  } finally {
    signer.destroy?.();
  }
}
