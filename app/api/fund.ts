// Vercel Node function: a NEAR Intents (1Click) quote that turns a deposit on
// another chain into NEAR in a player's mainnet wallet. The player sends the
// quoted amount to the quoted deposit address from any wallet; 1Click swaps
// and delivers native NEAR to their wallet account. A failed or short swap is
// refunded on the chain the player paid from, to the address they give.
//
// Env: ONECLICK_JWT (optional; without it 1Click charges its public fee).

import { cors, originOk } from "./_origin.js";

const SOURCES: Record<string, { asset: string; label: string; chain: string }> = {
  "usdc-sol": { asset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", label: "USDC", chain: "Solana" },
  "usdt-sol": { asset: "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near", label: "USDT", chain: "Solana" },
  sol: { asset: "nep141:sol.omft.near", label: "SOL", chain: "Solana" },
  "usdc-base": { asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", label: "USDC", chain: "Base" },
  "eth-base": { asset: "nep141:base.omft.near", label: "ETH", chain: "Base" },
};
const NEAR_ASSET = "nep141:wrap.near";

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  if (!originOk(req)) return res.status(403).json({ error: "funding quotes come from the KEYFALL site only" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const accountId = String(body.accountId || "");
  if (!/^[0-9a-f]{64}$/.test(accountId)) return res.status(400).json({ error: "accountId must be a 64 character implicit account" });
  const src = SOURCES[String(body.source || "")];
  if (!src) return res.status(400).json({ error: `source must be one of ${Object.keys(SOURCES).join(", ")}` });
  const refundTo = String(body.refundTo || "").trim();
  const onSolana = src.chain === "Solana";
  if (onSolana ? !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(refundTo) : !/^0x[0-9a-fA-F]{40}$/.test(refundTo)) return res.status(400).json({ error: `refundTo must be your ${src.chain} address (refunds go back there)` });
  const near = Number(body.near);
  if (!(near >= 0.5 && near <= 50)) return res.status(400).json({ error: "near must be between 0.5 and 50" });

  const amount = (BigInt(Math.round(near * 1000)) * 10n ** 21n).toString();
  const deadline = new Date(Date.now() + 24 * 3600_000).toISOString();
  const jwt = process.env.ONECLICK_JWT;
  try {
    const r = await fetch("https://1click.chaindefuser.com/v0/quote", {
      method: "POST",
      headers: { "content-type": "application/json", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
      body: JSON.stringify({
        dry: false, swapType: "EXACT_OUTPUT", slippageTolerance: 100,
        originAsset: src.asset, depositType: "ORIGIN_CHAIN",
        destinationAsset: NEAR_ASSET, amount,
        refundTo, refundType: "ORIGIN_CHAIN",
        recipient: accountId, recipientType: "DESTINATION_CHAIN", deadline,
      }),
    });
    const j: any = await r.json().catch(() => ({}));
    const q = j?.quote;
    if (!r.ok || !q?.depositAddress) return res.status(502).json({ error: j?.message || `1Click answered ${r.status}` });
    return res.status(200).json({
      depositAddress: q.depositAddress, amountIn: q.amountIn, amountInFormatted: q.amountInFormatted,
      amountOut: q.amountOut, asset: src.label, chain: src.chain, deadline: q.deadline || deadline,
    });
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || e).slice(0, 200) });
  }
}
