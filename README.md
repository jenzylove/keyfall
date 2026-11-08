<p align="center">
  <img src="app/public/favicon.svg" width="72" alt="Q-DAY logo" />
</p>

<h1 align="center">Q-DAY</h1>

<p align="center"><b>A memecoin you play. Move your bag into a quantum vault before Q-Day, or watch it bleed and then freeze.</b></p>

<p align="center">
  <a href="https://qday-one.vercel.app"><img alt="Play" src="https://img.shields.io/badge/play-qday--one.vercel.app-FFD60A?style=flat-square&labelColor=0C0C0B"></a>
  <a href="https://testnet.nearblocks.io/address/qday-live-mw6vii9l47s.testnet"><img alt="Contract" src="https://img.shields.io/badge/NEAR%20testnet-qday--live--mw6vii9l47s-FF3D2E?style=flat-square&labelColor=0C0C0B"></a>
  <a href="https://github.com/jenzylove/qday/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/jenzylove/qday/ci.yml?branch=main&style=flat-square&label=ci&labelColor=0C0C0B"></a>
  <a href="docs/e2e/latest.md"><img alt="End to end" src="https://img.shields.io/badge/end%20to%20end-33%2F33%20on%20testnet-FFD60A?style=flat-square&labelColor=0C0C0B"></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-EDEBE3?style=flat-square&labelColor=0C0C0B"></a>
</p>

<p align="center"><img src="docs/img/hero.png" alt="Q-DAY title screen: the live radar of every player around the share of coins held in quantum vaults" width="900" /></p>

Built at **NEAR HACKATHON** (November 2026). Tracks: **Memecoins With Mechanics** and **Games With Real Economies**.

## What it is

A future quantum computer could derive the private key of any classical key whose public key sits on a chain. Moving to a quantum safe key takes an explicit action, and nobody rotates a key until it costs them something.

Q-DAY makes it cost something. It is a NEP-141 token and a game in one NEAR contract, with one rule that changes everything: **the contract checks which kind of key signed every move.**

| | Exposed wallet | Quantum vault |
|---|---|---|
| What it is | Any normal NEAR account holding $QDAY | `<name>.<contract>`, created by the game, born with **only** an ML-DSA-65 key |
| Every epoch | Bleeds 2.5% (half burned, half to vaults) | Receives the vault share of the bleed |
| When raided | Cannot defend. Can only escape into a vault | Defends and wins the raider's stake, minus a burn |
| Raid, shield, hit Satoshi | No | Yes, every move signed with the quantum key |
| At Q-Day | **Frozen for good** | Keeps playing and trading |

On NEAR an ML-DSA-65 (FIPS 204) key is an ordinary account key since protocol 85, and every contract call carries the signer's public key, whose first byte is its type. So the contract refuses any vault move that was not signed with type `2`: `E_NOT_QUANTUM`. Sources for every fact: [docs/SOURCES.md](docs/SOURCES.md).

## Try it in two minutes

No wallet, no sign up, no popups. Testnet only, free.

1. Open **https://qday-one.vercel.app** on a phone or desktop and press **PLAY**. Missions walk you through the first session.
2. **Grab my bag.** You get a funded testnet wallet made in your browser and your first bag of coins. Your bag sits in the middle of the radar, red and dripping: it is exposed.
3. Wait about 30 seconds. A rival on the radar (a Qubit) raids your exposed bag and the mission card turns red with a 10 minute clock.
4. **Build vault & move in.** Your coins move into an account whose only key is quantum safe. When the clock runs out the raid settles, and because you escaped, **it takes nothing**. Had you stayed, it would have taken 10%.
5. **Strike back.** Tap the raider on the radar and raid it. Then shield, hit Satoshi and climb the board from the action bar. Every move is signed in your browser with ML-DSA-65.

<p align="center"><img src="docs/img/raid-alert.png" alt="A Qubit raids your exposed bag: the mission card turns red with a 10 minute clock while rivals circle on the radar" width="320" /></p>

Prefer to check without playing? Open **Under the hood** (https://qday-one.vercel.app/proof): every check there reads the chain from your browser.

## Check every claim yourself

| Claim | How to check |
|---|---|
| Only quantum signed moves are accepted | The same `boss_raid` refused with `E_NOT_QUANTUM` when signed with ed25519, accepted with ML-DSA-65: transactions in [docs/e2e/latest.md](docs/e2e/latest.md) |
| Vaults are born quantum only | `/proof` reads every vault's key list live and counts how many hold exactly one `ml-dsa-65` key |
| Nobody can change the rules | The contract account has **no access keys**, and `config()` equals [`sim/params.json`](sim/params.json) field by field |
| The deployed code is this repo | `node scripts/judge-checks.mjs` compares your local wasm build hash with the deployed one |
| The books add up | exposed + vaults + market + escrow + burned = 21,000,000 $QDAY, checked live |
| The whole season works, Q-Day included | 33 of 33 end to end checks on a fresh season with real transactions, including frozen bags, stopped raids and `finalize()`: [docs/e2e/latest.md](docs/e2e/latest.md) |
| Harvest cost does not grow with holders | Harvest gas was equal at 4 and 44 exposed holders in the recorded testnet run |

```sh
git clone https://github.com/jenzylove/qday && cd qday
cd scripts && npm install && node judge-checks.mjs
```

## How it works

```
 browser (app/)                        NEAR testnet
 ─────────────                          ────────────
 ed25519 wallet key   ── buy, migrate ──▶ ┌──────────────────────────────┐
 ML-DSA-65 vault seed ── raid, defend, ──▶ │ qday contract (contract/)    │
   sealed on device      shield, boss     │  NEP-141 + NEP-145 + game    │
                                          │  rules from core/ (pure Rust)│
 /api/join  sponsor funds a new wallet    │  signer key type check       │
 /api/tick  NPCs move under the same rules│  create_vault: born with one │
                                          │   ML-DSA-65 key              │
 GitHub Actions: crank every 10 minutes   │  no access keys              │
   (harvest, settle raids, NPC moves)     └──────────────────────────────┘
```

| Folder | What it holds |
|---|---|
| [`core/`](core) | Every game rule as pure Rust: buckets with one share index each (constant gas harvest), raids, shields, Satoshi, the bonding curve, Q-Day. 17 tests including 10,000 random moves that keep the books exact |
| [`contract/`](contract) | The NEAR contract: NEP-141 token, NEP-145 storage, vault creation, the quantum signer check, events and an on chain feed |
| [`sim/`](sim) | The same rules crate simulated over 6 scenarios and 48 parameter sets; the chosen parameters are locked in `sim/params.json` |
| [`app/`](app) | The site (Vite, TypeScript): landing, `/play`, `/d/<raid id>` defend links, `/proof` |
| [`app/npc/rules.mjs`](app/npc/rules.mjs) | The NPCs' whole behaviour in one readable file, with a reason for every move |
| [`scripts/`](scripts) | Deploy (deploy, init and delete the key in one transaction), end to end run, judge checks, crank |
| [`docs/`](docs) | PRD, specs, spikes, sources, end to end evidence, build log |

## The mechanic

- **Supply:** 21,000,000 $QDAY. Satoshi's stash (1,100,000) is an exposed holder that can never move. The rest sits in a bonding curve inside the contract. No team allocation, no admin mint, no outside pool.
- **Harvest:** each epoch (6 hours) anyone can call `harvest()`: 2.5% of every exposed balance, Satoshi included; half burns, half goes to vaults.
- **Raids:** a vault stakes $QDAY against any holder. An exposed target cannot defend but can escape by migrating inside the 10 minute window. A vault target can defend and take the stake. The take is 10% of an exposed bag or 2% of a vault, reduced by its shield, capped at 3 times the stake. No punching down: the target must be at least a quarter of your size.
- **Shields:** burn a share of your bag; strength is the square root of the share (1% buys 10%, 4% buys 20%).
- **Satoshi:** once per epoch each vault can take 0.1% of Satoshi's stash.
- **Q-Day:** raids, harvest and Satoshi stop; every exposed balance freezes for good; `finalize()` writes the season result on chain.

Season 1 runs on testnet until **21 November 2026, 20:47 UTC**. The recorded fast season in `docs/e2e` shows the Q-Day beat.

## NPCs

The game's own bots (`shor`, `grover`, `qubit-01` to `qubit-08`) are ordinary quantum vaults playing under the same contract rules. Qubits greet new players with a raid, Shor hunts the largest exposed bag it may raid, Grover hunts the least shielded vault. They defend 2 raids in 3, run the harvest, settle closed raids and pay their own gas by selling part of their bag. The landing page shows how much of the vault total they hold.

## Run it locally

```sh
# site against the live testnet contract
cd app && npm install && npm run dev

# contract (Rust with the wasm32 target and cargo-near)
cd contract && cargo near build non-reproducible-wasm --no-abi

# tests (Linux or macOS; on Windows the aws-lc-sys dev dependency needs NASM)
cargo test --workspace
cd app && node --test npc/rules.test.mjs
```

CI runs the Rust tests and the wasm build on every push. A clean runner also loads every live route every 3 hours (`sitecheck`).

## Scope

Testnet only, unaudited. A vault owner could later add a classical key to their own vault with their quantum key; `/proof` reads every vault's keys and flags any that did. Moves must be signed directly by the vault: a relayed (gasless) transaction shows the relayer's key, so the contract refuses it.

## Built with

near-sdk (Rust), the `uint` and `borsh` crates, `@fastnear/api`, `@fastnear/ml-dsa-65` and `@fastnear/utils`, Vite and TypeScript, puppeteer-core for the automated checks. Fonts: Big Shoulders Display and IBM Plex Mono. All code was written during the hackathon (from 7 November 2026), with AI assistance (Claude Code).

## Also by the same team

**Offmap**, a separate and independent NEAR HACKATHON project. Its README names Q-DAY.

## License

[MIT](LICENSE)
