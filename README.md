# Q-DAY

A memecoin you play: raid other holders, defend your own bag, and survive Q-Day. The only weapon and the only shield is a quantum-safe key, and only NEAR has those live.

Built at NEAR HACKATHON (Nov 2026). Tracks: Memecoins With Mechanics, Games With Real Economies.

**Status: spike stage.** Nothing below the spikes is built yet.

## Spike S1: can a contract tell a quantum-safe signer?

`spikes/s1` deploys a small contract to NEAR testnet and checks, with real transactions:

1. A transaction signed with an ed25519 key is seen as key type 0.
2. A transaction signed with an ML-DSA-65 key is seen as key type 2.
3. A method that requires a quantum-safe signer refuses ed25519 and accepts ML-DSA-65.
4. The same holds through a meta transaction.
5. The contract can create a player account born with only an ML-DSA-65 key, and that account can sign its own transactions.

Run it yourself (needs Rust with the wasm32 target, cargo-near and Node 20.19+):

```sh
cd spikes/s1/contract && cargo near build non-reproducible-wasm --no-abi
cd ../script && npm install
node run.mjs ../contract/target/near/qday_spike_s1.wasm ./out
```

Or open the `spike-s1` workflow in GitHub Actions: every run prints the results table with links to each testnet transaction.

## License

MIT
