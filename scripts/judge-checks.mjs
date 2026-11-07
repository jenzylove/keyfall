// Judge checks: rebuild every Q-DAY claim from a public NEAR RPC. No keys needed.
//
// Usage: node judge-checks.mjs [contract]   (default: deployments/testnet-live.json)

import fs from "node:fs";
import crypto from "node:crypto";
import { view, keyList, explorer } from "./lib.mjs";

const live = JSON.parse(fs.readFileSync(new URL("../deployments/testnet-live.json", import.meta.url), "utf8"));
const contract = process.argv[2] || live.contract;
const params = JSON.parse(fs.readFileSync(new URL("../sim/params.json", import.meta.url), "utf8"));
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

console.log(`Q-DAY judge checks against ${contract} on testnet\n`);

// 1. Nobody can change the rules
const keys = await keyList(contract);
check("contract account has no access keys", keys.length === 0, `${keys.length} keys`);
const cfg = await view(contract, "config");
const diffs = Object.keys(params).filter((k) => String(cfg[k]) !== String(params[k]));
check("config() equals sim/params.json", diffs.length === 0 && Object.keys(cfg).length === Object.keys(params).length, diffs.join(", ") || "all fields equal");

// 2. Deployed code is the code in this repo
const wasmPath = new URL("../target/near/qday_contract/qday_contract.wasm", import.meta.url);
if (fs.existsSync(wasmPath)) {
  const sha = crypto.createHash("sha256").update(fs.readFileSync(wasmPath)).digest("hex");
  check("local build matches the deployed wasm hash", sha === live.wasm_sha256, `local ${sha.slice(0, 12)}…, deployed ${live.wasm_sha256.slice(0, 12)}…`);
} else {
  console.log(`SKIP  wasm hash (build with: cd contract && cargo near build non-reproducible-wasm --no-abi); deployed sha256 ${live.wasm_sha256}`);
}

// 3. Every vault is quantum only
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

// 4. The books add up
const s = await view(contract, "stats");
// Satoshi's stash is an exposed balance, so it is inside exposed_tokens.
const sum = ["exposed_tokens", "vault_tokens", "market_tokens", "escrow", "burned"].reduce((a, k) => a + BigInt(s[k]), 0n);
check("exposed (incl. Satoshi) + vaults + market + escrow + burned = total supply", sum === BigInt(params.total_supply), `${sum} vs ${params.total_supply}`);

// 5. Quantum guard evidence from the last end-to-end run
const e2ePath = new URL("../docs/e2e/latest.json", import.meta.url);
if (fs.existsSync(e2ePath)) {
  const e2e = JSON.parse(fs.readFileSync(e2ePath, "utf8"));
  for (const name of ["a vault move signed with a classical key is refused (E_NOT_QUANTUM)", "vault raids an exposed wallet (signed with ML-DSA-65)"]) {
    const c = e2e.checks.find((x) => x.name === name);
    check(`e2e: ${name}`, Boolean(c?.pass), c?.link || "missing");
  }
  check(`e2e run on ${e2e.contract}: ${e2e.checks.filter((c) => c.pass).length} of ${e2e.checks.length} checks pass`, e2e.all_pass, e2e.ran_at);
}

console.log(`\nSeason: epoch ${s.epoch}, Q-Day ${new Date(Number(s.q_day_ms)).toISOString()}, ${s.vaults} vaults, ${s.exposed_holders} exposed holders, ${s.raids} raids, ${(s.vault_share_bps / 100).toFixed(2)}% of holdings in vaults`);
console.log(`Deploy: ${explorer(live.deploy_tx)}`);
const pass = results.every((r) => r.pass);
console.log(pass ? "\nALL PASS" : "\nFAILURES");
process.exit(pass ? 0 : 1);
