# End-to-end run (testnet, fast season)

Contract `qday-fast-mwakr7y77m5.testnet` · code_hash `AjPVqvBoTAoUUXZLXZ7a3MWNUm1aR26aXgZtWGTHFkh4` · 2026-11-10T11:57:33.379Z · **ALL PASS**

| Check | Result | Transaction |
|---|---|---|
| alice buys from the market | Pass | [view](https://testnet.nearblocks.io/txns/BkAnMNr7iJxkuva45vkKj96Q3Dh9XxB6yx2V4UoAR5qW) |
| bob buys from the market | Pass | [view](https://testnet.nearblocks.io/txns/Ar7LjDqmdw9TMgkEepXtXky4NtMmohRmZpgpwjYMY1np) |
| carol buys from the market | Pass | [view](https://testnet.nearblocks.io/txns/56kUBKnxD1kFM1pkretWgUAUHs2b7S5wRSk5Bodna42a) |
| dave buys from the market | Pass | [view](https://testnet.nearblocks.io/txns/5Gb6MCafNBZwZsAfKXxze2q1Xb1ri9CBrqMZxmDjUn8B) |
| a normal wallet is an exposed holder | Pass |  |
| exposed wallet cannot raid (E_NOT_VAULT) | Pass | [view](https://testnet.nearblocks.io/txns/FXD2HRBcx3KZ5ztxV17LQvAQB5pWpUAck9FTQYAq4x3V) |
| alice's vault is born quantum-only and registered | Pass | [view](https://testnet.nearblocks.io/txns/3Dbg3pjTdScMd59xhPd2KfMYKRDK6vsUgQY8NYVRNxcC) |
| bob's vault is born quantum-only and registered | Pass | [view](https://testnet.nearblocks.io/txns/BDDCSgb6yJTn1CrQNYRUnsEJMCcCVBTQk1FK1Qkk762v) |
| dave's vault is born quantum-only and registered | Pass | [view](https://testnet.nearblocks.io/txns/8tGX72sJWx3VyJVQ9CwoqJwb9qdpHuhXnZyywrRqkpQh) |
| alice migrates the whole bag into the vault | Pass | [view](https://testnet.nearblocks.io/txns/GRoRCgikjoFQVzT7XQPUKuP1V3sPa2djj2Avjjp5u1Zr) |
| bob migrates the whole bag into the vault | Pass | [view](https://testnet.nearblocks.io/txns/oPXR6vQ72AmyKL9P3HSQr7MSAe6ESAgSdUavURj79ze) |
| vault raids an exposed wallet (signed with ML-DSA-65) | Pass | [view](https://testnet.nearblocks.io/txns/8V4sPx7jmWonAkrEpUrs7qt6VWzqayaG6WHPsLEzAY11) |
| anyone resolves it after the window; take = take_bps of the bag, capped at stake_mult x stake | Pass | [view](https://testnet.nearblocks.io/txns/oRR2XAT26h46fQVq2z4Si2DpXGonkNCUxoh6kYWx5Zd) |
| vault raids another vault | Pass | [view](https://testnet.nearblocks.io/txns/2TuzB9kCWC8jURsJsYamnMEpn6w9n2hgNjWfT12ywBs2) |
| target defends in time and takes the stake (minus burn) | Pass | [view](https://testnet.nearblocks.io/txns/FGLhBc4ikp1T1fyEPtTytgqbQtLUtquMxMN4WuU2yvem) |
| vault raids a second exposed wallet | Pass | [view](https://testnet.nearblocks.io/txns/EinQHTZYAN7aEZCALQe9aFyvJbWNTxf4cjDMPbcpxkhb) |
| the target escapes by migrating during the window | Pass | [view](https://testnet.nearblocks.io/txns/8RJRkbw6c9iDkX1U9k2PgRKP6b7i18gpjpm6hKApbp6e) |
| the escaped raid takes nothing | Pass | [view](https://testnet.nearblocks.io/txns/AnSjd5Q661EdMr1NWKWKiUw7JCNoGr1kjTgoNiWF9WD1) |
| burning 4% of the bag buys a 20% shield | Pass | [view](https://testnet.nearblocks.io/txns/6fFqt9h9ZeUfsgBEtHGFgGPdbe5VgCnQkW7dV7mQu87P) |
| boss raid takes from Satoshi's stash | Pass | [view](https://testnet.nearblocks.io/txns/9qEtqDpA56hhsTuiLh9X22aZ7A9MCjZ4c89hj7g7887n) |
| only once per epoch (E_BOSS_DONE) | Pass | [view](https://testnet.nearblocks.io/txns/6h5LPdHsUut7ZjEGRYEEekAWRNCJXsaPkMEgvtHGxDTW) |
| a vault move signed with a classical key is refused (E_NOT_QUANTUM) | Pass | [view](https://testnet.nearblocks.io/txns/39Rj5RWTEhZ1EEf3PBQRrsZM6yFckYzSBF1qz7AAvYAR) |
| tokens cannot leave a vault with a classical signature | Pass | [view](https://testnet.nearblocks.io/txns/8Es2nkDQn4VnXgi8VdDQLyao9bVLGRs8GpKbdNu1Dgk5) |
| the classical key is removed again; vault is quantum-only | Pass | [view](https://testnet.nearblocks.io/txns/FEBUgGxGRJQLMpd2Aw1Q3vV1mDUnd1ToCRGrbvDjKbYh) |
| harvest moves tokens from exposed wallets to vaults | Pass | [view](https://testnet.nearblocks.io/txns/FMNwV6j88U2PE3JwSDo1SZwwwzTwgYsHYyEyxJNk1SqS) |
| harvest gas is the same at 4 and 44 exposed holders | Pass | [view](https://testnet.nearblocks.io/txns/CbjrSrFnxFsXBQ3zKfEGbkrBPkc1GCRUJY1jYWAMkp3a) |
| a vault sells to the market for NEAR (signed with ML-DSA-65) | Pass | [view](https://testnet.nearblocks.io/txns/F8KDPpxL2wwg6WiQrw4e2ar1FNjoRMBv85Jdqz5aZJx) |
| on-chain feed records the moves | Pass |  |
| after Q-Day an exposed bag cannot move (E_FROZEN) | Pass | [view](https://testnet.nearblocks.io/txns/8MpgM91PpkHdxrdv2xEmhacF1gjB4P1pBqcpBxd3wSmr) |
| after Q-Day an exposed bag cannot sell (E_FROZEN) | Pass | [view](https://testnet.nearblocks.io/txns/27H6YUA4XaKnYMwKbtp8qHZGoyLzZPqPR7FNvHFa81Z5) |
| after Q-Day raids stop (E_QDAY_PASSED) | Pass | [view](https://testnet.nearblocks.io/txns/8mWh7r8jNZPdXHhYzAkLziUbKJ4M2TRwo7x4i58AfAew) |
| after Q-Day a vault still transfers (signed with ML-DSA-65) | Pass | [view](https://testnet.nearblocks.io/txns/6hdGRgSdTxXh2Bmxfdo7fJJY3pmNLSkKceY7HA1pE7Tw) |
| finalize writes the season result on chain | Pass | [view](https://testnet.nearblocks.io/txns/2L8UyC25JzwnNmW4wBpBY4gWAWcntqKiKhh942UKFEog) |
