// Pour a fresh testnet faucet account into `to`: the sponsor that funds new
// players and NPC gas. Runs from GitHub Actions. The faucet key lives only in
// memory for the length of this run.
//
// Usage: node fund.mjs <to-account> [rounds]

import { near, send, faucetAccount, explorer, sleep, unwrap } from "./lib.mjs";

const to = process.argv[2];
const rounds = Number(process.argv[3] || 1);
if (!to) throw new Error("usage: node fund.mjs <to-account> [rounds]");
for (let i = 0; i < rounds; i += 1) {
  let acct;
  try {
    acct = await faucetAccount("qday-fund");
  } catch (e) {
    console.log(`round ${i + 1}: faucet refused: ${String(e.message).slice(0, 160)}`);
    break;
  }
  const a = unwrap(await near.queryAccount({ accountId: acct.accountId, network: "testnet" }));
  const keep = 5n * 10n ** 22n; // 0.05 NEAR stays for the transfer's gas and storage
  const amount = (BigInt(a.amount) - keep).toString();
  const r = await send({ signerId: acct.accountId, signer: acct.signer, receiverId: to, actions: [near.actions.transfer(amount)] });
  console.log(`round ${i + 1}: ${r.error ? "FAILED " + r.error : `sent ${Number(BigInt(amount) / 10n ** 21n) / 1000} NEAR ${explorer(r.hash)}`}`);
  await sleep(5000);
}
