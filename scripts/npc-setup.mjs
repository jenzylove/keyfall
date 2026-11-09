// One-time NPC setup, from a developer machine.
// Creates faucet "bank" accounts, then for each roster entry: create_vault
// (0.3 NEAR), buy its bag from a bank account and migrate it into the vault.
// Seeds are written to a file OUTSIDE the repo and never printed.
//
// Usage: node scripts/npc-setup.mjs [seeds-path]   (default ../../qday-launch/npc-seeds.json)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { signerFromSeed } from "@fastnear/ml-dsa-65";
import { near, call, send, view, faucetAccount, rawMlDsaPublicKey, bytesToBase64, explorer, sleep, NEAR, TGAS, waitForAccount, unwrap, successValue } from "./lib.mjs";
import { ROSTER, BAGS_NEAR } from "../app/npc/rules.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
// Mainnet: NEAR_NETWORK=mainnet NPC_BANK=<deployer.json> NPC_ONLY=shor,grover,qubit-01 NPC_BAG=0.25
const MAINNET = process.env.NEAR_NETWORK === "mainnet";
const live = JSON.parse(fs.readFileSync(path.join(here, "..", "deployments", MAINNET ? "mainnet.json" : "testnet-live.json"), "utf8"));
const contract = live.contract;
const ONLY = process.env.NPC_ONLY ? process.env.NPC_ONLY.split(",") : null;
const FIXED_BAG = process.env.NPC_BAG ? Number(process.env.NPC_BAG) : null;
const seedsPath = path.resolve(process.argv[2] || path.join(here, "..", "..", "qday-launch", "npc-seeds.json"));
const FAUCET_PAUSE_MS = 60_000;
const BANKS = 2;

const toHex = (b) => Buffer.from(b).toString("hex");
const fromHex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));

let seeds = {};
if (fs.existsSync(seedsPath)) seeds = JSON.parse(fs.readFileSync(seedsPath, "utf8"));
const saveSeeds = () => {
  fs.mkdirSync(path.dirname(seedsPath), { recursive: true });
  fs.writeFileSync(seedsPath, JSON.stringify(seeds, null, 2) + "\n");
};

const todo = [];
for (const r of ROSTER.filter((x) => !ONLY || ONLY.includes(x.name))) {
  const id = `${r.name}.${contract}`;
  const h = await view(contract, "holder", { account_id: id });
  if (h) console.log(`skip ${id}: vault already exists`);
  else todo.push(r);
}
if (!todo.length) {
  console.log("all NPC vaults exist");
  process.exit(0);
}
const bag = (r) => FIXED_BAG ?? (r.name.startsWith("qubit") ? BAGS_NEAR.qubit : BAGS_NEAR[r.name]);
const need = todo.reduce((s, r) => s + bag(r) + 0.3, 0) + 0.5;
console.log(`creating ${todo.length} vault(s), about ${need.toFixed(1)} NEAR needed`);

async function makeBank(i) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const b = await faucetAccount(`qday-npc${i}`);
      console.log(`bank ${i}: ${b.accountId}`);
      return b;
    } catch (e) {
      console.log(`faucet refused bank ${i} (attempt ${attempt}): ${String(e?.message || e).slice(0, 120)}; waiting 3 min`);
      await sleep(180_000);
    }
  }
  throw new Error("faucet kept refusing");
}

const banks = [];
if (process.env.NPC_BANK) {
  const k = JSON.parse(fs.readFileSync(process.env.NPC_BANK, "utf8"));
  const { signerFromPrivateKey } = await import("@fastnear/utils");
  const have = Number(BigInt(unwrap(await near.queryAccount({ accountId: k.account_id, network: MAINNET ? "mainnet" : "testnet" })).amount) / 10n ** 21n) / 1000;
  console.log(`bank: ${k.account_id.slice(0, 8)}… holds ${have} NEAR`);
  banks.push({ accountId: k.account_id, signer: signerFromPrivateKey(k.private_key), spent: 9.9 - (have - 0.05) });
}
for (let i = 1; !process.env.NPC_BANK && i <= BANKS && banks.length * 9.5 < need; i += 1) {
  if (i > 1) await sleep(FAUCET_PAUSE_MS);
  banks.push({ ...(await makeBank(i)), spent: 0 });
}

const bal = async (id) => BigInt(await view(contract, "ft_balance_of", { account_id: id }));
const created = [];

for (const r of todo) {
  const cost = bag(r) + 0.3 + 0.05;
  const bank = banks.find((b) => 9.9 - b.spent >= cost);
  if (!bank) {
    console.log(`out of bank funds before ${r.name}; rerun the script to finish`);
    break;
  }
  const accountId = `${r.name}.${contract}`;
  const seed = seeds[r.name] ? fromHex(seeds[r.name]) : crypto.randomBytes(32);
  seeds[r.name] = toHex(seed);
  saveSeeds(); // the seed is on disk before any money moves

  const signer = signerFromSeed(seed);
  const raw = rawMlDsaPublicKey(signer.publicKey);
  const cv = await call(contract, bank.accountId, bank.signer, "create_vault", { name: r.name, pq_public_key: bytesToBase64(raw) }, { deposit: NEAR(0.3), gas: 100 });
  bank.spent += 0.3;
  await waitForAccount(accountId);
  const hv = await view(contract, "holder", { account_id: accountId });
  if (cv.error || hv?.kind !== "vault") {
    console.log(`FAILED ${r.name}: create_vault ${cv.error?.slice(0, 200) || "not registered"}`);
    signer.destroy?.();
    continue;
  }

  const buy = await call(contract, bank.accountId, bank.signer, "buy", {}, { deposit: NEAR(bag(r)) });
  bank.spent += bag(r);
  const amount = (await bal(bank.accountId)).toString();
  const mig = await send({
    signerId: bank.accountId, signer: bank.signer, receiverId: contract,
    actions: [near.actions.functionCall({ methodName: "ft_transfer", args: { receiver_id: accountId, amount }, gas: TGAS(50), deposit: "1" })],
  });
  const have = await bal(accountId);
  created.push({ name: r.name, accountId, create: cv.hash, buy: buy.hash, migrate: mig.hash, bag: have.toString() });
  console.log(`${accountId}: bag ${(have / 10n ** 18n).toString()} tokens`);
  console.log(`  create  ${explorer(cv.hash)}`);
  console.log(`  buy     ${buy.error ? "FAILED " + buy.error.slice(0, 120) : explorer(buy.hash)}`);
  console.log(`  migrate ${mig.error ? "FAILED " + mig.error.slice(0, 120) : explorer(mig.hash)}`);
  signer.destroy?.();
}

console.log(`done: ${created.length} created. Seeds saved to ${seedsPath} (not printed).`);
