// Cash out dry run: everything a KEYFALL vault does to cash out to another
// chain through NEAR Intents (1Click), up to (not including) the deposit.
// Read only. No keys, nothing signed, nothing sent.
//
// Usage: node cashout-dry.mjs [--vault shor.keyfall.near] [--near 0.5]
//          [--sol <Solana address>] [--base <0x address>] [--api https://keyfall.jdollar.site]
//
// 1. Reads the vault on mainnet: exists, its key list (one ML-DSA-65 key), NEAR,
//    wNEAR registration and balance.
// 2. Gets a dry 1Click quote (dry: true, no deposit address is made) for each
//    destination the app offers, with exactly the body app/api/cashout.ts sends.
//    With --api it asks that deployment's /api/cashout instead (same origin rules).
// 3. Prints the one transaction the vault would sign (to wrap.near, ML-DSA-65):
//    storage_deposit x2, near_deposit, ft_transfer to the deposit address.
// 4. Checks the 1Click status endpoint answers for a deposit address.

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const VAULT = arg("vault", "shor.keyfall.near");
const NEAR_AMT = Number(arg("near", "0.5"));
const SOL_TO = arg("sol", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"); // a wallet address, used for pricing only (1Click refuses program addresses)
const BASE_TO = arg("base", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"); // a wallet address, used for pricing only (1Click refuses burn addresses)
const API = arg("api", "");
const RPC = "https://rpc.mainnet.fastnear.com";
const ONECLICK = "https://1click.chaindefuser.com/v0";
const WRAP = "wrap.near";

const DESTS = {
  "usdc-sol": { asset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", label: "USDC", chain: "Solana", to: SOL_TO },
  sol: { asset: "nep141:sol.omft.near", label: "SOL", chain: "Solana", to: SOL_TO },
  "usdc-base": { asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", label: "USDC", chain: "Base", to: BASE_TO },
  "eth-base": { asset: "nep141:base.omft.near", label: "ETH", chain: "Base", to: BASE_TO },
};

let failed = 0;
const line = (ok, name, detail = "", warnOnly = false) => { if (!ok && !warnOnly) failed++; console.log(`${ok ? "PASS" : warnOnly ? "WARN" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const yocto = (n) => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
const fmt = (y, d = 4) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(d);

async function retry(fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); } }
  throw last;
}
async function rpc(params) {
  return retry(async () => {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }), signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
    if (j.result?.error) throw new Error(j.result.error);
    return j.result;
  });
}
async function viewFn(account_id, method_name, args = {}) {
  const res = await rpc({ request_type: "call_function", account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(res.result).toString() || "null");
}

console.log(`KEYFALL cash out dry run: ${NEAR_AMT} NEAR from ${VAULT}\n`);

// ---- 1. the vault
const acct = await rpc({ request_type: "view_account", account_id: VAULT });
line(true, "vault account exists", `${fmt(acct.amount)} NEAR`);
const keys = (await rpc({ request_type: "view_access_key_list", account_id: VAULT })).keys;
const pq = keys.length === 1 && /^ml-dsa-65/.test(keys[0].public_key);
line(pq, "vault holds exactly one ML-DSA-65 key", keys.map((k) => k.public_key.slice(0, 24) + "…").join(", "));
const holder = await viewFn("keyfall.near", "holder", { account_id: VAULT });
line(holder?.kind === "vault", "keyfall.near knows it as a vault", `${(Number(BigInt(holder?.balance || 0) / 10n ** 15n) / 1000).toLocaleString("en-US")} $KEYFALL`);
const bounds = await viewFn(WRAP, "storage_balance_bounds");
line(bounds.min === "1250000000000000000000", "wNEAR storage costs 0.00125 NEAR (what payCashout attaches)", bounds.min);
const reg = await viewFn(WRAP, "storage_balance_of", { account_id: VAULT });
const wn = await viewFn(WRAP, "ft_balance_of", { account_id: VAULT });
line(true, "vault wNEAR registration", reg ? `registered, ${fmt(wn)} wNEAR` : "not yet registered (the cash out transaction registers it)");
const need = BigInt(yocto(NEAR_AMT)) + 2n * 1250000000000000000000n;
line(BigInt(acct.amount) > need, `vault can pay ${NEAR_AMT} NEAR plus storage`, BigInt(acct.amount) > need ? "" : `has ${fmt(acct.amount)}, needs ${fmt(need)} plus gas: sell $KEYFALL first`, true);

// ---- 2. dry quotes, one per destination
const prices = await retry(async () => (await fetch(`${ONECLICK}/tokens`, { signal: AbortSignal.timeout(15000) })).json());
const px = Object.fromEntries(prices.map((t) => [t.assetId, t.price]));
line(Boolean(px["nep141:wrap.near"]), "1Click lists wNEAR", `$${px["nep141:wrap.near"]}`);
let sample = null;
for (const [id, d] of Object.entries(DESTS)) {
  const body = {
    dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100,
    originAsset: "nep141:wrap.near", depositType: "ORIGIN_CHAIN",
    destinationAsset: d.asset, amount: yocto(NEAR_AMT),
    refundTo: VAULT, refundType: "ORIGIN_CHAIN",
    recipient: d.to, recipientType: "DESTINATION_CHAIN", deadline: new Date(Date.now() + 2 * 3600_000).toISOString(),
  };
  try {
    const q = await retry(async () => {
      const r = API
        ? await fetch(`${API}/api/cashout`, { method: "POST", headers: { "content-type": "application/json", origin: API }, body: JSON.stringify({ vault: VAULT, dest: id, yocto: body.amount, recipient: d.to, dry: true }), signal: AbortSignal.timeout(25000) })
        : await fetch(`${ONECLICK}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
      return API ? j : j.quote;
    });
    const usdIn = NEAR_AMT * (px["nep141:wrap.near"] || 0);
    line(Boolean(q.amountOut) && !q.depositAddress, `dry quote ${NEAR_AMT} NEAR -> ${d.label} on ${d.chain}`,
      `receive ${q.amountOutFormatted} ${d.label} (min ${q.minAmountOut}), about ${q.timeEstimate ?? "?"}s, in $${usdIn.toFixed(2)} out $${Number(q.amountOutUsd || 0).toFixed(2)}`);
    sample ??= { id, d, q };
  } catch (e) {
    line(false, `dry quote ${NEAR_AMT} NEAR -> ${d.label} on ${d.chain}`, String(e.message || e).slice(0, 160));
  }
}

// ---- 3. the transaction the vault would sign
const DEPOSIT = "<depositAddress from the live quote: a 64 hex NEAR implicit account>";
console.log(`
Plan (one transaction, signer ${VAULT}, key ml-dsa-65, receiver ${WRAP}):
  1. storage_deposit { account_id: "${VAULT}", registration_only: true }   attach 0.00125 NEAR  (refunded if already registered)
  2. storage_deposit { account_id: "${DEPOSIT}", registration_only: true }   attach 0.00125 NEAR
  3. near_deposit {}   attach ${NEAR_AMT} NEAR   (wraps it into wNEAR on the vault)
  4. ft_transfer { receiver_id: "${DEPOSIT}", amount: "${yocto(NEAR_AMT)}" }   attach 1 yoctoNEAR
Then POST ${ONECLICK}/deposit/submit { txHash, depositAddress, nearSenderAccount: "${VAULT}" } and poll /status.
1Click delivers ${sample ? `${sample.q.amountOutFormatted} ${sample.d.label} on ${sample.d.chain}` : "the coin"} to the recipient; a refund comes back as wNEAR to ${VAULT} (the app offers near_withdraw).
`);

// ---- 4. status endpoint
const st = await retry(async () => (await fetch(`${ONECLICK}/status?depositAddress=${"0".repeat(64)}`, { signal: AbortSignal.timeout(15000) })).json().catch(() => ({})));
line(typeof st === "object", "1Click status endpoint answers", JSON.stringify(st).slice(0, 120));

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll dry run checks passed. The next step is a live quote and the deposit, signed by the vault.");
process.exit(failed ? 1 : 0);
