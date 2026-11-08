def edit(p, pairs):
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (p, a[:60])
        s = s.replace(a, b)
    open(p, 'w', encoding='utf8').write(s)

edit('api/rpc.ts', [
    ('const UPSTREAMS = [', '''import { originOk } from "./_origin.js";

// Only the calls the app makes: reads, account and key lookups, sending a transaction.
const METHODS = new Set(["query", "status", "block", "send_tx", "broadcast_tx_commit", "broadcast_tx_async", "tx", "EXPERIMENTAL_tx_status", "gas_price", "EXPERIMENTAL_protocol_config"]);

const UPSTREAMS = ['''),
    ('''  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});''',
     '''  if (!originOk(req)) return res.status(403).json({ error: "this RPC serves the Q-DAY site only" });
  const parsed = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
  if (!METHODS.has(String(parsed?.method))) return res.status(400).json({ jsonrpc: "2.0", id: parsed?.id ?? null, error: { code: -32601, message: "method not allowed" } });
  const body = JSON.stringify(parsed);'''),
])
edit('api/join.ts', [
    ('import { signerFromPrivateKey } from "@fastnear/utils";', 'import { signerFromPrivateKey } from "@fastnear/utils";\nimport { originOk } from "./_origin.js";'),
    ('''  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });''',
     '''  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  if (!originOk(req)) return res.status(403).json({ error: "new wallets are made from the Q-DAY site only" });'''),
])
edit('api/tick.ts', [
    ('import { tick } from "../npc/tick.mjs";', 'import { tick } from "../npc/tick.mjs";\nimport { originOk } from "./_origin.js";'),
    ('''  if (req.method !== "POST") return res.status(405).json({ error: "use GET or POST" });''',
     '''  if (req.method !== "POST") return res.status(405).json({ error: "use GET or POST" });
  if (!originOk(req)) return res.status(403).json({ error: "ticks come from the Q-DAY site or the crank" });'''),
])
print("ok")
