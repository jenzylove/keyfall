// Vercel Node function: fund a new player's wallet so they can play with no
// sign-up and no faucet. The player's browser makes its own ed25519 key and
// sends only the matching implicit account id (64 hex characters). The
// sponsor sends it a fixed amount of testnet NEAR. No player key ever reaches
// this function.
//
// Env: SPONSOR_ACCOUNT (implicit id), SPONSOR_KEY (ed25519 secret key).

import * as near from "@fastnear/api";
import { signerFromPrivateKey } from "@fastnear/utils";

const GRANT = (15n * 10n ** 23n).toString(); // 1.5 NEAR: a 1 NEAR buy, a 0.3 NEAR vault, gas
const PER_IP_PER_HOUR = 3;
const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_IP_PER_HOUR) return true;
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

async function exists(accountId: string): Promise<boolean> {
  try {
    const r: any = await near.queryAccount({ accountId, network: "testnet" });
    return Boolean((r?.result ?? r)?.amount);
  } catch {
    return false;
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  const sponsor = process.env.SPONSOR_ACCOUNT;
  const key = process.env.SPONSOR_KEY;
  if (!sponsor || !key) return res.status(503).json({ error: "sponsor not configured" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const accountId = String(body.accountId || "");
  if (!/^[0-9a-f]{64}$/.test(accountId)) return res.status(400).json({ error: "accountId must be a 64 character implicit account" });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many new wallets from this network. Try again in an hour." });
  if (await exists(accountId)) return res.status(409).json({ error: "That wallet already exists." });

  try {
    const raw: any = await near.sendTx({
      signerId: sponsor,
      signer: signerFromPrivateKey(key),
      receiverId: accountId,
      actions: [near.actions.transfer(GRANT)],
      waitUntil: "EXECUTED_OPTIMISTIC",
      network: "testnet",
    } as any);
    const r = raw?.result ?? raw;
    if (r?.status?.Failure) return res.status(502).json({ error: "sponsor transfer failed", detail: JSON.stringify(r.status.Failure).slice(0, 200) });
    return res.status(200).json({ accountId, hash: r?.transaction?.hash || null, amount: GRANT });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/NotEnoughBalance|LackBalance/i.test(msg)) return res.status(503).json({ error: "The sponsor is out of testnet NEAR right now." });
    return res.status(502).json({ error: msg.slice(0, 200) });
  }
}
