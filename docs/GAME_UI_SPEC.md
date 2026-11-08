# Q-DAY game UI, v2

Replaces the landing and `/play` parts of `APP_SPEC.md`. The chain layer (`app/src/chain.ts`), NPCs (`app/npc/*`), API (`app/api/*`), fonts and colour tokens stay. `/proof` stays as is, renamed in navigation to **Under the hood**.

Why v2: the owner's verdict on v1 was "no clarity, no understanding of the game flow; it looks like a billboard or newspaper before a game; UI filled with raw code." v1 was a long scrolling editorial page with parameter tables. v2 is a **game**: one screen, a clear goal, missions that explain each thing before it happens, and nothing a player would not say out loud.

## Hard rules (check every screen against these)

1. **No raw identifiers on the title screen or in the game.** Banned: parameter keys (`take_bps`), error codes (`E_NOT_QUANTUM`), method names (`config()`), key type bytes, transaction hashes, 64 character account ids, contract ids, "epoch" (say "every 6 hours"), "bps", "yocto". Allowed in one place only: a small "receipt ↗" link on an activity log row, and everything on `/proof`.
2. **Every player gets a readable name.** NPCs by character name (Shor, Grover, Qubit 01 ... Qubit 08). A human vault by the name they chose. Any other account by a codename made from its id: deterministic `Adjective Animal` (two word lists of 64 each, index from hashing the id), for example "Amber Lynx". Your own entries say "You".
3. **One screen, no page scroll in the game on phones.** Things open as bottom sheets or cards over the play field. On desktop the play field sits in the centre with panels at the sides.
4. **Every number is live and every word is plain.** Amounts as "548k" style in the HUD, full numbers in sheets. Times as "9:40", "5 h 12 m", "13 days". Errors as one friendly sentence (map in `chain.ts`; never show a raw string: fallback "That did not go through. Try again.").
5. **Motion explains state:** the bag drips while exposed, turns gold on migrate, shakes when raided, grows when you win; blips pulse when they can be raided; buttons show cooldown fills.
6. Phone first (360 to 430 px), then desktop. Light and dark both finished. No hyphens or dashes in copy except names (Q-DAY, ML-DSA-65).

## The goal (always on screen)

**Hold the biggest vault when Q-Day hits.** The HUD shows your rank among vaults ("#9 of 14").

## Screens

### 1. Title screen `/`

Full viewport, no long scroll. Feels like a game title, not an article.

- Top bar: logo, "Under the hood" (to `/proof`), theme toggle.
- Centre: **Q-DAY** wordmark huge, one line premise: "Quantum computers will break old crypto keys. Move your coins into a quantum vault before Q-Day, raid everyone who doesn't."
- The live radar (same component as the game, read only, slowly rotating sweep) behind or beside the wordmark, showing real holders as blips.
- Countdown to Q-Day, compact: "Q-Day in 13 d 04 h 12 m".
- Big **PLAY** button (to `/play`). Under it: "Free. No wallet, no sign up. NEAR testnet."
- Below the fold, only three short things:
  1. **How to play**: three cards with a small illustration each: (1) "Grab a bag. Your coins start exposed: they bleed every 6 hours and freeze at Q-Day." (2) "Build a quantum vault. Only a quantum safe key can open it, and only vaults can fight." (3) "Raid, defend, hit Satoshi. Biggest vault at Q-Day wins."
  2. **Top 5 vaults** with names (NPC tag) and live bags, plus "x% of all coins are in vaults; y% of that is NPC bots".
  3. Footer: Built at NEAR HACKATHON · Under the hood · GitHub · Also by the same team: Offmap.
- Nothing else. No rules table, no key bytes, no sources list (sources live on `/proof`).

### 2. The game `/play`

Layout on phones, top to bottom, fitting 100dvh:

- **HUD** (one row): Q-Day countdown · your bag (live, "548k") with state chip (EXPOSED red / VAULT gold) · rank "#9". A menu icon opens **Settings** (sheet).
- **Mission card** (only while a mission is active): one sentence of what is happening, one of what to do, one primary button. See Missions.
- **Play field** (fills the rest): the **radar**. Centre: your bag as the bleed pile (red dripping or gold). Around it, rival blips placed on rings by bag size (bigger bags on outer ring), each a small avatar: NPCs get a pixel portrait (generated SVG, distinct per character: Shor a red eye, Grover a magnifier, Qubits small cube faces numbered), humans a pixel identicon from their codename. Blip colour: red ring exposed, gold ring vault. Blips you can raid right now pulse; ones you cannot are dimmed with a tiny icon (moon = resting after a raid, shield = shielded, arrow down = too small for you). A sweep line rotates slowly. Tapping a blip opens its **Raid sheet**.
- **Event cards** slide over the field: "Qubit 02 is raiding you · 9:40", "You defended! +13,435", "Harvest: exposed bags bled 39,549 into vaults", "Your raid on Amber Lynx landed: +44,785". Tap to open the relevant sheet; they queue and auto dismiss except raids on you.
- **Action bar** (bottom, thumb zone, 4 big buttons with icons and small status): **RAID** (raids left "3"), **SHIELD** (current %), **SATOSHI** (ready dot or countdown), **MARKET**. Disabled with a short reason while exposed: "Vaults only".

Desktop (≥ 1024 px): HUD across the top; left column mission card and your stats; centre the radar large; right column **Activity** (the feed as plain sentences with names, newest first, your moves highlighted, "receipt ↗" links); action bar under the radar.

### Sheets

- **Raid sheet** (from a blip or RAID): portrait, name, state, bag. Plain explanation: "Exposed: can't defend. You'd take 10% of their bag" or "Vault: can defend for 10 minutes. You'd take 2% if they don't." Stake slider (min stake to sensible max) with live "Stake 15,000 to take about 44,785. If they defend, they keep your stake." If not raidable, the reason in words and when it changes ("Resting for 18 h 40 m", "Too small for your bag: no punching down", "Already under raid", "Too small to raid"). Button **Raid**. After sending: event card + the raid appears on the field as a line from you to them with its countdown, then the result.
- **Under raid card** (from an event): attacker portrait, countdown big, "If you do nothing you lose ~44,785". Exposed: explains escape and offers **Build vault & escape** (mission 3 flow). Vault: **Defend**.
- **Shield sheet**: slider 0 to 9% of your bag; live "Burn 4% (21,904) for a 20% shield until the next harvest in 5 h 12 m". Button **Charge shield**.
- **Satoshi sheet**: Satoshi portrait and stash; "Hit once every 6 hours for 0.1% of the stash (up to 20,000). Next hit ready in ...". Button **Hit Satoshi**.
- **Market sheet**: Buy (0.25 / 0.5 / 1 NEAR, disabled above what you hold minus 0.05) and Sell (slider), live quotes, fee in words.
- **Settings sheet**: your vault name; **Back up vault key** (shows the recovery code with copy and download as a text file; a small red dot on the menu icon until backed up once); Restore a vault from a code; Forget this device; link "Under the hood".

### Missions (first session)

Missions sit in the mission card. They advance from real chain state, never on a timer alone.

1. **Grab a free bag.** "You need coins to play. We'll make you a free testnet wallet and buy your first bag." Button **Grab my bag** = `join()` then `buy(1)` in one go, with progress text ("Making your wallet… Buying…").
2. **Your coins are exposed.** Shown when the bag lands. "Your coins sit behind an old key. Every 6 hours a share bleeds away, and at Q-Day they freeze for good. Only a quantum vault is safe." Button **Build my vault** (to step 3). Also call `/api/tick` (already done by `chain` flow helpers in play.ts) so a raider notices.
3. **Build your vault** (or, if a raid on you arrives first, the card turns red: **"Qubit 02 is raiding you. Exposed coins can't fight back. Build your vault and move in before 9:40 runs out. The raid gets nothing."**). One field: vault name (prefilled, editable). Button **Build vault & move in** = `createVault(name, newVaultSeed().seed)` then `migrate()`, progress text. The recovery code is NOT shown here; it is saved sealed on the device and offered in Settings (red dot).
4. **You're quantum safe.** If you escaped a raid: "Qubit 02's raid will find nothing. Watch the clock." When it settles: "Escaped. The raid took 0." Otherwise: "Your coins can't bleed or freeze now. Next: strike back."
5. **Strike back.** Highlights the raider's blip (or the best raidable blip): "Raid Qubit 02. If it doesn't defend in 10 minutes you take a share of its bag." Opens the Raid sheet prefilled.
6. Done: "Free play. Hit Satoshi every 6 hours, shield before others raid you, and climb the board." Card hides; a small "Goal: biggest vault at Q-Day" stays in the HUD.

After Q-Day: the mission card says "Q-Day has come. Exposed coins are frozen for good. Final standings:" and the radar shows frozen blips grey.

## Data (unchanged sources)

All reads through `chain.ts` (`getStats`, `getHolders`, `getVaults`, `getOpenRaids`, `getFeed`, `getHolder`, `getConfig`, `balanceOf`, `nearBalance`, `quoteBuy`, `quoteSell`, `keyList`). Poll every 5 s in the game, 15 s on the title. Use `isNpc` and `explainRaid` from `../npc/rules.mjs`. Rank = position of your vault among `getVaults` sorted by balance. Rules numbers (10%, 2%, 6 hours, 10 minutes, 0.1%, caps) come from `getConfig()` at runtime, formatted in words.

## Acceptance

- `npm run build` clean.
- Headless Chrome at 390×844 and 1440×900, dark and light, against the live contract on localhost (`npm run dev`, not the Vercel URL): title screen, and `/play` in each mission state. Drive the real first session on testnet once on localhost: Grab my bag → (raid card if it arrives) → Build vault & move in → Strike back raid → Shield → Satoshi. `/api/*` does not exist under `vite dev`: run `npx vercel dev` from the repo root instead if needed, or call the live `/api/join` and `/api/tick` by absolute URL only when on localhost (allowed by the origin check).
- No page scroll in `/play` on phones; no horizontal scroll anywhere; no console errors.
- A screen by screen check against the hard rules above, written in the final report.
