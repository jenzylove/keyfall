// Which arena a request is for. `?net=mainnet` selects mainnet; anything else
// is the practice arena on testnet. Each arena has its own contract and NPC seeds.

export type Network = "mainnet" | "testnet";

export function netOf(req: any): Network {
  const q = String(req?.query?.net ?? "");
  if (q === "mainnet") return "mainnet";
  try {
    const u = new URL(req?.url || "/", "http://x");
    if (u.searchParams.get("net") === "mainnet") return "mainnet";
  } catch {}
  return "testnet";
}

export function arena(network: Network): { network: Network; contract: string; seeds: Record<string, string> } {
  const contract = (network === "mainnet" ? process.env.CONTRACT_MAINNET : process.env.VITE_CONTRACT) || "";
  let seeds: Record<string, string> = {};
  try {
    seeds = JSON.parse((network === "mainnet" ? process.env.NPC_SEEDS_MAINNET : process.env.NPC_SEEDS) || "{}");
  } catch {
    throw new Error(`NPC seeds for ${network} are not valid JSON`);
  }
  return { network, contract, seeds };
}
