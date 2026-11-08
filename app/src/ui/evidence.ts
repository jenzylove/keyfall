// Evidence files from the repo, bundled at build time. Nothing here is live;
// pages label it as a recorded run with its date and links.

export interface E2ECheck { name: string; pass: boolean; hash?: string; link?: string; error?: string | null; [k: string]: unknown }
export interface E2E { contract: string; ran_at: string; all_pass: boolean; checks: E2ECheck[] }
export interface Deploy {
  network: string; contract: string; deploy_tx: string; deploy_link: string; deployed_at: string;
  start_ms: number; q_day_ms: number; wasm_sha256: string; wasm_bytes: number; keyless: boolean; config_matches_params: boolean; params_file?: string;
}
export interface SimPoint { epoch: number; pct_holdings_in_vaults: number; satoshi_tokens: number; burned_tokens: number; raids_opened: number; [k: string]: number }
export interface SimReport { chosen: Record<string, number>; season: { epoch_hours: number; season_epochs: number; seeds: number[] }; series: Record<string, SimPoint[]>; scenarios: Record<string, Record<string, number | null>> }

const one = (m: Record<string, unknown>) => Object.values(m)[0] as any;

export const e2e: E2E | null = one(import.meta.glob("../../../docs/e2e/latest.json", { eager: true, import: "default" })) ?? null;
export const deploy: Deploy | null = one(import.meta.glob("../../../deployments/testnet-live.json", { eager: true, import: "default" })) ?? null;
export const sim: SimReport | null = one(import.meta.glob("../../../sim/out/report.json", { eager: true, import: "default" })) ?? null;
export const simParams: Record<string, string | number> | null = one(import.meta.glob("../../../sim/params.json", { eager: true, import: "default" })) ?? null;

export const findCheck = (re: RegExp) => e2e?.checks.find((c) => re.test(c.name)) ?? null;

/** The same vault move twice: refused when a classical key signed it, accepted with ML-DSA-65. */
export const guardRefused = () => findCheck(/E_NOT_QUANTUM/);
export const guardAccepted = () => findCheck(/signed with ML-DSA-65/);

export const SOURCES = {
  nearcore: "https://github.com/near/nearcore/releases/tag/2.13.0-rc.1",
  nep645: "https://github.com/near/neps/pull/645",
  fips204: "https://csrc.nist.gov/pubs/fips/204/final",
  citiRisk: "https://www.citigroup.com/global/insights/managing-the-quantum-threat-to-blockchains",
  citiShare: "https://en.spaziocrypto.com/bitcoin/q-day-bitcoin-quantum-computing-citi-25-percent-supply-exposed/",
  glassnode: "https://cointelegraph.com/news/nearly-10-bitcoin-supply-structurally-unsafe-quantum-breakthrough-glassnode",
  bip361: "https://bips.dev/361/",
  nist8547: "https://nvlpubs.nist.gov/nistpubs/ir/2024/NIST.IR.8547.ipd.pdf",
};
