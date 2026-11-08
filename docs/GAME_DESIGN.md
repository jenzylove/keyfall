# Q-DAY game design, v3: arcade

Supersedes the look and feel in `GAME_UI_SPEC.md` (v2). v2's structure stays (title screen, one screen game, HUD, radar, missions, action bar, sheets, plain words, no raw identifiers), but v2 had no fun: "it's just clicking buttons, no fun vibe for a game, nobody will want to play." The owner also found the title page below the hero broken (fonts, arrangement, no visible footer). v3 makes Q-DAY feel like an **arcade game** people want to keep playing. **Mobile first**: design and test at 390×844 before anything else; desktop is the phone layout with room around it.

Decisions from the owner: **Arcade pixel vibe. Sound on by default after the first tap, with a mute toggle.**

## Hard rules (kept from v2)

1. No raw identifiers in the title screen or the game: no param keys, error codes, method names, key bytes, tx hashes (except a tiny "receipt ↗" in the activity log), 64 hex ids (codenames instead), "epoch", "bps". Everything technical lives on **Under the hood** (`/proof`) and in the README.
2. Every number is live from `app/src/chain.ts`. No fake states, no invented events. Animations dramatise real results; they never show a result before the chain confirms it (show "in flight" until then).
3. No hyphens or dashes in copy except names (Q-DAY, ML-DSA-65).
4. Light and dark both finished, but **dark is the hero** for the arcade look.

## Vibe: arcade pixel

- Neon on deep space black. Signal yellow `#FFD60A` stays the quantum/vault colour, hazard red `#FF3D2E` stays exposed/danger; add one electric accent (cyan or magenta) for beams and UI glow. Subtle CRT scanlines and a faint grid on the play field.
- Type: a **pixel display font** for titles, numbers and buttons (pick one with character: `Silkscreen` or `Pixelify Sans` from Google Fonts; **not** Press Start 2P, which reads as a template), with `IBM Plex Mono` (already loaded) for small text. Never more than these two.
- Pixel art everywhere it counts: the avatars (already in `app/src/ui/avatars.ts`, make them bigger and animated: idle bob, blink), icons, the bag (pixel coin pile), the vault (pixel safe door), Satoshi (big pixel boss).
- Chunky arcade buttons with a press depth, glow on hover/focus.

## Sound and feel

- Sound effects synthesised with WebAudio (no audio files): button blip, raid launch (rising zap), raid hit (crunch), coins in (cascade of blips), escape (power up chord), defend (shield clang), boss hit (deep thud), rank up (fanfare), Q-Day siren (on the title, quiet). Unlocked by the first tap (PLAY). Mute toggle in the HUD, remembered in localStorage (try/catch).
- `navigator.vibrate` on raid hits, defends and boss hits where supported.
- Screen shake on hits, number pops (+13,435 floats up), particle bursts (coins), and a short freeze frame on big moments. Respect `prefers-reduced-motion` (no shake, fewer particles).

## Flow

### Title screen `/` (mobile first, fully designed top to bottom)

1. **Hero:** pixel Q-DAY logo with a glitch flicker, the live radar behind it (real players), one line: "Quantum computers just broke old crypto keys. Get your coins into a quantum vault, then raid everyone who didn't." Big **PLAY** button (pulsing). Countdown "Q-DAY IN 13D 04H". "Free · no wallet · NEAR testnet".
2. **How to play:** three pixel illustrated panels, swipeable on phone: GRAB A BAG (exposed coins drip) → BUILD YOUR VAULT (pixel safe slams shut) → RAID & SURVIVE (beams across the radar). One short line each.
3. **Meet the rivals:** the characters with a line each, so players know who they will fight: Shor ("Hunts the biggest exposed bag."), Grover ("Hunts the weakest vault."), the Qubits ("Greet every new player with a raid."), Satoshi ("The boss. Everyone hits his stash.").
4. **High scores:** top 10 vaults arcade style (rank, avatar, name, score), NPCs tagged, plus "73% of all coins are in vaults · 91% of those are NPC bots" style line, live.
5. **Footer** (must exist and look finished): Q-DAY logo, Play, Under the hood, GitHub, "Built at NEAR HACKATHON on NEAR testnet", "Also by the same team: Offmap", MIT.
Every section checked at 390 px for font sizes, wrapping, spacing and alignment; nothing overflows, nothing cramped.

### Cold open (first visit to `/play`, skippable, about 15 seconds)

Three pixel panels with typewriter text and sound: (1) "2031. A quantum computer wakes up." (2) "Every old crypto key is now a door left open. Including yours." (3) "Get your coins behind a quantum key. Then take everyone else's." Radar powers on with a sweep and a chime. "Skip" always visible. Shown once (localStorage).

### The game `/play`

v2 structure, now alive:
- **HUD:** Q-Day countdown, your score (bag) with EXPOSED/VAULT badge, rank with an arrow when it changes, mute, menu.
- **Radar arena:** rivals on rings, idle animations, a sweep that pings them. Your pile in the centre (pixel coins; red and dripping while exposed, gold behind a vault door once safe).
- **Rivals talk:** speech bubbles over avatars, short and in character, from a lines file `app/src/ui/lines.ts` keyed by character and event (raids you, you escape it, you defend it, you raid it, it defends, idle taunt, Satoshi hit). Examples: Shor raids: "Your keys are showing." You escape Shor: "...a quantum key. Annoying." Grover raids: "Found you." Qubit raids: "hi! :) gimme." You defend a Qubit: "ow ow ow." Satoshi when hit: "I was here first." Lines are flavour only; numbers always come from the chain.
- **Moves as moments** (each shows "in flight" while the chain confirms, then the real result):
  - Raid: a beam from you to the target, a countdown chip on the beam; on result, coins fly to the winner with a number pop.
  - Under raid: the arena edge flashes red, siren blip, the raider's bubble, big clock, one button (ESCAPE when exposed, DEFEND in a vault).
  - Escape: vault door slams over your pile, red turns gold, power up sound, "ESCAPED" banner when the raid settles at 0.
  - Defend: shield dome pops, clang, the raider's stake flies to you.
  - Shield: a dome you can see on your pile until it expires, strength shown as rings.
- **Satoshi boss fight** (SATOSHI button): full screen boss with a big health bar = his live stash out of 1,100,000. "Every player can hit once every 6 hours." HIT button; on confirm: hit animation, thud, "YOU DEALT 1,050 · KEPT 840". Shows the last few hits by others from the feed. Cooldown timer when used.
- **Missions** (v2 flow kept; first raid = escape): GRAB A BAG → YOUR COINS ARE EXPOSED → BUILD YOUR VAULT (or ESCAPE when a Qubit raids first) → YOU'RE QUANTUM SAFE → STRIKE BACK → free play. Mission card styled as an arcade quest banner.
- **Titles** (earned, shown on your profile and announced with a fanfare), only from real data you can check: Quantum Native (you own a vault), Escape Artist (a raid on your old wallet settled at 0 after you moved in), Shield Up (you charged a shield), Satoshi Slayer (you hit Satoshi), Raider (one of your raids took coins), Wall (you defended a raid). Track them from your own confirmed transactions in this browser plus chain reads; never award without a confirmed result.
- **Share:** when you are raided, a "CALL FOR BACKUP" button shares the defend link (Web Share API, X intent fallback) with text like "A Qubit is raiding my vault in Q-DAY. 9 minutes left." When you earn a title, a share card.
- **Activity:** a drawer (phone) or right column (desktop) in plain sentences with names.

## What stays exactly as is

`app/src/chain.ts` behaviour (use `apiUrl()` for `/api/*`), `app/api/*`, `app/npc/*`, `/proof` (restyle to match the arcade look, keep its content), `/d/:id` (restyle, keep function).

## Acceptance (done before reporting)

- `npm run build` clean.
- `npm run dev` on localhost (Vercel's bot check blocks headless Chrome from this machine on the live URL), puppeteer-core at 390×844 first, then 1440×900, dark and light.
- Play the real first session on testnet: cold open → GRAB A BAG → (a Qubit raid usually arrives in about 30 s) → ESCAPE into a vault → raid settles at 0 → STRIKE BACK → shield → Satoshi boss hit. Screenshot every state into `C:\Users\LENOVO\qday-launch\v3shots\` and look at each one, fixing anything unclear, cramped, misaligned, unreadable or dull.
- Title screen full page at 390 px reviewed section by section, footer included.
- No horizontal scroll anywhere, no page scroll in `/play` on phones, no console errors.
- Report: files changed, a check against the hard rules, the testnet outcomes, screenshot paths, anything not done.
