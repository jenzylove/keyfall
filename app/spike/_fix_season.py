def edit(p, pairs):
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w', encoding='utf8').write(s)

# /play: season over panel
edit('src/pages/play.ts', [
    ('''    const st = step();
    const m = st ? `onb${st}` : "game";
    if (m !== mode) {
      mode = m;
      $("#onb", root).innerHTML = "";
      $("#game", root).innerHTML = "";
      if (st) buildOnboarding(st);
      else buildGame();
    }''',
     '''    const over = Boolean(w.stats?.after_q_day);
    const st = step();
    const m = over ? (st ? "over" : "over-game") : st ? `onb${st}` : "game";
    if (m !== mode) {
      mode = m;
      $("#onb", root).innerHTML = "";
      $("#game", root).innerHTML = "";
      if (over) $("#onb", root).innerHTML = `<span class="count">Season 1 is over</span><h2 class="display h2">Q-Day has come.</h2>
        <p class="lede">Every exposed bag is frozen for good. Raids, the harvest and Satoshi have stopped. Vaults keep their tokens and can still trade and transfer.</p>
        <p class="lede"><a href="/proof" data-link>See the season result and every check →</a></p>`;
      if (st && over) return;
      if (st) buildOnboarding(st);
      else buildGame();
    }'''),
])

# landing: hero after Q-Day
edit('src/pages/landing.ts', [
    ('''        cd.set(Number(s.q_day_ms));''',
     '''        cd.set(Number(s.q_day_ms));
        if (s.after_q_day && !root.dataset.over) {
          root.dataset.over = "1";
          const h1 = root.querySelector(".hero h1");
          if (h1) h1.innerHTML = `<span>Q-Day</span><span>has</span><span class="strike">come.</span>`;
          const lede = root.querySelector(".hero .lede");
          if (lede) lede.textContent = "Season 1 is over. Every exposed bag is frozen for good; vaults keep theirs. The result is written on chain.";
          const cta = root.querySelector(".hero .cta .btn") as HTMLAnchorElement | null;
          if (cta) { cta.href = "/proof"; cta.innerHTML = `See the season result <span class="arrow">→</span>`; }
          const lbl = root.querySelector(".hero .label");
          if (lbl) lbl.textContent = "Q-Day was";
        }'''),
])

# crank: finalize once after Q-Day
edit('npc/tick.mjs', [
    ('''  const planned = decide({''', '''  // After Q-Day, write the season result on chain once (permissionless finalize).
  const season = stats.after_q_day ? await view("season").catch(() => null) : null;
  const plannedExtra = stats.after_q_day && !season ? [{ npc: "*", action: "finalize", reason: "Q-Day has passed and the season result is not written yet." }] : [];

  const planned = [...plannedExtra, ...decide({'''),
    ('''contract, fuel });''', '''contract, fuel })];'''),
])
s = open('npc/tick.mjs', encoding='utf8').read()
assert 'methodName, args' in s
s = s.replace('''const r = await sendCall({ network, signerId: `${who}.${contract}`, signer: signerFor(who), contract, methodName, args });''',
              '''const r = await sendCall({ network, signerId: `${who}.${contract}`, signer: signerFor(who), contract, methodName, args, gas: m.action === "finalize" ? 250 : 100 });''')
s = s.replace('''async function sendCall({ network, signerId, signer, contract, methodName, args }) {''', '''async function sendCall({ network, signerId, signer, contract, methodName, args, gas = 100 }) {''')
s = s.replace('''actions: [near.actions.functionCall({ methodName, args, gas: TGAS(100), deposit: "0" })],''', '''actions: [near.actions.functionCall({ methodName, args, gas: TGAS(gas), deposit: "0" })],''')
open('npc/tick.mjs', 'w', encoding='utf8').write(s)
print("ok")
