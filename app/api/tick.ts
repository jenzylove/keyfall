// Vercel Node function. POST runs one NPC tick, GET returns the last result.
// Arena from ?net (see _net.ts): seeds from NPC_SEEDS / NPC_SEEDS_MAINNET,
// contract from VITE_CONTRACT / CONTRACT_MAINNET. Throttled: a tick within 20 s of the previous
// one in this instance returns the cached result.

// @ts-ignore plain ES module
import { tick } from "../npc/tick.mjs";
import { cors, originOk } from "./_origin.js";
import { arena, netOf } from "./_net.js";

const THROTTLE_MS = 20_000;
type Result = { at: string; moves: unknown[] };
// One throttle per arena.
const last: Record<string, Result | null> = {};
const lastRun: Record<string, number> = {};
const running: Record<string, Promise<Result> | null> = {};

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (cors(req, res)) return;
  const net = netOf(req);
  if (req.method === "GET") return res.status(200).json(last[net] ?? { at: null, moves: [] });
  if (req.method !== "POST") return res.status(405).json({ error: "use GET or POST" });
  if (!originOk(req)) return res.status(403).json({ error: "ticks come from the Q-DAY site or the crank" });

  let a;
  try {
    a = arena(net);
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
  if (!a.contract || !Object.keys(a.seeds).length) return res.status(500).json({ error: `NPCs are not configured for ${net}` });

  const prev = last[net];
  if (prev && Date.now() - (lastRun[net] || 0) < THROTTLE_MS) return res.status(200).json({ ...prev, cached: true });
  try {
    running[net] ||= tick({ contract: a.contract, seeds: a.seeds, network: net });
    const r = (await running[net])!;
    last[net] = r;
    lastRun[net] = Date.now();
    return res.status(200).json(r);
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e).slice(0, 300) });
  } finally {
    running[net] = null;
  }
}
