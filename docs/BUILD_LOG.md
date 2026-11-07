# Build log

| Date | What now works |
|---|---|
| 2026-11-07 | Spike S1 passes on testnet: the contract reads the signer key type, refuses non-quantum moves, and creates accounts born with only an ML-DSA-65 key. |
| 2026-11-07 | Core rules crate: 17 tests, including 10,000 random moves that keep the books exact. |
| 2026-11-07 | Simulation (6 scenarios × 5 seeds × 48 parameter sets) caught small vaults being farmed (median 29.5% loss). Added vault armour and a no-punching-down rule; worst small-vault raid loss is now 6.2%. Parameters locked in `sim/params.json`. |
| 2026-11-07 | Contract wasm build fixed (export name clash); new views `holders()`, `holder_count()`, `open_raids()`. CI runs every test and the wasm build on each push. |
| 2026-11-07 | End-to-end run on a fresh fast season: 28 of 28 checks pass with real testnet transactions (`docs/e2e/latest.md`). |
| 2026-11-07 | Spike S2 passes: a phone browser joins with a faucet wallet, buys, creates a quantum vault and signs ML-DSA-65 moves with no wallet and no popups (`docs/spikes/s2-browser.md`). |
| 2026-11-07 | **Season 1 live** on testnet: `qday-live-mw6vii9l47s.testnet`, keyless, config equals `sim/params.json`, Q-Day 2026-11-21 20:47 UTC. `scripts/judge-checks.mjs` passes against it. |
