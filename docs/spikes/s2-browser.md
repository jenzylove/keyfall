# Spike S2: can a phone browser play with no wallet, no sign-up and a quantum key?

**Question.** In a plain browser, with no wallet extension and no popups: can the app create a funded testnet wallet, buy, create a quantum vault, migrate and sign a vault move with ML-DSA-65? How slow is it on a phone?

**What was run.** `app/spike/` builds the app's real chain layer (`app/src/chain.ts`) into a test page and drives it in headless Chrome with `app/spike/run.mjs`, once on desktop and once emulating a Pixel 5 with the CPU slowed 4×. Contract: `qday-fast-mw6v53dy3fp.testnet`.

**Output (desktop run, 2026-11-07).**

| Step | Result | Evidence |
|---|---|---|
| Testnet faucet account from the browser (CORS allowed) | Pass, 5 s | `qd-24x213k4cc1q.testnet` |
| Buy from the market | Pass | https://testnet.nearblocks.io/txns/D5ah2voAkqWbJTQeuvBaJaueVJTgw2Qqxuycq9istjgQ |
| Create vault, born with one ML-DSA-65 full-access key | Pass, 6.5 s | https://testnet.nearblocks.io/txns/9YHcatDBmxvtQ5pGVwD8LUoAsJnQ8VNCbKcK2mfksPVK |
| Migrate the whole bag | Pass | https://testnet.nearblocks.io/txns/5NSesPHqRKRvuxzVsnAyVEif5JKqTcm5taFwQqZjwdGr |
| Vault move signed in the browser with ML-DSA-65 | Pass, 6.4 s | https://testnet.nearblocks.io/txns/FMvCFFsafm7NAfwS96u1Mkdor3TgdKa5ga253uvaHgb |
| Reload: vault restored from the sealed seed | Pass | |
| Same flow, phone emulation, CPU 4× slower | Pass; vault 7.2 s, ML-DSA move 9.8 s | |

**Findings.**
1. The access key list shows ML-DSA-65 keys as a hash handle (`ml-dsa-65-hash:…`), not the full key. Vault restore compares handles.
2. Most of the time is waiting for finality, not signing. The app waits for optimistic execution instead.

**Verdict.** Pass. No-sign-up play on a phone works with the quantum key held in the browser.
