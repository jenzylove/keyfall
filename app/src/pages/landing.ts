import { CONTRACT, accountLink, fmtTokens, getConfig, getFeed, getStats, getVaults, keyList, txLink, type Params } from "../chain";
import { $, FAIL, REPO, esc, failIn, fmtDuration, isNpc, maybe, poll, sentence, short, syncClock, text } from "../ui/dom";
import { countTo, countdown, crawl } from "../ui/widgets";
import { Bleed } from "../ui/bleed";
import { PARAMS, fmtParam, pct, bigParam, numParam } from "../ui/params";
import { SOURCES, e2e, guardAccepted, guardRefused } from "../ui/evidence";

const ext = (href: string, label: string) => `<a href="${esc(href)}" target="_blank" rel="noopener">${label} ↗</a>`;

export function landing(root: HTMLElement) {
  const refused = guardRefused();
  const accepted = guardAccepted();
  const ranAt = e2e ? new Date(e2e.ran_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";

  root.innerHTML = `
  <section class="hero">
    <div class="wrap hero-grid">
      <div style="display:grid;gap:26px;align-content:start">
        <p class="eyebrow"><span class="dot"></span>Live on NEAR testnet · Season 1</p>
        <h1 class="display h1"><span>Migrate</span><span>before</span><span>Q-Day</span><span class="strike">or freeze.</span></h1>
        <div style="display:grid;gap:10px">
          <span class="label">Q-Day in</span>
          <div id="qday-cd" class="countdown"><span class="fail-inline">reading the chain…</span></div>
        </div>
        <div class="cta">
        <a class="btn" href="/play" data-link>Play now, no sign up <span class="arrow">→</span></a>
        <a href="#how" class="link-btn">How it works</a>
        </div>
        <p class="lede">Your wallet is exposed. Move your bag into a quantum vault before Q-Day, or watch it bleed every epoch and then freeze.</p>
      </div>
      <div class="hero-canvas" aria-label="Exposed bags on the ledge drip into the quantum vaults below">
        <canvas id="bleed"></canvas>
        <div class="canvas-legend">
          <span class="label"><span class="red">■</span> Exposed <span id="lg-e"></span></span>
          <span class="label"><span class="yel">■</span> In vaults <span id="lg-v"></span></span>
        </div>
      </div>
    </div>
    <div class="wrap" style="display:grid;gap:30px;margin-top:30px">
      <div class="vitals">
        <div class="vital"><span class="label">Held in quantum vaults</span><span class="stack"><span class="val" id="v-share">·</span><span class="label" id="v-share-npc"></span></span></div>
        <div class="vital"><span class="label">Satoshi's stash</span><span class="stack"><span class="val" id="v-sat">·</span><span class="meter" aria-hidden="true"><i id="v-sat-bar" style="width:0%"></i></span></span></div>
        <div class="vital"><span class="label">Raids so far</span><span class="val" id="v-raids">·</span></div>
      </div>
    </div>
  </section>

  <div id="crawl-slot"></div>

  <section class="band" id="threat">
    <div class="wrap">
      <div class="sec-head"><span class="sec-num">01</span><h2 class="display h2">The threat</h2></div>
      <div class="indent">
        <ul class="rows">
          <li style="display:grid;gap:8px">
            <span class="display h3">A key you show is a key they can break.</span>
            <span>Public keys revealed on chain stay visible. Once a large quantum computer exists, a revealed key could let someone derive the private key and sign new transactions. Citi calls exposed public keys the most immediate risk to blockchains.</span>
            <span class="tx">${ext(SOURCES.citiRisk, "Citi Institute, March 2026")}</span>
          </li>
          <li style="display:grid;gap:8px">
            <span class="display h3">A quarter to a third of all bitcoin.</span>
            <span>About a quarter to a third of all bitcoin sits at addresses with exposed public keys. BIP 361, a draft proposal, would sunset the old signatures.</span>
            <span class="tx">${ext(SOURCES.citiShare, "Citi Institute via SpazioCrypto")} · ${ext(SOURCES.glassnode, "Glassnode via Cointelegraph")} · ${ext(SOURCES.bip361, "BIP 361 draft")}</span>
          </li>
          <li style="display:grid;gap:8px">
            <span class="display h3">Classical keys have an end date.</span>
            <span>NIST's draft plan disallows RSA, ECDSA and EdDSA keys after 2035. NEAR's default ed25519 keys are EdDSA keys.</span>
            <span class="tx">${ext(SOURCES.nist8547, "NIST IR 8547 draft, November 2024")}</span>
          </li>
        </ul>
        <p class="display h3" style="max-width:20ch">Nobody moves a key until it costs them something. <span class="hl">Q-DAY makes it cost something.</span></p>
      </div>
    </div>
  </section>

  <section class="band" id="kinds">
    <div class="wrap">
      <div class="sec-head"><span class="sec-num">02</span><h2 class="display h2">Two kinds of holder</h2></div>
      <div class="versus">
        <div class="versus-head">
          <div><div class="display ex">Exposed</div><span class="label" id="n-exposed"></span></div>
          <div class="qv"><div class="display">Quantum vault</div><span class="label" id="n-vaults"></span></div>
        </div>
        ${[
          ["What it is", "Any normal NEAR wallet holding $QDAY", "A new account, <i>name</i>.contract, born with only an ML-DSA-65 key"],
          ["Every epoch", "Bleeds a share to the harvest", "Gets half of what the harvest took"],
          ["When raided", "Cannot defend. It can only run", "Defends, and wins the raider's stake, minus a burn"],
          ["Its moves", "None. It cannot raid, shield or hit Satoshi", "Raids, shields, hits Satoshi. Every move signed with the quantum key"],
          ["At Q-Day", "Frozen for good", "Keeps playing and trading"],
        ]
          .map(([k, a, b]) => `<div class="versus-row"><span class="label k">${k}</span><span class="ex">${a}</span><span class="qv">${b}</span></div>`)
          .join("")}
      </div>
    </div>
  </section>

  <section class="band" id="how">
    <div class="wrap">
      <div class="sec-head"><span class="sec-num">03</span><h2 class="display h2">How a season plays</h2></div>
      <div class="loop">
        <div class="loop-step"><div class="when">Every few minutes</div><ul>
          <li>Read the feed, pick a target, launch a raid.</li>
          <li>Got raided? You have <b id="c-window">·</b> to defend, or to escape into a vault.</li>
          <li>Share a defend link. Anyone holding the vault key can answer it.</li>
        </ul></div>
        <div class="loop-step"><div class="when">Every epoch, <span id="c-epoch">·</span></div><ul>
          <li>Charge your shield for the epoch.</li>
          <li>Hit Satoshi's stash once.</li>
          <li>The harvest takes <b id="c-harvest">·</b> of every exposed bag. Half burns, half goes to vaults.</li>
        </ul></div>
        <div class="loop-step"><div class="when">The season, <span id="c-season">·</span></div><ul>
          <li>Q-Day ends it. Every exposed bag freezes for good, Satoshi's too.</li>
          <li>Vaults keep everything and keep trading.</li>
          <li>Now: epoch <b id="c-now">·</b>.</li>
        </ul></div>
      </div>
    </div>
  </section>

  <section class="band" id="rules">
    <div class="wrap">
      <div class="sec-head"><span class="sec-num">04</span><h2 class="display h2">The rules can't change</h2></div>
      <div class="indent">
        <div class="vital" style="border-top:1px solid var(--line)"><span class="label">Contract keys, read live</span><span class="val" id="r-keys">·</span></div>
        <p class="lede">The contract was deployed and stripped of every access key in one transaction. Nobody can upgrade it, pause it or change a number. These are its rules, read live from <span class="mono">config()</span>.</p>
        <div class="params" id="r-params"><p class="dim">reading the chain…</p></div>
        <p><a class="link-btn" href="/proof" data-link>Check it yourself on the proof page →</a></p>
      </div>
    </div>
  </section>

  <section class="band" id="near">
    <div class="wrap">
      <div class="sec-head"><span class="sec-num">05</span><h2 class="display h2">Why NEAR</h2></div>
      <div class="indent">
        <p class="lede">On NEAR a quantum safe ML-DSA-65 key is an ordinary account key, live since protocol version 85. Every call tells the contract which key type signed it, so Q-DAY refuses any vault move that was not signed with one.</p>
        <div class="keybyte" aria-label="Signer key type byte">
          <div><b>0</b><span>ed25519, classical</span></div>
          <div><b>1</b><span>secp256k1, classical</span></div>
          <div class="on"><b>2</b><span>ML-DSA-65, quantum safe. The only key a vault move accepts.</span></div>
        </div>
        <p class="mono" style="margin:0">signer key type 2 = ML-DSA-65</p>
        <ul class="rows">
          ${refused?.hash ? `<li><span><span class="badmark">Refused</span> a vault move signed with a classical key, <span class="mono">E_NOT_QUANTUM</span></span><a class="tx nowrap" href="${txLink(refused.hash)}" target="_blank" rel="noopener">view on explorer ↗</a></li>` : ""}
          ${accepted?.hash ? `<li><span><span class="okmark">Accepted</span> the same kind of move signed with ML-DSA-65</span><a class="tx nowrap" href="${txLink(accepted.hash)}" target="_blank" rel="noopener">view on explorer ↗</a></li>` : ""}
        </ul>
        <p class="tx">From the recorded test run on testnet, ${esc(ranAt)}. Sources: ${ext(SOURCES.nearcore, "nearcore 2.13 release")} · ${ext(SOURCES.nep645, "NEP 645")} · ${ext(SOURCES.fips204, "NIST FIPS 204")}</p>
      </div>
    </div>
  </section>

  <section class="band" id="board">
    <div class="wrap">
      <div class="sec-head"><span class="sec-num">06</span><h2 class="display h2">Leaderboard</h2></div>
      <div class="indent"><ol class="board" id="board-list"><li><span></span><span class="dim">reading the chain…</span><span></span></li></ol></div>
    </div>
  </section>

  <section class="band" id="faq">
    <div class="wrap">
      <div class="sec-head"><span class="sec-num">FAQ</span><h2 class="display h2">Questions</h2></div>
      <div class="indent faq">
        ${[
          ["Is this real money?", "No. Q-DAY runs on NEAR testnet. Testnet NEAR is free and has no value, and the game gives you a funded testnet wallet when you press play."],
          ["What is Q-Day?", "The day a quantum computer can break the keys most wallets use today. Here it is a fixed date on the countdown. At Q-Day every exposed bag freezes for good."],
          ["What happens to my key?", "Both keys are made in your browser and never sent anywhere. The vault key is sealed on this device. Before the vault exists you save a recovery code. It is the only way to open the vault on another device."],
          ["Who are the NPCs?", `The game's own bots: Shor, Grover and eight Qubits. They are ordinary vaults bound by the same contract rules, and what they do is written in one public file, ${ext(`${REPO}/blob/main/app/npc/rules.mjs`, "rules.mjs")}.`],
          ["Can the rules change?", "No. The contract has no access keys, so nobody can upgrade it. Every rule is public in config(), and the proof page checks it against the simulation."],
          ["What is ML-DSA-65?", `A digital signature scheme from NIST's FIPS 204 standard, published in August 2024 and built to stay secure against large quantum computers. NEAR accepts it as an account key. ${ext(SOURCES.fips204, "FIPS 204")}`],
        ]
          .map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`)
          .join("")}
      </div>
    </div>
  </section>

  <footer class="foot">
    <div class="wrap">
      <p class="foot-big">Q<span>-</span>DAY</p>
      <div class="foot-grid">
        <div style="display:grid;gap:6px"><span>Built at NEAR HACKATHON</span><span class="dim">Also by the same team: Offmap</span></div>
        <div style="display:grid;gap:6px"><span class="dim">Contract</span><a class="break" href="${accountLink(CONTRACT)}" target="_blank" rel="noopener">${esc(CONTRACT)} ↗</a></div>
        <div style="display:grid;gap:6px"><a href="${REPO}" target="_blank" rel="noopener">GitHub ↗</a><span class="dim">MIT licence · testnet only · unaudited</span></div>
      </div>
    </div>
  </footer>`;

  const cr = crawl("Live feed");
  $("#crawl-slot", root).replaceWith(cr.el);
  const cd = countdown($("#qday-cd", root));
  const bleed = new Bleed($<HTMLCanvasElement>("#bleed", root), "season");
  let config: Params | null = null;

  const stops = [
    poll(async () => {
      try {
        const s = await getStats();
        syncClock(s.now_ms);
        cd.set(Number(s.q_day_ms));
        if (s.after_q_day && !root.dataset.over) {
          root.dataset.over = "1";
          const h1 = root.querySelector(".hero h1");
          if (h1) h1.innerHTML = `<span>Q-Day</span><span>has</span><span class="strike">come.</span>`;
          const lede = root.querySelector(".hero .lede");
          if (lede) lede.textContent = "Season 1 is over. Every exposed bag is frozen for good; vaults keep theirs. The result is written on chain.";
          const cta = root.querySelector(".hero .cta .btn") as HTMLAnchorElement | null;
          if (cta) { cta.href = "/proof"; cta.innerHTML = `See the season result <span class="arrow">→</span>`; }
          const lbl = root.querySelector(".hero .label");
          if (lbl) lbl.textContent = `Q-Day was ${new Date(Number(s.q_day_ms)).toUTCString().replace(/:\d\d GMT$/, " UTC")}`;
          const cdEl = root.querySelector("#qday-cd") as HTMLElement | null;
          if (cdEl) cdEl.style.display = "none";
        }
        countTo(maybe("#v-share", root), s.vault_share_bps / 100, (n) => `${n.toFixed(2)}%`);
        countTo(maybe("#v-sat", root), Number(BigInt(s.satoshi_tokens) / 10n ** 18n), (n) => Math.round(n).toLocaleString("en-US"));
        countTo(maybe("#v-raids", root), Number(s.raids), (n) => Math.round(n).toLocaleString("en-US"));
        const sat0 = config ? bigParam(config, "satoshi_supply") : 1_100_000n * 10n ** 18n;
        const bar = maybe("#v-sat-bar", root);
        if (bar) bar.style.width = `${Number((BigInt(s.satoshi_tokens) * 10000n) / sat0) / 100}%`;
        const e = Number(BigInt(s.exposed_tokens) / 10n ** 18n), v = Number(BigInt(s.vault_tokens) / 10n ** 18n);
        bleed.setSeason(e, v);
        text(maybe("#lg-e", root), fmtTokens(s.exposed_tokens));
        text(maybe("#lg-v", root), fmtTokens(s.vault_tokens));
        text(maybe("#n-exposed", root), `${Number(s.exposed_holders).toLocaleString("en-US")} exposed wallet${s.exposed_holders === "1" ? "" : "s"} now`);
        text(maybe("#n-vaults", root), `${Number(s.vaults).toLocaleString("en-US")} vault${s.vaults === "1" ? "" : "s"} now`);
        text(maybe("#c-now", root), `${Number(s.epoch) + 1}${config ? ` of ${numParam(config, "season_epochs")}` : ""}`);
      } catch {
        for (const id of ["#qday-cd", "#v-share", "#v-sat", "#v-raids", "#c-now"]) failIn(maybe(id, root));
      }
    }, 15000),
    poll(async () => {
      try {
        const f = await getFeed(20);
        cr.set(f.map((x) => sentence(x, [], true)));
      } catch {
        cr.set(null);
      }
    }, 15000),
    poll(async () => {
      try {
        config = config || (await getConfig());
        const c = config;
        text(maybe("#c-window", root), fmtDuration(numParam(c, "defend_window_ms")));
        text(maybe("#c-epoch", root), fmtDuration(numParam(c, "epoch_ms")));
        text(maybe("#c-harvest", root), pct(numParam(c, "harvest_bps")));
        text(maybe("#c-season", root), fmtDuration(numParam(c, "epoch_ms") * numParam(c, "season_epochs")));
        const pr = maybe("#r-params", root);
        if (pr && !pr.dataset.done) {
          pr.dataset.done = "1";
          pr.innerHTML = PARAMS.filter(([k]) => k in c)
            .map(([k, , m]) => `<div class="param"><span class="name">${k}</span><span class="val">${esc(fmtParam(k, c[k]))}</span><span class="meaning">${m}</span></div>`)
            .join("");
        }
      } catch {
        for (const id of ["#c-window", "#c-epoch", "#c-harvest", "#c-season"]) failIn(maybe(id, root));
        const pr = maybe("#r-params", root);
        if (pr && !pr.dataset.done) failIn(pr);
      }
      try {
        const keys = await keyList(CONTRACT);
        countTo(maybe("#r-keys", root), keys.length, (n) => String(Math.round(n)));
        if (keys.length === 0) text(maybe("#r-keys", root), "0");
      } catch {
        failIn(maybe("#r-keys", root));
      }
    }, 15000),
    poll(async () => {
      const el = maybe("#board-list", root);
      if (!el) return;
      try {
        const all = await getVaults(0, 200);
        const vaultTotal = all.reduce((a, v) => a + BigInt(v.balance), 0n);
        const npcTotal = all.filter((v) => isNpc(v.account)).reduce((a, v) => a + BigInt(v.balance), 0n);
        text(maybe("#v-share-npc", root), vaultTotal > 0n ? `${(Number((npcTotal * 10000n) / vaultTotal) / 100).toFixed(0)}% of that is the game's NPC bots` : "");
        const vs = [...all].sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : BigInt(b.balance) < BigInt(a.balance) ? -1 : 0)).slice(0, 10);
        el.innerHTML = vs.length
          ? vs.map((v, i) => `<li><span class="rank">${i + 1}</span><span class="who">${esc(short(v.account, 28))}${isNpc(v.account) ? '<span class="tag npc">NPC</span>' : ""}</span><span class="amt">${fmtTokens(v.balance)}</span></li>`).join("")
          : `<li><span></span><span class="dim">No vaults yet. The first one tops the board.</span><span></span></li>`;
      } catch {
        el.innerHTML = `<li><span></span><span class="fail-inline">${FAIL}</span><span></span></li>`;
      }
    }, 15000),
  ];

  return () => {
    stops.forEach((s) => s());
    cd.stop();
    bleed.destroy();
  };
}
