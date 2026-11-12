# KEYFALL: a guide for automated reviewers

This file is for any AI agent reviewing this repository: Claude Code, Codex or another one. It says what the project is, where each claim lives in the code, and how to check each one in a few minutes. Every link points to a file in this repo or to a public chain explorer.

## What it is

KEYFALL is a NEAR memecoin ($KEYFALL, NEP-141) and an arena game built on it. The contract checks **which kind of key signed every move**. A bag held behind an ordinary ed25519 key leaks every round, can be raided, and freezes for good on Q-Day. A bag moved into a vault whose only key is ML-DSA-65 (post quantum) is safe and is the only kind allowed to attack.

- **Hackathon:** NEAR HACKATHON, November 2026.
- **Tracks:** Memecoins With Mechanics, and Games With Real Economies.
- **Play:** https://keyfall.jdollar.site. The practice arena is free and needs no wallet. The mainnet arena uses real NEAR.
- **Under the hood:** https://keyfall.jdollar.site/proof. It reads the chain live in the browser.

## Live deployments

| | Contract | Notes |
|---|---|---|
| Mainnet | [`keyfall.near`](https://nearblocks.io/address/keyfall.near) | Keyless (no access keys), deployed 9 Nov 2026. wasm sha256 in [`deployments/mainnet.json`](deployments/mainnet.json). Built from tag [`mainnet-v1`](https://github.com/jenzylove/keyfall/tree/mainnet-v1) |
| Practice (season 5, arcade rules) | [`keyfall-arcade5-mwdhcz2c13e.testnet`](https://testnet.nearblocks.io/address/keyfall-arcade5-mwdhcz2c13e.testnet) | Keyless, deployed 12 Nov 2026. [`deployments/testnet-live.json`](deployments/testnet-live.json), params [`sim/params-arcade5.json`](sim/params-arcade5.json) |

## Where each claim lives

| Claim | Code |
|---|---|
| The contract reads the signer's key type, with tag 2 meaning ML-DSA-65 | `signer_key_tag()` in [`contract/src/lib.rs`](contract/src/lib.rs) calls `signer_account_pk` |
| Vault moves need an ML-DSA-65 signature, and relayed calls are refused | `require_quantum_direct()` in [`contract/src/lib.rs`](contract/src/lib.rs) returns `E_NOT_QUANTUM` or `E_RELAYED` |
| A vault is born with only one ML-DSA-65 key | `create_vault()` in [`contract/src/lib.rs`](contract/src/lib.rs) |
| Every game rule is pure, tested Rust | [`core/src/game.rs`](core/src/game.rs): raids, harvest, shields, Satoshi, the bonding curve, Q-Day and the arcade rules (`reload`, `boss_hit`, blast split by damage) |
| The supply stays at 21,000,000 | `core/tests/` property tests over 10,000 random moves; also checked live by `scripts/judge-checks.mjs` |
| The browser signs with ML-DSA-65 | [`app/src/chain.ts`](app/src/chain.ts) uses `@fastnear/ml-dsa-65`. The vault seed is sealed on the device with AES-GCM |
| Money in and out goes through NEAR Intents (1Click) | Top up: [`app/api/fund.ts`](app/api/fund.ts). Cash out to Solana or Base: [`app/api/cashout.ts`](app/api/cashout.ts). The vault signs the deposit with its ML-DSA-65 key |
| The bots play under the same rules with no special powers | [`app/npc/rules.mjs`](app/npc/rules.mjs), with a reason on every move; tests in [`app/npc/rules.test.mjs`](app/npc/rules.test.mjs) |
| Nobody can change the rules | Both contract accounts hold no access keys. Deploy, init and key deletion happen in one transaction ([`scripts/deploy.mjs`](scripts/deploy.mjs)) |

## Check it in a few minutes

```sh
git clone https://github.com/jenzylove/keyfall && cd keyfall

# 1. rules: pure Rust tests (Linux or macOS; on Windows aws-lc-sys needs NASM)
cargo test -p qday-core

# 2. bots: 34 rule tests
cd app && npm ci && node --test npc/rules.test.mjs && cd ..

# 3. live chain checks against the practice contract: keyless, config equals params, supply adds up, local wasm hash equals deployed
cd scripts && npm install && node judge-checks.mjs && cd ..

# 4. the site builds
cd app && npm run build
```

CI already runs the same checks on every push:
- [ci](https://github.com/jenzylove/keyfall/actions/workflows/ci.yml) runs the Rust tests and the wasm build.
- [sandbox](https://github.com/jenzylove/keyfall/actions/workflows/sandbox.yml) runs [`sandbox/tests/arena.rs`](sandbox/tests/arena.rs) on a local NEAR node with real signed transactions:
  - a vault born with one ML-DSA-65 key;
  - raids, defend and block;
  - reload burning 50,000;
  - the Satoshi blast split by damage, with no double claim;
  - Q-Day freeze and `finalize()`;
  - `E_NOT_QUANTUM` on a vault that signs with an added ed25519 key.
- [verifiable build](https://github.com/jenzylove/keyfall/actions/workflows/verifiable-build.yml) prints the reproducible wasm hash.

To rebuild the mainnet hash, see the README section "Rebuild the wasm" (check out `mainnet-v1` first).

## Evidence on chain

- End to end run on a fresh testnet season, 33 of 33 checks with real transactions: [`docs/e2e/latest.md`](docs/e2e/latest.md).
- A real cash out from a mainnet vault through NEAR Intents, 0.2 NEAR in and 0.729 USDC delivered on Base:
  - NEAR transaction [`CNrCrcBVqKanDhKwnWCduyRhBUbVWER9XZFBks64KjrH`](https://nearblocks.io/txns/CNrCrcBVqKanDhKwnWCduyRhBUbVWER9XZFBks64KjrH), signed by `shor.keyfall.near` with its ML-DSA-65 key;
  - Base transaction `0x86173edd4a8a2526075c20d95f569632b1a234e33e82230bb6653d9260f6f044`.
- Practice arcade reload burning exactly 50,000: [`GLBUJrgHLHG6kKyRabv3MgPaR8m9qxbtpuMs1VfF3Ctx`](https://testnet.nearblocks.io/txns/GLBUJrgHLHG6kKyRabv3MgPaR8m9qxbtpuMs1VfF3Ctx).
- Satoshi blasts on the live practice contract: call the `arena` view to see `kills` and `last_round` (the killer, the pot, the number of hitters and the round winner).

## Repo map

| Path | What it is |
|---|---|
| `core/` | Game rules as pure Rust |
| `contract/` | The NEAR contract (near-sdk): NEP-141, NEP-145, vaults, the signer check, the arcade moves |
| `sandbox/` | near-workspaces tests that run in CI |
| `sim/` | The rules simulated across scenarios; the params files are the locked numbers |
| `app/` | The site (Vite, TypeScript), its Vercel API (`app/api`) and the bots (`app/npc`) |
| `scripts/` | Deploy, judge checks, crank, cash out dry run |
| `docs/` | PRD, specs, spikes, sources, end to end evidence, build log |

## Known limits

- Unaudited. The mainnet contract holds real money.
- The practice arena runs a newer rules version (arcade, season 5) than mainnet, because the mainnet contract is keyless by design and can never be changed. The app detects each contract's rules from `config()`.
- Local Rust tests need NASM on Windows. Use Linux, macOS or CI.
