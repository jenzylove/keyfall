# Q-DAY app spec

The app is a static Vite + TypeScript site in `app/`, deployed on Vercel. It talks to the chain only through `app/src/chain.ts` (already written and proven in spike S2; do not change its behaviour without a reason). No backend, except one serverless function for NPC ticks (`app/api/tick.ts`, separate brief).

Judged on: the game loop (games track), the mechanic (memecoins track), design, and "players never notice the chain". A judge on a phone must go from the landing page to a real raid in under three minutes, with no wallet, no sign-up, no popups and no gas prompts.

## Stack

- Vite 6, TypeScript, **no UI framework required**; Preact (`preact@10.26.x`) with `preact-iso` routing is allowed if it helps. No Tailwind. Plain CSS with custom properties.
- Fonts (Google Fonts): **Big Shoulders Display** (700, 900) for headlines and big numbers; **IBM Plex Mono** (400, 500, 600) for everything else. No other fonts.
- Routes (SPA, `vercel.json` rewrites everything to `index.html`):

| Route | Page |
|---|---|
| `/` | Landing (numbered sections, FAQ, footer) |
| `/play` | The game |
| `/d/:id` | Defend link for raid `id` |
| `/proof` | Judge checks and evidence |

## Identity: the emergency broadcast

Q-DAY looks like a civil defence alert for the quantum apocalypse. Public warning signage, emergency broadcast crawl, hazard tape. Serious type, a joke underneath.

- **Colours** as tokens on `:root`, with a light theme under `[data-theme=light]` and `prefers-color-scheme`:
  - dark: `--bg #0C0C0B`, `--ink #EDEBE3`, `--dim #8A877E`, `--line #2A2926`
  - light: `--bg #F2EFE6`, `--ink #121211`, `--dim #6B685F`, `--line #D6D2C6`
  - both: `--safe #FFD60A` (signal yellow: vaults, quantum, primary actions; on yellow, text is always `#121211`), `--hazard #FF3D2E` (exposed, bleeding, raids), `--hazard-ink` darker red for text on light.
- **Type:** huge condensed numbers (countdown at up to 18vw on phones), uppercase Big Shoulders headlines, Plex Mono for data, labels, body and buttons.
- **Signature visual: the bleed.** A canvas animation of grains. Exposed bags are red grain piles that drip; dripping grains fall into a yellow vault stream. On the landing hero it represents the whole season (left: exposed supply, right: vault supply, proportions live from `stats()`). In `/play` it is your own bag: red and dripping while exposed, yellow and still in a vault. Respect `prefers-reduced-motion` (static render).
- **Hazard crawl:** a full-width band with diagonal hazard stripes and a scrolling ticker of the live feed (`feed()`), like an emergency alert crawl. On the landing and at the top of `/play`.
- **Alert state:** when the player is under raid, the whole `/play` screen switches to the alert: red stripes pulse at the edges, a big countdown to the raid deadline, one button. This is the core moment of the game.
- **Layout rules:** no grids of bordered cards. Full-bleed sections separated by thin rules, big type, generous space. Lists are rows with hairlines. One primary action per screen. Works at 360 px wide with a 16 px gutter and no horizontal scroll. Light and dark both finished.
- **Motion:** countdown digits tick, numbers count up when they change, the crawl scrolls, the bleed drips, buttons press. Nothing static on the hero.
- **Words:** plain, short, no jargon. Never "web3", "on-chain magic" or "seamless". Do not use hyphens or dashes in copy (the product name Q-DAY and the error codes are the only exception). Say "testnet" plainly where it matters.

## Data rules

- Every number on screen is read live from the contract or chain through `chain.ts`, refreshed every 5 s on `/play` and `/d/:id`, every 15 s elsewhere. If a read fails, show "can't reach NEAR right now" in place of the number. Never a placeholder that looks real.
- Token amounts: `fmtTokens`. NEAR: `fmtNear`. Times: countdowns from `stats().now_ms` (chain time), not the device clock, kept ticking locally between refreshes.
- Every transaction result shows a small "view on explorer" link (`txLink(hash)`).
- Errors show `ChainError.message` (already friendly) in the action's own spot, never `alert()`.

## `/` Landing

1. **Hero.** Eyebrow: "Live on NEAR testnet · Season 1". Headline: **"Migrate before Q-Day or freeze."** Big countdown to `q_day_ms`. Three live numbers in a row (not cards): share of holdings in quantum vaults (`vault_share_bps`), Satoshi's stash (`satoshi_tokens`, with a thin bar shrinking from 1,100,000), raids so far (`raids`). The bleed canvas behind or beside. Primary button **Play now, no sign up** → `/play`. Secondary text link "How it works".
2. **Hazard crawl** with the live feed.
3. **01 The threat.** Three short facts, each with its source link (sources are in `docs/SOURCES.md`; use only facts listed there). Then: "Nobody moves a key until it costs them something. Q-DAY makes it cost something."
4. **02 Two kinds of holder.** Exposed wallet vs quantum vault, as two columns of rows (from PRD section 6 table). Exposed side red, vault side yellow.
5. **03 How a season plays.** The loop: every few minutes (raid, defend, escape), every epoch (harvest, shield, Satoshi), the season (Q-Day freezes every exposed bag). Live epoch length and season length from `config()`.
6. **04 The rules can't change.** Every parameter from `config()` in a two-column list with a one-line plain meaning each, plus "contract keys: 0" read live from `keyList(CONTRACT)`. Link to `/proof`.
7. **05 Why only NEAR.** NEAR accepts ML-DSA-65 (post-quantum, FIPS 204) account keys, and a contract sees which key type signed each move. Show the byte: `signer key type 2 = ML-DSA-65`. Two transaction links from `docs/e2e/latest.json`: one move refused with `E_NOT_QUANTUM`, the same move accepted with ML-DSA-65.
8. **06 Leaderboard.** Top vaults by balance, from `vaults()`. NPC vaults are labelled "NPC".
9. **FAQ.** Is this real money? (testnet, free) · What is Q-Day? · What happens to my key? (made in your browser, never sent anywhere, recovery code) · Who are the NPCs? (the game's own bots, rules in one public file) · Can the rules change? (no keys) · What is ML-DSA-65?
10. **Footer.** Q-DAY, built at NEAR HACKATHON, contract id with explorer link, GitHub repo, "Also by the same team: Offmap" (required by the rules), MIT.

## `/play` The game

Top: crawl, then a status strip: your state (EXPOSED in red / VAULT in yellow / NOT JOINED), balance, NEAR left, shield %, raids left this epoch, epoch countdown.

**Onboarding (shown until the player has a vault holding tokens).** One step at a time, with a progress line of 4 steps:

1. **Join.** "Get a free testnet wallet. No sign up." Button → `chain.join()`. Show account id.
2. **Buy.** Amount choice 0.5 / 1 / 2 NEAR with live `quoteBuy`. Button → `chain.buy(n)`. After buying, the bag shows as red, dripping: "Your bag is exposed. It bleeds every epoch and freezes at Q-Day." Call `fetch("/api/tick", {method:"POST"})` (fire and forget) so the NPCs notice the new bag.
3. **Make your quantum vault.** Name input (lowercase, digits, `-`, `_`, max 20). Show the recovery code from `newVaultSeed()` in 8 blocks; the player must tick "I saved this code" (and can copy it) before the button enables. Button → `chain.createVault(name, seed)`. Explain in one line: "Your vault is a new NEAR account whose only key is quantum safe. The key was made in this browser and never leaves it."
4. **Migrate.** "Move your bag into the vault." Button → `chain.migrate()`. Bag animates from red to yellow.

If the player is raided while exposed (their `holder.under_raid` is set), show the alert with **Escape: migrate now** (steps 3 and 4 in one flow if needed).

**After onboarding: the game.** Sections in this order, each a full-width band (not cards):

- **Under raid** (only when `under_raid`): alert state, countdown to the raid deadline, attacker, stake, what you would lose, **Defend** → `chain.defend(id)`. Afterwards the result.
- **Raid.** Targets from `holders()`, excluding yourself, frozen and the market. Each row: name (NPC label), kind (exposed red / vault yellow), balance, shield, immune countdown or "under raid". Disable rows the contract would refuse (immune, busy, too small, punch down: target balance × `punch_down_band` < your balance) and say why. Stake input with min `min_stake`, max your balance; show the possible take: exposed `take_bps`, vault `vault_take_bps`, reduced by shield, capped at `stake_mult` × stake. Button → `chain.raid(target, stake)`. Then a row in "Your raids" with its countdown and a **Share defend link** (copy `/d/<id>`), and **Settle** → `chain.resolve(id)` once the window closes.
- **Satoshi.** The stash, the per-epoch hit (`boss_bps`, cap `boss_cap`), ready or next epoch countdown. Button → `chain.bossRaid()`.
- **Shield.** Slider 0 to 9% of your bag, live strength = sqrt(share) as in the rules (1% → 10%, 4% → 20%, 9% → 30%, cap `max_shield_bps`). Button → `chain.chargeShield(amount)`. Shows current shield and when it expires (end of epoch).
- **Market.** Buy more (from the vault, `buy(n, "vault")`) and sell (`sell(amount)`), with live quotes, fee shown.
- **Harvest.** If `stats().harvest_due`, a button anyone can press → `chain.harvest()`: "Run the harvest: exposed bags bleed into vaults."
- **Open raids** across the game (`open_raids()`): any with a passed deadline get a **Settle** button.
- **Feed.** Latest moves, newest first, as plain sentences ("shor raided qd-x8k2…: took 12,410", "you migrated 640,000 into your vault").
- **Your keys.** Vault account id, live key list from `keyList()` showing one `ml-dsa-65` key, "show recovery code" is not possible (sealed), restore from a code, and "forget this device".

## `/d/:id` Defend link

Works opened cold (new device, no session). Shows: raid attacker → target, stake, countdown, status. If this device holds the target vault: big **Defend** button. If not: "Is this your vault? Restore it with your recovery code" (inline `restoreVault`) or "Play Q-DAY" → `/play`. After the deadline: **Settle** for anyone, and the result once resolved.

## `/proof` Judge checks

Each check runs live on page load, shows pass or fail, and links to its evidence:

1. Contract has no access keys (`keyList(CONTRACT)` is empty).
2. `config()` equals `sim/params.json` (bundle the file at build time and compare field by field).
3. Vault census: every vault from `vaults()` with its live key list; count how many are quantum only (exactly one `ml-dsa-65` key) and flag any that added another key.
4. Quantum guard: the refused and accepted transactions from `docs/e2e/latest.json` (bundled), with links.
5. Harvest gas at small and large holder counts from `docs/e2e/latest.json`.
6. End-to-end run: the whole `docs/e2e/latest.json` table.
7. **Fast forward: a season in 60 seconds.** Replay `sim/out/report.json` `series` per scenario (selector of the 6 scenarios): animated lines over 56 epochs for share in vaults, Satoshi's stash, burned, and raids, with play/pause. Explain: "The rules crate the contract runs, simulated over 60 days."
8. Deployment record from `deployments/testnet-live.json` (bundled): deploy transaction, wasm sha256, and how to rebuild.

## Files

- `app/index.html`, `app/src/main.ts` (router), `app/src/pages/*.ts`, `app/src/ui/*.ts` (bleed canvas, crawl, countdown, numbers), `app/src/styles.css`, `app/vercel.json`, `app/public/favicon.svg` (the yellow ring with the red slash from the contract icon, in the new colours).
- The contract id comes from `VITE_CONTRACT` (in `app/.env.production`, committed; it is public).

## Acceptance

- `npm run build` clean, no TypeScript errors.
- Driven in headless Chrome at 390×844 and 1440×900, dark and light: every route renders with live data; the onboarding flow completes on testnet (join, buy, vault, migrate) and a raid, a shield and a boss raid succeed; `/d/:id` works in a fresh browser profile.
- No console errors. No horizontal scroll at 360 px.
