// Vercel Node function. POST { target, hunter? }: an NPC body caught the
// player in the arena. The server lets that NPC raid the target only if the
// contract rules allow it (same checks as /api/tick, via app/npc/rules.mjs:
// band, immunity, busy, size, raids left, NPC stake cap). Seeds come from
// NPC_SEEDS like tick.ts. Throttled per IP and per target so the arena can
// never be used to spam raids.

// @ts-ignore plain ES module
import { hunt } from "../npc/tick.mjs";
import { cors, originOk } from "./_origin.js";
import { arena, netOf } from "./_net.js";

const PER_IP_MS = 12_000;
const PER_TARGET_MS = 20_000;
const ipLast = new Map<string, number>();
const targetLast = new Map<string, number>();
let running: Promise<unknown> | null = null;

const NPC_NAME = /^(shor|grover|qubit-\d\d)$/;
const ACCOUNT = /^[a-z0-9._-]{2,64}$/;

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  if (!originOk(req)) return res.status(403).json({ error: "hunts come from the KEYFALL site only" });

  const net = netOf(req);
  let a;
  try {
    a = arena(net);
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
  const { contract, seeds } = a;
  if (!contract || !Object.keys(seeds).length) return res.status(500).json({ error: `NPCs are not configured for ${net}` });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const target = String(body.target || "");
  const hunter = body.hunter ? String(body.hunter) : undefined;
  if (!ACCOUNT.test(target)) return res.status(400).json({ error: "target must be an account id" });
  if (hunter && !NPC_NAME.test(hunter)) return res.status(400).json({ error: "hunter must be an NPC name" });

  const now = Date.now();
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (now - (ipLast.get(ip) || 0) < PER_IP_MS) return res.status(429).json({ skipped: "Catching your breath. Try again in a moment." });
  if (now - (targetLast.get(target) || 0) < PER_TARGET_MS) return res.status(200).json({ skipped: "That bag was just hunted." });
  ipLast.set(ip, now);
  targetLast.set(target, now);
  if (ipLast.size > 2000) ipLast.clear();
  if (targetLast.size > 2000) targetLast.clear();

  try {
    while (running) await running.catch(() => {});
    running = hunt({ contract, seeds, network: net, target, hunter });
    const out = await running;
    return res.status(200).json(out);
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e).slice(0, 300) });
  } finally {
    running = null;
  }
}
