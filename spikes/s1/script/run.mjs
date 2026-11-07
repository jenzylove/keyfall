// Spike S1 runner (NEAR testnet).
//
// 1. Create a fresh funded testnet account with an ed25519 key.
// 2. Deploy the spike contract to it.
// 3. Call whoami() signed with ed25519            -> expect key_tag 0
// 4. Add an ML-DSA-65 key, call whoami() with it   -> expect key_tag 2
// 5. require_quantum(): fails with ed25519, passes with ML-DSA-65
// 6. Same check through a meta transaction (delegate signed with ML-DSA-65)
// 7. make_player(): contract creates <name>.<contract> born with only an
//    ML-DSA-65 key; the new account then signs its own transaction.
//
// Usage: node run.mjs <path-to-wasm> [out-dir]
// Never logs or writes any secret key or seed.

import fs from "node:fs";
import path from "node:path";
import * as near from "@fastnear/api";
import { generateSigner, publicKeyToHandle } from "@fastnear/ml-dsa-65";
import {
  privateKeyFromRandom,
  publicKeyFromPrivate,
  signerFromPrivateKey,
  fromBase58,
  bytesToBase64,
} from "@fastnear/utils";

const network = "testnet";
const wasmPath = process.argv[2];
const outDir = process.argv[3] || ".";
if (!wasmPath) throw new Error("usage: node run.mjs <wasm> [out-dir]");

const TGAS = (n) => (BigInt(n) * 10n ** 12n).toString();
const NEAR = (n) => (BigInt(Math.round(n * 1000)) * 10n ** 21n).toString();
const explorer = (h) => `https://testnet.nearblocks.io/txns/${h}`;

const results = {
  started_at: new Date().toISOString(),
  network,
  protocol_version: null,
  contract: null,
  checks: [],
};

function record(name, pass, detail) {
  const row = { name, pass, ...detail };
  results.checks.push(row);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`, JSON.stringify(detail));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function unwrap(res) {
  return res && res.result ? res.result : res;
}

function txHash(res) {
  const r = unwrap(res);
  return r?.transaction?.hash || r?.transaction_outcome?.id || null;
}

function successValue(res) {
  const r = unwrap(res);
  const v = r?.status?.SuccessValue;
  if (v === undefined || v === null) return undefined;
  if (v === "") return null;
  return JSON.parse(Buffer.from(v, "base64").toString("utf8"));
}

function failure(res) {
  const r = unwrap(res);
  if (r?.status?.Failure) return JSON.stringify(r.status.Failure);
  for (const o of r?.receipts_outcome || []) {
    if (o?.outcome?.status?.Failure) return JSON.stringify(o.outcome.status.Failure);
  }
  return null;
}

async function send({ signerId, signer, receiverId, actions }) {
  try {
    const res = await near.sendTx({
      signerId,
      signer,
      receiverId,
      actions,
      waitUntil: "FINAL",
      network,
    });
    return { res, error: failure(res) };
  } catch (e) {
    return { res: null, error: String(e?.message || e) };
  }
}

async function waitForAccount(accountId) {
  for (let i = 0; i < 30; i += 1) {
    try {
      const a = await near.queryAccount({ accountId, network });
      if (unwrap(a)?.amount) return true;
    } catch {}
    await sleep(2000);
  }
  return false;
}

function rawMlDsaPublicKey(full) {
  const b = fromBase58(full.replace(/^ml-dsa-65:/, ""));
  if (b.length === 1952) return b;
  if (b.length === 1953 && b[0] === 2) return b.slice(1);
  throw new Error(`unexpected ML-DSA-65 public key length ${b.length}`);
}

async function main() {
  results.protocol_version = await near.queryProtocolVersion({ network });
  console.log("testnet protocol version:", results.protocol_version);
  record("protocol supports ML-DSA-65 accounts (>= 85)", results.protocol_version >= 85, {
    protocol_version: results.protocol_version,
  });

  // 1. Fresh account
  const classicalSecret = privateKeyFromRandom();
  const classicalPublic = publicKeyFromPrivate(classicalSecret);
  const classical = signerFromPrivateKey(classicalSecret);
  const accountId = `qday-s1-${Date.now().toString(36)}.testnet`;
  results.contract = accountId;
  await near.createFundedTestnetAccount({ newAccountId: accountId, publicKey: classicalPublic });
  const ready = await waitForAccount(accountId);
  record("faucet account created", ready, { account: accountId });
  if (!ready) return;

  // 2. Deploy
  const code = fs.readFileSync(wasmPath);
  const dep = await send({
    signerId: accountId,
    signer: classical,
    receiverId: accountId,
    actions: [near.actions.deployContract({ codeBase64: code.toString("base64") })],
  });
  record("contract deployed", !dep.error, { tx: txHash(dep.res), link: explorer(txHash(dep.res)), error: dep.error });
  if (dep.error) return;

  const call = (signerId, signer, methodName, args = {}, deposit = "0") =>
    send({
      signerId,
      signer,
      receiverId: accountId,
      actions: [near.actions.functionCall({ methodName, args, gas: TGAS(100), deposit })],
    });

  // 3. whoami with ed25519
  const w0 = await call(accountId, classical, "whoami");
  const v0 = successValue(w0.res);
  record("ed25519 signer is seen as key_tag 0", v0?.key_tag === 0 && v0?.quantum_safe === false, {
    returned: v0,
    tx: txHash(w0.res),
    link: explorer(txHash(w0.res)),
    error: w0.error,
  });

  // 4. Add ML-DSA-65 key, whoami with it
  const pq = generateSigner();
  try {
    const add = await send({
      signerId: accountId,
      signer: classical,
      receiverId: accountId,
      actions: [near.actions.addFullAccessKey({ publicKey: pq.publicKey })],
    });
    record("ML-DSA-65 full-access key added", !add.error, { tx: txHash(add.res), link: explorer(txHash(add.res)), error: add.error });

    const w2 = await call(accountId, pq, "whoami");
    const v2 = successValue(w2.res);
    record("ML-DSA-65 signer is seen as key_tag 2", v2?.key_tag === 2 && v2?.quantum_safe === true, {
      returned: v2,
      tx: txHash(w2.res),
      link: explorer(txHash(w2.res)),
      error: w2.error,
    });

    // 5. require_quantum gate
    const g0 = await call(accountId, classical, "require_quantum");
    record("require_quantum refuses ed25519", Boolean(g0.error) && /E_NOT_QUANTUM/.test(g0.error), {
      tx: txHash(g0.res),
      link: txHash(g0.res) ? explorer(txHash(g0.res)) : null,
      error: g0.error,
    });
    const g2 = await call(accountId, pq, "require_quantum");
    record("require_quantum accepts ML-DSA-65", !g2.error && successValue(g2.res) === true, {
      tx: txHash(g2.res),
      link: explorer(txHash(g2.res)),
      error: g2.error,
    });

    // 6. Meta transaction: delegate signed by ML-DSA-65, relayed by ed25519
    try {
      const signed = await near.signDelegate({
        receiverId: accountId,
        actions: [near.actions.functionCall({ methodName: "whoami", args: {}, gas: TGAS(50), deposit: "0" })],
        signerId: accountId,
        signer: pq,
        network,
      });
      const relayed = await near.relayDelegate({
        ...signed,
        relayerSigner: classical,
        relayerId: accountId,
        waitUntil: "FINAL",
        network,
      });
      const vm = successValue(relayed);
      const err = failure(relayed);
      // For a delegate, the inner call's return value sits in a receipt; the
      // contract also logs it. Read the log line to be exact.
      const logs = (unwrap(relayed)?.receipts_outcome || []).flatMap((o) => o.outcome?.logs || []);
      const line = logs.find((l) => l.startsWith("whoami ")) || null;
      record("meta transaction: inner ML-DSA-65 signer is seen as key_tag 2", Boolean(line && /tag=2/.test(line)), {
        log: line,
        returned: vm,
        tx: txHash(relayed),
        link: explorer(txHash(relayed)),
        error: err,
      });
    } catch (e) {
      record("meta transaction: inner ML-DSA-65 signer is seen as key_tag 2", false, { error: String(e?.message || e) });
    }
  } finally {
    pq.destroy();
  }

  // 7. Player account born quantum-only
  const player = generateSigner();
  try {
    const name = `p${Date.now().toString(36)}`;
    const playerId = `${name}.${accountId}`;
    const raw = rawMlDsaPublicKey(player.publicKey);
    const mk = await call(
      accountId,
      classical,
      "make_player",
      { name, pq_public_key: bytesToBase64(raw) },
      NEAR(0.05),
    );
    record("make_player created a sub-account", !mk.error, {
      player: playerId,
      tx: txHash(mk.res),
      link: explorer(txHash(mk.res)),
      error: mk.error,
    });

    if (!mk.error) {
      await waitForAccount(playerId);
      const list = unwrap(await near.queryAccessKeyList({ accountId: playerId, blockId: "final", network }));
      const keys = (list?.keys || []).map((k) => ({
        public_key: k.public_key,
        permission: k.access_key?.permission,
      }));
      const handle = publicKeyToHandle(player.publicKey);
      const onlyPq = keys.length === 1 && keys[0].public_key === handle && keys[0].permission === "FullAccess";
      record("player account holds exactly one key: the ML-DSA-65 full-access key", onlyPq, {
        keys,
        expected_handle: handle,
      });

      const own = await send({
        signerId: playerId,
        signer: player,
        receiverId: accountId,
        actions: [near.actions.functionCall({ methodName: "whoami", args: {}, gas: TGAS(50), deposit: "0" })],
      });
      const vo = successValue(own.res);
      record("player account signs its own transaction with ML-DSA-65", vo?.key_tag === 2 && vo?.signer === playerId, {
        returned: vo,
        tx: txHash(own.res),
        link: explorer(txHash(own.res)),
        error: own.error,
      });
    }
  } finally {
    player.destroy();
  }
}

try {
  await main();
} catch (e) {
  record("runner crashed", false, { error: String(e?.stack || e) });
}

results.finished_at = new Date().toISOString();
results.all_pass = results.checks.length > 0 && results.checks.every((c) => c.pass);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "s1-results.json"), JSON.stringify(results, null, 2));

const md = [
  `# Spike S1 results`,
  ``,
  `Network: ${network} · protocol ${results.protocol_version} · contract \`${results.contract}\``,
  ``,
  `**Overall: ${results.all_pass ? "PASS" : "FAIL"}**`,
  ``,
  `| Check | Result | Evidence |`,
  `|---|---|---|`,
  ...results.checks.map(
    (c) => `| ${c.name} | ${c.pass ? "PASS" : "FAIL"} | ${c.link ? `[tx](${c.link})` : ""} ${c.error ? "`" + String(c.error).slice(0, 160).replace(/\|/g, "/") + "`" : ""} |`,
  ),
  ``,
].join("\n");
fs.writeFileSync(path.join(outDir, "s1-results.md"), md);
console.log("\n" + md);
process.exit(results.all_pass ? 0 : 1);
