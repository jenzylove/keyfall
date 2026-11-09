// KEYFALL mainnet launch, step by step. Run with NEAR_NETWORK=mainnet.
//
//   node mainnet-launch.mjs claim  <deployer.json> <name.near> <near>
//       the deployer (an implicit account) creates the top level account with
//       its own key, through the `near` registrar
//   node mainnet-launch.mjs pqtest <deployer.json> <name.near>
//       proves ML-DSA-65 keys work on mainnet before anything is locked:
//       creates pq.<name.near> with ONLY an ML-DSA-65 key, then that account
//       deletes itself (refunding <name.near>) in a transaction signed with
//       the quantum key
//   node mainnet-launch.mjs deploy <deployer.json> <name.near> <wasm> <params.json>
//       ONE transaction: deploy, init, delete the only key. Then checks the
//       account is keyless and config() equals the params file.
//
// The deployer key file never enters the repo and is never printed.

import fs from "node:fs";
import crypto from "node:crypto";
import { near, send, view, keyList, explorer, TGAS, NEAR, network, signerFromPrivateKey, generateSigner, waitForAccount } from "./lib.mjs";

if (network !== "mainnet") throw new Error("set NEAR_NETWORK=mainnet");
const [cmd, keyFile, name, ...rest] = process.argv.slice(2);
const dep = JSON.parse(fs.readFileSync(keyFile, "utf8"));
const deployer = { accountId: dep.account_id, signer: signerFromPrivateKey(dep.private_key), publicKey: dep.public_key };
const named = { accountId: name, signer: deployer.signer, publicKey: deployer.publicKey };

async function must(r, what) {
  if (r.error) throw new Error(`${what} failed: ${r.error}`);
  console.log(`${what}: ${explorer(r.hash)}`);
  return r;
}

if (cmd === "claim") {
  const amount = Number(rest[0] || "3.2");
  await must(
    await send({
      signerId: deployer.accountId,
      signer: deployer.signer,
      receiverId: "near",
      actions: [near.actions.functionCall({ methodName: "create_account", args: { new_account_id: name, new_public_key: deployer.publicKey }, gas: TGAS(100), deposit: NEAR(amount) })],
    }),
    `claim ${name}`,
  );
  console.log("exists:", await waitForAccount(name));
} else if (cmd === "pqtest") {
  const pq = await generateSigner();
  const pqId = `pq.${name}`;
  await must(
    await send({
      signerId: named.accountId,
      signer: named.signer,
      receiverId: pqId,
      actions: [near.actions.createAccount(), near.actions.transfer(NEAR(0.05)), near.actions.addFullAccessKey({ publicKey: pq.publicKey })],
    }),
    `create ${pqId} with only an ML-DSA-65 key`,
  );
  const keys = await keyList(pqId);
  console.log("keys on", pqId, keys.map((k) => k.public_key.slice(0, 24) + "…"));
  await must(
    await send({ signerId: pqId, signer: pq, receiverId: pqId, actions: [near.actions.deleteAccount({ beneficiaryId: name })] }),
    `${pqId} deletes itself, signed with ML-DSA-65`,
  );
} else if (cmd === "deploy") {
  const [wasmPath, paramsPath] = rest;
  const code = fs.readFileSync(wasmPath);
  const params = JSON.parse(fs.readFileSync(paramsPath, "utf8"));
  const start_ms = String(Date.now() + 60_000);
  const r = await must(
    await send({
      signerId: named.accountId,
      signer: named.signer,
      receiverId: named.accountId,
      actions: [
        near.actions.deployContract({ codeBase64: code.toString("base64") }),
        near.actions.functionCall({ methodName: "new", args: { params, start_ms }, gas: TGAS(100), deposit: "0" }),
        near.actions.deleteKey({ publicKey: named.publicKey }),
      ],
    }),
    "deploy + init + delete key",
  );
  const keys = await keyList(name);
  const cfg = await view(name, "config");
  const stats = await view(name, "stats");
  const out = {
    network,
    contract: name,
    deploy_tx: r.hash,
    deploy_link: explorer(r.hash),
    deployed_at: new Date().toISOString(),
    start_ms: Number(start_ms),
    q_day_ms: Number(stats.q_day_ms),
    params_file: paramsPath.replace(/^\.\.\//, ""),
    wasm_sha256: crypto.createHash("sha256").update(code).digest("hex"),
    wasm_bytes: code.length,
    keyless: keys.length === 0,
    config_matches_params: JSON.stringify(cfg) === JSON.stringify(params),
  };
  fs.writeFileSync("../deployments/mainnet.json", JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  if (!out.keyless || !out.config_matches_params) throw new Error("post deploy checks failed");
} else {
  throw new Error("usage: claim | pqtest | deploy (see the header)");
}
