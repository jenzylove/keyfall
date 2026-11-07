# Build log

| Date | What now works |
|---|---|
| 2026-11-07 | Spike S1 passes on testnet: the contract reads the signer key type, refuses non-quantum moves, and creates accounts born with only an ML-DSA-65 key. |
| 2026-11-07 | Core rules crate: 17 tests, including 10,000 random moves that keep the books exact. |
| 2026-11-07 | Simulation (6 scenarios × 5 seeds × 48 parameter sets) caught small vaults being farmed (median 29.5% loss). Added vault armour and a no-punching-down rule; worst small-vault raid loss is now 6.2%. Parameters locked in `sim/params.json`. |
