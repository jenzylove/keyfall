# End-to-end run (testnet, fast season)

Contract `qday-fast-mw6v53dy3fp.testnet` · 2026-11-07T20:44:08.218Z · **ALL PASS**

| Check | Result | Transaction |
|---|---|---|
| alice buys from the market | Pass | [view](https://testnet.nearblocks.io/txns/728SJ7bXVq6oT92xapzovvqwCbpeRZ49fZbhyAX3QfQN) |
| bob buys from the market | Pass | [view](https://testnet.nearblocks.io/txns/8LSyw5cmb4fQVXbSS6Awak8f3nnNXmHSotvjTHva9cS5) |
| carol buys from the market | Pass | [view](https://testnet.nearblocks.io/txns/H8USKhrzRa6RsH2LotszHadtFsAsEmQfKSsPSJ8FwA64) |
| dave buys from the market | Pass | [view](https://testnet.nearblocks.io/txns/52KpoMrEznTc1DW2eAgBzaWa7ez7JvgKPDo8f5DGDP3L) |
| a normal wallet is an exposed holder | Pass |  |
| exposed wallet cannot raid (E_NOT_VAULT) | Pass | [view](https://testnet.nearblocks.io/txns/23KhKPBfYMvLgFDtuSJzEnaC899QMiREcBcKzKZpYYys) |
| alice's vault is born quantum-only and registered | Pass | [view](https://testnet.nearblocks.io/txns/CCwubXdDJuUCTu8w1Pc5ieB38gYdVcYDtN3ooQFRgRmE) |
| bob's vault is born quantum-only and registered | Pass | [view](https://testnet.nearblocks.io/txns/5bHSCfkhzk7ncEM7Uxp1PA392UCneSxZwYY5FpfW81xu) |
| dave's vault is born quantum-only and registered | Pass | [view](https://testnet.nearblocks.io/txns/FUbEsQJ2iyfNQpBu4CsWPJNczUPLTxq3kwcgQ34GHqm1) |
| alice migrates the whole bag into the vault | Pass | [view](https://testnet.nearblocks.io/txns/7K3m45uHFbvifW2NHsPJ3EonHXhsEgadpuSPRjVtecg9) |
| bob migrates the whole bag into the vault | Pass | [view](https://testnet.nearblocks.io/txns/9DBzp5TRy6YS6Jbd4EEBS9oxQr9Hese8HvfKcpzCZSvA) |
| vault raids an exposed wallet (signed with ML-DSA-65) | Pass | [view](https://testnet.nearblocks.io/txns/BGKWPjDDkm1N4ZDjUYQBw2oZFJQZHudENy6UtgBmPEuK) |
| anyone resolves it after the window; take = take_bps of the bag | Pass | [view](https://testnet.nearblocks.io/txns/7fwUAPDemgcyHTZwyS3Y4WHLXRSe8BzVNYQL5Sa6GMzv) |
| vault raids another vault | Pass | [view](https://testnet.nearblocks.io/txns/4ktEDFiPrfKRHMELF3zUC9cR5NiDNGjqibtPioU7qFYn) |
| target defends in time and takes the stake (minus burn) | Pass | [view](https://testnet.nearblocks.io/txns/sR47ipT3CUj3oDRQxjoqqx8bCFmMiDgXjNMksaqkiSh) |
| vault raids a second exposed wallet | Pass | [view](https://testnet.nearblocks.io/txns/CNr1VBvDnAf71NqwxcET5vRwFqscHjZqu9fg9PXSyKKX) |
| the target escapes by migrating during the window | Pass | [view](https://testnet.nearblocks.io/txns/BNUAHEL6hVDs14jint7ubgSbKRTgtVdBenWQv7hAzJy5) |
| the escaped raid takes nothing | Pass | [view](https://testnet.nearblocks.io/txns/BpeEpzNA97QxZu6LrjGfkYXwq2fWD6oQnKfNUZj31mJS) |
| burning 4% of the bag buys a 20% shield | Pass | [view](https://testnet.nearblocks.io/txns/HMDot6xLm6F7ci2DFc4uy6nLXyNMwDuEdoUXim35t14t) |
| boss raid takes from Satoshi's stash | Pass | [view](https://testnet.nearblocks.io/txns/2MycF314VWBfUvMTtctvWK6sg3Avrkhg9v13Srq52mni) |
| only once per epoch (E_BOSS_DONE) | Pass | [view](https://testnet.nearblocks.io/txns/3HrgFurpNe6RsEwZVGx3ZwqHhydmJ11nSa1wM8fbTviN) |
| a vault move signed with a classical key is refused (E_NOT_QUANTUM) | Pass | [view](https://testnet.nearblocks.io/txns/8BR2aEvVKXYn9AWy4VsYoZVXb4sjQNRoPM4KBuwaevqP) |
| tokens cannot leave a vault with a classical signature | Pass | [view](https://testnet.nearblocks.io/txns/HdX3DVoZGfdh9YTPTDfRMHzmNBLadeaV32TEXY1gt6eX) |
| the classical key is removed again; vault is quantum-only | Pass | [view](https://testnet.nearblocks.io/txns/3Z559mRYfXuADKKKb9PZzsceYMysp7f1QjZVyphMkKSC) |
| harvest moves tokens from exposed wallets to vaults | Pass | [view](https://testnet.nearblocks.io/txns/4NQd9smKMBmTRFJREaoXzxTqMTJaFWXTA4mxWotV86ec) |
| harvest gas is the same at 6 and 46 exposed holders | Pass | [view](https://testnet.nearblocks.io/txns/AcS9R7nnvRyxXSEFwtCcoYmyLKopFuLQbnA3sEZPJcK1) |
| a vault sells to the market for NEAR (signed with ML-DSA-65) | Pass | [view](https://testnet.nearblocks.io/txns/2KJmuUJCZVVGBd1wXex6M2Q1ZjjT5Uh31FsUMTxLDW1G) |
| on-chain feed records the moves | Pass |  |
