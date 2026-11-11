import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, decideHunt, isNpc, ROSTER, MAX_MOVES, GREET_DELAY_MS, explainRaid } from "./rules.mjs";

const C = "qday-test.testnet";
const Q = (n) => (BigInt(n) * 10n ** 18n).toString();
const NOW = 1_000_000_000;
const config = {
  min_stake: Q(1000), min_target_balance: Q(10000), take_bps: 1000, vault_take_bps: 200,
  punch_down_band: 4, stake_mult: 3, boss_min_balance: Q(10000), max_raids_per_epoch: 3,
};
const stats = { after_q_day: false, harvest_due: false, epoch: "12" };
const holder = (account, o = {}) => ({
  account, kind: "exposed", balance: Q(100000), shield_bps: 0, immune_until: "0", under_raid: null,
  raids_left: 3, boss_ready: false, ...o,
});
const npc = (name, o = {}) => holder(`${name}.${C}`, { kind: "vault", balance: Q(50000), ...o });
const base = (o = {}) => ({ now: NOW, config, stats, npcs: [], holders: [], openRaids: [], contract: C, ...o });
const raids = (ms) => ms.filter((m) => m.action === "raid");

test("isNpc matches roster names under the contract only", () => {
  assert.ok(isNpc(`shor.${C}`, C));
  assert.ok(isNpc(`qubit-03.${C}`, C));
  assert.ok(!isNpc(`alice.${C}`, C));
  assert.ok(!isNpc(`shor.other.testnet`, C));
  assert.equal(ROSTER.length, 10);
});

test("cranks first: harvest then resolve closed raids, never resolve an open window", () => {
  const m = decide(base({
    stats: { ...stats, harvest_due: true },
    openRaids: [{ id: "5", attacker: "a", target: "b", deadline: NOW - 40000 }, { id: "6", attacker: "a", target: "c", deadline: NOW + 5000 }],
  }));
  assert.equal(m[0].action, "harvest");
  assert.deepEqual(m.filter((x) => x.action === "resolve").map((x) => x.raidId), ["5"]);
  assert.match(m[1].reason, /40 s ago/);
});

test("defend: NPC target defends 1 in 3, only in the second half of the clock", () => {
  const g = npc("grover");
  const openRaids = [{ id: "9", attacker: "human.testnet", target: g.account, opened_at: NOW - 60000, deadline: NOW + 30000 }];
  const yes = decide(base({ npcs: [g], openRaids, random: () => 0.21 }));
  assert.equal(yes.filter((x) => x.action === "defend").length, 1);
  assert.match(yes[0].reason, /rolled 0\.21/);
  const mid = decide(base({ npcs: [g], openRaids, random: () => 0.41 }));
  assert.equal(mid.filter((x) => x.action === "defend").length, 0);
  const early = decide(base({ npcs: [g], openRaids: [{ ...openRaids[0], opened_at: NOW - 10000, deadline: NOW + 80000 }], random: () => 0 }));
  assert.equal(early.filter((x) => x.action === "defend").length, 0);
  const no = decide(base({ npcs: [g], openRaids, random: () => 0.9 }));
  assert.equal(no.filter((x) => x.action === "defend").length, 0);
  // a raid on a human is never defended by an NPC
  const other = decide(base({ npcs: [g], openRaids: [{ id: "9", attacker: "x", target: "human.testnet", deadline: NOW + 60000 }], random: () => 0 }));
  assert.equal(other.length, 0);
});

test("a raided NPC does not start its own raid", () => {
  const s = npc("shor");
  const m = decide(base({
    npcs: [s], holders: [holder("rich.testnet")],
    openRaids: [{ id: "9", attacker: "human.testnet", target: s.account, deadline: NOW + 60000 }], random: () => 0.99,
  }));
  assert.equal(raids(m).length, 0);
});

test("boss: ready NPCs with balance, at most two per tick", () => {
  const npcs = ["shor", "grover", "qubit-01", "qubit-02"].map((n) => npc(n, { boss_ready: true }));
  npcs.push(npc("qubit-03", { boss_ready: true, balance: Q(5) })); // too small
  const m = decide(base({ npcs }));
  assert.equal(m.filter((x) => x.action === "boss").length, 2);
});

test("Shor takes the largest exposed bag in range; skips vaults", () => {
  const s = npc("shor");
  const holders = [holder("small.testnet", { balance: Q(80000) }), holder("big.testnet", { balance: Q(500000) }), holder("v.testnet", { kind: "vault", balance: Q(900000) })];
  const m = raids(decide(base({ npcs: [s], holders })));
  assert.equal(m.length, 1);
  assert.equal(m[0].npc, "shor");
  assert.equal(m[0].target, "big.testnet");
  assert.match(m[0].reason, /Largest exposed bag/);
});

test("stake covers the take under the stake_mult cap, within 20% of the bag", () => {
  const s = npc("shor", { balance: Q(500000) });
  const m = raids(decide(base({ npcs: [s], holders: [holder("big.testnet", { balance: Q(900000) })] })))[0];
  // take = 10% of 900000 = 90000; stake = 30000 (<= 100000 cap)
  assert.equal(m.stake, Q(30000));
  const poor = npc("shor", { balance: Q(50000) });
  const m2 = raids(decide(base({ npcs: [poor], holders: [holder("big.testnet", { balance: Q(900000) })] })))[0];
  assert.equal(m2.stake, Q(10000)); // capped at 20% of 50000
});

test("no punching down: target balance x band must reach the NPC balance", () => {
  const s = npc("shor", { balance: Q(500000) });
  const m = decide(base({ npcs: [s], holders: [holder("tiny.testnet", { balance: Q(100000) })] })); // 400k < 500k
  assert.equal(raids(m).length, 0);
  const ok = decide(base({ npcs: [s], holders: [holder("fair.testnet", { balance: Q(125000) })] })); // 500k >= 500k
  assert.equal(raids(ok).length, 1);
});

test("skips immune, busy, too small targets, itself and NPCs", () => {
  const s = npc("shor");
  const holders = [
    holder("immune.testnet", { immune_until: String(NOW + 1000) }),
    holder("busy.testnet", { under_raid: "3" }),
    holder("dust.testnet", { balance: Q(5) }),
    npc("grover", { kind: "exposed", balance: Q(900000) }), // an NPC, even if it looked exposed
    holder(s.account),
  ];
  assert.equal(raids(decide(base({ npcs: [s], holders }))).length, 0);
});

test("immunity that already expired is fine", () => {
  const s = npc("shor");
  const m = decide(base({ npcs: [s], holders: [holder("was.testnet", { immune_until: String(NOW - 1) })] }));
  assert.equal(raids(m).length, 1);
});

test("NPCs without raids left or under raid do not raid", () => {
  const holders = [holder("x.testnet")];
  assert.equal(raids(decide(base({ npcs: [npc("shor", { raids_left: 0 })], holders }))).length, 0);
  assert.equal(raids(decide(base({ npcs: [npc("shor", { under_raid: "1" })], holders, openRaids: [] }))).length, 0);
});

test("Grover picks the least shielded vault, tie goes to the larger bag", () => {
  const g = npc("grover");
  const holders = [
    holder("a.testnet", { kind: "vault", shield_bps: 2000, balance: Q(100000) }),
    holder("b.testnet", { kind: "vault", shield_bps: 0, balance: Q(60000) }),
    holder("c.testnet", { kind: "vault", shield_bps: 0, balance: Q(90000) }),
    holder("d.testnet", { kind: "exposed", balance: Q(900000) }),
  ];
  const m = raids(decide(base({ npcs: [g], holders })))[0];
  assert.equal(m.npc, "grover");
  assert.equal(m.target, "c.testnet");
});

test("Qubits greet the newest unraided holder, one qubit per target", () => {
  const qs = ["qubit-01", "qubit-02", "qubit-03"].map((n) => npc(n, { balance: Q(20000) }));
  const holders = [
    holder("old.testnet", { balance: Q(60000) }),
    holder("mid.testnet", { balance: Q(60000) }),
    holder("new.testnet", { balance: Q(60000) }),
    ...qs, // NPCs sit in the holder list too
  ];
  const m = raids(decide(base({ npcs: qs, holders })));
  const targets = m.map((x) => x.target);
  assert.equal(new Set(targets).size, targets.length);
  assert.ok(targets.includes("new.testnet"));
  assert.ok(m.every((x) => x.npc.startsWith("qubit-")));
  assert.match(m[0].reason, /Newest holder/);
});

test("past the greeting window, Qubits still hunt (not greet) a player who is not resting", () => {
  const qs = [npc("qubit-01", { balance: Q(20000) })];
  const old = holder("old.testnet", { balance: Q(60000) });
  const m1 = decide(base({ npcs: qs, holders: [old], firstSeen: { "old.testnet": NOW - 31 * 60 * 1000 } }));
  assert.equal(raids(m1).length, 1);
  assert.match(raids(m1)[0].reason, /Hunting/);
  const raided = holder("hit.testnet", { balance: Q(60000) });
  const m2 = decide(base({ npcs: qs, holders: [{ ...raided, immune_until: String(NOW - 5) }] }));
  assert.match(raids(m2)[0].reason, /Hunting/);
});

test("Qubits leave a holder alone for its first minutes, then greet it", () => {
  const qs = [npc("qubit-01", { balance: Q(20000) })];
  const fresh = holder("fresh.testnet", { balance: Q(60000) });
  const early = decide(base({ npcs: qs, holders: [fresh], firstSeen: { "fresh.testnet": NOW - 90 * 1000 } }));
  assert.equal(raids(early).length, 0);
  const edge = decide(base({ npcs: qs, holders: [fresh], firstSeen: { "fresh.testnet": NOW - GREET_DELAY_MS + 1 } }));
  assert.equal(raids(edge).length, 0);
  const later = decide(base({ npcs: qs, holders: [fresh], firstSeen: { "fresh.testnet": NOW - GREET_DELAY_MS } }));
  assert.equal(raids(later).length, 1);
  assert.equal(raids(later)[0].target, "fresh.testnet");
});

test("never more than 6 moves per tick", () => {
  const openRaids = Array.from({ length: 10 }, (_, i) => ({ id: String(i), attacker: "a", target: "b", deadline: NOW - 1000 }));
  const m = decide(base({ stats: { ...stats, harvest_due: true }, openRaids, npcs: [npc("shor")], holders: [holder("x.testnet")] }));
  assert.equal(m.length, MAX_MOVES);
});

test("nothing after Q-Day", () => {
  assert.equal(decide(base({ stats: { ...stats, after_q_day: true, harvest_due: true }, npcs: [npc("shor")], holders: [holder("x.testnet")] })).length, 0);
});

test("explainRaid describes each style", () => {
  assert.match(explainRaid({ attacker: `shor.${C}` }, { balance: Q(640112) }), /640,112/);
  assert.match(explainRaid({ attacker: `grover.${C}` }, { shield_bps: 500 }), /5% shield/);
  assert.match(explainRaid({ attacker: `qubit-02.${C}` }), /newest holder/);
  assert.equal(explainRaid({ attacker: "alice.testnet" }), "Not an NPC raid.");
});

test("an NPC low on gas sells 10% of its bag; one with enough gas does not", async () => {
  const { decide } = await import("./rules.mjs");
  const C = "qday.testnet";
  const config = { take_bps: 1000, vault_take_bps: 200, stake_mult: 3, min_stake: "1000", min_target_balance: "10000", punch_down_band: 4, boss_min_balance: "1" };
  const npc = (name, bal) => ({ account: `${name}.${C}`, kind: "vault", balance: bal, shield_bps: 0, immune_until: "0", under_raid: null, raids_left: 0, boss_ready: false });
  const npcs = [npc("shor", "1000000"), npc("grover", "2000000")];
  const moves = decide({ now: 1, config, stats: {}, npcs, holders: [], openRaids: [], contract: C, fuel: { [`shor.${C}`]: 10n ** 22n, [`grover.${C}`]: 10n ** 24n } });
  const sells = moves.filter((m) => m.action === "sell");
  assert.equal(sells.length, 1);
  assert.equal(sells[0].npc, "shor");
  assert.equal(sells[0].amount, "100000");
});

test("hunt: the touching qubit raids an exposed target it may raid", () => {
  const q1 = npc("qubit-01"), q2 = npc("qubit-02", { raids_left: 3 });
  const m = decideHunt(base({ npcs: [q1, q2], holders: [holder("me.testnet", { immune_until: "1" })], target: "me.testnet", hunter: "qubit-02" }));
  assert.equal(m.action, "raid");
  assert.equal(m.npc, "qubit-02");
  assert.equal(m.target, "me.testnet");
  assert.ok(BigInt(m.stake) > 0n);
  assert.match(m.reason, /caught/);
});

test("hunt: another eligible NPC steps in when the hunter is out of raids; vaults prefer Grover", () => {
  const q = npc("qubit-01", { raids_left: 0 }), s = npc("shor"), g = npc("grover");
  const ex = decideHunt(base({ npcs: [q, s, g], holders: [holder("me.testnet")], target: "me.testnet", hunter: "qubit-01" }));
  assert.equal(ex.npc, "shor");
  const v = decideHunt(base({ npcs: [q, s, g], holders: [holder("v.testnet", { kind: "vault" })], target: "v.testnet", hunter: "qubit-01" }));
  assert.equal(v.npc, "grover");
});

test("hunt: refused when the target is immune, busy, too small, an NPC, out of band, or unknown", () => {
  const q = npc("qubit-01");
  const run = (h, o = {}) => decideHunt(base({ npcs: [q], holders: h ? [h] : [], target: h ? h.account : "ghost.testnet", hunter: "qubit-01", ...o }));
  assert.match(run(holder("a.testnet", { immune_until: String(NOW + 1000) })).skipped, /Resting/);
  assert.match(run(holder("a.testnet", { under_raid: "4" })).skipped, /under raid/);
  assert.match(run(holder("a.testnet", { balance: Q(10) })).skipped, /small/);
  assert.match(run(npc("shor")).skipped, /NPCs/);
  assert.match(run(holder("a.testnet", { balance: Q(10001) }), { npcs: [npc("qubit-01", { balance: Q(500000) })] }).skipped, /No NPC/);
  assert.match(run(null).skipped, /no bag/);
  assert.match(run(holder("a.testnet"), { stats: { ...stats, after_q_day: true } }).skipped, /Q-Day/);
});

test("hunt: an NPC already attacking or under raid does not hunt", () => {
  const q = npc("qubit-01");
  const m = decideHunt(base({ npcs: [q], holders: [holder("me.testnet")], target: "me.testnet", hunter: "qubit-01", openRaids: [{ id: "1", attacker: q.account, target: "x.testnet", deadline: NOW + 9000 }] }));
  assert.ok(m.skipped);
  const ok = decideHunt(base({ npcs: [q], holders: [holder("me.testnet")], target: "me.testnet", hunter: "qubit-01", openRaids: [{ id: "1", attacker: q.account, target: "x.testnet", deadline: NOW - 9000 }] }));
  assert.equal(ok.action, "raid");
});

test("no NPC raids a holder in its first minutes, by tick or by hunt", () => {
  const seen = { "fresh.testnet": NOW - 60 * 1000 };
  const all = [npc("shor"), npc("grover"), npc("qubit-01")];
  const m = decide(base({ npcs: all, holders: [holder("fresh.testnet", { balance: Q(300000) })], firstSeen: seen }));
  assert.equal(m.filter((x) => x.action === "raid").length, 0);
  const h = decideHunt(base({ npcs: all, holders: [holder("fresh.testnet")], target: "fresh.testnet", hunter: "qubit-01", firstSeen: seen }));
  assert.ok(h.skipped);
});

test("bagholders: buy back in when low, never raid, never raided by NPCs", () => {
  const bag = { account: "kfbag01-x.testnet", kind: "exposed", balance: Q(100000) };
  const fuel = { [bag.account]: (5n * 10n ** 24n).toString() };
  const m = decide(base({ npcs: [npc("shor")], holders: [bag], bags: [bag], fuel }));
  const buy = m.filter((x) => x.action === "buy");
  assert.equal(buy.length, 1);
  assert.equal(buy[0].npc, bag.account);
  const full = decide(base({ npcs: [], holders: [], bags: [{ ...bag, balance: Q(500000) }], fuel }));
  assert.equal(full.filter((x) => x.action === "buy").length, 0);
  const broke = decide(base({ npcs: [], holders: [], bags: [bag], fuel: { [bag.account]: (10n ** 24n).toString() } }));
  assert.equal(broke.filter((x) => x.action === "buy").length, 0);
});

test("qubits keep hunting a player who already met them, once the rest is over", () => {
  const qs = [npc("qubit-01"), npc("qubit-02"), npc("qubit-03")];
  const old = holder("player.testnet", { immune_until: "5" }); // raided before, rest over
  const m = decide(base({ npcs: qs, holders: [old], firstSeen: { "player.testnet": NOW - 3600_000 } }));
  assert.equal(raids(m).filter((x) => x.target === "player.testnet").length, 1);
  const resting = holder("player.testnet", { immune_until: String(NOW + 60_000) });
  assert.equal(raids(decide(base({ npcs: qs, holders: [resting] }))).length, 0);
});
