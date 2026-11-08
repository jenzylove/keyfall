import re

def edit(p, pairs):
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (p, a[:60])
        s = s.replace(a, b)
    open(p, 'w', encoding='utf8').write(s)

edit('src/pages/landing.ts', [
    ('<div class="vital"><span class="label">Held in quantum vaults</span><span class="val" id="v-share">·</span></div>',
     '<div class="vital"><span class="label">Held in quantum vaults</span><span class="stack"><span class="val" id="v-share">·</span><span class="label" id="v-share-npc"></span></span></div>'),
    ("NIST's draft plan disallows RSA, ECDSA and EdDSA keys after 2035. EdDSA is the ed25519 key most NEAR wallets use today.",
     "NIST's draft plan disallows RSA, ECDSA and EdDSA keys after 2035. NEAR's default ed25519 keys are EdDSA keys."),
    ('"Defends, and wins the raider\'s stake"', '"Defends, and wins the raider\'s stake, minus a burn"'),
    ('''        const vs = (await getVaults(0, 200)).sort(''', '''        const all = await getVaults(0, 200);
        const vaultTotal = all.reduce((a, v) => a + BigInt(v.balance), 0n);
        const npcTotal = all.filter((v) => isNpc(v.account)).reduce((a, v) => a + BigInt(v.balance), 0n);
        text(maybe("#v-share-npc", root), vaultTotal > 0n ? `${(Number((npcTotal * 10000n) / vaultTotal) / 100).toFixed(0)}% of that is the game's NPC bots` : "");
        const vs = [...all].sort('''),
])
edit('src/pages/play.ts', [
    ('${[0.5, 1, 2].map((n) => `<button type="button" data-n="${n}" aria-pressed="${n === buyNear}">${n} NEAR</button>`).join("")}',
     '${[0.5, 0.8, 1].map((n) => `<button type="button" data-n="${n}" aria-pressed="${n === buyNear}">${n} NEAR</button>`).join("")}'),
])
edit('src/pages/proof.ts', [
    ('"The rules crate the contract runs, simulated over 60 days. Pick a scenario and play it."',
     '"The rules crate the contract runs, simulated over a 14 day season and replayed in 60 seconds. Pick a scenario and play it."'),
])
print("ok")
