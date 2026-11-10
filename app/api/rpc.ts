// Same-origin NEAR RPC (testnet, or mainnet with ?net=mainnet) for the app. Public RPCs sometimes answer a
// browser with a rate-limit page that has no CORS header, which the page sees
// as "can't reach NEAR". This forwards the JSON-RPC body unchanged and falls
// back to the next node on a network error, 429 or 5xx. No keys, no state.

import { cors, originOk } from "./_origin.js";
import { netOf } from "./_net.js";

// Only the calls the app makes: reads, account and key lookups, sending a transaction.
const METHODS = new Set(["query", "status", "block", "send_tx", "broadcast_tx_commit", "broadcast_tx_async", "tx", "EXPERIMENTAL_tx_status", "gas_price", "validators", "EXPERIMENTAL_protocol_config"]);

const UPSTREAMS = {
  testnet: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"],
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
};

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  if (!originOk(req)) return res.status(403).json({ error: "this RPC serves the KEYFALL site only" });
  const parsed = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
  if (!METHODS.has(String(parsed?.method))) return res.status(400).json({ jsonrpc: "2.0", id: parsed?.id ?? null, error: { code: -32601, message: "method not allowed" } });
  const body = JSON.stringify(parsed);
  let last = "";
  const net = netOf(req);
  for (const url of UPSTREAMS[net]) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
      if (r.status === 429 || r.status >= 500) {
        last = `${url} answered ${r.status}`;
        continue;
      }
      res.setHeader("content-type", "application/json");
      return res.status(r.status).send(await r.text());
    } catch (e: any) {
      last = `${url}: ${String(e?.message || e)}`;
    }
  }
  return res.status(502).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: `no ${net} RPC answered (${last})` } });
}
