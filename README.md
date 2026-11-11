<p align="center">
  <img src="app/public/favicon.svg" width="72" alt="KEYFALL logo" />
</p>

<h1 align="center">KEYFALL</h1>

<p align="center"><b>A memecoin where the only way to keep your bag is to move it behind a quantum safe key.<br/>The game is hunting everyone who didn't.</b></p>

<p align="center">
  <a href="https://keyfall.jdollar.site"><img alt="Play" src="https://img.shields.io/badge/play-keyfall.jdollar.site-FFD60A?style=flat-square&labelColor=0C0C0B"></a>
  <a href="https://nearblocks.io/address/keyfall.near"><img alt="Mainnet contract" src="https://img.shields.io/badge/NEAR%20mainnet-keyfall.near-FF3D2E?style=flat-square&labelColor=0C0C0B"></a>
  <a href="https://testnet.nearblocks.io/address/keyfall-arcade4-mwbrut5g2vx.testnet"><img alt="Practice contract" src="https://img.shields.io/badge/practice-NEAR%20testnet-FF3D2E?style=flat-square&labelColor=0C0C0B"></a>
  <a href="https://github.com/jenzylove/keyfall/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/jenzylove/keyfall/ci.yml?branch=main&style=flat-square&label=ci&labelColor=0C0C0B"></a>
  <a href="docs/e2e/latest.md"><img alt="End to end" src="https://img.shields.io/badge/end%20to%20end-33%2F33%20on%20testnet-FFD60A?style=flat-square&labelColor=0C0C0B"></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-EDEBE3?style=flat-square&labelColor=0C0C0B"></a>
</p>

<p align="center">
  <img src="docs/img/gate.png" alt="Guide step 3 on a phone: a red bag runs for the gold vault gate" width="200" />
  <img src="docs/img/shoot.png" alt="Aiming at a marked rival and firing: the hit becomes a real raid signed with the quantum key" width="200" />
  <img src="docs/img/shield.png" alt="A gold vault with a 20% shield ring" width="200" />
  <img src="docs/img/satoshi.png" alt="A real hit on Satoshi: you dealt 842, kept 673" width="200" />
</p>

Built at **NEAR HACKATHON** (November 2026). Tracks: **Memecoins With Mechanics** and **Games With Real Economies**. The practice contract keeps the season codename it was deployed with.

## The mechanic in one line

**The contract checks which kind of key signed every move.** Bags behind an ordinary key bleed every 6 hours, can be raided and freeze for good on Q-Day. Bags behind a quantum safe key (ML-DSA-65) are safe, earn the bleed and are the only ones allowed to attack.

## Why this exists

A future quantum computer could derive the private key of any classical key whose public key sits on a chain. NEAR made ML-DSA-65 an ordinary account key, but moving to one is opt in, and nobody rotates a key until it costs them something. KEYFALL makes staying on an old key cost something, every 6 hours, in a coin people actually hold.

| | Exposed bag (ordinary key) | Quantum vault |
|---|---|---|
| What it is | Any normal NEAR account holding the coin | `<name>.<contract>`, created by the game, born with **only** an ML-DSA-65 key |
| Every epoch (6 hours) | Bleeds 2.5%: half burned, half paid to vaults | Receives the vault share of the bleed |
| When raided | Cannot defend. Can only escape into a vault | Defends and wins the raider's stake, minus a burn |
| Raid, shield, hit Satoshi | No | Yes, every move signed with the quantum key |
| On Q-Day | **Frozen for good** | Keeps playing and trading |

Every NEAR contract call carries the signer's public key, and its first byte is the key type. The contract refuses any vault move not signed with type `2` (ML-DSA-65): `E_NOT_QUANTUM`. Sources for every fact: [docs/SOURCES.md](docs/SOURCES.md).

## Play it in two minutes

Open **https://keyfall.jdollar.site** on a phone or desktop and press **PLAY**. First visits start in the free **practice** arena: no wallet, no sign up, no popups.

1. **We make you a practice wallet and buy your first bag.** It lands red: your coins sit behind an old key and they leak over time. A short guide walks you through the first minute, and no bot raids you in your first three minutes; after that the hunters come for you.
2. **Run to the gold gate.** Steer with your thumb (or WASD and the arrow keys). Touch the gate and your vault is built: your coins move into an account whose only key is quantum safe. If a raider caught you first and you escape in time, the raid takes nothing.
3. **Now you're gold, and only gold can shoot.** Shoot a marked rival to raid it. Exposed bags run, so chase them. Vaults fight back.
4. **Stay alive and climb.** Charge a SHIELD so raids take less, DASH away from raiders, and shoot Satoshi's core when it glows. The richest vault at Q-Day wins. Every move is signed in your browser with ML-DSA-65.
5. **Play for real.** After the first mission, switch to the **mainnet** arena: buy $KEYFALL with NEAR on `keyfall.near` and play the same rules for real money. No NEAR yet? Top up from USDC or SOL on Solana, or USDC or ETH on Base, through NEAR Intents straight to your in browser wallet (QR code included), and cash out to any NEAR account from the menu. Before any money goes in you save the wallet's recovery code (its key is sealed in your browser and nobody else has a copy); a swap that cannot finish refunds to your own address on the chain you paid from.

Prefer to check without playing? Open **Under the hood** (https://keyfall.jdollar.site/proof): every check there reads the chain from your browser.

## Two arenas, one contract code

| | Mainnet | Practice |
|---|---|---|
| Contract | [`keyfall.near`](https://nearblocks.io/address/keyfall.near), deployed keyless on 9 November 2026 ([deploy](https://nearblocks.io/txns/CVAtSwnxxq1pxwkV22EtsUPDLQA3GFH4bA61nsS3Eeh7), [`deployments/mainnet.json`](deployments/mainnet.json)) | [`keyfall-arcade4-mwbrut5g2vx.testnet`](https://testnet.nearblocks.io/address/keyfall-arcade4-mwbrut5g2vx.testnet), season 4, deployed keyless on 11 November 2026 ([`deployments/testnet-live.json`](deployments/testnet-live.json)) |
| Money | Real NEAR, real $KEYFALL | Free testnet coins |
| Q-Day | 23 November 2026, 04:56 UTC | 22 November 2026, 20:00 UTC |
| Clock | The long season: 6 hour rounds, a 10 minute raid clock, 6 raids a round, 2 hours of rest after a raid ([`sim/params-mainnet.json`](sim/params-mainnet.json)) | The arcade season: 10 minute rounds, a **90 second** raid clock, 3 raids a round, 10 minutes of rest after a raid, a smaller leak every round ([`sim/params-arcade.json`](sim/params-arcade.json)) |

Before locking the mainnet contract, a spike proved mainnet accepts transactions signed only by an ML-DSA-65 key: an account was created with only a quantum key and then deleted itself with that key ([docs/spikes/s3-mainnet.md](docs/spikes/s3-mainnet.md)).

## Check every claim yourself

| Claim | How to check |
|---|---|
| Only quantum signed moves are accepted | The same `boss_raid` refused with `E_NOT_QUANTUM` when signed with ed25519, accepted with ML-DSA-65: transactions in [docs/e2e/latest.md](docs/e2e/latest.md) |
| Vaults are born quantum only | `/proof` reads every vault's key list live and counts how many hold exactly one `ml-dsa-65` key |
| Nobody can change the rules | The contract accounts have **no access keys**, and `config()` equals the params file field by field |
| The deployed code is this repo | `node scripts/judge-checks.mjs` compares your local wasm build hash with the deployed one. The mainnet wasm hash is in [`deployments/mainnet.json`](deployments/mainnet.json) |
| The books add up | exposed + vaults + market + escrow + burned = 21,000,000, checked live |
| The whole season works, Q-Day included | 33 of 33 end to end checks on a fresh testnet season with real transactions, including frozen bags, stopped raids and `finalize()`: [docs/e2e/latest.md](docs/e2e/latest.md) |
| Harvest cost does not grow with holders | Harvest gas was equal at 4 and 44 exposed holders in the recorded testnet run |

```sh
git clone https://github.com/jenzylove/keyfall && cd keyfall
cd scripts && npm install && node judge-checks.mjs
```

`judge-checks.mjs` runs against the practice contract by default (`deployments/testnet-live.json`).

## The rules

- **Supply:** 21,000,000 coins. Satoshi's stash (1,100,000 on mainnet, 3,000,000 in practice) is an exposed holder that can never move. The rest sits in a bonding curve inside the contract. No team allocation, no admin mint, no outside pool.
- **Harvest:** every round anyone can call `harvest()`: a slice of every exposed balance, Satoshi included (2.5% per 6 hour round on mainnet, 0.04% per 10 minute round in practice, about the same pressure per day); half burns, half goes to vaults.
- **Raids:** a vault stakes coins against any holder. An exposed target cannot defend but can escape by moving into a vault before the clock runs out (10 minutes on mainnet, 90 seconds in practice). A vault target can defend and take the stake. The take is 7 to 10% of an exposed bag or 0.5 to 2% of a vault, reduced by its shield, capped at 3 times the stake. No punching down: the target must be at least a quarter (mainnet) or half (practice) of your size.
- **Shields:** burn a share of your bag; strength is the square root of the share (1% buys 10%, 4% buys 20%).
- **Satoshi:** once per round each vault can take a slice of Satoshi's stash (0.1% on mainnet; 0.05% of a bigger 3,000,000 stash in practice, about 1,500 coins a hit at the start, sized by simulation so he lasts to Q-Day). The bots hit him at most once every 6 hours, so on the short clock his stash is left for players.
- **Q-Day:** raids, harvest and Satoshi stop; every exposed balance freezes for good; `finalize()` writes the season result on chain.

These numbers came from simulation, not guesses: the same rules crate was run over 6 scenarios and 48 parameter sets, which caught small vaults being farmed and led to vault armour and the no punching down rule ([docs/BUILD_LOG.md](docs/BUILD_LOG.md)). The arcade clock was simulated the same way at 30 second steps: about 25 successful raids a day against about 1 on the long clock, with Satoshi lasting to Q-Day and the median small vault losing about 3% to raids ([sim/out/ARCADE.md](sim/out/ARCADE.md)).

## The hunters

The game's own bots (`shor`, `grover`, `qubit-01` to `qubit-08`) are ordinary quantum vaults playing under the same contract rules. Six **bagholders** are their opposite: ordinary accounts that hold a big bag behind an old key, never move it, cannot defend, leak to the vaults every round and buy back in when they run low, so there is always red prey to shoot. Qubits greet new players with a raid once they are past their first three minutes and keep hunting anyone who is not resting, Shor hunts the largest exposed bag it may raid, Grover hunts the least shielded vault. They defend 1 raid in 3, late in the clock, run the harvest, settle closed raids and pay their own gas by selling part of their bag. The landing page shows how much of the vault total they hold. Their whole behaviour is one readable file with a reason for every move: [`app/npc/rules.mjs`](app/npc/rules.mjs).

## How it works

```
 browser (app/)                        NEAR
 ─────────────                          ────
 ed25519 wallet key   ── buy, migrate ──▶ ┌──────────────────────────────┐
 ML-DSA-65 vault seed ── raid, defend, ──▶ │ keyfall contract (contract/) │
   sealed on device      shield, boss     │  NEP-141 + NEP-145 + game    │
                                          │  rules from core/ (pure Rust)│
 /api/join  sponsor funds a new wallet    │  signer key type check       │
 /api/tick  NPCs move under the same rules│  create_vault: born with one │
                                          │   ML-DSA-65 key              │
 GitHub Actions: crank on a schedule      │  no access keys              │
   (harvest, settle raids, NPC moves)     └──────────────────────────────┘
```

| Folder | What it holds |
|---|---|
| [`core/`](core) | Every game rule as pure Rust: buckets with one share index each (constant gas harvest), raids, shields, Satoshi, the bonding curve, Q-Day. 17 tests including 10,000 random moves that keep the books exact |
| [`contract/`](contract) | The NEAR contract: NEP-141 token, NEP-145 storage, vault creation, the quantum signer check, events and an on chain feed |
| [`sim/`](sim) | The same rules crate simulated over 6 scenarios and 48 parameter sets; the chosen parameters are locked in the params files |
| [`app/`](app) | The site (Vite, TypeScript): landing, `/play`, `/d/<raid id>` defend links, `/proof` |
| [`app/npc/rules.mjs`](app/npc/rules.mjs) | The hunters' whole behaviour in one readable file |
| [`scripts/`](scripts) | Deploy (deploy, init and delete the key in one transaction), end to end run, judge checks, crank |
| [`docs/`](docs) | PRD, specs, spikes, sources, end to end evidence, build log |

## Run it locally

```sh
# site against the live contracts
cd app && npm install && npm run dev

# contract (Rust with the wasm32 target and cargo-near)
cd contract && cargo near build non-reproducible-wasm --no-abi

# tests (Linux or macOS; on Windows the aws-lc-sys dev dependency needs NASM)
cargo test --workspace
cd app && node --test npc/rules.test.mjs
```

CI runs the Rust tests and the wasm build on every push. A clean runner also loads every live route every 3 hours (`sitecheck`).

## Scope

Unaudited. The mainnet contract holds real money; play with what you can lose. A vault owner could later add a classical key to their own vault with their quantum key; `/proof` reads every vault's keys and flags any that did. Moves must be signed directly by the vault: a relayed (gasless) transaction shows the relayer's key, so the contract refuses it.

## Built with

near-sdk (Rust), the `uint` and `borsh` crates, `@fastnear/api`, `@fastnear/ml-dsa-65` and `@fastnear/utils`, Vite and TypeScript, puppeteer-core for the automated checks. Fonts: Jersey 10 and IBM Plex Mono. All code was written during the hackathon (from 7 November 2026), with AI assistance (Claude Code).

## Also by the same author

**Offmap** ([github.com/jenzylove/offmap](https://github.com/jenzylove/offmap)), private loans on Morpho through NEAR. A separate and independent NEAR HACKATHON project. Its README names KEYFALL.

## License

[MIT](LICENSE)
