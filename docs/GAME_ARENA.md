# KEYFALL game design, v4: the arena

Supersedes the `/play` screen of `GAME_DESIGN.md` (v3). v3's look stays (arcade pixel, neon on black, Jersey 10 + IBM Plex Mono, chiptune WebAudio, shake, particles, speech bubbles, titles, cold open), but v3 was still a screen you tap and then put the phone down. Owner, Nov 9: "I was expecting the app to be something in movement... you catch the wrong one, then that person can be chasing you... there should be a truth of you moving, not just clicking."

**The game is renamed KEYFALL.** Token **$KEYFALL**. "Q-Day" stays as the in-world event (the day old keys fall), never as the product name. Another team posted a game called Q-DAY on Nov 8.

## The one idea

**You steer your bag around a live arena with your thumb.** Everyone who holds the token is a body in the arena. Red bodies are exposed bags, gold bodies are quantum vaults. Contact is the controller: every on-chain move fires because you physically reached something.

| You touch | When | Chain call (already in `chain.ts` or added by the chief) |
|---|---|---|
| A red or gold rival | You are a vault, the target is raidable (band, not immune, raids left) | `raid(target)` |
| The **vault gate** (gold portal) | You are exposed | `createVault` + `migrate` (first time), `migrate` later |
| A raider charging at your vault | A raid is open on you and you are a vault | `defend(raidId)` |
| **Satoshi** in the centre | Boss ready for you this epoch | `bossRaid()` |
| A **shield cell** on your HUD (not a pickup) | Any time in a vault | `chargeShield(bps)` |

The arena never invents money. Positions and movement are local and free; every coin that moves comes from a confirmed transaction.

## Controls (mobile first, 390×844)

- Floating thumb joystick: touch anywhere in the lower 60% of the arena, drag to steer, release to coast. Desktop: WASD/arrows, mouse also steers toward the pointer while held.
- Your body moves at a fixed speed with slight inertia; a **DASH** button (bottom right, 3 s cooldown) gives a short burst. Dash is how you escape a hunter.
- The camera follows you; the arena is bigger than the screen (about 3×3 screens), with a minimap ring at the top right showing the gate, Satoshi and anyone hunting you.
- 60 fps on a mid phone. Canvas 2D, pixel art at integer scale, `image-rendering: pixelated`. No new libraries unless tiny and justified.

## Bodies

- Every holder from `getHolders` is a body (cap the drawn set at about 60: you, everyone raiding you or raided by you, NPCs, then the largest). Size grows with bag (log scale, clamped). Labels: codename (never the 64 hex id), bag in k/M.
- NPC behaviour in the arena mirrors `app/npc/rules.mjs` intent: **Shor** drifts toward the biggest exposed bag, **Grover** toward the least shielded vault, **Qubits** swarm new players. Other real players wander on a seeded path (seed = account id) so they look alive.
- States drawn on bodies: exposed (red, dripping pixels), vault (gold, door icon), shielded (ring per 10%), immune (dim with a moon), out of your band (dim with a lock; bumping it bounces you off with a "too small/too big" bubble), raiding you (red trail pointed at you).

## The loop

### Exposed (start)

1. GRAB A BAG gives you a bag (existing `join` + `buy`). You spawn red in a quiet corner. The **vault gate** spawns across the map and pulses gold.
2. **Hunters come for you.** Within seconds the nearest Qubit (and, if your bag is big, Shor) turns toward you and accelerates. Siren blip, red edge pulse, bubble ("hi! :) gimme").
3. If a hunter **touches you**, the client calls `POST /api/hunt { target }`. The server lets that NPC raid you **only if the contract rules allow it** (it uses the same rules as `/api/tick`). On confirmation: the hunter latches on with a red tether, the 3 minute escape clock starts on your HUD, coins drip toward the hunter as a preview ring (no number until settle).
4. **Run for the gate.** Reach it before the clock ends: the vault door slams around you (create vault the first time, migrate after), red turns gold, ESCAPED banner when the raid settles at 0. Caught and the clock ran out: the real take flies to the hunter with the real number.
5. You can also just go straight to the gate before anyone catches you. That is the smart play, and the game tells you so in the first mission.

### Vault (you are the hunter now)

- Your raids left this epoch show as pips on your body. Touch a raidable body to raid it: beam, stake chip ("stake 1,000"), the target's tether timer. Exposed targets flee toward their own gate (NPC behaviour), so you chase; the result is whatever the contract settles.
- When you are raided as a vault, the raider body charges you. **Intercept it** (touch it) to defend. Clang, shield dome, its stake flies to you on confirmation.
- Satoshi sits in the centre behind a slow rotating pulse ring. Dodge the pulse (touching it knocks you back, no chain effect), touch his core when your boss hit is ready: thud, health bar drops by the confirmed amount, "YOU DEALT 1,050 · KEPT 840".

### In flight

Every chain call shows a small spinner on your body ("signing with your quantum key...") and the arena keeps running. Failures come back as a bubble in plain words (use `plainError`). Never show a result before the chain confirms.

## Screen

- Full screen canvas, no page scroll. HUD on top (Q-Day countdown, your bag with EXPOSED/VAULT badge, rank, network chip MAINNET/PRACTICE, mute, menu). Bottom: joystick zone, DASH, SHIELD, MARKET (opens the existing sheet). Mission banner as a slim strip under the HUD that collapses after it is read.
- Activity drawer and the boss sheet from v3 stay, reachable from the menu.
- Cold open, titles, share card, sound, fx and lines from v3 stay and are triggered by arena events.

## Network

Two arenas, one game:
- **MAINNET**: real $KEYFALL bought with real NEAR from your own NEAR wallet. Default for returning players.
- **PRACTICE** (testnet): free, no wallet, the current flow. Default for a first visit and for judges, with a clear "Play for real on mainnet" button once you finish the first mission.
The chief owns `chain.ts` network switching and wallet connect. The UI reads `chain.NETWORK` and calls the same functions.

## Hard rules (kept)

1. No raw identifiers in the game (no 64 hex ids, error codes, method names, bps, epoch). Technical detail lives on `/proof` and in the README.
2. Every number from the chain. Movement is local; money is not.
3. No hyphens or dashes in copy except names (ML-DSA-65).
4. `prefers-reduced-motion`: no shake, fewer particles, joystick still works.

## Acceptance

- `npm run build` clean; localhost at 390×844 first, then 1440×900.
- Play the real practice session on testnet: spawn, a Qubit hunts and catches you (real raid), you reach the gate (real vault + migrate), the raid settles at 0, you raid a rival by touch, you hit Satoshi by touch. Screenshots of every state in `C:\Users\LENOVO\qday-launch\v4shots\`, looked at one by one.
- Record a 20 second screen capture of the chase (puppeteer screencast or frames) so the owner can see it move.
- 50+ fps measured on the arena with 60 bodies (report the number).
