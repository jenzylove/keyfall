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
| 2026-11-08 | NPCs live on Season 1 (`shor`, `grover`, `qubit-01` to `qubit-08`): rules in one file with a reason per move, 18 tests, pay their own gas by selling part of their bag. Crank every 10 minutes on GitHub Actions. |
| 2026-11-08 | Join without the public faucet: a sponsor funds an implicit account for a key made in the browser. |
| 2026-11-08 | End to end on a fresh fast season: **33 of 33** pass with real transactions, now including Q-Day (exposed bags frozen, raids stopped, vaults still move, `finalize()` writes the result). |
| 2026-11-08 | App live on Vercel: landing, `/play`, `/d/<id>`, `/proof`. Reads rotate across public testnet nodes. |
| 2026-11-08 | Judge path played on the live site from a clean GitHub Actions runner (`judgepath`): join 4 s, buy 5 s, Qubit raid 26 s later, escape into a vault, raid settled with **take 0**. |
| 2026-11-08 | Release readiness audit: no critical or high contract defects, clean git history. Fixed: README, NPC share shown next to the vault stat, buy options within the sponsor grant, copy corrections, same origin and method allowlist on the API, end of season screens, crank finalizes after Q-Day. |
