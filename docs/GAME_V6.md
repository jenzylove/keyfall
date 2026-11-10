# KEYFALL v6: make the fight and the coin readable

Owner played season 2 (arcade clock + bagholders) on a phone on Nov 10: "significantly better than before", then these. Every item below is required. Hard rules of GAME_ARENA.md stay: every number from the chain, movement is local and money is not, no hyphens or dashes in copy, no raw ids, reduced motion respected.

## 1. Your raid on someone (replaces the cyan dashed tether)

- Remove the dashed line between you and targets you are raiding.
- The target carries a big badge above it: `ROBBING` + countdown `0:33` (cyan), readable at 390 px. The top right raid tracker stays.
- When the raid settles with take > 0: the target body bursts (pixel shards + coins scatter), the coins fly to your body, and a big number pops at you `+46,977` with the coin sound. Then the target reforms (it is still a holder). When it settles at 0 (defended): see 4.

## 2. Enemy shots on you (they must never miss)

- An NPC or player shot at you dramatises a raid that is already on chain. It starts at the real raider's body (on screen, or from the screen edge in its real direction with an edge pointer), travels to you and always hits: flash, short shake, `HIT` and a pinned strip `QUBIT 06 IS ROBBING YOU · 0:59 · SHOOT BACK` (vault) or `· RUN TO THE GOLD DOOR` (red).
- With a shield: the shot visibly breaks on your ring and the strip says `shield takes 20% off`.
- Obstacles never appear to block shots aimed at you or by you (cover cannot change the chain). Shots pass over blocks.
- No other enemy projectiles exist. Nothing flies at you that is not a real raid.

## 3. SHOOT always answers

Every SHOOT press gives a visible result within 150 ms:
- a target in range: fires (as now);
- the locked target is already being robbed by you: auto switch the lock to the next open target in range and fire; if none: bubble `Already robbing Qubit 08 · coins in 0:33`;
- no shots left: bubble `No shots left · new round in 4:12` and the SHOOT button shows the round countdown;
- nothing in range: `Nothing to shoot here · red marks are targets` and the nearest target gets an edge pointer.
A move in flight: the button shows `SIGNING…`, presses are ignored with a tiny shake.

## 4. Back and forth

- When a bot (or player) defends your raid: a counter shot flies from it to you, `BLOCKED` on it, `−15,659` (your stake) pops red at you, sound `deny`.
- When you defend a raid on you: your shot hits the raider, `BLOCKED` on it, `+stake` pops gold at you.
- After the 3 minute new player grace, hunters do come (already in rules); make sure the first hunter raid on a vault player happens within the first 5 minutes of free play when the rules allow (no rule change needed if they already do; check with a real session).

## 5. Satoshi is the boss, and he is red

- Recolor Satoshi from gold to hazard red / dark (gold means safe in this game). Bigger, a clear `BOSS` tag and his health bar (stash / 1,100,000) above him.
- When your boss hit is ready: a pulsing badge on him `SHOOT HIM · +~X` (X = the contract's boss hit for you: boss_bps of his stash, capped by boss_cap), an edge pointer when off screen, and the mission strip says so once. When it is not ready: `next hit in 9:12`.
- A hit: big damage number on him `−1,090` and `+872` popping at you (kept after the boss burn), health bar drops.
- Mention him in the guide (step 6 or 7): `Satoshi is the boss. Every round each vault can shoot his stash once.`

## 6. Your bag (the memecoin loop, visible)

Tapping YOUR BAG in the HUD opens a sheet `YOUR BAG`, all from chain reads:
- coins now; what the whole bag sells for now in NEAR (contract `quote_sell`, practice too) ; on mainnet what you paid;
- this round: harvest income to your vault (or leak from your red bag) with the countdown to the next harvest;
- your raids this session: won (sum of takes), blocked (sum of stakes lost), raids on you and what they took;
- YOUR KEYS: `Wallet key: ed25519 · an old key, a quantum computer can crack it` and `Vault key: ML-DSA-65 · quantum safe, it signed N of your moves` (N = your confirmed vault moves in this browser), each with a link to the account on the explorer;
- a one line explainer: `Red bags leak to vaults every round and freeze at Q-Day. The coin is your score, your ammo (stakes) and your armour (shields).`
Also show a small `+12k next harvest` chip near the bag (already in the goal bar; keep it short).

## 7. Explain the key in the guide

- Step 3 card (gold door) text: `It makes a new account locked by an ML-DSA-65 key, made in your phone. A quantum computer cannot crack it.`
- Step 4 (you are gold): `Every move you make now is signed with that quantum key. Red bags leak coins to you every round.`

## 8. Building the vault takes long

Measure the real time of create_vault + callback + migrate on the live site (phone and localhost). Replace the single `IN FLIGHT` with three named steps that tick as each confirms: `1 Creating your vault account · 2 Adding your quantum key · 3 Moving your coins in`, with elapsed seconds. If there is avoidable waiting in the client (polls, sleeps, waitUntil levels), cut it and report the before and after times.

## Acceptance

- `npm run build` clean, rules tests green.
- A fresh player real session on localhost at 390x844 (the agent may use app/spike/v5loop.mjs as a base): guide through step 7, shoot 3 bagholders, see ROBBING badges, the burst and `+N` on each settle, a bot defend shown as BLOCKED with the stake loss, a raid on you shown as a hit from the real raider, a shield ring catching a shot, Satoshi red with the ready badge and a hit with numbers, SHOOT pressed on an already robbed target and with zero shots (both answer), the YOUR BAG sheet with real numbers, vault build with the three steps and its measured time.
- Screenshots of every state into C:\Users\LENOVO\qday-launch\v6shots\, looked at one by one, light AND dark theme (the owner's phone is in light theme).
- A 60 to 90 s real screencast `C:\Users\LENOVO\qday-launch\v6shots\loop.mp4` of free play: shoot, badge, burst, coins in, a block, a raid on you.
- fps at 6x CPU throttle at 390x844 stays 40+.
