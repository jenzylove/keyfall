// Vercel Node function. POST runs one NPC tick, GET returns the last result.
// Seeds come from env NPC_SEEDS (JSON { "shor": "<64 hex>", ... }), the
// contract from VITE_CONTRACT. Throttled: a tick within 20 s of the previous
// one in this instance returns the cached result.

// @ts-ignore plain ES module
import { tick } from "../npc/tick.mjs";

const THROTTLE_MS = 20_000;
let last: { at: string; moves: unknown[] } | null = null;
let lastRun = 0;
let running: Promise<{ at: string; moves: unknown[] }> | null = null;

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") return res.status(200).json(last ?? { at: null, moves: [] });
  if (req.method !== "POST") return res.status(405).json({ error: "use GET or POST" });

  const contract = process.env.VITE_CONTRACT;
  let seeds: Record<string, string> = {};
  try {
    seeds = JSON.parse(process.env.NPC_SEEDS || "{}");
  } catch {
    return res.status(500).json({ error: "NPC_SEEDS is not valid JSON" });
  }
  if (!contract || !Object.keys(seeds).length) return res.status(500).json({ error: "NPCs are not configured" });

  if (last && Date.now() - lastRun < THROTTLE_MS) return res.status(200).json({ ...last, cached: true });
  try {
    running ||= tick({ contract, seeds, network: "testnet" });
    last = await running;
    lastRun = Date.now();
    return res.status(200).json(last);
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e).slice(0, 300) });
  } finally {
    running = null;
  }
}
