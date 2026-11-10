// KEYFALL chain layer. Everything the app reads or writes on NEAR goes through
// here. No secret ever leaves the browser: the exposed wallet's ed25519 key and
// the vault's ML-DSA-65 seed are created and kept on this device only.

import * as near from "@fastnear/api";
import { signerFromSeed, publicKeyToHandle, type MlDsa65Signer } from "@fastnear/ml-dsa-65";
import {
  privateKeyFromRandom,
  publicKeyFromPrivate,
  signerFromPrivateKey,
  fromBase58,
  toBase58,
  bytesToBase64,
} from "@fastnear/utils";

// Two arenas, one game: MAINNET (real NEAR, real $KEYFALL) and PRACTICE
// (testnet, free). The choice is per browser; `?net=mainnet` or `?net=practice`
// switches it. Mainnet is only offered once its contract is configured.
export type Network = "mainnet" | "testnet";
const MAINNET_CONTRACT: string = import.meta.env.VITE_CONTRACT_MAINNET || "";
const TESTNET_CONTRACT: string = import.meta.env.VITE_CONTRACT || "";
const LS_NET = "keyfall.net.v1";
export const MAINNET_READY = Boolean(MAINNET_CONTRACT);
function pickNetwork(): Network {
  if (!MAINNET_READY) return "testnet";
  try {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("net") : null;
    const fromQuery: Network | null = q === "mainnet" ? "mainnet" : q === "practice" || q === "testnet" ? "testnet" : null;
    if (fromQuery) {
      localStorage.setItem(LS_NET, fromQuery);
      return fromQuery;
    }
    const saved = localStorage.getItem(LS_NET);
    if (saved === "mainnet" || saved === "testnet") return saved;
  } catch {}
  return "testnet";
}
export const NETWORK: Network = pickNetwork();
export const IS_MAINNET = NETWORK === "mainnet";
/** Switch arenas and reload. Each arena keeps its own wallet and vault on this device. */
export function switchNetwork(n: Network) {
  try {
    localStorage.setItem(LS_NET, n);
  } catch {}
  const u = new URL(location.href);
  u.searchParams.delete("net");
  location.replace(u.toString());
}
// Reads and transactions go straight from the browser to public nodes, moving
// to the next one when a node fails or rate limits. The app's own proxy
// (/api/rpc) is the last resort, so the site never depends on one node.
const PUBLIC_RPCS: Record<Network, string[]> = {
  testnet: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"],
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
};
const RPCS = [
  ...PUBLIC_RPCS[NETWORK],
  ...(typeof location !== "undefined" && !/localhost|127\.0\.0\.1/.test(location.hostname) ? [`${location.origin}/api/rpc${NETWORK === "mainnet" ? "?net=mainnet" : ""}`] : []),
];
let rpcIndex = 0;
near.config({ networkId: NETWORK, nodeUrl: RPCS[0] } as any);
function nextRpc() {
  rpcIndex = (rpcIndex + 1) % RPCS.length;
  near.config({ networkId: NETWORK, nodeUrl: RPCS[rpcIndex] } as any);
}
const transient = (e: unknown) => /fetch|network|transport|timeout|429|50[234]|CORS|Failed to/i.test(String((e as any)?.message || e));
/** Run an RPC call, moving across nodes on transport errors. */
async function withRpc<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < RPCS.length; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!transient(e)) throw e;
      nextRpc();
    }
  }
  throw last;
}
export const CONTRACT: string = NETWORK === "mainnet" ? MAINNET_CONTRACT : TESTNET_CONTRACT;
export const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
/** The game's API. On a local dev server it is the live site (CORS allows localhost). */
export const API_BASE = typeof location !== "undefined" && /localhost|127\.0\.0\.1/.test(location.hostname) ? "https://playkeyfall.vercel.app" : "";
/** The game's API for this arena: mainnet calls carry `net=mainnet`. */
export const apiUrl = (path: string) => {
  if (NETWORK !== "mainnet") return `${API_BASE}${path}`;
  return `${API_BASE}${path}${path.includes("?") ? "&" : "?"}net=mainnet`;
};
export const txLink = (h: string) => `${EXPLORER}/txns/${h}`;
export const accountLink = (a: string) => `${EXPLORER}/address/${a}`;

const TGAS = (n: number) => (BigInt(n) * 10n ** 12n).toString();
export const ONE = 10n ** 18n; // 1 coin (18 decimals)
export const ONE_NEAR = 10n ** 24n;
export const nearToYocto = (n: number) => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();

// ------------------------------------------------------------------ types

export type Kind = "exposed" | "vault";

export interface Stats {
  now_ms: string; epoch: string; epoch_ends_ms: string; q_day_ms: string; after_q_day: boolean;
  harvest_due: boolean; harvested: string; exposed_tokens: string; vault_tokens: string;
  satoshi_tokens: string; market_tokens: string; escrow: string; burned: string; circulating: string;
  near_reserve: string; price_yocto_per_token: string; vaults: string; exposed_holders: string;
  raids: string; vault_share_bps: number;
}
export interface Holder {
  account: string; kind: Kind; balance: string; shield_bps: number; immune_until: string;
  under_raid: string | null; raids_left: number; boss_ready: boolean;
}
export interface Raid {
  id: number; attacker: string; target: string; target_kind: Kind; stake: string; opened_at: number;
  deadline: number; status: "open" | "defended" | "resolved"; take: string; burned: string;
}
export interface FeedItem { n: string; at: string; kind: string; actor: string; target: string | null; amount: string; extra: string | null }
export type Params = Record<string, string | number>;

export class ChainError extends Error {
  code: string;
  hash?: string;
  constructor(message: string, hash?: string) {
    super(friendly(message));
    this.code = (message.match(/E_[A-Z_]+/) || ["E_UNKNOWN"])[0];
    this.hash = hash;
  }
}

const MESSAGES: Record<string, string> = {
  E_NOT_QUANTUM: "Refused: this move was not signed with a quantum-safe key.",
  E_NOT_VAULT: "Only a quantum vault can do that.",
  E_TARGET_IMMUNE: "That holder is immune right now.",
  E_TARGET_BUSY: "That holder is already under raid.",
  E_TARGET_TOO_SMALL: "That bag is too small to raid.",
  E_PUNCH_DOWN: "No punching down: that bag is far smaller than yours.",
  E_RAID_LIMIT: "You've used all your raids this epoch.",
  E_STAKE_TOO_SMALL: "Stake more to raid.",
  E_INSUFFICIENT: "Not enough coins.",
  E_WINDOW_CLOSED: "Too late: the defend window has closed.",
  E_WINDOW_OPEN: "The defend window is still open.",
  E_BOSS_DONE: "You already hit Satoshi this epoch.",
  E_BOSS_MIN_BALANCE: "Hold more coins to hit Satoshi.",
  E_FROZEN: "Frozen at Q-Day.",
  E_QDAY_PASSED: "Q-Day has passed. The season is over.",
  E_TAKEN: "That vault name is taken.",
  E_SLIPPAGE: "Price moved. Try again.",
};
function friendly(raw: string): string {
  const code = (raw.match(/E_[A-Z_]+/) || [""])[0];
  return MESSAGES[code] || raw.replace(/^.*ExecutionError":"?/, "").replace(/Smart contract panicked: /, "").slice(0, 200);
}

// ------------------------------------------------------------------ reads

export async function view<T = unknown>(methodName: string, args: object = {}): Promise<T> {
  return (await withRpc(() => near.view({ contractId: CONTRACT, methodName, args, network: NETWORK }))) as T;
}

export const getStats = () => view<Stats>("stats");
export const getConfig = () => view<Params>("config");
export const getHolder = (account_id: string) => view<Holder | null>("holder", { account_id });
export const getHolders = (from_index = 0, limit = 200) => view<Holder[]>("holders", { from_index, limit });
export const getHolderCount = () => view<number>("holder_count");
export const getVaults = (from_index = 0, limit = 200) => view<Holder[]>("vaults", { from_index, limit });
export const getRaid = (raid_id: number | string) => view<Raid | null>("get_raid", { raid_id: String(raid_id) });
export const getOpenRaids = () => view<Raid[]>("open_raids", {});
export const getFeed = (limit = 30) => view<FeedItem[]>("feed", { limit });
export const getSeason = () => view<unknown>("season");
export const quoteBuy = (yocto: string) => view<string | null>("quote_buy", { near: yocto });
export const quoteSell = (amount: string) => view<string | null>("quote_sell", { amount });
export const balanceOf = (account_id: string) => view<string>("ft_balance_of", { account_id });

export async function keyList(accountId: string): Promise<{ public_key: string; permission: unknown }[]> {
  const r: any = await withRpc(() => near.queryAccessKeyList({ accountId, blockId: "final", network: NETWORK }));
  const res = r?.result ?? r;
  return (res?.keys || []).map((k: any) => ({ public_key: k.public_key, permission: k.access_key?.permission }));
}

export async function nearBalance(accountId: string): Promise<bigint> {
  try {
    const r: any = await withRpc(() => near.queryAccount({ accountId, network: NETWORK }));
    const a = r?.result ?? r;
    return BigInt(a?.amount || 0);
  } catch {
    return 0n;
  }
}

// ------------------------------------------------------------------ local key store

// Practice keeps the original keys so existing players keep their vaults.
const LS_WALLET = NETWORK === "mainnet" ? "keyfall.mainnet.wallet.v1" : "qday.wallet.v1";
const LS_VAULT = NETWORK === "mainnet" ? "keyfall.mainnet.vault.v1" : "qday.vault.v1";

/** The wallet key: sealed like the vault seed (iv + sealed); `secretKey` is only read to migrate an older plain record. */
interface WalletRecord { accountId: string; contract: string; iv?: string; sealed?: string; secretKey?: string }
interface VaultRecord { accountId: string; iv: string; sealed: string; contract: string }

function lsGet<T>(k: string): T | null {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function lsSet(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage blocked: the session lives in memory only */
  }
}

// The vault seed is sealed with an AES-GCM key that cannot be exported from
// this browser (kept in IndexedDB). The recovery code is the only copy that
// can leave the device, and only the player writes it down.
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("qday", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("keys");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function deviceKey(): Promise<CryptoKey> {
  const db = await idb();
  const existing: CryptoKey | undefined = await new Promise((res) => {
    const g = db.transaction("keys").objectStore("keys").get("seal");
    g.onsuccess = () => res(g.result);
    g.onerror = () => res(undefined);
  });
  if (existing) return existing;
  const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await new Promise<void>((res, rej) => {
    const t = db.transaction("keys", "readwrite");
    t.objectStore("keys").put(k, "seal");
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  return k;
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function sealSeed(seed: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deviceKey(), seed));
  return { iv: b64(iv), sealed: b64(ct) };
}
async function openSeed(r: VaultRecord): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(r.iv) }, await deviceKey(), unb64(r.sealed));
  return new Uint8Array(pt);
}

/** Recovery code: the 32-byte seed as 8 groups of 8 hex characters. */
export function seedToCode(seed: Uint8Array): string {
  const hex = [...seed].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.match(/.{8}/g)!.join("-").toUpperCase();
}
export function codeToSeed(code: string): Uint8Array {
  const hex = code.replace(/[^0-9a-f]/gi, "");
  if (hex.length !== 64) throw new Error("A recovery code has 64 characters.");
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

/** An ed25519 NEAR secret key from its 32 byte seed (the seed alone is the backup). */
function secretFromSeed(seed: Uint8Array): string {
  const pub = fromBase58(publicKeyFromPrivate(`ed25519:${toBase58(seed)}`).replace(/^ed25519:/, ""));
  return `ed25519:${toBase58(new Uint8Array([...seed, ...pub]))}`;
}
const seedOfSecret = (secretKey: string) => fromBase58(secretKey.replace(/^ed25519:/, "")).slice(0, 32);
const implicitOf = (secretKey: string) => [...fromBase58(publicKeyFromPrivate(secretKey).replace(/^ed25519:/, ""))].map((b) => b.toString(16).padStart(2, "0")).join("");
let walletSecret: string | null = null; // in memory only; on disk the seed is sealed
let walletSaving: Promise<void> = Promise.resolve();
async function storeWallet(accountId: string, secretKey: string) {
  try { lsSet(LS_WALLET, { accountId, ...(await sealSeed(seedOfSecret(secretKey))), contract: CONTRACT } satisfies WalletRecord); }
  catch { /* no IndexedDB: the wallet lives in memory for this visit only */ }
}
function useWallet(accountId: string, secretKey: string) {
  walletSecret = secretKey;
  walletSigner = { accountId, signer: signerFromPrivateKey(secretKey) };
}
const LS_WALLET_SAVED = `${LS_WALLET}.saved`;
/** Whether the player confirmed they saved this wallet's recovery code. */
export const walletBackedUp = () => { try { return !!walletSigner && localStorage.getItem(LS_WALLET_SAVED) === walletSigner.accountId; } catch { return false; } };
export const markWalletBackedUp = () => { try { if (walletSigner) localStorage.setItem(LS_WALLET_SAVED, walletSigner.accountId); } catch {} };
/** The wallet's recovery code (its 32 byte seed in 8 blocks), for the player's own backup. */
export async function walletRecoveryCode(): Promise<string | null> {
  await walletSaving;
  return walletSecret ? seedToCode(seedOfSecret(walletSecret)) : null;
}
/** Restore a wallet on this device from its recovery code. */
export async function restoreWallet(code: string): Promise<{ accountId: string }> {
  const secretKey = secretFromSeed(codeToSeed(code));
  const accountId = implicitOf(secretKey);
  await storeWallet(accountId, secretKey);
  useWallet(accountId, secretKey);
  try { localStorage.setItem(LS_WALLET_SAVED, accountId); } catch {}
  return { accountId };
}

// ------------------------------------------------------------------ session

export interface Session {
  wallet: { accountId: string } | null;
  vault: { accountId: string } | null;
}

let walletSigner: { accountId: string; signer: any } | null = null;
let vaultSigner: { accountId: string; signer: MlDsa65Signer } | null = null;

export async function loadSession(): Promise<Session> {
  const w = lsGet<WalletRecord>(LS_WALLET);
  if (w && w.contract === CONTRACT && !walletSigner) {
    try {
      if (w.sealed && w.iv) useWallet(w.accountId, secretFromSeed(await openSeed({ accountId: w.accountId, iv: w.iv, sealed: w.sealed, contract: w.contract })));
      else if (w.secretKey) { useWallet(w.accountId, w.secretKey); await storeWallet(w.accountId, w.secretKey); } // an older plain record: seal it now
    } catch {
      walletSigner = null;
    }
  }
  const v = lsGet<VaultRecord>(LS_VAULT);
  if (v && v.contract === CONTRACT && !vaultSigner) {
    try {
      vaultSigner = { accountId: v.accountId, signer: signerFromSeed(await openSeed(v)) };
    } catch {
      vaultSigner = null;
    }
  }
  return session();
}
export function session(): Session {
  return {
    wallet: walletSigner ? { accountId: walletSigner.accountId } : null,
    vault: vaultSigner ? { accountId: vaultSigner.accountId } : null,
  };
}
export function forget() {
  try {
    localStorage.removeItem(LS_WALLET);
    localStorage.removeItem(LS_WALLET_SAVED);
    localStorage.removeItem(LS_VAULT);
  } catch {}
  walletSigner = null;
  walletSecret = null;
  vaultSigner?.signer.destroy?.();
  vaultSigner = null;
}

// ------------------------------------------------------------------ sending

export interface TxResult { hash: string; value: unknown }

function decodeValue(r: any): unknown {
  const v = r?.status?.SuccessValue;
  if (v === undefined || v === null || v === "") return null;
  try {
    return JSON.parse(new TextDecoder().decode(unb64(v)));
  } catch {
    return v;
  }
}
function failureOf(r: any): string | null {
  if (r?.status?.Failure) return JSON.stringify(r.status.Failure);
  for (const o of r?.receipts_outcome || []) if (o?.outcome?.status?.Failure) return JSON.stringify(o.outcome.status.Failure);
  return null;
}

/** One move at a time per key: two transactions signed at once fight over the key's nonce and one is refused. */
const lanes = new Map<string, Promise<unknown>>();
function send(who: { accountId: string; signer: any }, receiverId: string, actions: any[]): Promise<TxResult> {
  const prev = lanes.get(who.accountId) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => sendNow(who, receiverId, actions));
  lanes.set(who.accountId, run.catch(() => {}));
  return run;
}
async function sendNow(who: { accountId: string; signer: any }, receiverId: string, actions: any[]): Promise<TxResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw: any = await near.sendTx({ signerId: who.accountId, signer: who.signer, receiverId, actions, waitUntil: "EXECUTED_OPTIMISTIC", network: NETWORK } as any);
      const r = raw?.result ?? raw;
      const hash = r?.transaction?.hash || r?.transaction_outcome?.id || "";
      const fail = failureOf(r);
      if (fail) throw new ChainError(fail, hash);
      return { hash, value: decodeValue(r) };
    } catch (e: any) {
      if (e instanceof ChainError) throw e;
      lastErr = e;
      const msg = String(e?.message || e);
      if (/nonce/i.test(msg) && attempt < 2) { await new Promise((r) => setTimeout(r, 800)); continue; } // a nonce race: the library refetches it
      if (/fetch|network|timeout|503|502|429/i.test(msg)) {
        nextRpc();
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw new ChainError(msg);
    }
  }
  throw new ChainError(String((lastErr as any)?.message || lastErr));
}

const fc = (methodName: string, args: object, deposit = "0", gas = 100) =>
  near.actions.functionCall({ methodName, args, gas: TGAS(gas), deposit });

function needWallet() {
  if (!walletSigner) throw new ChainError("Join first.");
  return walletSigner;
}
function needVault() {
  if (!vaultSigner) throw new ChainError("Create your quantum vault first.");
  return vaultSigner;
}

// ------------------------------------------------------------------ moves

/** A fresh, funded testnet account (an ordinary, exposed wallet). No sign-up.
 * First choice: the game's sponsor funds an implicit account for a key made
 * right here (`/api/join` only ever sees the account id). Fallback: the public
 * testnet faucet, which allows a few accounts per network per day. */
export async function join(): Promise<{ accountId: string; via: "sponsor" | "faucet" | "self" }> {
  if (NETWORK === "mainnet") return { ...mainnetWallet(), via: "self" };
  const secretKey = privateKeyFromRandom();
  const publicKey = publicKeyFromPrivate(secretKey);
  let accountId = [...fromBase58(publicKey.replace(/^ed25519:/, ""))].map((b) => b.toString(16).padStart(2, "0")).join("");
  let via: "sponsor" | "faucet" = "sponsor";
  let sponsorError = "";
  try {
    const r = await fetch(apiUrl("/api/join"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId }) });
    if (!r.ok) sponsorError = (await r.json().catch(() => ({})))?.error || `sponsor answered ${r.status}`;
  } catch (e: any) {
    sponsorError = String(e?.message || e);
  }
  if (sponsorError) {
    via = "faucet";
    const rand = crypto.getRandomValues(new Uint8Array(5));
    accountId = `qd-${[...rand].map((b) => b.toString(36)).join("").slice(0, 8)}${Date.now().toString(36).slice(-4)}.testnet`;
    try {
      await near.createFundedTestnetAccount({ newAccountId: accountId, publicKey });
    } catch (e: any) {
      const limited = /429|rate limit/i.test(String(e?.message || e));
      throw new ChainError(
        limited
          ? `No free testnet wallet available right now (${sponsorError}; the public faucet limits each network). Try again later.`
          : `Could not create a testnet wallet: ${sponsorError}; faucet: ${String(e?.message || e).slice(0, 120)}`,
      );
    }
  }
  for (let i = 0; i < 30 && (await nearBalance(accountId)) === 0n; i++) await new Promise((r) => setTimeout(r, 1500));
  if ((await nearBalance(accountId)) === 0n) throw new ChainError("The new wallet was not funded. Try again in a minute.");
  await storeWallet(accountId, secretKey);
  useWallet(accountId, secretKey);
  return { accountId, via };
}

/** Mainnet: make (or reuse) this device's wallet key. The wallet is an implicit
 * account that exists once someone sends it NEAR: from any NEAR wallet or
 * exchange, or from another chain through NEAR Intents (`fundingQuote`). */
export function mainnetWallet(): { accountId: string } {
  if (NETWORK !== "mainnet") throw new ChainError("Mainnet only.");
  if (walletSigner) return { accountId: walletSigner.accountId };
  const secretKey = secretFromSeed(crypto.getRandomValues(new Uint8Array(32)));
  const accountId = implicitOf(secretKey);
  useWallet(accountId, secretKey);
  walletSaving = storeWallet(accountId, secretKey); // sealed on disk; the recovery code is the only copy that leaves the device
  return { accountId };
}

export interface FundingQuote { depositAddress: string; amountIn: string; amountInFormatted: string; amountOut: string; asset: string; chain: string; deadline: string }
/** A NEAR Intents quote: send `amountInFormatted` of `asset` on `chain` to
 * `depositAddress`, and `amountOut` NEAR lands in this device's wallet. */
export async function fundingQuote(source: "usdc-sol" | "usdc-base" | "usdt-sol" | "sol" | "eth-base", near: number, refundTo: string): Promise<FundingQuote> {
  const w = mainnetWallet();
  const r = await fetch(apiUrl("/api/fund"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: w.accountId, source, near, refundTo }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ChainError(j?.error || `funding quote failed (${r.status})`);
  return j as FundingQuote;
}
/** Live USD prices from NEAR Intents (1Click), for showing what a top up costs in the coin you pay with. */
let priceCache: { at: number; byId: Record<string, number> } | null = null;
export async function intentPrices(): Promise<Record<string, number>> {
  if (priceCache && Date.now() - priceCache.at < 60_000) return priceCache.byId;
  const r = await fetch("https://1click.chaindefuser.com/v0/tokens");
  const list: { assetId: string; price: number }[] = await r.json();
  const byId: Record<string, number> = {};
  for (const t of list) if (t.assetId && t.price) byId[t.assetId] = Number(t.price);
  priceCache = { at: Date.now(), byId };
  return byId;
}
export const FUND_ASSET: Record<string, string> = {
  "usdc-sol": "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
  "usdt-sol": "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near",
  sol: "nep141:sol.omft.near",
  "usdc-base": "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  "eth-base": "nep141:base.omft.near",
};
export const NEAR_ASSET = "nep141:wrap.near";

export interface FundingStatus { status: string; deposited: string | null; refunded: string | null }
export async function fundingStatus(depositAddress: string): Promise<FundingStatus> {
  const r = await fetch(`https://1click.chaindefuser.com/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`).catch(() => null);
  const j: any = r ? await r.json().catch(() => ({})) : {};
  const d = j?.swapDetails || {};
  return { status: String(j?.status || "UNKNOWN"), deposited: d.depositedAmountFormatted ?? null, refunded: d.refundedAmountFormatted ?? null };
}

/** Cash out: send NEAR from the vault (signed with its quantum key) to any NEAR account. */
export async function cashOut(to: string, yocto: string) {
  return send(needVault(), to, [near.actions.transfer(yocto)]);
}
/** Send the exposed wallet's NEAR to any NEAR account (keeps a little for gas). */
export async function walletWithdraw(to: string, yocto: string) {
  return send(needWallet(), to, [near.actions.transfer(yocto)]);
}

export async function buy(nearAmount: number, from: "wallet" | "vault" = "wallet", minOut?: string) {
  const who = from === "vault" ? needVault() : needWallet();
  return send(who, CONTRACT, [fc("buy", minOut ? { min_out: minOut } : {}, nearToYocto(nearAmount), 50)]);
}

export async function sell(amount: string, from: "wallet" | "vault" = "vault") {
  const who = from === "vault" ? needVault() : needWallet();
  return send(who, CONTRACT, [fc("sell", { amount }, "0", 60)]);
}

/** Make a new ML-DSA-65 seed. The player must save the recovery code before
 * `createVault` is called with it. */
export function newVaultSeed(): { seed: Uint8Array; code: string } {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  return { seed, code: seedToCode(seed) };
}

function rawPq(signer: MlDsa65Signer): Uint8Array {
  const b = fromBase58(signer.publicKey.replace(/^ml-dsa-65:/, ""));
  if (b.length === 1952) return b;
  if (b.length === 1953 && b[0] === 2) return b.slice(1);
  throw new Error(`unexpected ML-DSA-65 public key length ${b.length}`);
}

/** Creates `<name>.<contract>`, born with only the ML-DSA-65 key. Paid by the
 * exposed wallet (0.3 NEAR funds the vault's own gas). */
export async function createVault(name: string, seed: Uint8Array, onSent?: () => void): Promise<TxResult & { accountId: string }> {
  const w = needWallet();
  const signer = signerFromSeed(seed);
  const r = await send(w, CONTRACT, [fc("create_vault", { name, pq_public_key: bytesToBase64(rawPq(signer)) }, nearToYocto(0.3), 100)]);
  onSent?.(); // the account tx is in; now the key shows up on it
  const accountId = `${name}.${CONTRACT}`;
  // the tx returned executed (optimistic); the holder view usually answers at once, so poll fast and briefly
  let seen = await getHolder(accountId).catch(() => null);
  for (let i = 0; i < 40 && !seen; i++) { await new Promise((r) => setTimeout(r, 400)); seen = await getHolder(accountId).catch(() => null); }
  if (!seen) throw new ChainError("The vault account was not created.", r.hash);
  lsSet(LS_VAULT, { accountId, ...(await sealSeed(seed)), contract: CONTRACT } satisfies VaultRecord);
  vaultSigner = { accountId, signer };
  return { ...r, accountId };
}

/** The recovery code of the vault sealed on this device, for the player's own
 * backup. Read only: opens the sealed seed in this browser and nothing else. */
export async function vaultRecoveryCode(): Promise<string | null> {
  const v = lsGet<VaultRecord>(LS_VAULT);
  if (!v || v.contract !== CONTRACT) return null;
  try {
    return seedToCode(await openSeed(v));
  } catch {
    return null;
  }
}

/** Restore a vault on this device from its recovery code. */
export async function restoreVault(name: string, code: string) {
  const seed = codeToSeed(code);
  const signer = signerFromSeed(seed);
  const accountId = name.includes(".") ? name : `${name}.${CONTRACT}`;
  const keys = await keyList(accountId);
  const handle = String(publicKeyToHandle(signer.publicKey as any));
  if (!keys.some((k) => k.public_key === signer.publicKey || k.public_key === handle)) throw new ChainError("That code does not control this vault.");
  lsSet(LS_VAULT, { accountId, ...(await sealSeed(seed)), contract: CONTRACT } satisfies VaultRecord);
  vaultSigner = { accountId, signer };
  return { accountId };
}

/** Move the whole exposed bag (or `amount`) into the vault. */
export async function migrate(amount?: string) {
  const w = needWallet();
  const v = needVault();
  const amt = amount ?? (await balanceOf(w.accountId));
  if (BigInt(amt) === 0n) throw new ChainError("Nothing to migrate.");
  return send(w, CONTRACT, [fc("ft_transfer", { receiver_id: v.accountId, amount: amt }, "1", 50)]);
}

export const raid = (target: string, stake: string) => send(needVault(), CONTRACT, [fc("raid", { target, stake }, "0", 60)]);
export const defend = (raidId: number | string) => send(needVault(), CONTRACT, [fc("defend", { raid_id: String(raidId) }, "0", 60)]);
export const chargeShield = (amount: string) => send(needVault(), CONTRACT, [fc("charge_shield", { amount }, "0", 50)]);
export const bossRaid = () => send(needVault(), CONTRACT, [fc("boss_raid", {}, "0", 50)]);

/** Permissionless cranks: anyone can call these; the app uses whichever key it has. */
function anyKey() {
  return walletSigner || vaultSigner || null;
}
export async function resolve(raidId: number | string) {
  const who = anyKey();
  if (!who) throw new ChainError("Join first.");
  return send(who, CONTRACT, [fc("resolve", { raid_id: String(raidId) }, "0", 60)]);
}
export async function harvest() {
  const who = anyKey();
  if (!who) throw new ChainError("Join first.");
  return send(who, CONTRACT, [fc("harvest", {}, "0", 100)]);
}

// ------------------------------------------------------------------ formatting

export function fmtTokens(x: string | bigint, digits = 0): string {
  const v = typeof x === "bigint" ? x : BigInt(x || 0);
  const whole = v / ONE;
  if (digits === 0) return whole.toLocaleString("en-US");
  const frac = Number((v % ONE) / 10n ** BigInt(18 - digits)) / 10 ** digits;
  return (Number(whole) + frac).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
export function fmtNear(yocto: string | bigint, digits = 3): string {
  const v = typeof yocto === "bigint" ? yocto : BigInt(yocto || 0);
  return (Number(v / 10n ** 18n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: digits });
}
export const tokens = (n: number) => (BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString();
