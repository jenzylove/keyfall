# Q-DAY

A memecoin you play. Raid other holders, defend your own bag, and survive Q-Day. The only weapon and the only shield is a quantum-safe key, and only NEAR has those live.

Hackathon: NEAR HACKATHON: Build Beyond Boundaries. Submissions close **14 Nov 2026, 23:59 UTC**.
Tracks: Memecoins With Mechanics (`memecoins`, primary), Games With Real Economies (`games`).

## 1. One line

Your wallet is exposed. Move your bag into a quantum vault before Q-Day, or watch it get harvested and then frozen.

## 2. Reframe

Post-quantum security doesn't have a technology problem, it has a motivation problem: nobody rotates a key until it costs them something.

## 3. Why only NEAR

1. NEAR accepts **ML-DSA-65** (FIPS 204) post-quantum keys as account keys and transaction signers since protocol version 85 (July 2026). It is the first major chain with live quantum-safe account keys.
2. A NEAR contract receives the signer's public key on every call, and the first byte says the key type: `0` ed25519, `1` secp256k1, `2` ML-DSA-65. So **the contract can refuse any move that was not signed with a quantum-safe key.** Proven on testnet in spike S1 (`docs/spikes/s1.md`).
3. A NEAR contract can create a new account that is **born with only an ML-DSA-65 key**. Proven in spike S1.
4. No other major chain has quantum-safe account keys live, so this game cannot run anywhere else today.

## 4. Problem and evidence

1. **Classical keys can be harvested later.** Every NEAR access key's public key sits in chain state from the moment it is added. A large enough quantum computer could derive the private key of any ed25519 or secp256k1 key it can read.
2. **Almost nobody has moved.** Public samples in October 2026 found no ML-DSA-65 signed transactions in a sampled mainnet window. Moving takes an explicit action, and most wallets cannot hold an ML-DSA-65 key yet.
3. **The same fight is coming to Bitcoin.** Over 30% of BTC supply sits at addresses with exposed public keys, and BIP-361 proposes freezing coins that never migrate.
4. **Raid and defend is the most engaging loop in games right now.** A raid-and-steal game was the first ever to pass 25M concurrent players.

**Who has the problem:** every holder of a classical key, and NEAR itself, whose flagship security feature is barely used.

**What Q-DAY changes:** it gives holders a reason, a deadline and a rival to move value into accounts that only a quantum-safe key controls, and it counts every one of those accounts on chain.

## 5. The front door (first ten seconds)

The home screen says one thing: **"Migrate before Q-Day or freeze."** Under it, live from the contract:

1. The countdown to Q-Day.
2. The share of supply sitting in quantum vaults.
3. Satoshi's stash, shrinking.
4. The live raid feed.

One button: **Play now (no sign-up).** On testnet the app creates a funded testnet wallet for the visitor, buys a bag from the market, and offers the move into a quantum vault, all in the browser.

## 6. How it plays

### Two kinds of holder

| | Exposed wallet | Quantum vault |
|---|---|---|
| What it is | Any normal NEAR account holding $QDAY | `<name>.<game contract>`, created by the game, born with **only** an ML-DSA-65 key |
| Daily harvest | **Bleeds** a share every epoch | **Receives** half of what was harvested |
| Can be raided | Yes, and **cannot defend** | Yes, but can defend and shield |
| Can raid, shield, hit the boss | No | Yes, every move signed with the quantum key |
| At Q-Day | **Frozen** for good | Keeps playing and trading |

Migrating is one transfer: send your $QDAY from your exposed wallet to your vault.

### The loop

1. **Every few minutes:** check the raid feed, pick a target, launch a raid, or answer a defend link.
2. **Every epoch:** recharge your shield, hit Satoshi once, watch the harvest move tokens from exposed wallets to vaults.
3. **The season:** ends at Q-Day. Exposed balances freeze. The season result is written on chain.

## 7. Rules

All numbers are fixed at launch, readable through `config()`, and picked by the simulation (`sim/params.json`). Nobody can change them: the contract account has no keys.

### 7.1 Supply

1. **21,000,000 $QDAY**, 18 decimals. After genesis: only burns.
2. **Satoshi's stash:** 1,100,000 $QDAY minted to a pseudo-holder inside the contract. It is an exposed wallet that can never move, never defend and never migrate.
3. **The market:** the other 19,900,000 sit in a bonding curve inside the contract. No team allocation, no admin mint, no outside pool.

### 7.2 Quantum vaults

1. `create_vault(name, pq_public_key)` with a deposit creates `<name>.<contract>` with exactly one access key: the given ML-DSA-65 key, full access. The deposit funds the vault's gas and storage.
2. Every game move (`raid`, `defend`, `charge_shield`, `boss_raid`) and every transfer out of a vault must be **signed by the vault itself with an ML-DSA-65 key**. Anything else is refused with `E_NOT_QUANTUM`.
3. Moves must be signed directly. Under a relayed (gasless) transaction the contract sees the relayer's key, not the player's (spike S1), so relayed moves are refused.

### 7.3 Harvest

1. Each epoch, anyone can call `harvest()`. It takes `harvest_bps` of every exposed balance, Satoshi included.
2. Half burns. Half goes to all vaults, pro rata.
3. Balances live in two buckets with one share index each, so a harvest costs the same gas at 10 holders or 10,000.

### 7.4 Raids

1. `raid(target, stake)`: a vault locks `stake` and opens a raid on any holder that is not itself, Satoshi, the market, frozen, immune, or already under raid.
2. A defend window opens (`defend_window_ms`). The app makes a **defend link** `/d/<raid id>`.
3. **Target is a vault:** it can `defend(raid_id)` inside the window. The attacker's stake goes to the defender, minus a burn.
4. **Target is an exposed wallet:** it cannot defend. It can still **escape**: move the bag into a vault before the window ends. The take is computed on what is left.
5. After the window anyone can `resolve(raid_id)`. The take is `take_bps` of an exposed target's balance, or the smaller `vault_take_bps` of a vault's balance (a vault is armour), reduced by the target's shield, and never more than `stake_mult` times the stake. Part burns, the rest goes to the attacker with their stake back.
6. **No punching down:** a raid needs the target's balance times `punch_down_band` to be at least the attacker's balance, so big holders cannot hunt small bags.
7. The target becomes immune for `immunity_ms`. Each vault can open at most `max_raids_per_epoch` raids per epoch.

### 7.5 Shields

1. `charge_shield(amount)` burns `amount` for a shield that lasts until the end of the current epoch.
2. Strength grows with the square root of the share of your balance you burn: burning 1% gives a 10% shield, 4% gives 20%, 9% gives 30%, capped at `max_shield_bps`. The same share costs everyone the same, big or small.

### 7.6 Satoshi boss

1. Once per epoch, each vault holding at least `boss_min_balance` can `boss_raid()`.
2. It takes `boss_bps` of Satoshi's stash, capped at `boss_cap`. Part burns, the rest goes to the raider.

### 7.7 Market

1. Constant-product bonding curve inside the contract with virtual reserves, paid in NEAR.
2. `buy(min_out)` with NEAR attached. Tokens land in the buyer's bucket: exposed for a normal wallet, quantum for a vault.
3. `sell(amount, min_near)`: a `sell_fee_bps` fee in tokens (half burned, half to vaults), the rest swapped for NEAR.
4. The curve can only buy back what it sold. The NEAR reserve is capped at `reserve_cap`, so the contract is never a large honeypot.

### 7.8 Q-Day

1. At Q-Day, raids, the boss and the harvest stop. Every exposed balance, Satoshi's included, freezes for good: no transfers, no sells.
2. Vaults keep their balances and can trade and transfer.
3. `finalize()` writes the season result on chain: frozen total, vault total, number of vaults, top vaults.

## 8. Contract

1. One Rust contract (near-sdk): NEP-141 token, NEP-145 storage, game, market.
2. All game math lives in `core/`, a pure crate with no chain code, shared with the simulation, so the contract and the simulation run the same rules.
3. Deployed, initialised and stripped of every access key in **one** transaction. `scripts/judge-checks` proves it from a public RPC.
4. `config()` returns every parameter and must equal `sim/params.json`.
5. Views: `stats()`, `holder(account)`, `get_raid(id)`, `open_raids(scan)`, `holders(from, limit)`, `holder_count()`, `feed()`, `vaults(from, limit)`, `season()`, `quote_buy`, `quote_sell`.
6. Every state change emits a NEP-297 event and is kept in an on-chain feed of the latest moves.

## 9. App

Phone first. One clean screen per job.

| Route | Purpose |
|---|---|
| `/` | Countdown, share in vaults, Satoshi's stash, raid feed, your status, **Play now** |
| `/vault` | Create your quantum vault, back up its recovery code, migrate your bag |
| `/market` | Buy and sell |
| `/raid` | Targets with balance, shield and immunity; launch a raid |
| `/d/<id>` | Defend link: countdown and one button. Works opened cold from a DM or a post |
| `/boss` | Daily Satoshi raid |
| `/proof` | Judge checks, vault census, simulation, every claim with its evidence |

**Key custody:** the vault key's 32-byte seed is created in the browser and sealed with an AES-GCM key that cannot be exported from that browser (kept in IndexedDB). The player must save a recovery code (the seed, 64 hex characters) before the vault is created; the code restores the vault on any device. The seed is never sent anywhere and never committed. (Changed from a passphrase: no prompt in the game loop, same protection on the device, spike S2.)

### NPCs

The game's own bots (`shor`, `grover`, `qubit-01` to `qubit-08`) are ordinary quantum vaults playing under the same contract rules. Their behaviour lives in one readable file, `app/npc/rules.mjs`, and every NPC move carries a one-line reason the app shows. Qubits greet new players with a raid within minutes, so every player meets the core moment: escape by migrating. They run from the app's `/api/tick` and a 10-minute GitHub Actions heartbeat that also runs the harvest and settles raids. Spec: `docs/NPC_SPEC.md`.

## 10. Judging criteria

1. **Technical implementation:** a contract that checks the signer's key type on every move, creates quantum-only accounts, runs constant-gas bucket accounting, raids with escrow, and a market, all keyless. A simulation and the contract share one rules crate.
2. **Design:** one message, "Migrate before Q-Day or freeze", one live number, one shrinking stash, and a defend link with a countdown.
3. **Impact:** every vault is a real account controlled only by a quantum-safe key, counted on chain.
4. **Originality:** the first coin whose rules depend on what kind of key signed the move.
5. **Sustainability:** fixed rules, no team allocation, sell fees feed vault holders, seasons can repeat.

## 11. Claims and proof

| Claim | Proof |
|---|---|
| Only quantum-signed moves are accepted | Testnet transaction refused with `E_NOT_QUANTUM`, and the same move accepted with ML-DSA-65 |
| Vaults are born quantum-only | Each vault's key list, read live on `/proof` |
| Nobody can change the rules | Contract key list is empty; `config()` equals `sim/params.json` |
| Contract follows the same rules as the simulation | Shared `core/` crate; golden tests in CI |
| Harvest gas does not grow with holders | Gas of `harvest()` at small and large holder counts, in CI |
| Every number on the site is live | Read from the contract or chain on load; nothing staged |

## 12. What it does not do

1. It does not migrate anyone's main account. It creates new accounts that a quantum key alone controls.
2. A vault owner could later add a classical key to their vault with their quantum key. The contract cannot see an account's key list, so `/proof` re-reads every vault's keys and flags any that did.
3. Relayed (gasless) moves are refused; players pay their own small fees.
4. Unaudited. The market reserve is capped.
5. Testnet first. A mainnet season is the owner's call.

## 13. Submission checklist

Kept in `docs/SUBMISSION_CHECKLIST.md`, ticked only from the live app.
