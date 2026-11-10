// Shared helpers for deploy, end-to-end runs, the crank and judge checks.
// Never logs or writes a secret key or seed.

import * as near from "@fastnear/api";
import { generateSigner } from "@fastnear/ml-dsa-65";
import { privateKeyFromRandom, publicKeyFromPrivate, signerFromPrivateKey, fromBase58, bytesToBase64 } from "@fastnear/utils";

export const network = process.env.NEAR_NETWORK || "testnet";
export const TGAS = (n) => (BigInt(n) * 10n ** 12n).toString();
export const NEAR = (n) => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
export const explorer = (h) => (network === "mainnet" ? `https://nearblocks.io/txns/${h}` : `https://testnet.nearblocks.io/txns/${h}`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { near, generateSigner, privateKeyFromRandom, publicKeyFromPrivate, signerFromPrivateKey };

export function unwrap(res) {
  return res && res.result ? res.result : res;
}

export function txHash(res) {
  const r = unwrap(res);
  return r?.transaction?.hash || r?.transaction_outcome?.id || null;
}

export function failure(res) {
  const r = unwrap(res);
  if (r?.status?.Failure) return JSON.stringify(r.status.Failure);
  for (const o of r?.receipts_outcome || []) {
    if (o?.outcome?.status?.Failure) return JSON.stringify(o.outcome.status.Failure);
  }
  return null;
}

export function successValue(res) {
  const r = unwrap(res);
  const v = r?.status?.SuccessValue;
  if (v === undefined || v === null) return undefined;
  if (v === "") return null;
  try {
    return JSON.parse(Buffer.from(v, "base64").toString("utf8"));
  } catch {
    return v;
  }
}

export function gasBurnt(res) {
  const r = unwrap(res);
  let g = BigInt(r?.transaction_outcome?.outcome?.gas_burnt || 0);
  for (const o of r?.receipts_outcome || []) g += BigInt(o?.outcome?.gas_burnt || 0);
  return g;
}

export function logs(res) {
  const r = unwrap(res);
  return (r?.receipts_outcome || []).flatMap((o) => o.outcome?.logs || []);
}

export async function send({ signerId, signer, receiverId, actions }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await near.sendTx({ signerId, signer, receiverId, actions, waitUntil: "FINAL", network });
      return { res, error: failure(res), hash: txHash(res) };
    } catch (e) {
      const msg = String(e?.message || e);
      // Retry only transport problems, never a transaction the chain refused.
      if (attempt < 2 && /fetch|abort|ECONN|timeout|503|502|429/i.test(msg)) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      return { res: null, error: msg, hash: null };
    }
  }
}

export function call(contract, signerId, signer, methodName, args = {}, { deposit = "0", gas = 100 } = {}) {
  return send({
    signerId,
    signer,
    receiverId: contract,
    actions: [near.actions.functionCall({ methodName, args, gas: TGAS(gas), deposit })],
  });
}

export async function view(contractId, methodName, args = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await near.view({ contractId, methodName, args, network });
    } catch (e) {
      // Retry transport problems only; a view the contract refused is real.
      if (attempt >= 5 || !/fetch|transport|abort|ECONN|timeout|503|502|429/i.test(String(e?.message || e))) throw e;
      await sleep(2000 * (attempt + 1));
    }
  }
}

export async function accountExists(accountId) {
  try {
    const a = unwrap(await near.queryAccount({ accountId, network }));
    return Boolean(a?.amount);
  } catch {
    return false;
  }
}

export async function waitForAccount(accountId, tries = 30) {
  for (let i = 0; i < tries; i += 1) {
    if (await accountExists(accountId)) return true;
    await sleep(2000);
  }
  return false;
}

export async function keyList(accountId) {
  const r = unwrap(await near.queryAccessKeyList({ accountId, blockId: "final", network }));
  return (r?.keys || []).map((k) => ({ public_key: k.public_key, permission: k.access_key?.permission }));
}

/** A fresh funded testnet account with an ed25519 key held in memory. */
export async function faucetAccount(prefix) {
  const secret = privateKeyFromRandom();
  const accountId = `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}.testnet`;
  await near.createFundedTestnetAccount({ newAccountId: accountId, publicKey: publicKeyFromPrivate(secret) });
  if (!(await waitForAccount(accountId))) throw new Error(`faucet account ${accountId} never appeared`);
  return { accountId, signer: signerFromPrivateKey(secret), publicKey: publicKeyFromPrivate(secret) };
}

/** A sub-account of `parent`, funded from it, with a fresh ed25519 key. */
export async function subAccount(parent, name, near_) {
  const secret = privateKeyFromRandom();
  const accountId = `${name}.${parent.accountId}`;
  const r = await send({
    signerId: parent.accountId,
    signer: parent.signer,
    receiverId: accountId,
    actions: [
      near.actions.createAccount(),
      near.actions.transfer(NEAR(near_)),
      near.actions.addFullAccessKey({ publicKey: publicKeyFromPrivate(secret) }),
    ],
  });
  if (r.error) throw new Error(`sub-account ${accountId}: ${r.error}`);
  return { accountId, signer: signerFromPrivateKey(secret), publicKey: publicKeyFromPrivate(secret), tx: r.hash };
}

export function rawMlDsaPublicKey(full) {
  const b = fromBase58(full.replace(/^ml-dsa-65:/, ""));
  if (b.length === 1952) return b;
  if (b.length === 1953 && b[0] === 2) return b.slice(1);
  throw new Error(`unexpected ML-DSA-65 public key length ${b.length}`);
}

export { bytesToBase64 };
