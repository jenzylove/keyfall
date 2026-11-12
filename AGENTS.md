# AGENTS.md

How to work on KEYFALL: the layout, the commands, and the rules that keep the live contracts safe.

## Project

KEYFALL is a NEAR memecoin ($KEYFALL, NEP-141) with an arena game on top. The contract reads the key type of every transaction's signer. Vault moves must be signed with ML-DSA-65; anything else is refused with `E_NOT_QUANTUM`. The user-facing overview is in [README.md](README.md).

| | Contract | Source of truth |
|---|---|---|
| Mainnet | `keyfall.near` (keyless) | [`deployments/mainnet.json`](deployments/mainnet.json), built from tag `mainnet-v1` |
| Practice | `keyfall-arcade5-mwdhcz2c13e.testnet` (keyless, arcade rules) | [`deployments/testnet-live.json`](deployments/testnet-live.json), params [`sim/params-arcade5.json`](sim/params-arcade5.json) |

## Layout

| Path | What it is |
|---|---|
| `core/` | Every game rule as pure Rust (`core/src/game.rs`), with property tests in `core/tests/` |
| `contract/` | The near-sdk contract. The signer check is `signer_key_tag()` and `require_quantum_direct()` in `contract/src/lib.rs` |
| `sandbox/` | near-workspaces tests that deploy the built wasm on a local NEAR node (`sandbox/tests/arena.rs`) |
| `sim/` | The rules simulated across scenarios; the `params-*.json` files are the locked numbers |
| `app/` | The site (Vite, TypeScript). `app/src/chain.ts` is the chain layer (ML-DSA-65 signing, NEAR Intents); `app/src/pages/play.ts` is the game; `app/api/` holds the Vercel functions |
| `app/npc/` | Bot behaviour (`rules.mjs`, a reason on every move) and the tick that sends it (`tick.mjs`) |
| `scripts/` | Deploy, judge checks, crank and crank loop, cash out dry run |

## Commands

```sh
cargo test -p qday-core                      # rules (Linux/macOS; on Windows aws-lc-sys needs NASM)
cd contract && cargo near build non-reproducible-wasm --no-abi
cd sandbox && cargo test -- --nocapture      # after the wasm build
cd app && npm ci && node --test npc/rules.test.mjs && npm run build
cd app && npm run dev                        # site against the live contracts
cd scripts && npm install && node judge-checks.mjs   # live checks: keyless, config equals params, supply, wasm hash
```

CI runs `ci.yml` (Rust tests and the wasm build), `sandbox.yml` (the near-workspaces suite) and `verifiable-build.yml` (the reproducible wasm hash). `crank.yml` is the bots' heartbeat: one long job that runs `scripts/crank-loop.mjs`, a bot tick every 30 seconds.

## Rules

- **Never redeploy or touch `keyfall.near`.** It is keyless on purpose, and anyone can rebuild its hash from tag `mainnet-v1`. Contract changes ship as a new practice season through `scripts/deploy.mjs` with a new params file.
- **Never commit or print keys.** Bot seeds live outside the repo and reach CI and Vercel only as the `NPC_SEEDS` secret.
- **Every number on screen comes from the chain.** Animations may run ahead of a transaction, but the amount shown is the confirmed one.
- **Copy:** short plain sentences, and no hyphens or dashes in visible text (names such as Q-Day and ML-DSA-65 are fine).
- **Mainnet and practice can run different rules.** The app detects a contract's rules from `config()` (`config().arcade` turns on bullets, shield charges and the Satoshi blast).
- **Keep open tabs cheap.** Pages must not poll the Vercel functions on a timer; the bots run on the GitHub heartbeat.

## Evidence

- End to end run on a fresh testnet season, 33 of 33 checks: [`docs/e2e/latest.md`](docs/e2e/latest.md).
- A mainnet vault cash out through NEAR Intents, 0.2 NEAR in and 0.729 USDC out on Base: NEAR tx `CNrCrcBVqKanDhKwnWCduyRhBUbVWER9XZFBks64KjrH`, Base tx `0x86173edd4a8a2526075c20d95f569632b1a234e33e82230bb6653d9260f6f044`.
- A practice reload burning 50,000: tx `GLBUJrgHLHG6kKyRabv3MgPaR8m9qxbtpuMs1VfF3Ctx`.
