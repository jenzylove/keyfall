// Same-origin NEAR testnet RPC for the app. Public RPCs sometimes answer a
// browser with a rate-limit page that has no CORS header, which the page sees
// as "can't reach NEAR". This forwards the JSON-RPC body unchanged and falls
// back to the next node on a network error, 429 or 5xx. No keys, no state.

const UPSTREAMS = ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"];

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
  let last = "";
  for (const url of UPSTREAMS) {
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
  return res.status(502).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: `no testnet RPC answered (${last})` } });
}
