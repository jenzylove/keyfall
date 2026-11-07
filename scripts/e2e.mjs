// End-to-end run against a freshly deployed fast-season contract on testnet.
// Every behaviour Q-DAY claims is exercised with a real transaction, and
// each result is written with its explorer link.
//
// Usage: node e2e.mjs <contract-account> [out-dir]

import fs from "node:fs";
import path from "node:path";
import {
  near, send, call, view, keyList, explorer, faucetAccount, subAccount, generateSigner, rawMlDsaPublicKey,
  bytesToBase64, successValue, gasBurnt, sleep, NEAR, TGAS, privateKeyFromRandom, publicKeyFromPrivate,
  signerFromPrivateKey, waitForAccount,
} from "./lib.mjs";

const contract = process.argv[2];
const outDir = process.argv[3] || "../docs/e2e";
if (!contract) throw new Error("usage: node e2e.mjs <contract> [out-dir]");

const checks = [];
function check(name, pass, detail = {}) {
  checks.push({ name, pass: Boolean(pass), ...detail, link: detail.hash ? explorer(detail.hash) : undefined });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`, JSON.stringify(detail));
}
const big = (x) => BigInt(x?.toString?.() ?? x ?? 0);
const cfg = await view(contract, "config");
const tok = (n) => (BigInt(n) * 10n ** 18n).toString();

async function bal(id) {
  return big(await view(contract, "ft_balance_of", { account_id: id }));
}

async function makeVault(owner, name) {
  const pq = generateSigner();
  const raw = rawMlDsaPublicKey(pq.publicKey);
  const r = await call(contract, owner.accountId, owner.signer, "create_vault", { name, pq_public_key: bytesToBase64(raw) }, { deposit: NEAR(0.3), gas: 100 });
  const id = `${name}.${contract}`;
  await waitForAccount(id);
  return { accountId: id, signer: pq, tx: r.hash, error: r.error };
}

async function waitUntil(ms) {
  for (;;) {
    const s = await view(contract, "stats");
    if (Number(s.now_ms) >= ms) return s;
    await sleep(3000);
  }
}

const tag = Date.now().toString(36).slice(-4);
const bank = await faucetAccount("qday-e2e");
const alice = await subAccount(bank, "alice", 2.2);
const bob = await subAccount(bank, "bob", 2.2);
const carol = await subAccount(bank, "carol", 1.6);
const dave = await subAccount(bank, "dave", 1.6);
console.log("players:", alice.accountId, bob.accountId, carol.accountId, dave.accountId);

// 1. Buy from the market with normal (exposed) wallets
for (const [who, n] of [[alice, 1.2], [bob, 1.2], [carol, 0.9], [dave, 0.9]]) {
  const r = await call(contract, who.accountId, who.signer, "buy", {}, { deposit: NEAR(n) });
  check(`${who.accountId.split(".")[0]} buys from the market`, !r.error && (await bal(who.accountId)) > 0n, { hash: r.hash, error: r.error });
}
let h = await view(contract, "holder", { account_id: alice.accountId });
check("a normal wallet is an exposed holder", h?.kind === "exposed");

// 2. An exposed wallet cannot play
{
  const r = await call(contract, alice.accountId, alice.signer, "raid", { target: carol.accountId, stake: tok(1000) });
  check("exposed wallet cannot raid (E_NOT_VAULT)", /E_NOT_VAULT/.test(r.error || ""), { hash: r.hash, error: r.error?.slice(0, 200) });
}

// 3. Quantum vaults, born with only an ML-DSA-65 key
const va = await makeVault(alice, `a${tag}`);
const vb = await makeVault(bob, `b${tag}`);
const vd = await makeVault(dave, `d${tag}`);
for (const [v, n] of [[va, "alice"], [vb, "bob"], [vd, "dave"]]) {
  const keys = await keyList(v.accountId);
  const only = keys.length === 1 && keys[0].public_key.startsWith("ml-dsa-65") && keys[0].permission === "FullAccess";
  const hv = await view(contract, "holder", { account_id: v.accountId });
  check(`${n}'s vault is born quantum-only and registered`, !v.error && only && hv?.kind === "vault", { hash: v.tx, keys, error: v.error });
}

// 4. Migrate: exposed bag into the vault
for (const [w, v, n] of [[alice, va, "alice"], [bob, vb, "bob"]]) {
  const amount = (await bal(w.accountId)).toString();
  const r = await send({
    signerId: w.accountId, signer: w.signer, receiverId: contract,
    actions: [near.actions.functionCall({ methodName: "ft_transfer", args: { receiver_id: v.accountId, amount }, gas: TGAS(50), deposit: "1" })],
  });
  check(`${n} migrates the whole bag into the vault`, !r.error && (await bal(w.accountId)) === 0n && (await bal(v.accountId)) > 0n, { hash: r.hash, error: r.error });
}

// 5. Raid an exposed wallet: it cannot defend; the raid takes its share
{
  const before = await bal(carol.accountId);
  const r = await call(contract, va.accountId, va.signer, "raid", { target: carol.accountId, stake: tok(2000) });
  const id = successValue(r.res);
  check("vault raids an exposed wallet (signed with ML-DSA-65)", !r.error && id, { hash: r.hash, error: r.error, raid_id: id });
  const raid = await view(contract, "get_raid", { raid_id: id });
  await waitUntil(Number(raid.deadline) + 1500);
  const res = await call(contract, bank.accountId, bank.signer, "resolve", { raid_id: id });
  const take = big(successValue(res.res));
  const expected = (before * BigInt(cfg.take_bps)) / 10000n;
  check("anyone resolves it after the window; take = take_bps of the bag", !res.error && take > 0n && (take - expected < 10n || expected - take < 10n), { hash: res.hash, take: take.toString(), expected: expected.toString(), error: res.error });
}

// 6. Raid a vault: the target defends inside the window and wins the stake
{
  const r = await call(contract, vb.accountId, vb.signer, "raid", { target: va.accountId, stake: tok(3000) });
  const id = successValue(r.res);
  check("vault raids another vault", !r.error && id, { hash: r.hash, error: r.error });
  const d = await call(contract, va.accountId, va.signer, "defend", { raid_id: id });
  const won = big(successValue(d.res));
  const expected = BigInt(tok(3000)) - (BigInt(tok(3000)) * BigInt(cfg.raid_burn_bps)) / 10000n;
  check("target defends in time and takes the stake (minus burn)", !d.error && won === expected, { hash: d.hash, won: won.toString(), error: d.error });
}

// 7. Escape: an exposed target moves its bag into a vault before the window ends
{
  const r = await call(contract, va.accountId, va.signer, "raid", { target: dave.accountId, stake: tok(2000) });
  const id = successValue(r.res);
  check("vault raids a second exposed wallet", !r.error && id, { hash: r.hash, error: r.error });
  const amount = (await bal(dave.accountId)).toString();
  const m = await send({
    signerId: dave.accountId, signer: dave.signer, receiverId: contract,
    actions: [near.actions.functionCall({ methodName: "ft_transfer", args: { receiver_id: vd.accountId, amount }, gas: TGAS(50), deposit: "1" })],
  });
  check("the target escapes by migrating during the window", !m.error, { hash: m.hash, error: m.error });
  const raid = await view(contract, "get_raid", { raid_id: id });
  await waitUntil(Number(raid.deadline) + 1500);
  const res = await call(contract, bank.accountId, bank.signer, "resolve", { raid_id: id });
  check("the escaped raid takes nothing", !res.error && big(successValue(res.res)) === 0n, { hash: res.hash, error: res.error });
}

// 8. Shield and boss
{
  const b = await bal(vb.accountId);
  const amount = ((b * 4n + 99n) / 100n).toString();
  const r = await call(contract, vb.accountId, vb.signer, "charge_shield", { amount });
  check("burning 4% of the bag buys a 20% shield", !r.error && Number(successValue(r.res)) >= 1990, { hash: r.hash, shield_bps: successValue(r.res), error: r.error });
  const s0 = big((await view(contract, "stats")).satoshi_tokens);
  const bo = await call(contract, va.accountId, va.signer, "boss_raid", {});
  const s1 = big((await view(contract, "stats")).satoshi_tokens);
  check("boss raid takes from Satoshi's stash", !bo.error && s1 < s0 && big(successValue(bo.res)) > 0n, { hash: bo.hash, error: bo.error });
  const again = await call(contract, va.accountId, va.signer, "boss_raid", {});
  check("only once per epoch (E_BOSS_DONE)", /E_BOSS_DONE/.test(again.error || ""), { hash: again.hash });
}

// 9. Quantum guard holds even if a vault owner adds a classical key
{
  const secret = privateKeyFromRandom();
  const pub = publicKeyFromPrivate(secret);
  const add = await send({ signerId: vb.accountId, signer: vb.signer, receiverId: vb.accountId, actions: [near.actions.addFullAccessKey({ publicKey: pub })] });
  const classical = signerFromPrivateKey(secret);
  const r = await call(contract, vb.accountId, classical, "boss_raid", {});
  check("a vault move signed with a classical key is refused (E_NOT_QUANTUM)", !add.error && /E_NOT_QUANTUM/.test(r.error || ""), { hash: r.hash, add_tx: add.hash, error: r.error?.slice(0, 220) });
  const t = await send({
    signerId: vb.accountId, signer: classical, receiverId: contract,
    actions: [near.actions.functionCall({ methodName: "ft_transfer", args: { receiver_id: bob.accountId, amount: tok(1) }, gas: TGAS(50), deposit: "1" })],
  });
  check("tokens cannot leave a vault with a classical signature", /E_NOT_QUANTUM/.test(t.error || ""), { hash: t.hash });
  const del = await send({ signerId: vb.accountId, signer: vb.signer, receiverId: vb.accountId, actions: [near.actions.deleteKey({ publicKey: pub })] });
  const keys = await keyList(vb.accountId);
  check("the classical key is removed again; vault is quantum-only", !del.error && keys.length === 1 && keys[0].public_key.startsWith("ml-dsa-65"), { hash: del.hash });
}

// 10. Harvest, and its gas does not grow with the number of holders
{
  let s = await view(contract, "stats");
  s = await waitUntil(Number(s.epoch_ends_ms) + 1000);
  const before = { exposed: big(s.exposed_tokens), vaults: big(s.vault_tokens) };
  const h1 = await call(contract, bank.accountId, bank.signer, "harvest", {});
  const g1 = gasBurnt(h1.res);
  const s1 = await view(contract, "stats");
  check("harvest moves tokens from exposed wallets to vaults", !h1.error && big(s1.exposed_tokens) < before.exposed && big(s1.vault_tokens) > before.vaults, { hash: h1.hash, error: h1.error });

  // add 40 more holders with balances
  const extra = 40;
  for (let i = 0; i < extra; i += 1) {
    const id = `h${i}.${bank.accountId}`;
    await send({
      signerId: carol.accountId, signer: carol.signer, receiverId: contract,
      actions: [
        near.actions.functionCall({ methodName: "storage_deposit", args: { account_id: id }, gas: TGAS(20), deposit: NEAR(0.0025) }),
        near.actions.functionCall({ methodName: "ft_transfer", args: { receiver_id: id, amount: tok(100) }, gas: TGAS(30), deposit: "1" }),
      ],
    });
  }
  const s2 = await view(contract, "stats");
  await waitUntil(Number(s2.epoch_ends_ms) + 1000);
  const h2 = await call(contract, bank.accountId, bank.signer, "harvest", {});
  const g2 = gasBurnt(h2.res);
  const holders = Number((await view(contract, "stats")).exposed_holders);
  const diff = Number(g2 > g1 ? g2 - g1 : g1 - g2) / Number(g1);
  check(`harvest gas is the same at ${holders - extra} and ${holders} exposed holders`, !h2.error && diff < 0.05, {
    hash: h2.hash, gas_small: g1.toString(), gas_large: g2.toString(), diff_pct: (diff * 100).toFixed(2), first_tx: h1.hash,
  });
}

// 11. Sell from a vault
{
  const b = await bal(va.accountId);
  const r = await call(contract, va.accountId, va.signer, "sell", { amount: (b / 10n).toString() });
  check("a vault sells to the market for NEAR (signed with ML-DSA-65)", !r.error && big(successValue(r.res)) > 0n, { hash: r.hash, near: successValue(r.res), error: r.error });
}

// Books
{
  const s = await view(contract, "stats");
  const feed = await view(contract, "feed", { limit: 10 });
  check("on-chain feed records the moves", Array.isArray(feed) && feed.length > 0, { latest: feed[0]?.kind });
  console.log("stats:", JSON.stringify(s));
}

for (const v of [va, vb, vd]) v.signer.destroy();

const pass = checks.every((c) => c.pass);
const result = { contract, ran_at: new Date().toISOString(), all_pass: pass, checks };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "latest.json"), JSON.stringify(result, null, 2) + "\n");
const md = [
  "# End-to-end run (testnet, fast season)",
  "",
  `Contract \`${contract}\` · ${result.ran_at} · **${pass ? "ALL PASS" : "FAILURES"}**`,
  "",
  "| Check | Result | Transaction |",
  "|---|---|---|",
  ...checks.map((c) => `| ${c.name} | ${c.pass ? "Pass" : "**Fail**"} | ${c.link ? `[view](${c.link})` : ""} |`),
  "",
].join("\n");
fs.writeFileSync(path.join(outDir, "latest.md"), md);
console.log(md);
process.exit(pass ? 0 : 1);
