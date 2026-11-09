// Plain meanings and display formats for every config() field.

import { fmtNear, fmtTokens, type Params } from "../chain";
import { fmtDuration } from "./dom";

type Fmt = "tokens" | "near" | "bps" | "ms" | "n";

export const PARAMS: [string, Fmt, string][] = [
  ["total_supply", "tokens", "Every $KEYFALL that will ever exist. After genesis, only burns."],
  ["satoshi_supply", "tokens", "Satoshi's stash at genesis. It never moves and never defends."],
  ["curve_virtual_near", "near", "Virtual NEAR in the market curve. It sets the starting price."],
  ["curve_virtual_tokens", "tokens", "Virtual $KEYFALL in the market curve."],
  ["reserve_cap", "near", "The most NEAR the market may ever hold."],
  ["sell_fee_bps", "bps", "Fee on every sell. Half burns, half goes to vaults."],
  ["epoch_ms", "ms", "One epoch. Shields, Satoshi and the harvest reset every epoch."],
  ["season_epochs", "n", "Epochs until Q-Day."],
  ["harvest_bps", "bps", "Share of every exposed bag the harvest takes each epoch."],
  ["min_stake", "tokens", "The smallest raid stake."],
  ["min_target_balance", "tokens", "The smallest bag anyone may raid."],
  ["take_bps", "bps", "Share of an exposed bag a raid takes."],
  ["vault_take_bps", "bps", "Share of a vault a raid takes. A vault is armour."],
  ["punch_down_band", "n", "A target must hold at least your bag divided by this. No punching down."],
  ["stake_mult", "n", "A raid never takes more than this many times its stake."],
  ["raid_burn_bps", "bps", "Share of every raid take or won stake that burns."],
  ["defend_window_ms", "ms", "Time a target has to defend or escape."],
  ["immunity_ms", "ms", "Rest a holder gets after a raid ends."],
  ["max_raids_per_epoch", "n", "Raids each vault may open per epoch."],
  ["max_shield_bps", "bps", "The strongest shield."],
  ["boss_bps", "bps", "Share of Satoshi's stash one hit takes."],
  ["boss_cap", "tokens", "The most one hit on Satoshi can take."],
  ["boss_burn_bps", "bps", "Share of every Satoshi hit that burns."],
  ["boss_min_balance", "tokens", "The bag you need to hit Satoshi."],
];

export const pct = (bps: number, digits = 2) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: digits })}%`;

export function fmtParam(name: string, v: string | number): string {
  const f = PARAMS.find((p) => p[0] === name)?.[1] ?? "n";
  if (f === "tokens") return `${fmtTokens(String(v))} $KEYFALL`;
  if (f === "near") return `${fmtNear(String(v), 0)} NEAR`;
  if (f === "bps") return pct(Number(v));
  if (f === "ms") return fmtDuration(Number(v));
  return Number(v).toLocaleString("en-US");
}

export const bigParam = (c: Params, k: string) => BigInt(String(c[k] ?? 0));
export const numParam = (c: Params, k: string) => Number(c[k] ?? 0);
