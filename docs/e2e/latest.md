# End-to-end run (testnet, fast season)

Contract `qday-fast-mw726yhglx.testnet` · 2026-11-08T00:53:59.145Z · **ALL PASS** · [Actions run](https://github.com/jenzylove/qday/actions/runs/42427087363)

| Check | Result | Transaction |
|---|---|---|
| alice buys from the market | Pass | [view](https://testnet.nearblocks.io/txns/3dwvg9wPrMBGis6pQGt31thsoke6wFqi1FpKBbAsP7JW) |
| bob buys from the market | Pass | [view](https://testnet.nearblocks.io/txns/EiTnWqAM6J7BZPjnSUV2Ai8PtWjnCWrw1W6bCqjwjqGe) |
| carol buys from the market | Pass | [view](https://testnet.nearblocks.io/txns/2L6c4MHUX9XkrvWUknFPTyW5MmdSRiC7psQaa5q2MsGc) |
| dave buys from the market | Pass | [view](https://testnet.nearblocks.io/txns/Ai1WMbC2RAgyCskwPePZEY1NqLxava5YKuEtryzLUTH3) |
| a normal wallet is an exposed holder | Pass |  |
| exposed wallet cannot raid (E_NOT_VAULT) | Pass | [view](https://testnet.nearblocks.io/txns/3HPj3wPunqkoCiuVCze3qckL5iFANBzoxyUxJ8YcQSUA) |
| alice's vault is born quantum-only and registered | Pass | [view](https://testnet.nearblocks.io/txns/HpmY6xWq5NjgFE1b8rrfiQVULs9jR7ndq8E3VgSoaSnw) |
| bob's vault is born quantum-only and registered | Pass | [view](https://testnet.nearblocks.io/txns/Ghc8f2obRohwZr18prYrhBJfroacJBkzq7RScthL2atG) |
| dave's vault is born quantum-only and registered | Pass | [view](https://testnet.nearblocks.io/txns/DkyyBnm59GRtWoGWyeEkS2bjkz5i5fwkLV43WbXSap8P) |
| alice migrates the whole bag into the vault | Pass | [view](https://testnet.nearblocks.io/txns/8536vy7g8sTdYbnoGv9EXuEwffxRoVcGJwScoVJyzte1) |
| bob migrates the whole bag into the vault | Pass | [view](https://testnet.nearblocks.io/txns/5nwKvG1Wo86jRAP7Ero1xwXiz3PipZmqon7mARPYuS9H) |
| vault raids an exposed wallet (signed with ML-DSA-65) | Pass | [view](https://testnet.nearblocks.io/txns/6HDqBCEVRZPs8wVDJLmBiYTgE7CTDJAQptzp5NhC4hJd) |
| anyone resolves it after the window; take = take_bps of the bag, capped at stake_mult x stake | Pass | [view](https://testnet.nearblocks.io/txns/jJtNptyRZqo8zma7VVZuobdV5ziEmHrE1XAX4K6ZFa3) |
| vault raids another vault | Pass | [view](https://testnet.nearblocks.io/txns/CTZinMkqG69aH1UcBxswNiZUnydeY4vKX3smwFReVj6c) |
| target defends in time and takes the stake (minus burn) | Pass | [view](https://testnet.nearblocks.io/txns/GN5Db7jcjWGqWqNgb7kvfykvNAn6muHUJ86zCssy3vgY) |
| vault raids a second exposed wallet | Pass | [view](https://testnet.nearblocks.io/txns/9H3PVaJZ6WeGgHLXxZ3wqGiGgRgYnBnejfjmvj9xAio2) |
| the target escapes by migrating during the window | Pass | [view](https://testnet.nearblocks.io/txns/GZ9FfK4hZ6v49CvhApq1aEkoHteX5CxKPGD6AKy7AFVo) |
| the escaped raid takes nothing | Pass | [view](https://testnet.nearblocks.io/txns/GvuBg4qgbMZBUQTCE6pKVKLqMrhdrM8M2SrzZCCraheh) |
| burning 4% of the bag buys a 20% shield | Pass | [view](https://testnet.nearblocks.io/txns/7JDx6xmdAJ2W9aWg5xhyXdczQ8pcVETPrREwxgL1MrNC) |
| boss raid takes from Satoshi's stash | Pass | [view](https://testnet.nearblocks.io/txns/AXKkzmZfoSMWEyv4GbTJKGvsF6cAn1jhPxpFJQSU6W6R) |
| only once per epoch (E_BOSS_DONE) | Pass | [view](https://testnet.nearblocks.io/txns/FXBj1kHwvJxcSLmsi5Ux5ZpqCdBEaLw9UhKir1pReS64) |
| a vault move signed with a classical key is refused (E_NOT_QUANTUM) | Pass | [view](https://testnet.nearblocks.io/txns/BNZcaHJDZgc6PKeskHtX6685a8Ke3r8rg44NiwHMEfrz) |
| tokens cannot leave a vault with a classical signature | Pass | [view](https://testnet.nearblocks.io/txns/Dp1vwW5LahwT1E8L9eoBofbWXwVm3oPKCFMddd8U4BXz) |
| the classical key is removed again; vault is quantum-only | Pass | [view](https://testnet.nearblocks.io/txns/Eb2FLNbTRufsfP1yrgQZ8Qc7WfLBXwAnWA2yfiVGSDMz) |
| harvest moves tokens from exposed wallets to vaults | Pass | [view](https://testnet.nearblocks.io/txns/6r9LseLgR7o9aQbmdibWnP5xmpkkfFpTTyFgxiNmA3co) |
| harvest gas is the same at 4 and 44 exposed holders | Pass | [view](https://testnet.nearblocks.io/txns/46WagqjuAEdXjK6FbbVd3myCw7gCySHJ39Fmf4boDxgb) |
| a vault sells to the market for NEAR (signed with ML-DSA-65) | Pass | [view](https://testnet.nearblocks.io/txns/FW1omnxhFVizNP8NtYtGdWQS8qKFxDEBUHTykxcDjDUP) |
| on-chain feed records the moves | Pass |  |
| after Q-Day an exposed bag cannot move (E_FROZEN) | Pass | [view](https://testnet.nearblocks.io/txns/8dKCWatTQQvTgwmdR5UWrSS2Qx7zyyRpToksGENJJFgM) |
| after Q-Day an exposed bag cannot sell (E_FROZEN) | Pass | [view](https://testnet.nearblocks.io/txns/BiTqrb7HSWuF2SXShPsZ1y8efhJi7ra9MTkG4PpQjzgd) |
| after Q-Day raids stop (E_QDAY_PASSED) | Pass | [view](https://testnet.nearblocks.io/txns/HqNPKVzch5sCiVc9BogBgXrkAuLfotFZv2T1kqRJssJ) |
| after Q-Day a vault still transfers (signed with ML-DSA-65) | Pass | [view](https://testnet.nearblocks.io/txns/7UApVnaL13SsxCtL6zb5muFCtdQmV36o9dVn5RQLiHvT) |
| finalize writes the season result on chain | Pass | [view](https://testnet.nearblocks.io/txns/ETYS1BRT5uuXTGweWRuNbT6uYpLbyNyX4Jok9EE7GrFP) |
