// Plain words for the game: short amounts, human times, friendly errors.

import { ChainError, type Params } from "../chain";

const U = 10n ** 18n;
export const whole = (x: string | bigint) => Number((typeof x === "bigint" ? x : BigInt(x || 0)) / 10n ** 12n) / 1e6;

/** 548k, 1.6M, 940. */
export function short(x: string | bigint | number): string {
  const n = typeof x === "number" ? x : whole(x);
  const a = Math.abs(n);
  const f = (v: number, s: string) => `${v >= 100 ? Math.round(v) : v >= 10 ? (Math.round(v * 10) / 10).toString() : (Math.round(v * 100) / 100).toString()}${s}`;
  if (a >= 1e6) return f(n / 1e6, "M");
  if (a >= 1e3) return f(n / 1e3, "k");
  return Math.round(n).toLocaleString("en-US");
}
/** 548,231 */
export const full = (x: string | bigint) => (BigInt(typeof x === "bigint" ? x : x || 0) / U).toLocaleString("en-US");

/** 5 h 12 m, 13 d 4 h, 9 m 40 s */
export function span(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} m`;
  if (m > 0) return `${m} m ${String(sec).padStart(2, "0")} s`;
  return `${sec} s`;
}
/** 9:40 style clock for short windows, 1:02:09 above an hour. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}
/** Q-Day countdown: 13 d 04 h 12 m */
export function longClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d} d ${p(h)} h ${p(m)} m`;
  return `${p(h)} h ${p(m)} m ${p(sec)} s`;
}
/** 12 d, 5 h 12 m (two units, for the HUD) */
export function hudClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${p(h)}h`;
  if (h > 0) return `${h}h ${p(m)}m`;
  return `${m}:${p(sec)}`;
}

/** "every 6 hours", "10 minutes" */
export function every(ms: number): string {
  const h = ms / 3_600_000;
  if (h >= 1 && Number.isInteger(h)) return h === 1 ? "every hour" : `every ${h} hours`;
  const m = ms / 60_000;
  return `every ${Math.round(m)} minutes`;
}
export function minutes(ms: number): string {
  if (ms < 120_000) return `${Math.round(ms / 1000)} seconds`;
  const m = Math.round(ms / 60_000);
  if (m >= 60 && m % 60 === 0) return `${m / 60} hour${m === 60 ? "" : "s"}`;
  return `${m} minute${m === 1 ? "" : "s"}`;
}
export function hours(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  return `${h} hour${h === 1 ? "" : "s"}`;
}

export const pct = (bps: number) => `${(Math.round(bps / 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
export const P = (c: Params | null, k: string) => Number(c?.[k] ?? 0);
export const PB = (c: Params | null, k: string) => BigInt(String(c?.[k] ?? 0));

// ------------------------------------------------------------------ errors

const PLAIN: Record<string, string> = {
  E_NOT_QUANTUM: "Only your quantum vault can make that move.",
  E_NOT_VAULT: "Only a quantum vault can do that. Build yours first.",
  E_TARGET_IMMUNE: "They are resting after a raid. Try someone else.",
  E_TARGET_BUSY: "Someone is already raiding them.",
  E_TARGET_TOO_SMALL: "That bag is too small to raid.",
  E_PUNCH_DOWN: "No punching down: that bag is far smaller than yours.",
  E_RAID_LIMIT: "You have used all your raids for now. They come back at the next harvest.",
  E_STAKE_TOO_SMALL: "Stake a little more to raid.",
  E_INSUFFICIENT: "You do not have enough coins for that.",
  E_WINDOW_CLOSED: "Too late: the defend window has closed.",
  E_WINDOW_OPEN: "The defend window is still open.",
  E_BOSS_DONE: "You already hit Satoshi. Come back after the next harvest.",
  E_BOSS_MIN_BALANCE: "Your vault needs a bigger bag to hit Satoshi.",
  E_FROZEN: "Those coins froze at Q-Day.",
  E_QDAY_PASSED: "Q-Day has passed. The season is over.",
  E_TAKEN: "That vault name is taken. Try another.",
  E_SLIPPAGE: "The price moved. Try again.",
};
export const FALLBACK = "That did not go through. Try again.";

/** One friendly sentence for any failure. Never a raw string. */
export function plainError(e: unknown): string {
  const raw = String((e as any)?.message || e || "");
  const code = e instanceof ChainError ? e.code : (raw.match(/E_[A-Z_]+/) || [""])[0];
  if (PLAIN[code]) return PLAIN[code];
  if (/No free testnet wallet|faucet|sponsor|not funded|Could not create a testnet wallet/i.test(raw)) return "No free wallet is available right now. Try again in a minute.";
  if (/recovery code has 64/i.test(raw)) return "A recovery code has 64 letters and digits.";
  if (/does not control this vault/i.test(raw)) return "That code does not open this vault.";
  if (/not created/i.test(raw)) return "The vault did not appear in time. Try again.";
  if (/Nothing to migrate/i.test(raw)) return "There is nothing left to move in.";
  if (/NotEnoughBalance|LackBalanceForState|balance/i.test(raw)) return "Not enough testnet NEAR for that.";
  if (/fetch|network|timeout|429|50[234]/i.test(raw)) return "NEAR is not answering right now. Try again in a moment.";
  return FALLBACK;
}
