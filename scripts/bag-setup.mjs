// Bagholders: the game's red bots. Each is an ordinary testnet account (from the
// faucet) with an ed25519 key that buys a big bag and never moves it into a vault,
// so players always have red prey. The keys go into the NPC seeds file OUTSIDE the
// repo (keyed by account id) and are never printed; the account ids go into
// app/npc/bagholders.json for this contract.
//
// Usage: node scripts/bag-setup.mjs <seeds-path> [count] [bag NEAR]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { near, send, view, waitForAccount, privateKeyFromRandom, publicKeyFromPrivate, signerFromPrivateKey, explorer, sleep, NEAR, TGAS } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const live = JSON.parse(fs.readFileSync(path.join(here, "..", "deployments", "testnet-live.json"), "utf8"));
const contract = live.contract;
const seedsPath = path.resolve(process.argv[2]);
const COUNT = Number(process.argv[3] || 6);
const BAG = Number(process.argv[4] || 2);
const regPath = path.join(here, "..", "app", "npc", "bagholders.json");
const seeds = JSON.parse(fs.readFileSync(seedsPath, "utf8"));
const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
const list = (reg[contract] ||= []);

for (let i = list.length; i < COUNT; i++) {
  const secret = privateKeyFromRandom();
  const accountId = `kfbag${String(i + 1).padStart(2, "0")}-${Date.now().toString(36)}.testnet`;
  await near.createFundedTestnetAccount({ newAccountId: accountId, publicKey: publicKeyFromPrivate(secret) });
  if (!(await waitForAccount(accountId))) throw new Error(`faucet account ${accountId} never appeared`);
  seeds[accountId] = secret;
  list.push(accountId);
  fs.writeFileSync(seedsPath, JSON.stringify(seeds, null, 2));
  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2) + "\n");
  const r = await send({ signerId: accountId, signer: signerFromPrivateKey(secret), receiverId: contract, actions: [near.actions.functionCall({ methodName: "buy", args: {}, gas: TGAS(50), deposit: NEAR(BAG) })] });
  if (r.error) throw new Error(`buy for ${accountId}: ${r.error}`);
  const h = await view(contract, "holder", { account_id: accountId });
  console.log(`bagholder ${i + 1}: ${accountId} bag ${BigInt(h.balance) / 10n ** 18n} coins, buy ${explorer(r.hash)}`);
  if (i < COUNT - 1) await sleep(60_000); // the faucet rate limit
}
console.log(`done: ${list.length} bagholders on ${contract}. Keys in ${seedsPath} (not printed).`);
