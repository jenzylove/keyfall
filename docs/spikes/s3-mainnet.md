# S3: ML-DSA-65 keys on NEAR mainnet (Nov 9 2026)

Question: does an account whose only key is ML-DSA-65 work on mainnet, before we lock a keyless contract that creates such accounts?

1. `keyfall.near` created `pq.keyfall.near` with 0.05 NEAR and only an ML-DSA-65 full access key: https://nearblocks.io/txns/BnbF27ptyh5E5snnfbbEm5UkWYCUCD8QKgmRGrwRt2Sc . Its key list shows one `ml-dsa-65-hash:` handle.
2. `pq.keyfall.near` deleted itself (beneficiary `keyfall.near`) in a transaction signed with that ML-DSA-65 key: https://nearblocks.io/txns/83wJmtvWFpS1EVYjZZxc7sPw2bQ2unrEtorobC2a5hxS (status success). Repeated once: create GtPYHG4Y…, delete AoHxcnVZ… .

Verdict: **pass**. Mainnet (protocol 88) accepts ML-DSA-65 signed transactions. The contract was then deployed keyless: https://nearblocks.io/txns/CVAtSwnxxq1pxwkV22EtsUPDLQA3GFH4bA61nsS3Eeh7 (`deployments/mainnet.json`).

Note: the script's send helper retried after a slow response, so the second delete attempt reported `AccountDoesNotExist` after the first had already succeeded.
