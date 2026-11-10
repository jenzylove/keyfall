// Vercel Node function: fund a new player's wallet so they can play with no
// sign-up and no faucet. The player's browser makes its own ed25519 key and
// sends only the matching implicit account id (64 hex characters). The
// sponsor sends it a fixed amount of testnet NEAR. No player key ever reaches
// this function.
//
// Env: SPONSOR_ACCOUNT (implicit id), SPONSOR_KEY (ed25519 secret key).
//
// Threat model. Anyone can POST here with a fresh random account id, and each
// grant is real (testnet) NEAR, so a script could empty the sponsor and leave
// the next judge without a one tap wallet. Layers, cheapest first:
//  1. Origin must be the KEYFALL site (_origin.ts). Forgeable; stops casual curl.
//  2. Per IP, in memory: 3 an hour per instance. Lost on a cold start; a speed bump.
//  3. The global limit, which survives cold starts and any number of
//     instances: the chain itself. NEAR rejects a transaction whose nonce is not
//     above the key's last nonce, and also one whose nonce is at or above
//     block_height * 10^6. So the sponsor key's nonce is used as a clock: every
//     grant moves it forward by COST_BLOCKS * 10^6, and a grant is only sent if
//     the new nonce still sits below the current height * 10^6. That is a token
//     bucket (BURST grants at once, then one per COST_BLOCKS blocks) whose state
//     is the access key on chain. Two instances racing for the same nonce: the
//     chain accepts one and rejects the other, so the cap cannot be beaten by
//     parallel requests. No database, no new service, no new secret.
//  4. GRANT is the least the first run needs: a 1 NEAR first buy, a 0.3 NEAR
//     vault, storage and gas. Worst case drain is BURST + ~10 grants an hour
//     (about 14 NEAR), and when the bucket is empty the client falls back to the
//     public testnet faucet, so onboarding keeps working.

import { sha256, signerFromPrivateKey, serializeTransaction, serializeSignedTransaction, bytesToBase64, toBase58 } from "@fastnear/utils";
import { cors, originOk } from "./_origin.js";

const GRANT = (14n * 10n ** 23n).toString(); // 1.4 NEAR: a 1 NEAR buy, a 0.3 NEAR vault, storage and gas
const NONCE_PER_BLOCK = 1_000_000n; // nearcore ACCESS_KEY_NONCE_RANGE_MULTIPLIER
const COST_BLOCKS = 600n; // testnet makes a block about every 0.6 s: one grant per ~6 minutes
const BURST = 5n; // grants that may go out at once after a quiet spell
const PER_IP_PER_HOUR = 3;
const RPCS = ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"];
const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_IP_PER_HOUR) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

async function rpc(method: string, params: unknown): Promise<any> {
  let last = "";
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "keyfall", method, params }) });
      if (r.status === 429 || r.status >= 500) {
        last = `${url} answered ${r.status}`;
        continue;
      }
      const j: any = await r.json();
      if (j.error) return { error: j.error };
      return { result: j.result };
    } catch (e: any) {
      last = String(e?.message || e);
    }
  }
  throw new Error(`no testnet RPC answered (${last})`);
}

async function exists(accountId: string): Promise<boolean> {
  const r = await rpc("query", { request_type: "view_account", finality: "final", account_id: accountId });
  return Boolean(r.result?.amount);
}

/** The next grant's nonce from the on chain bucket, or how long until one frees up. */
export function nextNonce(keyNonce: bigint, height: bigint): { nonce: bigint } | { waitBlocks: bigint } {
  const floor = (height - BURST * COST_BLOCKS) * NONCE_PER_BLOCK;
  const nonce = (keyNonce > floor ? keyNonce : floor) + COST_BLOCKS * NONCE_PER_BLOCK;
  // Strictly below the bound the chain enforces, with a block of slack for the
  // height the transaction is checked at.
  const ceiling = (height - 1n) * NONCE_PER_BLOCK;
  if (nonce > ceiling) return { waitBlocks: (nonce - ceiling + NONCE_PER_BLOCK - 1n) / NONCE_PER_BLOCK };
  return { nonce };
}

type Grant = { hash: string } | { busy: true; waitBlocks?: bigint } | { error: string; status: number };

async function grant(sponsor: string, key: string, accountId: string): Promise<Grant> {
  const signer = signerFromPrivateKey(key);
  const [block, ak] = await Promise.all([
    rpc("block", { finality: "final" }),
    rpc("query", { request_type: "view_access_key", finality: "final", account_id: sponsor, public_key: signer.publicKey }),
  ]);
  if (block.error || !block.result) return { error: "could not read the chain height", status: 502 };
  if (ak.error || ak.result?.nonce === undefined) return { error: "sponsor key not found on chain", status: 503 };
  const next = nextNonce(BigInt(ak.result.nonce), BigInt(block.result.header.height));
  if ("waitBlocks" in next) return { busy: true, waitBlocks: next.waitBlocks };

  const tx = {
    signerId: sponsor,
    publicKey: signer.publicKey,
    nonce: next.nonce,
    receiverId: accountId,
    blockHash: block.result.header.hash,
    actions: [{ type: "Transfer", deposit: GRANT }],
  };
  const hash = sha256(serializeTransaction(tx as any));
  const signature = await signer.signHash(hash);
  const signed = bytesToBase64(serializeSignedTransaction(tx as any, signature));
  const sent = await rpc("send_tx", { signed_tx_base64: signed, wait_until: "EXECUTED_OPTIMISTIC" });
  if (sent.error) {
    const msg = JSON.stringify(sent.error);
    if (/InvalidNonce|NonceTooLarge/.test(msg)) return { busy: true }; // another instance took this slot
    if (/NotEnoughBalance|LackBalance/i.test(msg)) return { error: "The sponsor is out of testnet NEAR right now.", status: 503 };
    return { error: msg.slice(0, 200), status: 502 };
  }
  const failure = sent.result?.status?.Failure;
  if (failure) return { error: `sponsor transfer failed: ${JSON.stringify(failure).slice(0, 200)}`, status: 502 };
  return { hash: sent.result?.transaction?.hash || toBase58(hash) };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  if (!originOk(req)) return res.status(403).json({ error: "new wallets are made from the KEYFALL site only" });
  const sponsor = process.env.SPONSOR_ACCOUNT;
  const key = process.env.SPONSOR_KEY;
  if (!sponsor || !key) return res.status(503).json({ error: "sponsor not configured" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const accountId = String(body.accountId || "");
  if (!/^[0-9a-f]{64}$/.test(accountId)) return res.status(400).json({ error: "accountId must be a 64 character implicit account" });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many new wallets from this network. Try again in an hour." });

  try {
    if (await exists(accountId)) return res.status(409).json({ error: "That wallet already exists." });
    // One retry: losing a nonce race to another instance is normal under load.
    let g = await grant(sponsor, key, accountId);
    if ("busy" in g && g.waitBlocks === undefined) g = await grant(sponsor, key, accountId);
    if ("hash" in g) return res.status(200).json({ accountId, hash: g.hash, amount: GRANT });
    if ("busy" in g) {
      const secs = g.waitBlocks === undefined ? 5 : Math.ceil(Number(g.waitBlocks) * 0.6);
      res.setHeader("Retry-After", String(secs));
      return res.status(429).json({ error: "Free wallets are handed out a few at a time. Try again shortly.", retryAfter: secs });
    }
    return res.status(g.status).json({ error: g.error });
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || e).slice(0, 200) });
  }
}
