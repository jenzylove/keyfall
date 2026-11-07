# Q-DAY NPCs and cranks

The game's own bots. They are ordinary quantum vaults on the live contract, they follow exactly the same rules as players (the contract enforces them), and their behaviour lives in **one readable file**, `app/npc/rules.mjs`. Every NPC decision comes with a one-line reason the app can show.

Why: a new player on day 5 of a season with few humans must still meet a rival within a minute. NPCs make the loop alive, give judges a raid to escape, and give players targets to hit back.

## Roster

| NPC | Vault name | Personality | Bag |
|---|---|---|---|
| Shor | `shor` | Hunts the **largest exposed bag** it is allowed to raid. "Shor's algorithm breaks classical keys." | buy 2 NEAR |
| Grover | `grover` | Hunts the **least shielded vault** it is allowed to raid. | buy 2 NEAR |
| Qubits | `qubit-01` … `qubit-08` | Greeters: raid the **newest holder** (most recently registered, not raided yet, not an NPC). Small bags so the no punching down rule lets them raid small new players. | buy 0.4 NEAR each |

All NPC vaults are named `<name>.<contract>` and the app labels any vault whose name is in the roster as **NPC**.

## Rules file `app/npc/rules.mjs`

Plain ES module, no dependencies, no chain code. Exports:

```js
export const ROSTER = [{ name: "shor", style: "hunter-exposed" }, { name: "grover", style: "hunter-vault" }, ...qubits];
export const isNpc = (accountId, contract) => boolean;
// Pure: given a snapshot, return the moves one tick should make, each with a reason.
export function decide({ now, config, stats, npcs, holders, openRaids }) => [
  { npc: "shor", action: "raid", target, stake, reason: "Largest exposed bag in range: 640,112 $QDAY, no defence possible." },
  { npc: "grover", action: "defend", raidId, reason: "Raided by qd-x8…; defends 2 in 3 times (rolled 0.41)." },
  { npc: "qubit-03", action: "boss", reason: "Satoshi is ready this epoch." },
  { npc: "*", action: "resolve", raidId, reason: "Defend window closed 40 s ago." },
  { npc: "*", action: "harvest", reason: "Epoch 12 harvest is due." },
]
// Pure: explain why an NPC raid targeted this account (used in the app tooltip).
export function explainRaid(raid, snapshotAtRaid) => string
```

Decision rules (keep them this simple, and write them as readable code with comments):

1. **Cranks first.** If `stats.harvest_due`: one `harvest`. Every open raid whose `deadline < now`: `resolve`.
2. **Defend.** For every open raid whose target is an NPC and whose window is open: defend with probability 2/3 (use `Math.random()`; record the roll in the reason). Losing sometimes keeps raiding NPCs worth trying.
3. **Boss.** Each NPC with `boss_ready` and balance ≥ `boss_min_balance`: `boss` (at most 2 NPCs per tick).
4. **Raids**, only for NPCs with `raids_left > 0`, `under_raid` null, and only targets the contract would accept: not self, not an NPC, not immune (`immune_until > now`), not `under_raid`, target balance ≥ `min_target_balance`, and **target balance × `punch_down_band` ≥ NPC balance**.
   - Qubits: target = the newest eligible holder who registered within the last 30 minutes (by `holders()` order; the last entries are the newest). One qubit per target; pick the first qubit with raids left and in range.
   - Shor: the eligible exposed holder with the largest balance. At most one Shor raid per tick.
   - Grover: the eligible vault with the lowest `shield_bps` (tie: largest balance). At most one per tick.
   - Stake: `max(min_stake, ceil(expected take / stake_mult))` so the cap does not bite, never more than 20% of the NPC's balance.
5. Never more than 6 moves per tick.

## Runner `app/npc/tick.mjs`

`export async function tick({ contract, seeds, network = "testnet", dryRun = false })`:

1. Read `config`, `stats`, `holders` (all pages), `open_raids`, and `holder()` for each NPC.
2. `decide(...)`.
3. Send each move: NPC moves signed by that NPC's ML-DSA-65 signer (`signerFromSeed` from `@fastnear/ml-dsa-65`, seeds as 64-char hex), cranks signed by any NPC. Moves run one after another; an error on one does not stop the others.
4. Return `{ at, moves: [{ npc, action, target?, raidId?, reason, hash?, error? }] }`.

Uses `@fastnear/api` the same way `scripts/lib.mjs` does. Never logs a seed.

## Where it runs

1. **Vercel function `app/api/tick.ts`** (Node runtime). `POST` runs one tick, `GET` returns the last result. Seeds come from env `NPC_SEEDS` (JSON `{ "shor": "<hex>", ... }`) and the contract from `VITE_CONTRACT`. Throttle: if the previous tick in this function instance ran less than 20 s ago, return the cached result. The app calls it after a player buys, creates a vault or opens `/play`.
2. **GitHub Actions `.github/workflows/crank.yml`**: on `schedule` every 10 minutes plus `workflow_dispatch`; runs `node scripts/crank.mjs` which imports `app/npc/tick.mjs` with seeds from secret `NPC_SEEDS` and contract from `deployments/testnet-live.json`. Appends a line per move to the job summary. This is the heartbeat when nobody is on the site.

## Setup `scripts/npc-setup.mjs`

One run, from a developer machine: creates 2 faucet accounts as the bank, then for each roster entry creates the vault (`create_vault` with 0.3 NEAR), buys the bag from the bank account and migrates it into the vault, and writes the seeds to a path given on the command line (default `../../qday-launch/npc-seeds.json`, **outside the repo**). Prints the vault ids and transaction links, never the seeds. Skips NPCs whose vault already exists.

## Tests

`app/npc/rules.test.mjs` with `node --test`: each rule above with a hand-made snapshot, including: no punching down, immune and busy targets skipped, NPCs never target NPCs, newest-holder greeting, defend probability with a fixed random, max 6 moves.
