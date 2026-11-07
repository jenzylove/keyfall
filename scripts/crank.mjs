// The heartbeat. Runs one NPC tick against the live contract: harvest, resolve,
// defend, boss and raids, all through app/npc/tick.mjs.
//
// Seeds come from env NPC_SEEDS (JSON { "shor": "<64 hex>", ... }). Never printed.
// Usage: node scripts/crank.mjs [--dry]   (or DRY_RUN=1)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tick } from "../app/npc/tick.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const live = JSON.parse(fs.readFileSync(path.join(here, "..", "deployments", "testnet-live.json"), "utf8"));
const contract = process.env.CONTRACT || live.contract;
const dryRun = process.argv.includes("--dry") || process.env.DRY_RUN === "1";

let seeds;
try {
  seeds = JSON.parse(process.env.NPC_SEEDS || "");
} catch {
  console.error("NPC_SEEDS is missing or not valid JSON");
  process.exit(1);
}

const link = (h) => `https://testnet.nearblocks.io/txns/${h}`;
const result = await tick({ contract, seeds, network: live.network || "testnet", dryRun });

const lines = result.moves.map((m) => {
  const what = m.action + (m.target ? ` ${m.target}` : "") + (m.raidId ? ` #${m.raidId}` : "");
  const status = m.error ? `FAILED ${m.error.slice(0, 160)}` : m.hash ? link(m.hash) : dryRun ? "dry run" : "";
  return `${m.npc}: ${what} | ${m.reason} | ${status}`;
});
console.log(`Q-DAY crank ${result.at} on ${contract}${dryRun ? " (dry run)" : ""}: ${result.moves.length} move(s)`);
for (const l of lines) console.log(l);
console.log(JSON.stringify(result, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [`### Crank ${result.at}${dryRun ? " (dry run)" : ""}`, "", ...(lines.length ? lines.map((l) => `- ${l}`) : ["- nothing to do"]), ""].join("\n");
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
process.exit(result.moves.some((m) => m.error) ? 2 : 0);
