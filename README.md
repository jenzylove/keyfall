<p align="center">
  <img src="app/public/favicon.svg" width="72" alt="KEYFALL logo" />
</p>

<h1 align="center">KEYFALL</h1>

<p align="center"><b>A memecoin where the only way to keep your bag is to move it behind a quantum safe key.<br/>The game is hunting everyone who didn't.</b></p>

<p align="center">
  <a href="https://keyfall.jdollar.site"><img alt="Play" src="https://img.shields.io/badge/play-keyfall.jdollar.site-FFD60A?style=flat-square&labelColor=0C0C0B"></a>
  <a href="https://nearblocks.io/address/keyfall.near"><img alt="Mainnet contract" src="https://img.shields.io/badge/NEAR%20mainnet-keyfall.near-FF3D2E?style=flat-square&labelColor=0C0C0B"></a>
  <a href="https://testnet.nearblocks.io/address/keyfall-arcade5-mwdhcz2c13e.testnet"><img alt="Practice contract" src="https://img.shields.io/badge/practice-NEAR%20testnet-FF3D2E?style=flat-square&labelColor=0C0C0B"></a>
  <a href="https://github.com/jenzylove/keyfall/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/jenzylove/keyfall/ci.yml?branch=main&style=flat-square&label=ci&labelColor=0C0C0B"></a>
  <a href="https://github.com/jenzylove/keyfall/actions/workflows/sandbox.yml"><img alt="Sandbox tests" src="https://img.shields.io/github/actions/workflow/status/jenzylove/keyfall/sandbox.yml?branch=main&style=flat-square&label=sandbox%20tests&labelColor=0C0C0B"></a>
  <a href="https://github.com/jenzylove/keyfall/actions/workflows/verifiable-build.yml"><img alt="Verifiable build" src="https://img.shields.io/github/actions/workflow/status/jenzylove/keyfall/verifiable-build.yml?branch=main&style=flat-square&label=verifiable%20build&labelColor=0C0C0B"></a>
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

## In 30 seconds

One day a quantum computer will be able to steal coins held behind normal crypto keys. NEAR already supports keys it cannot break, but almost nobody switches. KEYFALL turns switching into a game.

- **Red bags** sit behind a normal key. They leak coins every round, anyone can raid them, and on Q-Day they freeze for good.
- **Gold vaults** sit behind a quantum safe key. They are safe, they collect what the red bags leak, and only they can attack.
- **Run your bag into the gold gate, then go hunting.** The richest vault at Q-Day wins.

**[Play free in your browser](https://keyfall.jdollar.site)**, no wallet or sign up. Every shot you fire is a real transaction, signed with a quantum safe key and checked by the contract.

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
4. **Stay alive and climb.** In practice you carry a clip of 5 bullets that refills one a minute; when a raider shoots you, a prompt asks you to SHIELD (spend a charge) or SHOOT BACK (spend a bullet and take their stake). Chip Satoshi's life bar with everyone else: when he blasts, his stash is split among all who hit him, by damage, and a recap names the round winner. Out of bullets? Reload 5 for 50,000 coins, burned. The richest vault at Q-Day wins. Every move is signed in your browser with ML-DSA-65.
5. **Play for real.** After the first mission, switch to the **mainnet** arena: buy $KEYFALL with NEAR on `keyfall.near` and play the same rules for real money. No NEAR yet? Top up from USDC or SOL on Solana, or USDC or ETH on Base, through NEAR Intents straight to your in browser wallet (QR code included), and cash out the same way: your vault signs one transaction with its ML-DSA-65 key and NEAR Intents delivers USDC or SOL on Solana, USDC or ETH on Base, or NEAR to any NEAR account. Before any money goes in you save the wallet's recovery code (its key is sealed in your browser and nobody else has a copy); a swap that cannot finish refunds to your own address on the chain you paid from.

Prefer to check without playing? Open **Under the hood** (https://keyfall.jdollar.site/proof): every check there reads the chain from your browser.

## Two arenas, one contract code

| | Mainnet | Practice |
|---|---|---|
| Contract | [`keyfall.near`](https://nearblocks.io/address/keyfall.near), deployed keyless on 9 November 2026 ([deploy](https://nearblocks.io/txns/CVAtSwnxxq1pxwkV22EtsUPDLQA3GFH4bA61nsS3Eeh7), [`deployments/mainnet.json`](deployments/mainnet.json)) | [`keyfall-arcade5-mwdhcz2c13e.testnet`](https://testnet.nearblocks.io/address/keyfall-arcade5-mwdhcz2c13e.testnet), season 5, deployed keyless on 12 November 2026 ([deploy](https://testnet.nearblocks.io/txns/DPVq7UCCDANCe5BCeVXK4UcDPERm3q4Yttr85oZ1Dgh), [`deployments/testnet-live.json`](deployments/testnet-live.json)) |
| Money | Real NEAR, real $KEYFALL | Free testnet coins |
| Q-Day | 23 November 2026, 04:56 UTC | 26 November 2026, 11:45 UTC |
| Clock | The long season: 6 hour rounds, a 10 minute raid clock, 6 raids a round, 2 hours of rest after a raid ([`sim/params-mainnet.json`](sim/params-mainnet.json)) | The arcade loop: a 5 bullet clip that refills one bullet a minute, 3 shield charges, a **25 second** raid clock, 90 seconds of rest after a raid, and rounds that end when Satoshi blasts (10 minutes at most) ([`sim/params-arcade5.json`](sim/params-arcade5.json)) |

Before locking the mainnet contract, a spike proved mainnet accepts transactions signed only by an ML-DSA-65 key: an account was created with only a quantum key and then deleted itself with that key ([docs/spikes/s3-mainnet.md](docs/spikes/s3-mainnet.md)).

## Check every claim yourself

| Claim | How to check |
|---|---|
| Every move works on a real NEAR node | [`sandbox/tests/arena.rs`](sandbox/tests/arena.rs) deploys the built wasm on a local NEAR sandbox and plays it with real signed transactions: buy, a vault born with one ML-DSA-65 key, migrate, shield, raid and resolve, defend, boss, Q-Day freeze and `finalize()`. A vault that adds an ed25519 key to itself is refused with `E_NOT_QUANTUM` on raid, transfer, sell and shield. Runs on every push ([sandbox](https://github.com/jenzylove/keyfall/actions/workflows/sandbox.yml)) |
| Only quantum signed moves are accepted | The same `boss_raid` refused with `E_NOT_QUANTUM` when signed with ed25519, accepted with ML-DSA-65: transactions in [docs/e2e/latest.md](docs/e2e/latest.md) |
| Vaults are born quantum only | `/proof` reads every vault's key list live and counts how many hold exactly one `ml-dsa-65` key |
| Nobody can change the rules | The contract accounts have **no access keys**, and `config()` equals the params file field by field |
| The deployed code is this repo | `node scripts/judge-checks.mjs` compares your local wasm build hash with the deployed one when cargo near is installed; otherwise it prints the deployed sha256 for you to compare. The mainnet wasm hash is in [`deployments/mainnet.json`](deployments/mainnet.json). How to rebuild it: [Rebuild the wasm](#rebuild-the-wasm) |
| The books add up | exposed + vaults + market + escrow + burned = 21,000,000, checked live (practice also counts Satoshi's reserve and unclaimed blast pots) |
| The whole season works, Q-Day included | 33 of 33 end to end checks on a fresh testnet season with real transactions, including frozen bags, stopped raids and `finalize()`: [docs/e2e/latest.md](docs/e2e/latest.md) |
| Money comes in through NEAR Intents | A real top up: `intents.near` delivered 1 NEAR to a player wallet, which then bought in and built a mainnet vault: [`34NUTDJ45NZfePRoJKJk4L8CbLbnnPoCKptHtsLLuUed`](https://nearblocks.io/txns/34NUTDJ45NZfePRoJKJk4L8CbLbnnPoCKptHtsLLuUed) |
| Money goes out through NEAR Intents, signed by a quantum key | A real cash out: `shor.keyfall.near` signed with its ML-DSA-65 key and sent 0.2 NEAR ([`CNrCrcBVqKanDhKwnWCduyRhBUbVWER9XZFBks64KjrH`](https://nearblocks.io/txns/CNrCrcBVqKanDhKwnWCduyRhBUbVWER9XZFBks64KjrH)); 1Click delivered 0.729 USDC on Base ([`0x86173edd…f044`](https://basescan.org/tx/0x86173edd4a8a2526075c20d95f569632b1a234e33e82230bb6653d9260f6f044)) |
| Harvest cost does not grow with holders | Harvest gas was equal at 4 and 44 exposed holders in the recorded testnet run |

```sh
git clone https://github.com/jenzylove/keyfall && cd keyfall
cd scripts && npm install && node judge-checks.mjs
```

`judge-checks.mjs` runs against the practice contract by default (`deployments/testnet-live.json`).

The practice contract (season 5) was built on the builder's machine with the plain cargo near route, like mainnet, so its exact bytes (`ae79495d…`, recorded in [`deployments/testnet-arcade5.json`](deployments/testnet-arcade5.json)) depend on that toolchain (cargo near 0.23.0, rustc 1.98.1, source as of commit `604ed4c`); judge-checks compares the deployed code hash with that record. The end to end run (33 of 33) ran on a testnet copy of the mainnet code; the arcade moves are covered by the sandbox suite on a local NEAR node.

### Rebuild the wasm

There are two routes, and they answer different questions.

**The mainnet wasm** (`keyfall.near`, sha256 `9095039b…2ccf` in [`deployments/mainnet.json`](deployments/mainnet.json)) was built with the plain cargo near route, not inside Docker, from the source tagged [`mainnet-v1`](https://github.com/jenzylove/keyfall/tree/mainnet-v1). `main` has moved on (the practice arcade rules), so check out the tag first:

```sh
git checkout mainnet-v1
cd contract && cargo near build non-reproducible-wasm --no-abi
sha256sum ../target/near/qday_contract/qday_contract.wasm
```

This route depends on your Rust and cargo near versions, so the hash only matches with the toolchain it was built with. A stock GitHub runner (Rust 1.99.1, latest cargo near) gives a different hash for the same source; the [verifiable build](https://github.com/jenzylove/keyfall/actions/workflows/verifiable-build.yml) job prints both side by side.

**The reproducible route** (NEP-330) pins the whole toolchain in a Docker image chosen by digest in [`contract/Cargo.toml`](contract/Cargo.toml) (`sourcescan/cargo-near:0.22.0-rust-1.99.1`):

```sh
cd contract && cargo near build reproducible-wasm   # needs Docker and a clean git checkout
sha256sum ../target/near/qday_contract/qday_contract.wasm
```

Anyone with Docker gets the same bytes from the same commit, and the wasm records that commit and image inside it. The [verifiable build](https://github.com/jenzylove/keyfall/actions/workflows/verifiable-build.yml) job runs it on every push and writes the sha256 to the job summary. The mainnet contract predates this route and is keyless, so it is never redeployed: its proof stays the non reproducible rebuild above.

## The rules

- **Supply:** 21,000,000 coins. Satoshi's stash (1,100,000 on mainnet, 3,000,000 in practice) is an exposed holder that can never move. The rest sits in a bonding curve inside the contract. No team allocation, no admin mint, no outside pool.
- **Harvest:** every round anyone can call `harvest()`: a slice of every exposed balance, Satoshi included (2.5% per 6 hour round on mainnet, about 10% a day; 0.04% per 10 minute round in practice, about 6% a day); half burns, half goes to vaults.
- **Raids:** a vault stakes coins against any holder. An exposed target cannot defend but can escape by moving into a vault before the clock runs out (10 minutes on mainnet, 25 seconds in practice). A vault target can defend and take the stake. The take is 10% of an exposed bag or 2% of a vault on mainnet (7% and 0.4% in practice), reduced by its shield, capped at 3 times the stake. No punching down: the target must be at least a quarter (mainnet) or half (practice) of your size.
- **Shields (mainnet):** burn a share of your bag; strength is the square root of the share (1% buys 10%, 4% buys 20%).
- **Satoshi (mainnet):** once per round each vault can take 0.1% of Satoshi's stash. The bots hit him at most once every 6 hours, so his stash is left for players. In practice he is a shared life bar instead (below).
- **Practice arcade (season 5):** the practice contract adds arcade rules on top, all in its params (`config().arcade`); mainnet keeps the rules above.
  - **Bullets.** A vault holds a clip of 5. A raid, a shot back or a hit on Satoshi costs one bullet. One comes back free every minute. `reload()` burns 50,000 coins and fills the clip.
  - **Shield charges.** Up to 3; one comes back free every 2 minutes, and `buy_shield()` burns 4,000 for one. When someone raids you, you have 25 seconds to answer. `block()` spends a charge, `defend()` shoots back with a bullet; either way the raid fails and the stake is yours, less the 10% burn. After any raid you rest for 90 seconds.
  - **Satoshi** is a shared life bar. Each hit costs a bullet, deals a fixed share of his life and puts that vault on a 20 second cooldown; no coins move on a hit. When his life reaches zero he **blasts**. His whole stash leaves him and 20% burns. The rest is split among everyone who hit him that round, by damage. Each share is credited on that vault's next move or by `claim_blast()`, so the contract never loops over hitters. The round ends there and is written on chain with its winner: whoever took the most that round, raids and blast share together. If 10 minutes pass first, the round ends and he heals.
  - **Where his new life comes from.** He respawns from his own reserve: the part of his 3,000,000 supply not yet in his life bar. Once that reserve is spent, he is rebuilt only from the coins burned during that same round. Nothing is minted, and the 21,000,000 cap always holds.
  - **A break.** `set_break(true)` tells the game's bots to leave a vault alone. Players still can raid it, and bullets and charges keep coming back.
- **Q-Day:** raids, harvest and Satoshi stop; every exposed balance freezes for good; `finalize()` writes the season result on chain.

These numbers came from simulation, not guesses: the same rules crate was run over 6 scenarios and 48 parameter sets, which caught small vaults being farmed and led to vault armour and the no punching down rule ([docs/BUILD_LOG.md](docs/BUILD_LOG.md)). The arcade clock was simulated the same way at 30 second steps: about 25 successful raids a day against about 1 on the long clock, with Satoshi lasting to Q-Day and the median small vault losing about 3% to raids ([sim/out/ARCADE.md](sim/out/ARCADE.md)).

## The hunters

The game's own bots are ordinary quantum vaults playing under the same contract rules, with no special powers. Their whole behaviour is one readable file with a reason for every move: [`app/npc/rules.mjs`](app/npc/rules.mjs).

| | Practice (testnet) | Mainnet |
|---|---|---|
| Hunters | `shor`, `grover`, `qubit-01` to `qubit-08` | `shor`, `grover`, `qubit-01` |
| Bagholders (red prey) | six: ordinary accounts that hold a big bag behind an old key, never move it, cannot defend, leak to the vaults every round and buy back in when they run low | none: on mainnet the prey is real players, so nobody farms a bot pot |

Qubits raid a new player once their first three minutes are up, then keep hunting any player who is not resting, whenever the contract allows it (rest after a raid, a bullet in the clip, no punching down). Shor hunts the largest red bag it may raid, Grover the least shielded vault. In the practice arcade, at most 3 bots go after players per tick, each player gets a random 0 to 15 extra seconds after their rest, a bot with an empty clip reloads (burning 50,000 like a player), bots also fight each other, they answer 1 raid in 3 with a shield charge (or a bullet when out of charges), they leave a vault on a break alone, and five of them hit Satoshi each tick so he blasts every 5 to 8 minutes. On mainnet they hit him at most once every 6 hours. They move on a heartbeat: one long GitHub Actions job ([`crank.yml`](.github/workflows/crank.yml), [`scripts/crank-loop.mjs`](scripts/crank-loop.mjs)) plays a bot tick every 30 seconds, so the arena keeps moving with nobody watching and no page has to poll a server. The landing page shows how much of the vault total they hold.

## After Q-Day

Q-Day is written into the contract: 23 November 2026, 04:56 UTC on mainnet, and 26 November 2026, 11:45 UTC in practice. When it passes, the contract on its own:

- stops raids, the leak and Satoshi;
- freezes every red bag for good, while vault coins stay fully usable (on mainnet they can still be sold back to the contract for NEAR at any time);
- lets anyone call `finalize()`, which writes the season result, the ranked vaults, on chain once and for ever.

The plan for the next season:

- **Every season will be a new keyless contract,** the way this one was launched: the same code and its own rules, so nobody can change a season while it runs, not even the builder.
- **Season 1's result will carry over.** Season 2 will read the finalized result of this season from the chain, and its vault holders will start with a head start in proportion to their final rank.
- **Value never gets stuck** (live now). A vault can sell its coins back to the bonding curve for NEAR before or after Q-Day, so leaving a season costs nothing but the 2% sell fee.
- **Running costs come from the game.** A bot that drops below 0.15 NEAR sells 10% of its bag to pay for its moves (built in and tested in [`app/npc/rules.test.mjs`](app/npc/rules.test.mjs); no bot has needed it on chain yet), and the cranks are free to call: the GitHub heartbeat keeps a season moving, and anyone can run `scripts/crank.mjs` too.

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

# contract on a local NEAR sandbox (after the wasm build above)
cd sandbox && cargo test -- --nocapture

# cash out through NEAR Intents, dry run up to the deposit (read only)
cd scripts && node cashout-dry.mjs --vault <name>.keyfall.near --near 0.5
```

CI runs the Rust tests and the wasm build on every push, the sandbox suite plays the contract on a local NEAR node, and the verifiable build job prints the reproducible and non reproducible wasm hashes. A clean runner also loads every live route every 3 hours (`sitecheck`).

## Scope

Unaudited. The mainnet contract holds real money; play with what you can lose. A vault owner could later add a classical key to their own vault with their quantum key; `/proof` reads every vault's keys and flags any that did. Moves must be signed directly by the vault: a relayed (gasless) transaction shows the relayer's key, so the contract refuses it. The bot tick endpoints are public and rate limited; they only send moves the contract itself accepts.

## Built with

near-sdk (Rust), the `uint` and `borsh` crates, `@fastnear/api`, `@fastnear/ml-dsa-65` and `@fastnear/utils`, Vite and TypeScript, puppeteer-core for the automated checks. Fonts: Jersey 10 and IBM Plex Mono. All code was written during the hackathon (from 7 November 2026), with AI assistance (Claude Code).

## Also by the same author

**Offmap** ([github.com/jenzylove/offmap](https://github.com/jenzylove/offmap)), private loans on Morpho through NEAR. A separate and independent NEAR HACKATHON project. Its README names KEYFALL.

## License

[MIT](LICENSE)
