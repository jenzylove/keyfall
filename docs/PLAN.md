# Plan

Each phase ends with a check that proves it is done.

| # | Phase | Done when |
|---|---|---|
| 1 | Spike S1: key type and quantum-only accounts | `spike-s1` workflow passes on testnet (done, see `docs/spikes/s1.md`) |
| 2 | `core/`: all game rules as pure functions | Unit and property tests pass; invariant `exposed + vaults + market + escrow + burned = supply` holds on 10,000 random moves |
| 3 | Simulation | 60-day runs for every scenario; parameters written to `sim/params.json`; report data in `sim/out/` |
| 4 | Contract | Unit tests pass; golden tests match the simulation; wasm builds in CI |
| 5 | Testnet deploy | Contract deployed, initialised and keyless in one transaction; end-to-end run with real transactions for every move; harvest crank running on a schedule |
| 6 | App | Every route works on a phone against the live testnet contract; hosted on GitHub Pages |
| 7 | Proof | `/proof` and `scripts/judge-checks` rebuild every claim from public data |
| 8 | Audit and README | Release-readiness audit fixed; README with judge fast path |

## Risks

| Risk | Status |
|---|---|
| Contract can read the signer key type | **Known**: proven in S1 |
| Contract can create quantum-only accounts | **Known**: proven in S1 |
| Relayed moves show the relayer's key | **Known**: moves must be signed directly |
| ML-DSA-65 in mobile browsers | Needs a check on the live app |
| Testnet faucet limits for no-sign-up play | Needs a check on the live app; fallback: show the limit plainly |
| u128 overflow in curve math | Known: 256-bit intermediate math in `core/` |
| Harvest crank on a schedule | Needs a check: scheduled workflow confirmed running |
