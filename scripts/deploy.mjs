// Deploy Q-DAY to testnet: create the account, then in ONE transaction deploy
// the contract, initialise it and delete its only access key. After this
// nobody can change the rules.
//
// Usage: node deploy.mjs <wasm> <params.json> <label> [start_ms]
// Writes ../deployments/testnet-<label>.json

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { near, send, view, keyList, explorer, faucetAccount, TGAS, network } from "./lib.mjs";

const [wasmPath, paramsPath, label, startArg] = process.argv.slice(2);
if (!wasmPath || !paramsPath || !label) throw new Error("usage: node deploy.mjs <wasm> <params.json> <label> [start_ms]");

const code = fs.readFileSync(wasmPath);
const params = JSON.parse(fs.readFileSync(paramsPath, "utf8"));
const start_ms = startArg ? String(startArg) : String(Date.now() + 60_000);

const acct = await faucetAccount(`qday-${label}`);
console.log("contract account:", acct.accountId);

const r = await send({
  signerId: acct.accountId,
  signer: acct.signer,
  receiverId: acct.accountId,
  actions: [
    near.actions.deployContract({ codeBase64: code.toString("base64") }),
    near.actions.functionCall({ methodName: "new", args: { params, start_ms }, gas: TGAS(100), deposit: "0" }),
    near.actions.deleteKey({ publicKey: acct.publicKey }),
  ],
});
if (r.error) throw new Error(`deploy failed: ${r.error}`);
console.log("deploy + init + delete key:", explorer(r.hash));

const keys = await keyList(acct.accountId);
const cfg = await view(acct.accountId, "config");
const stats = await view(acct.accountId, "stats");
const keyless = keys.length === 0;
const configMatches = JSON.stringify(cfg) === JSON.stringify(params);
console.log("keyless:", keyless, "config matches params:", configMatches);
if (!keyless || !configMatches) throw new Error("post-deploy checks failed");

const out = {
  network,
  label,
  contract: acct.accountId,
  deploy_tx: r.hash,
  deploy_link: explorer(r.hash),
  deployed_at: new Date().toISOString(),
  start_ms: Number(start_ms),
  q_day_ms: Number(stats.q_day_ms),
  params_file: path.relative(path.resolve(".."), path.resolve(paramsPath)),
  wasm_sha256: crypto.createHash("sha256").update(code).digest("hex"),
  wasm_bytes: code.length,
  keyless,
  config_matches_params: configMatches,
};
fs.mkdirSync("../deployments", { recursive: true });
fs.writeFileSync(`../deployments/${network}-${label}.json`, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
