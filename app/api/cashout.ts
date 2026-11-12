// Vercel Node function: a NEAR Intents (1Click) quote that turns NEAR from a
// player's quantum vault into a coin on another chain. The vault then pays the
// quote itself: it wraps the NEAR and sends the wNEAR to the quoted deposit
// address (one transaction to wrap.near, signed with the vault's ML-DSA-65 key
// in the browser). 1Click swaps and delivers to the player's address on the
// destination chain. A failed or short swap is refunded as wNEAR to the vault.
//
// `dry: true` returns the price only (no deposit address), for the live
// preview while the player picks an amount.
//
// Env: ONECLICK_JWT (optional; without it 1Click charges its public fee).

import { cors, originOk } from "./_origin.js";

const DESTS: Record<string, { asset: string; label: string; chain: string; decimals: number }> = {
  "usdc-sol": { asset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", label: "USDC", chain: "Solana", decimals: 6 },
  sol: { asset: "nep141:sol.omft.near", label: "SOL", chain: "Solana", decimals: 9 },
  "usdc-base": { asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", label: "USDC", chain: "Base", decimals: 6 },
  "eth-base": { asset: "nep141:base.omft.near", label: "ETH", chain: "Base", decimals: 18 },
};
const NEAR_ASSET = "nep141:wrap.near";
const MIN_YOCTO = 10n ** 23n; // 0.1 NEAR: below this the withdrawal fee eats the swap
const MAX_YOCTO = 500n * 10n ** 24n;
// A mainnet vault is `<name>.keyfall.near`; refunds go back to it.
const VAULT = /^[a-z0-9]+([_-][a-z0-9]+)*\.keyfall\.near$/;

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  if (!originOk(req)) return res.status(403).json({ error: "cash out quotes come from the KEYFALL site only" });

  let body: any;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}; } catch { return res.status(400).json({ error: "bad JSON" }); }
  const vault = String(body.vault || "");
  if (!VAULT.test(vault)) return res.status(400).json({ error: "vault must be a KEYFALL mainnet vault (<name>.keyfall.near)" });
  const dest = DESTS[String(body.dest || "")];
  if (!dest) return res.status(400).json({ error: `dest must be one of ${Object.keys(DESTS).join(", ")}` });
  const recipient = String(body.recipient || "").trim();
  const onSolana = dest.chain === "Solana";
  if (onSolana ? !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient) : !/^0x[0-9a-fA-F]{40}$/.test(recipient)) return res.status(400).json({ error: `recipient must be a ${dest.chain} address` });
  let yocto: bigint;
  try { yocto = BigInt(String(body.yocto || "0")); } catch { return res.status(400).json({ error: "yocto must be an integer string" }); }
  if (yocto < MIN_YOCTO || yocto > MAX_YOCTO) return res.status(400).json({ error: "cash out between 0.1 and 500 NEAR" });
  const dry = body.dry === true;

  const deadline = new Date(Date.now() + 2 * 3600_000).toISOString();
  const jwt = process.env.ONECLICK_JWT;
  try {
    const r = await fetch("https://1click.chaindefuser.com/v0/quote", {
      method: "POST",
      headers: { "content-type": "application/json", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
      body: JSON.stringify({
        dry, swapType: "EXACT_INPUT", slippageTolerance: 100,
        originAsset: NEAR_ASSET, depositType: "ORIGIN_CHAIN",
        destinationAsset: dest.asset, amount: yocto.toString(),
        refundTo: vault, refundType: "ORIGIN_CHAIN",
        recipient, recipientType: "DESTINATION_CHAIN", deadline,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const j: any = await r.json().catch(() => ({}));
    const q = j?.quote;
    if (!r.ok || !q?.amountOut || (!dry && !q?.depositAddress)) return res.status(502).json({ error: r.status >= 500 || /internal/i.test(String(j?.message || "")) ? "No swap route for this amount right now. Try a little more, or another coin." : j?.message || `1Click answered ${r.status}` });
    // The deposit must be a NEAR implicit account: the vault sends wNEAR there with ft_transfer.
    if (!dry && !/^[0-9a-f]{64}$/.test(q.depositAddress)) return res.status(502).json({ error: "1Click returned a deposit address the vault cannot pay" });
    return res.status(200).json({
      dry, depositAddress: q.depositAddress || null, amountIn: q.amountIn,
      amountOut: q.amountOut, amountOutFormatted: q.amountOutFormatted, minAmountOut: q.minAmountOut,
      amountOutUsd: q.amountOutUsd, timeEstimate: q.timeEstimate ?? null,
      asset: dest.label, chain: dest.chain, recipient, deadline: q.deadline || deadline,
    });
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || e).slice(0, 200) });
  }
}
