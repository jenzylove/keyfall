// KEYFALL NPC rules. The whole behaviour of the game's own bots lives in this
// one file. No dependencies, no chain code: decide() is a pure function of a
// snapshot and returns the moves one tick should make, each with a reason.
//
// NPCs are ordinary quantum vaults. The contract enforces every rule on them
// exactly as on players; decide() mirrors the raid checks (core/src/game.rs)
// only so an NPC never sends a move the contract would refuse.

import bagholderList from "./bagholders.json" with { type: "json" };

export const MAX_MOVES = 6; // per tick
export const MAX_BOSS = 2; // boss raids per tick
export const DEFEND_CHANCE = 1 / 3; // an NPC defends 1 raid in 3 (2 in 3 made every raid on a bot a sure loss)
export const DEFEND_AFTER = 0.5; // ...and only in the second half of the clock, so a raid on a bot is a real gamble
export const GREET_WINDOW_MS = 30 * 60 * 1000; // qubits greet holders newer than this
export const GREET_DELAY_MS = 3 * 60 * 1000; // ...but never in a holder's first minutes: the arena guide runs then
export const HUNTS_PER_TICK = 3; // repeat raids on players per tick, beyond the greeting
export const GREET_TAIL = 10; // with no registration times, "newest" = last N holders
export const STAKE_BALANCE_CAP_BPS = 2000n; // never stake more than 20% of the NPC's bag
export const FUEL_LOW_YOCTO = 5n * 10n ** 22n; // 0.05 NEAR: below this an NPC pays for its gas
export const FUEL_SELL_BPS = 1000n; // by selling 10% of its bag to the market
export const BRAWLS_PER_TICK = 1; // arcade: bots also raid each other, so the arena is never still
export const MAX_HUNTERS_ARCADE = 3; // arcade: at most 3 bots raid players per tick (steady pressure, never a pile on)
export const MAX_BOSS_ARCADE = 3; // tuned for the 30 s page tick: 6 bot hits a minute take about 15% of his life bar, so he blasts in about 7 minutes alone and about 5 with a player shooting
export const PACE_JITTER_MS = 15_000; // arcade: after a player's 90 s immunity ends, bots wait a random 0 to 15 s more
/** Deterministic jitter per (player, immunity end), so ticks agree on when a player is fair game again. */
export function paceJitter(account, immuneUntil) {
  let h = 2166136261;
  for (const ch of `${account}:${immuneUntil}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return (h % 1000) / 1000 * PACE_JITTER_MS;
} // arcade: bot hits on Satoshi per tick (the blast pot is mostly for players)

const QUBITS = Array.from({ length: 8 }, (_, i) => ({
  name: `qubit-${String(i + 1).padStart(2, "0")}`,
  style: "greeter",
}));

export const ROSTER = [
  { name: "shor", style: "hunter-exposed" }, // largest exposed bag it may raid
  { name: "grover", style: "hunter-vault" }, // least shielded vault it may raid
  ...QUBITS, // greet the newest holder
];

/** Bag in whole NEAR bought at setup (read by scripts/npc-setup.mjs). */
export const BAGS_NEAR = { shor: 0.5, grover: 0.5, qubit: 0.3 }; // small enough that "no punching down" lets them hit real players

const rosterNames = new Set(ROSTER.map((r) => r.name));
export const npcName = (accountId) => String(accountId).split(".")[0];

/** Bagholders: the game's red bots. Ordinary NEAR accounts (not vaults) that hold a big bag behind an
 * old key and never move it, so there is always red prey: they cannot defend, they leak to vaults at
 * every harvest, and they buy back in when their bag runs low. Listed per contract in bagholders.json. */
export const BAGHOLDERS = bagholderList;
export const bagholdersOf = (contract) => BAGHOLDERS[contract] || [];
export const isBagholder = (accountId, contract) => bagholdersOf(contract).includes(String(accountId));
export const bagholderNo = (accountId, contract) => bagholdersOf(contract).indexOf(String(accountId)) + 1;
export const BAG_REFILL_BELOW = 300000n * 10n ** 18n; // buy back in under 300k coins
export const BAG_REFILL_NEAR = "1"; // with 1 NEAR
export const BAG_FUEL_FLOOR = 15n * 10n ** 23n; // keep 1.5 NEAR for gas and storage

export const isNpc = (accountId, contract) =>
  (rosterNames.has(npcName(accountId)) && String(accountId) === `${npcName(accountId)}.${contract}`) || isBagholder(accountId, contract);

const big = (x) => BigInt(x ?? 0);
const bps = (amount, b) => (big(amount) * big(b)) / 10000n;
const fmt = (x) => big(big(x) / 10n ** 18n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const short = (a) => (String(a).length > 22 ? `${String(a).slice(0, 20)}…` : String(a));
const cmpDesc = (a, b) => (b > a ? 1 : b < a ? -1 : 0);

/** What a raid on `h` would take right now (mirrors core resolve()). */
function expectedTake(h, config) {
  const share = h.kind === "vault" ? config.vault_take_bps : config.take_bps;
  return bps(bps(h.balance, share), 10000 - (h.shield_bps || 0));
}

/** Stake so the stake_mult cap does not bite; null if it would break the 20% rule. */
function pickStake(take, npcBalance, config) {
  const mult = big(config.stake_mult);
  let stake = (take + mult - 1n) / mult;
  const min = big(config.min_stake);
  if (stake < min) stake = min;
  const cap = (npcBalance * STAKE_BALANCE_CAP_BPS) / 10000n;
  if (stake > cap) return cap >= min ? cap : null;
  return stake;
}

export function decide({ now, config, stats, npcs = [], holders = [], openRaids = [], random = Math.random, firstSeen = {}, contract, fuel = {}, bags = [] }) {
  const moves = [];
  const push = (m) => {
    if (moves.length < MAX_MOVES) moves.push(m);
  };
  if (stats?.after_q_day) return moves;
  now = Number(now);

  const home = contract || (npcs[0] ? String(npcs[0].account).split(".").slice(1).join(".") : "");
  const npcIds = new Set(npcs.map((n) => n.account));
  const npcOf = (id) => npcIds.has(id) || isNpc(id, home);
  const view = (n) => ({ ...n, balance: big(n.balance) });
  // Arcade season: raids cost bullets, shields are charges, a vault on a break is left alone by bots.
  const arcade = !!config?.arcade;
  const onBreak = (h) => !!h?.arcade?.on_break;

  // 0. Fuel: an NPC low on NEAR for gas sells part of its bag, like any player would.
  //    `fuel` maps NPC account -> NEAR balance in yocto (missing = unknown, skip).
  for (const n of npcs) {
    const f = fuel[n.account];
    if (f === undefined || big(f) >= FUEL_LOW_YOCTO) continue;
    const amount = bps(n.balance, FUEL_SELL_BPS);
    if (amount <= 0n) continue;
    push({ npc: npcName(n.account), action: "sell", amount: amount.toString(), reason: `Low on gas (${(Number(big(f) / 10n ** 21n) / 1000).toFixed(3)} NEAR): sells 10% of its bag to pay for its moves.` });
  }

  // 1. Cranks first: harvest if due, then settle every raid whose window closed.
  if (stats?.harvest_due) {
    push({ npc: "*", action: "harvest", reason: `Epoch ${stats.epoch} harvest is due.` });
  }
  for (const r of openRaids) {
    const overdue = now - Number(r.deadline);
    if (overdue > 0) {
      push({ npc: "*", action: "resolve", raidId: String(r.id), reason: `Defend window closed ${Math.round(overdue / 1000)} s ago.` });
    }
  }

  // 1b. Bagholders buy back in when their red bag runs low, so there is always prey. One per tick.
  for (const bg of bags) {
    const f = fuel[bg.account];
    if (f === undefined || big(f) < BAG_FUEL_FLOOR + 10n ** 24n) continue;
    if (big(bg.balance) >= BAG_REFILL_BELOW) continue;
    push({ npc: bg.account, action: "buy", near: BAG_REFILL_NEAR, reason: `Bagholder down to ${fmt(bg.balance)} coins: buys back in with ${BAG_REFILL_NEAR} NEAR, red as ever.` });
    break;
  }

  // 2. Defend: an NPC under an open raid defends with probability 2/3.
  const busyNpc = new Set();
  for (const r of openRaids) {
    if (Number(r.deadline) < now) continue;
    const t = npcs.find((n) => n.account === r.target);
    if (!t) continue;
    busyNpc.add(t.account);
    const window = Number(r.deadline) - Number(r.opened_at || 0);
    if (r.opened_at && now < Number(r.opened_at) + window * DEFEND_AFTER) continue; // too early to answer
    const roll = random();
    if (roll < DEFEND_CHANCE) {
      const why = `Raided by ${short(r.attacker)}; answers 1 in 3 times, late in the clock (rolled ${roll.toFixed(2)}).`;
      if (!arcade) push({ npc: npcName(t.account), action: "defend", raidId: String(r.id), reason: why });
      // arcade: block with a shield charge if it has one, else shoot back with a bullet
      else if ((t.arcade?.shields || 0) > 0) push({ npc: npcName(t.account), action: "block", raidId: String(r.id), reason: `${why} Blocks with a shield charge.` });
      else if ((t.arcade?.bullets ?? t.raids_left ?? 0) > 0) push({ npc: npcName(t.account), action: "defend", raidId: String(r.id), reason: `${why} No shield left: shoots back.` });
    }
  }

  // 2b. Arcade: a hunter with an empty clip reloads (burns reload_price), like a player who cannot wait.
  //     Only when it can afford several reloads, so a bot never spends itself out of the arena.
  if (arcade && config.arcade?.reload_price) {
    const price = big(config.arcade.reload_price);
    for (const n of npcs) {
      if (!npcName(n.account).startsWith("qubit-") && !["shor", "grover"].includes(npcName(n.account))) continue;
      if ((n.arcade?.bullets ?? 1) > 0 || big(n.balance) < price * 4n || n.under_raid != null) continue;
      push({ npc: npcName(n.account), action: "reload", reason: `Clip empty: burns ${fmt(price)} coins to reload and keep hunting.` });
    }
  }

  // 3. Raids, only for NPCs that have raids left and are not under raid.
  const attackers = npcs.map(view).filter((n) => n.raids_left > 0 && n.under_raid == null && !busyNpc.has(n.account));
  const spent = new Set(); // an NPC raids at most once per tick
  const targeted = new Set(); // a target is raided at most once per tick

  // Would the contract accept this raid? (mirrors Game::raid)
  const eligible = (att, t, bots = false) =>
    t.account !== att.account &&
    (bots ? npcIds.has(t.account) : !npcOf(t.account)) &&
    !(onBreak(t) && !bots) &&
    big(t.immune_until) <= BigInt(now) &&
    (bots || !arcade || big(t.immune_until) === 0n || Number(t.immune_until) + paceJitter(t.account, String(t.immune_until)) <= now) &&
    t.under_raid == null &&
    !targeted.has(t.account) &&
    t.balance >= big(config.min_target_balance) &&
    t.balance * big(config.punch_down_band) >= att.balance;

  const fresh = (id) => firstSeen[id] !== undefined && now - Number(firstSeen[id]) < GREET_DELAY_MS;
  const targets = holders.map(view).filter((t) => !fresh(t.account)); // nobody raids a holder in its first minutes
  let onPlayers = 0;
  const launch = (att, t, why) => {
    const player = !npcIds.has(t.account);
    if (arcade && player && onPlayers >= MAX_HUNTERS_ARCADE) return false;
    const take = expectedTake(t, config);
    const stake = pickStake(take, att.balance, config);
    if (stake === null) return false;
    spent.add(att.account);
    targeted.add(t.account);
    if (player) onPlayers++;
    push({ npc: npcName(att.account), action: "raid", target: t.account, stake: stake.toString(), reason: `${why} Staking ${fmt(stake)} coins for about ${fmt(take)}.` });
    return true;
  };
  const free = (name) => attackers.find((a) => npcName(a.account) === name && !spent.has(a.account));

  // Qubits: greet the newest holders (last in holders() order), not raided yet.
  const qubits = () => attackers.filter((a) => npcName(a.account).startsWith("qubit-") && !spent.has(a.account));
  for (const t of targets.slice(-GREET_TAIL).reverse()) {
    const seen = firstSeen[t.account];
    if (seen !== undefined && now - Number(seen) > GREET_WINDOW_MS) continue;
    if (seen !== undefined && now - Number(seen) < GREET_DELAY_MS) continue; // still learning the arena
    if (big(t.immune_until) !== 0n) continue; // already raided once
    const q = qubits().find((a) => eligible(a, t));
    if (q) launch(q, t, `Newest holder ${short(t.account)} has not been raided yet: ${fmt(t.balance)} coins, say hello.`);
  }

  // Qubits keep hunting: after the greeting, any player who is not resting gets raided again, a few
  // per tick, so the arena never goes quiet. The contract's rest after a raid paces it.
  let hunts = 0;
  for (const t of [...targets].sort(() => random() - 0.5)) {
    if (hunts >= HUNTS_PER_TICK) break;
    const q = qubits().find((a) => eligible(a, t));
    if (q && launch(q, t, `Hunting ${short(t.account)}: ${fmt(t.balance)} coins and not resting.`)) hunts++;
  }

  // Shor: the eligible exposed holder with the largest balance.
  const shor = free("shor");
  if (shor) {
    const t = targets.filter((x) => x.kind === "exposed" && eligible(shor, x)).sort((a, b) => cmpDesc(a.balance, b.balance))[0];
    if (t) launch(shor, t, `Largest exposed bag in range: ${fmt(t.balance)} coins, no defence possible.`);
  }

  // Grover: the eligible vault with the lowest shield (tie: largest balance).
  const grover = free("grover");
  if (grover) {
    const t = targets
      .filter((x) => x.kind === "vault" && eligible(grover, x))
      .sort((a, b) => (a.shield_bps || 0) - (b.shield_bps || 0) || cmpDesc(a.balance, b.balance))[0];
    if (t) launch(grover, t, `Least shielded vault in range: ${(t.shield_bps || 0) / 100}% shield, ${fmt(t.balance)} coins.`);
  }

  // 3b. Arcade: bots raid bots. After every player raid, one free bot picks a fight with another bot
  //     (same contract checks), so there is always a fight on screen. Bagholders stay out of it.
  if (arcade) {
    let brawls = 0;
    const busy = new Set(openRaids.filter((r) => Number(r.deadline) >= now).flatMap((r) => [r.attacker, r.target]));
    const prey = npcs.map(view).filter((t) => !busy.has(t.account));
    for (const att of [...attackers].sort(() => random() - 0.5)) {
      if (brawls >= BRAWLS_PER_TICK) break;
      if (spent.has(att.account) || busy.has(att.account)) continue;
      const t = prey.filter((x) => eligible(att, x, true)).sort(() => random() - 0.5)[0];
      if (t && launch(att, t, `Bot fight: ${npcName(att.account)} raids ${npcName(t.account)} (${fmt(t.balance)} coins).`)) brawls++;
    }
  }

  // 4. Boss (after raids, so a greeting is never delayed): NPCs with boss_ready and enough balance, at most MAX_BOSS per tick.
  //    Arcade: one bot hit per tick at most, whenever its bullets and cooldown allow (rounds are short).
  let boss = 0;
  for (const n of npcs) {
    if (boss >= (arcade ? MAX_BOSS_ARCADE : MAX_BOSS)) break;
    if (arcade) {
      if (spent.has(n.account)) continue; // used its bullet on a raid this tick
      if (n.boss_ready && big(n.balance) >= big(config.boss_min_balance)) {
        boss += 1;
        push({ npc: npcName(n.account), action: "boss", reason: `Shoots Satoshi: ${n.arcade?.bullets ?? "?"} bullets, his life bar is shared by damage when he blasts.` });
      }
      continue;
    }
    // bots hit Satoshi at most once every 6 hours of play whatever the round length, so on a short clock
    // his stash is left for players (on the 6 hour mainnet clock that is every round)
    const every = Math.max(1, Math.round(6 * 3600_000 / Number(config.epoch_ms || 21600000)));
    if (Number(stats?.epoch || 0) % every !== 0) break;
    if (n.boss_ready && big(n.balance) >= big(config.boss_min_balance)) {
      boss += 1;
      push({ npc: npcName(n.account), action: "boss", reason: "Satoshi is ready this epoch." });
    }
  }

  return moves;
}

/** The arena chase: an NPC body touched `target` on the player's screen and
 * asks to raid it now. Same checks as decide() (band, immunity, busy, size,
 * raids left, 20% stake cap); the "greet once" rule is relaxed because the
 * player was physically caught. `hunter` is the NPC that touched them and is
 * preferred when it may raid; otherwise another eligible NPC takes the raid.
 * Returns one raid move, or { skipped } with the reason in words. */
export function decideHunt({ now, config, stats, npcs = [], holders = [], openRaids = [], target, hunter, contract, firstSeen = {} }) {
  if (stats?.after_q_day) return { skipped: "Q-Day has passed. Raids are over." };
  now = Number(now);
  if (firstSeen[target] !== undefined && now - Number(firstSeen[target]) < GREET_DELAY_MS) return { skipped: "New player, still learning the arena." };
  const home = contract || (npcs[0] ? String(npcs[0].account).split(".").slice(1).join(".") : "");
  const npcIds = new Set(npcs.map((n) => n.account));
  const npcOf = (id) => npcIds.has(id) || isNpc(id, home);
  const raw = holders.find((h) => h.account === target);
  if (!raw) return { skipped: "That account holds no bag." };
  if (npcOf(raw.account)) return { skipped: "NPCs do not hunt each other." };
  const t = { ...raw, balance: big(raw.balance) };
  if (t.under_raid != null) return { skipped: "Already under raid." };
  if (config?.arcade && t.arcade?.on_break) return { skipped: "On a break: bots leave this vault alone." };
  if (big(t.immune_until) > BigInt(now)) return { skipped: "Resting after a raid." };
  if (t.balance < big(config.min_target_balance)) return { skipped: "Too small to raid." };
  const live = openRaids.filter((r) => Number(r.deadline) >= now);
  const attacking = new Set(live.map((r) => r.attacker));
  const busy = new Set(live.map((r) => r.target));
  const can = (n) =>
    n.raids_left > 0 && n.under_raid == null && !busy.has(n.account) && !attacking.has(n.account) &&
    t.balance * big(config.punch_down_band) >= big(n.balance);
  const list = npcs.filter(can);
  const style = (n) => { const nm = npcName(n.account); return nm === "shor" ? "shor" : nm === "grover" ? "grover" : "qubit"; };
  const order = t.kind === "exposed" ? ["qubit", "shor", "grover"] : ["grover", "qubit", "shor"];
  const pref = (n) => (npcName(n.account) === hunter ? 0 : 1);
  list.sort((a, b) => pref(a) - pref(b) || order.indexOf(style(a)) - order.indexOf(style(b)) || b.raids_left - a.raids_left);
  for (const att of list) {
    const take = expectedTake(t, config);
    const stake = pickStake(take, big(att.balance), config);
    if (stake === null) continue;
    const name = npcName(att.account);
    return { npc: name, action: "raid", target: t.account, stake: stake.toString(), reason: `${name} caught ${short(t.account)} in the arena. Staking ${fmt(stake)} for about ${fmt(take)}.` };
  }
  return { skipped: list.length ? "No NPC can stake enough right now." : "No NPC has a raid left for a bag that size." };
}

/** Why an NPC raid picked this account. `snap` may carry { balance, shield_bps }. */
export function explainRaid(raid, snap = {}) {
  const name = npcName(raid.attacker);
  const npc = ROSTER.find((r) => r.name === name);
  if (!npc) return "Not an NPC raid.";
  const bag = snap.balance !== undefined ? `${fmt(snap.balance)} coins` : "a big bag";
  if (npc.style === "hunter-exposed") return `Shor hunts the largest exposed bag it may raid: ${bag}, and an exposed wallet cannot defend. Move it into a vault.`;
  if (npc.style === "hunter-vault") return `Grover hunts the least shielded vault it may raid (${(snap.shield_bps || 0) / 100}% shield). Charge a shield or defend in time.`;
  return `${name} greets the newest holder it may raid. A friendly first raid: defend it or escape into a vault.`;
}
