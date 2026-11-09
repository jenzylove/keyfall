# KEYFALL v4.1: a first minute a new player understands

Owner played v4 on a phone on Nov 9. Findings:
1. Attacked within seconds, before anything said what to do or how to attack back.
2. Tried to enter "a big box" and was refused; kept moving until something else worked; a bubble talked about Satoshi. The rules (band, Satoshi needs a vault, immunity, raids left) are invisible until you bump into them.
3. After turning gold, no idea how to hit the player chasing them.
4. No visible goal: "what is somebody gaining from playing?" The quantum story does not come through.
5. Laggy on a phone with low battery.

The arena, the chain calls, the look and the hard rules of `GAME_ARENA.md` all stay. This pass adds teaching, legibility, a goal and phone performance.

## 1. The guided first run (first visit per network, skippable, remembered in localStorage)

Nobody hunts a new player until the guide is done or skipped. Steps advance on the real event, never on a timer alone. One instruction at a time, as a big readable card near the top plus an arrow in the world pointing at the thing to touch.

| Step | Card text | Arrow at | Advances when |
|---|---|---|---|
| 1 | **This is you.** Drag anywhere to move. | your body | you moved about 1 body length |
| 2 | **You are red.** Your coins sit behind an old key. A quantum computer can crack it, so anyone can rob you, and red bags leak coins over time. | your bag badge | tap or 4 s |
| 3 | **Get to the gold door.** It locks your coins behind a quantum key. | the gate | vault created and coins moved in (real txs) |
| 4 | **You are gold now. Safe.** Only gold players can attack. | your body | tap or 4 s |
| 5 | **Rob someone.** Players with a red target mark are ones you can hit. Touch one. | the nearest real raidable body | you launched a real raid |
| 6 | **Now they hunt you too.** If someone charges your vault, touch them to block. DASH to get away. | DASH button | tap or 4 s; hunters switch on |
| 7 | **Your goal:** be the richest vault when Q-Day hits. Red bags freeze forever that day. | the goal bar | tap |

No fake dummies: step 5 points at a real body that `blocker()` says is raidable right now. If none exists in range, say so plainly ("Nobody you can rob is near. Satoshi is always there: touch his core.") and point at Satoshi if the boss is ready, else skip to step 6.

Server side: NPC greetings (`app/npc/rules.mjs` GREET_WINDOW_MS, `/api/tick`, `/api/hunt`) must not raid a holder in its first minutes while the guide runs. Pick the cleanest real mechanism (for example a greet delay of a few minutes after first seen, plus `/api/hunt` refusing while the client says the guide is on is NOT enough on its own because the cron also raids). Keep tests green and add one for the delay.

## 2. Make every rule visible before contact

- When you are gold, every body you can raid right now gets a clear red target mark (crosshair or bracket) and a slight pulse. Everything you cannot raid is drawn muted with a small icon for why (lock = band, moon = resting, hourglass = busy) and, when you get close (not only on bump), a short line under it: "Too big for you", "Resting 1h", "Already being raided".
- When you are red, other players show no target marks; the gate is the only gold thing that pulses, and touching a rival says "Get to the gold door first. Only gold can attack."
- Satoshi: when you cannot hit him, his core is dim and the line on approach says why ("Get gold first" / "Your vault needs N coins" / "Ready in 3h"). When you can, it glows and says "Touch his core".
- Raids left this epoch shown as pips next to your bag in the HUD, with words when zero.

## 3. The goal, always on screen

A slim goal bar under the HUD: "Richest vault at Q-Day wins · you are #12 of 48". On mainnet add the money line from real numbers only: what the player paid in NEAR (from their own confirmed buys in this browser) against what the bag sells for now (only if a real sell quote/view exists in the contract or `chain.ts`; if not, show the bag and rank only and say so in the report).

## 4. Phone performance

- Detect mobile / low power (coarse pointer, small screen, `navigator.hardwareConcurrency <= 4`, or measured frame time over 20 ms for 2 s). In that mode: cap drawn bodies at about 25, devicePixelRatio cap 1.5 (or 1), fewer particles, no per frame shadows or filters, skip redrawing static layers.
- Measure with CDP `Emulation.setCPUThrottlingRate` 6x at 390x844 with the full body set. Target 45+ fps there. Report the numbers before and after.

## Acceptance

- `npm run build` clean; `node --test` for npc rules green.
- On localhost (dev server, Vercel blocks headless Chrome here), at 390x844, a brand new testnet player runs the full guide with real transactions: move, gate, gold, real raid on a marked target, hunters switch on. No NPC raid lands during the guide. Screenshot each step into `C:\Users\LENOVO\qday-launch\v41shots\` and look at each one.
- A 30 to 45 s real screencast of the first minute (`app/spike/v4record.mjs` approach) saved as `C:\Users\LENOVO\qday-launch\v41shots\first-minute.mp4`.
- Hard rules kept: no raw ids, every number from chain, no hyphens or dashes in copy, reduced motion respected.
