# Submission checklist

Ticked only from the live app and the public repo, never from intent.

## NEAR HACKATHON rules

- [ ] Public repo with a LICENSE
- [ ] All code written since 2026-10-19
- [ ] README a human and an AI judge can follow: "do X, see Y", five-minute fast path
- [ ] README lists libraries used; decide how to word the AI-assisted code line
- [ ] README names the owner's other project, and that project's README names Q-DAY
- [ ] No secrets anywhere in git history
- [ ] Hosted demo up until at least 2026-11-25
- [ ] Public X post: built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, demo video attached
- [ ] Submission form: tracks `memecoins`, `games`; NEAR mainnet payout account created by the owner
- [ ] Submitted before 2026-11-14 23:59 UTC

## Memecoins With Mechanics

- [ ] The meme does something: rules in the contract, not in a server
- [ ] Rules cannot change: contract has no keys, `config()` equals `sim/params.json`
- [ ] Supply mechanics visible live: burns, harvest, Satoshi's stash

## Games With Real Economies

- [ ] Real stakes: raids, defence, shields and the boss move real tokens
- [ ] Playable from a phone with no sign-up on testnet
- [ ] Defend link works opened cold

## Product claims

- [ ] A non-quantum move is refused on chain (transaction link)
- [ ] Every vault is quantum-only (live census on `/proof`)
- [ ] Contract equals simulation (golden tests in CI)
- [ ] Harvest gas is constant (recorded testnet run, docs/e2e)
