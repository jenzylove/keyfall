// Judge checks: rebuild every KEYFALL claim from a public NEAR RPC. Read only,
// no keys needed, nothing is signed or sent.
//
// Usage: node judge-checks.mjs [testnet|mainnet] [contract]
//   testnet (default): the practice arena in deployments/testnet-live.json, rules in sim/params.json
//   mainnet:           keyfall.near from deployments/mainnet.json, rules in sim/params-mainnet.json

import fs from "node:fs";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const target = args[0] === "mainnet" || args[0] === "testnet" ? args.shift() : "testnet";
process.env.NEAR_NETWORK = target; // lib.mjs reads it on import
const { near, view, keyList, explorer, unwrap } = await import("./lib.mjs");

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), "utf8"));
const deployment = read(target === "mainnet" ? "../deployments/mainnet.json" : "../deployments/testnet-live.json");
const paramsFile = target === "mainnet" ? "sim/params-mainnet.json" : "sim/params.json";
const params = read(`../${paramsFile}`);
const contract = args[0] || deployment.contract;
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

// NEAR reports code_hash as base58 of the wasm's sha256.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function hexToBase58(hex) {
  let n = BigInt("0x" + hex);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (let i = 0; i < hex.length && hex.slice(i, i + 2) === "00"; i += 2) out = "1" + out;
  return out;
}
async function testnetTx(hash, sender) {
  for (const url of ["https://archival-rpc.testnet.fastnear.com", "https://rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"]) {
    try {
      const j = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" } }) }).then((x) => x.json());
      if (j.result) return j.result;
    } catch {
      /* next node */
    }
  }
  return null;
}
const account = async (id, network = target) => unwrap(await near.queryAccount({ accountId: id, network }));

console.log(`KEYFALL judge checks against ${contract} on ${target}\n`);

// 1. Nobody can change the rules
const keys = await keyList(contract);
check("contract account has no access keys", keys.length === 0, `${keys.length} keys`);
const cfg = await view(contract, "config");
const diffs = Object.keys(params).filter((k) => String(cfg[k]) !== String(params[k]));
check(`config() equals ${paramsFile}`, diffs.length === 0 && Object.keys(cfg).length === Object.keys(params).length, diffs.join(", ") || "all fields equal");

// 2. Deployed code is the code recorded at deploy time, and the code in this repo
const onChain = (await account(contract)).code_hash;
const recorded = hexToBase58(deployment.wasm_sha256);
check(`code_hash equals deployments/${target === "mainnet" ? "mainnet" : "testnet-live"}.json`, onChain === recorded, `chain ${onChain}, recorded ${recorded} (sha256 ${deployment.wasm_sha256.slice(0, 12)}…, ${deployment.wasm_bytes} bytes)`);
const wasmPath = new URL("../target/near/qday_contract/qday_contract.wasm", import.meta.url);
if (fs.existsSync(wasmPath)) {
  const sha = crypto.createHash("sha256").update(fs.readFileSync(wasmPath)).digest("hex");
  if (sha === deployment.wasm_sha256) check("local build matches the deployed wasm", true, `sha256 ${sha.slice(0, 12)}…`);
  else console.log(`NOTE  local build ${sha.slice(0, 12)}… is not the ${target} wasm ${deployment.wasm_sha256.slice(0, 12)}… (deployed ${deployment.deployed_at}; the build tracks this checkout)`);
} else {
  console.log(`SKIP  local build (cd contract && cargo near build non-reproducible-wasm --no-abi); deployed sha256 ${deployment.wasm_sha256}`);
}

// 3. The token
const meta = await view(contract, "ft_metadata");
if (target === "mainnet") check("ft_metadata is KEYFALL", meta?.symbol === "KEYFALL" && meta?.decimals === 18, `${meta?.name} / ${meta?.symbol}, ${meta?.decimals} decimals`);
else console.log(`INFO  ft_metadata: ${meta?.name} / ${meta?.symbol}, ${meta?.decimals} decimals`);

// 4. Every vault is quantum only
const vaults = [];
for (let from = 0; ; from += 200) {
  const page = await view(contract, "vaults", { from_index: from, limit: 200 });
  vaults.push(...page);
  if (page.length < 200) break;
}
let quantumOnly = 0;
const flagged = [];
for (const v of vaults) {
  const ks = await keyList(v.account);
  const ok = ks.length === 1 && ks[0].public_key.startsWith("ml-dsa-65") && ks[0].permission === "FullAccess";
  if (ok) quantumOnly += 1;
  else flagged.push(`${v.account} (${ks.map((k) => k.public_key.split(":")[0]).join(", ") || "no keys"})`);
}
check(`vault census: ${quantumOnly} of ${vaults.length} vaults are controlled only by an ML-DSA-65 key`, flagged.length === 0, flagged.length ? `flagged: ${flagged.join("; ")}` : "");

// 5. The books add up
const s = await view(contract, "stats");
// Satoshi's stash is an exposed balance, so it is inside exposed_tokens.
const sum = ["exposed_tokens", "vault_tokens", "market_tokens", "escrow", "burned"].reduce((a, k) => a + BigInt(s[k]), 0n);
check("exposed (incl. Satoshi) + vaults + market + escrow + burned = total supply", sum === BigInt(params.total_supply), `${sum} vs ${params.total_supply}`);

// 6. An ed25519 signed vault move is refused. Sending one would need a key,
// so this reads the refusal the end-to-end run put on testnet and checks it
// on chain: the transaction was signed with an ed25519 key, it failed with
// E_NOT_QUANTUM, and (mainnet) the contract that refused it runs the same
// code_hash as this contract.
const e2ePath = new URL("../docs/e2e/latest.json", import.meta.url);
if (!fs.existsSync(e2ePath)) check("e2e evidence present (docs/e2e/latest.json)", false, "missing");
else {
  const e2e = read("../docs/e2e/latest.json");
  const refused = e2e.checks.find((x) => x.name === "a vault move signed with a classical key is refused (E_NOT_QUANTUM)");
  let tx = null;
  const senders = refused?.signer ? [refused.signer] : (await near.view({ contractId: e2e.contract, methodName: "vaults", args: { limit: 50 }, network: "testnet" })).map((v) => v.account);
  for (const sender of senders) {
    try {
      const r = await testnetTx(refused.hash, sender);
      if (r?.transaction?.hash === refused.hash) {
        tx = r;
        break;
      }
    } catch {
      /* try the next vault */
    }
  }
  const outcome = JSON.stringify(tx?.receipts_outcome || []) + JSON.stringify(tx?.status || {});
  check(
    "an ed25519 signed vault move is refused on chain (E_NOT_QUANTUM)",
    Boolean(tx) && tx.transaction.public_key.startsWith("ed25519:") && /E_NOT_QUANTUM/.test(outcome),
    tx ? `${tx.transaction.signer_id} signed ${tx.transaction.public_key.slice(0, 16)}…, ${refused.link}` : `tx ${refused?.hash} not found`,
  );
  // The receipt records the code_hash that executed it: the code that refused.
  const ran = [...new Set((tx?.receipts_outcome || []).filter((o) => o.outcome.executor_id === e2e.contract).flatMap((o) => (o.outcome.metadata?.contracts || []).map((c) => c.local || c.global)).filter(Boolean))];
  const e2eCode = ran[0] || (await account(e2e.contract, "testnet")).code_hash;
  if (target === "mainnet") check("that refusal ran on the same code as mainnet", e2eCode === onChain, `${e2e.contract} ran code_hash ${e2eCode}`);
  else console.log(`INFO  the refusal ran on ${e2e.contract}, code_hash ${e2eCode}${e2eCode === onChain ? " (same as this contract)" : `; this contract runs ${onChain}`}`);
  check(`e2e run on ${e2e.contract}: ${e2e.checks.filter((c) => c.pass).length} of ${e2e.checks.length} checks pass`, e2e.all_pass, e2e.ran_at);
}

console.log(`\nSeason: epoch ${s.epoch}, Q-Day ${new Date(Number(s.q_day_ms)).toISOString()}, ${s.vaults} vaults, ${s.exposed_holders} exposed holders, ${s.raids} raids, ${(s.vault_share_bps / 100).toFixed(2)}% of holdings in vaults`);
console.log(`Deploy: ${explorer(deployment.deploy_tx)}`);
const pass = results.every((r) => r.pass);
console.log(pass ? "\nALL PASS" : "\nFAILURES");
process.exit(pass ? 0 : 1);
