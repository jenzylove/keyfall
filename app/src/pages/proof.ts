import * as chain from "../chain";
import { CONTRACT, accountLink, txLink, type Holder } from "../chain";
import { $, $$, FAIL, REPO, esc, isNpc, maybe, reducedMotion, short } from "../ui/dom";
import { deploy, e2e, findCheck, guardAccepted, guardRefused, sim, simParams, simParamsFile, type SimPoint } from "../ui/evidence";
import { fmtParam } from "../ui/params";

/** Recorded step names, in the page's own words (no hyphenated prose; file and account names stay as they are). */
const prose = (t: string) => t.replace(/\bquantum-only\b/g, "quantum only").replace(/\bon-chain\b/g, "on chain");
const V = (state: "pass" | "fail" | "wait", label?: string) => `<span class="verdict ${state}">${label ?? (state === "pass" ? "Pass" : state === "fail" ? "Fail" : "Checking")}</span>`;
const tx = (h?: string, label = "view on explorer") => (h ? `<a class="tx nowrap" href="${txLink(h)}" target="_blank" rel="noopener">${label} ↗</a>` : "");

export function proof(root: HTMLElement) {
  const ran = e2e ? new Date(e2e.ran_at).toUTCString().replace(" GMT", " UTC") : "";
  const item = (n: number, id: string, title: string, sub: string) => `
    <li id="${id}"><div><span class="sec-num" style="font-size:18px">${String(n).padStart(2, "0")}</span><h3>${title}</h3><div class="v">${V("wait")}</div><p class="dim" style="font-size:13px;margin:12px 0 0">${sub}</p></div><div class="check-body"></div></li>`;

  root.innerHTML = `
    <section class="wrap page-title">
      <p class="eyebrow"><span class="dot safe"></span>Checked live in your browser</p>
      <h1 class="display h1" style="font-size:clamp(48px,12vw,140px)">Under the hood</h1>
      <p class="lede">How you can tell the game is fair. Every check below reads NEAR ${chain.NETWORK === "mainnet" ? "mainnet" : "testnet (the free practice arena)"} now, from this page, or shows a recorded run with its date and transaction links. Contract <a class="break" href="${accountLink(CONTRACT)}" target="_blank" rel="noopener">${esc(CONTRACT)} ↗</a></p>
    </section>
    ${chain.NETWORK === "mainnet" ? "" : `<section class="wrap mn-sec" id="mainnet" hidden>
      <h2 class="sec-h"><span>MN</span>The mainnet arena</h2>
      <p class="dim" style="font-size:13px;margin:0 0 14px">Read live from NEAR mainnet: the real money arena at <a class="break" href="https://nearblocks.io/address/${MAINNET_ID}" target="_blank" rel="noopener">${MAINNET_ID} ↗</a>.</p>
      <div class="calc" id="mn-calc"></div>
      <p class="tx" id="mn-foot"></p>
    </section>`}
    <section class="wrap" style="padding-bottom:80px"><ol class="checks">
      ${item(1, "p-keys", "No keys on the contract", "Read live: the contract's access key list. Empty means nobody can upgrade or change it.")}
      ${item(2, "p-config", "Rules equal the simulation", `Read live: config(), compared field by field with ${simParamsFile}, the file this season was deployed with, bundled with this page.`)}
      ${item(3, "p-census", "Vault census", "Read live: every vault and its key list. A quantum only vault has exactly one key, and it is ML-DSA-65.")}
      ${item(4, "p-guard", "The quantum guard", "Recorded run: the same kind of vault move, refused with a classical key and accepted with ML-DSA-65.")}
      ${item(5, "p-gas", "Harvest gas stays flat", "Recorded run: gas of harvest() at a small and a large number of exposed holders.")}
      ${item(6, "p-e2e", "End to end on testnet", `Recorded run on ${esc(e2e?.contract || "")}, ${esc(ran)}.`)}
      ${item(7, "p-sim", "A season in 60 seconds", "The rules crate the contract runs, simulated over a 14 day season and replayed in 60 seconds. Pick a scenario and play it.")}
      ${item(8, "p-deploy", "Deployment record", `From deployments/${chain.NETWORK === "mainnet" ? "mainnet" : "testnet-live"}.json, bundled with this page.`)}
    </ol></section>`;

  if (chain.NETWORK !== "mainnet" && chain.MAINNET_READY) void mainnetSection(root);
  const body = (id: string) => $(`#${id} .check-body`, root);
  const verdict = (id: string, state: "pass" | "fail" | "wait", label?: string) => ($(`#${id} .v`, root).innerHTML = V(state, label));
  let alive = true;

  // 1. keys
  (async () => {
    try {
      const keys = await chain.keyList(CONTRACT);
      verdict("p-keys", keys.length === 0 ? "pass" : "fail");
      body("p-keys").innerHTML = `<div class="calc"><div><span>Access keys on ${esc(CONTRACT)}</span><span class="big">${keys.length}</span></div></div>
        ${keys.map((k) => `<p class="badmark break">${esc(k.public_key)}</p>`).join("")}
        <p>${deploy ? `Deployed, initialised and stripped of every key in one transaction: ${tx(deploy.deploy_tx)}` : ""}</p>`;
    } catch {
      verdict("p-keys", "wait", "Unreachable");
      body("p-keys").innerHTML = `<p class="fail-inline">${FAIL}</p>`;
    }
  })();

  // 2. config
  (async () => {
    if (!simParams) { verdict("p-config", "fail", "No file"); return; }
    try {
      const c = await chain.getConfig();
      const keys = [...new Set([...Object.keys(simParams), ...Object.keys(c)])];
      let bad = 0;
      const rows = keys.map((k) => {
        const a = simParams![k], b = c[k];
        const same = a !== undefined && b !== undefined && String(a) === String(b);
        if (!same) bad++;
        return `<tr><td class="mono">${esc(k)}</td><td>${b === undefined ? "missing" : esc(fmtParam(k, b))}</td><td>${a === undefined ? "missing" : esc(fmtParam(k, a))}</td><td class="r">${same ? '<span class="okmark">same</span>' : '<span class="badmark">differs</span>'}</td></tr>`;
      });
      verdict("p-config", bad === 0 ? "pass" : "fail");
      body("p-config").innerHTML = `<p>${keys.length - bad} of ${keys.length} fields match.</p><div class="scroll-x"><table class="tbl"><thead><tr><th>Field</th><th>Live, config()</th><th>${simParamsFile}</th><th class="r">Match</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
    } catch {
      verdict("p-config", "wait", "Unreachable");
      body("p-config").innerHTML = `<p class="fail-inline">${FAIL}</p>`;
    }
  })();

  // 3. census
  (async () => {
    try {
      const vaults: Holder[] = [];
      for (let i = 0; ; i += 200) { const p = await chain.getVaults(i, 200); vaults.push(...p); if (p.length < 200) break; }
      const out: { v: Holder; keys: { public_key: string }[] | null }[] = [];
      let idx = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (idx < vaults.length) {
          const v = vaults[idx++];
          try { out.push({ v, keys: await chain.keyList(v.account) }); } catch { out.push({ v, keys: null }); }
        }
      }));
      if (!alive) return;
      const qOnly = (k: { public_key: string }[] | null) => !!k && k.length === 1 && k[0].public_key.startsWith("ml-dsa-65");
      const good = out.filter((o) => qOnly(o.keys)).length;
      const unread = out.filter((o) => !o.keys).length;
      const flagged = out.length - good - unread;
      verdict("p-census", vaults.length === 0 ? "wait" : flagged === 0 && unread === 0 ? "pass" : flagged ? "fail" : "wait", vaults.length === 0 ? "No vaults yet" : undefined);
      out.sort((a, b) => a.v.account.localeCompare(b.v.account));
      body("p-census").innerHTML = `
        <div class="calc"><div><span>Vaults</span><span class="big">${vaults.length}</span></div><div><span>Quantum only</span><span class="big">${good}</span></div><div><span>Added another key</span><span class="big${flagged ? " red" : ""}">${flagged}</span></div>${unread ? `<div><span class="red">Key list not readable right now</span><b>${unread}</b></div>` : ""}</div>
        ${out.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Vault</th><th>Keys</th><th class="r">Verdict</th></tr></thead><tbody>${out.map((o) => `<tr><td><a class="break" href="${accountLink(o.v.account)}" target="_blank" rel="noopener">${esc(short(o.v.account, 30))}</a>${isNpc(o.v.account) ? '<span class="tag npc">NPC</span>' : ""}</td><td>${o.keys ? o.keys.map((k) => esc(k.public_key.split(":")[0])).join(", ") : `<span class="fail-inline">${FAIL}</span>`}</td><td class="r">${!o.keys ? "" : qOnly(o.keys) ? '<span class="okmark">quantum only</span>' : '<span class="badmark">flagged</span>'}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
    } catch {
      verdict("p-census", "wait", "Unreachable");
      body("p-census").innerHTML = `<p class="fail-inline">${FAIL}</p>`;
    }
  })();

  // 4. guard
  {
    const r = guardRefused(), a = guardAccepted(), nv = findCheck(/E_NOT_VAULT/), out = findCheck(/cannot leave a vault/);
    const ok = !!(r?.pass && a?.pass);
    verdict("p-guard", r && a ? (ok ? "pass" : "fail") : "fail", r && a ? undefined : "Missing");
    const row = (c: typeof r, label: string) => (c ? `<li><span>${c.pass ? '<span class="okmark">as expected</span>' : '<span class="badmark">unexpected</span>'} ${label}</span>${tx(c.hash)}</li>` : "");
    body("p-guard").innerHTML = `<ul class="rows">
      ${row(r, "Refused: vault move signed with a classical key, <span class='mono'>E_NOT_QUANTUM</span>")}
      ${row(a, "Accepted: vault raid signed with ML-DSA-65")}
      ${row(out, "Refused: tokens leaving a vault with a classical signature")}
      ${row(nv, "Refused: an exposed wallet tried to raid, <span class='mono'>E_NOT_VAULT</span>")}
    </ul>${r?.add_tx ? `<p class="tx">The classical key was added to the vault for the test ${tx(String(r.add_tx), "here")} and removed again afterwards.</p>` : ""}`;
  }

  // 5. gas
  {
    const g = findCheck(/harvest gas/);
    verdict("p-gas", g?.pass ? "pass" : "fail", g ? undefined : "Missing");
    if (g) {
      const tg = (x: unknown) => `${(Number(x) / 1e12).toFixed(3)} Tgas`;
      const m = String(g.name).match(/(\d+) and (\d+)/);
      body("p-gas").innerHTML = `<div class="calc">
        <div><span>${m ? `${m[1]} exposed holders` : "Small"}</span><b>${tg(g.gas_small)}</b></div>
        <div><span>${m ? `${m[2]} exposed holders` : "Large"}</span><b>${tg(g.gas_large)}</b></div>
        <div><span>Difference</span><span class="big">${esc(String(g.diff_pct))}%</span></div></div>
        <p>${tx(String(g.first_tx || ""), "small run")} ${tx(g.hash, "large run")}</p>`;
    }
  }

  // 6. e2e
  if (e2e) {
    verdict("p-e2e", e2e.all_pass ? "pass" : "fail", e2e.all_pass ? `${e2e.checks.filter((c) => c.pass).length} of ${e2e.checks.length} pass` : undefined);
    body("p-e2e").innerHTML = `<div class="scroll-x"><table class="tbl"><thead><tr><th>Step</th><th class="r">Result</th><th class="r">Tx</th></tr></thead><tbody>
      ${e2e.checks.map((c) => `<tr><td>${esc(prose(c.name))}</td><td class="r">${c.pass ? '<span class="okmark">pass</span>' : '<span class="badmark">fail</span>'}</td><td class="r">${c.hash ? `<a class="tx" href="${txLink(c.hash)}" target="_blank" rel="noopener">${esc(c.hash.slice(0, 6))}…↗</a>` : ""}</td></tr>`).join("")}
    </tbody></table></div><p class="tx">Script: <a href="${REPO}/tree/main/scripts" target="_blank" rel="noopener">scripts ↗</a></p>`;
  } else verdict("p-e2e", "fail", "No file");

  // 7. fast forward
  const stopSim = simulation(body("p-sim"), (ok) => verdict("p-sim", ok ? "pass" : "fail", ok ? "Replay" : "No file"));

  // 8. deploy
  if (deploy) {
    verdict("p-deploy", deploy.keyless && deploy.config_matches_params ? "pass" : "fail", "Recorded");
    body("p-deploy").innerHTML = `<ul class="rows">
      <li><span class="k">Contract</span><a class="v break" href="${accountLink(deploy.contract)}" target="_blank" rel="noopener">${esc(deploy.contract)} ↗</a></li>
      <li><span class="k">Deploy transaction</span>${tx(deploy.deploy_tx, esc(deploy.deploy_tx.slice(0, 10) + "…"))}</li>
      <li><span class="k">Deployed</span><span class="v">${esc(new Date(deploy.deployed_at).toUTCString().replace(" GMT", " UTC"))}</span></li>
      <li><span class="k">Q-Day</span><span class="v">${esc(new Date(deploy.q_day_ms).toUTCString().replace(" GMT", " UTC"))}</span></li>
      <li style="display:grid;gap:6px"><span class="k">wasm sha256, ${deploy.wasm_bytes.toLocaleString("en-US")} bytes</span><span class="mono break" style="font-size:12px">${esc(deploy.wasm_sha256)}</span></li>
    </ul>
    <p>Rebuild it: clone <a href="${REPO}" target="_blank" rel="noopener">the repo ↗</a>, build the contract wasm, and compare the sha256 above. Then run <span class="mono">node scripts/judge-checks.mjs</span> to repeat checks 1 to 3 from a public RPC.</p>`;
  } else verdict("p-deploy", "fail", "No file");

  return () => { alive = false; stopSim(); };
}

// ------------------------------------------------------------------ the mainnet arena, read from mainnet

const MAINNET_ID = String(import.meta.env.VITE_CONTRACT_MAINNET || "keyfall.near");
const MAINNET_DEPLOY = Object.values(import.meta.glob("../../../deployments/mainnet.json", { eager: true, import: "default" }))[0] as { deploy_tx?: string; deployed_at?: string; keyless?: boolean } | undefined;
async function mainnetRpc(method: string, params: object): Promise<any> {
  for (const url of ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"]) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await r.json();
      if (j?.result && !j.result.error) return j.result;
    } catch { /* next node */ }
  }
  throw new Error("mainnet unreachable");
}
const mainnetView = async (method: string, args: object = {}) => {
  const r = await mainnetRpc("query", { request_type: "call_function", finality: "final", account_id: MAINNET_ID, method_name: method, args_base64: btoa(JSON.stringify(args)) });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result)));
};
/** On the practice page, a short live read of the mainnet contract: its keys, its vaults, its Q-Day. Hidden if mainnet does not answer. */
async function mainnetSection(root: HTMLElement) {
  try {
    const [keys, stats] = await Promise.all([
      mainnetRpc("query", { request_type: "view_access_key_list", finality: "final", account_id: MAINNET_ID }),
      mainnetView("stats"),
    ]);
    const sec = maybe("#mainnet", root);
    if (!sec) return;
    const n = (keys?.keys || []).length;
    const qd = new Date(Number(stats.q_day_ms));
    $("#mn-calc", sec).innerHTML = `<div><span>Access keys on ${esc(MAINNET_ID)}</span><span class="big${n ? " red" : ""}">${n}</span></div><div><span>Vaults</span><span class="big">${esc(String(stats.vaults))}</span></div><div><span>Players holding coins</span><span class="big">${esc(String(Number(stats.vaults) + Number(stats.exposed_holders)))}</span></div><div><span>Q-Day</span><b>${esc(qd.toUTCString().replace(" GMT", " UTC"))}</b></div>`;
    $("#mn-foot", sec).innerHTML = `${n === 0 ? "No keys: nobody can change the mainnet contract." : "The mainnet contract still has keys."}${MAINNET_DEPLOY?.deploy_tx ? ` Deployed with no keys in one transaction: <a class="tx nowrap" href="https://nearblocks.io/txns/${esc(MAINNET_DEPLOY.deploy_tx)}" target="_blank" rel="noopener">see it ↗</a>` : ""}`;
    sec.hidden = false;
  } catch { /* mainnet not reachable from here: the section stays hidden */ }
}

// ------------------------------------------------------------------ simulation replay

function simulation(host: HTMLElement, done: (ok: boolean) => void): () => void {
  if (!sim) { done(false); host.innerHTML = `<p class="fail-inline">The simulation report is missing from this build.</p>`; return () => {}; }
  done(true);
  const names = Object.keys(sim.series);
  let scen = names.includes("base") ? "base" : names[0];
  const metrics: { key: string; label: string; cls: string; fmt: (n: number) => string; get: (s: SimPoint[], i: number) => number }[] = [
    { key: "vaults", label: "Share held in vaults", cls: "y", fmt: (n) => `${n.toFixed(1)}%`, get: (s, i) => s[i].pct_holdings_in_vaults },
    { key: "satoshi", label: "Satoshi's stash", cls: "r", fmt: (n) => Math.round(n).toLocaleString("en-US"), get: (s, i) => s[i].satoshi_tokens },
    { key: "burned", label: "Burned", cls: "", fmt: (n) => Math.round(n).toLocaleString("en-US"), get: (s, i) => s[i].burned_tokens },
    { key: "raids", label: "Raids opened, total", cls: "", fmt: (n) => Math.round(n).toLocaleString("en-US"), get: (s, i) => s.slice(0, i + 1).reduce((a, p) => a + p.raids_opened, 0) },
  ];
  host.innerHTML = `
    <div class="ff">
      <div class="seg" role="group" aria-label="Scenario">${names.map((n) => `<button type="button" data-s="${n}" aria-pressed="${n === scen}">${n.replace(/_/g, " ")}</button>`).join("")}</div>
      <div class="ff-controls"><button class="btn small" id="ff-play">Pause</button><span class="label">Epoch</span><span class="ff-epoch" id="ff-ep">0</span><span class="dim" id="ff-of"></span></div>
      <div class="charts">${metrics.map((m) => `<div class="chart" data-m="${m.key}"><div class="ch-head"><span class="label">${m.label}</span><span class="ch-val">·</span></div><svg viewBox="0 0 300 110" preserveAspectRatio="none" role="img" aria-label="${m.label} over the season"></svg></div>`).join("")}</div>
      <p class="tx">Source: sim/out/report.json, ${sim.season.season_epochs} epochs of ${sim.season.epoch_hours} hours, averaged over ${sim.season.seeds.length} seeds. Hover or drag across a chart to scrub.</p>
    </div>`;
  const ep = $("#ff-ep", host);
  const playBtn = $<HTMLButtonElement>("#ff-play", host);
  let t = 0; // epochs, fractional
  let playing = !reducedMotion();
  let raf = 0;
  let last = performance.now();
  const total = () => sim!.series[scen].length - 1;
  const SPEED = 56 / 60; // a season in 60 seconds

  const draw = () => {
    const s = sim!.series[scen];
    const n = s.length - 1;
    const i = Math.max(0, Math.min(n, Math.floor(t)));
    ep.textContent = String(i);
    $("#ff-of", host).textContent = `of ${n}`;
    for (const m of metrics) {
      const box = maybe(`.chart[data-m="${m.key}"]`, host)!;
      const vals = s.map((_, k) => m.get(s, k));
      const max = Math.max(...vals, 1e-9);
      const X = (k: number) => (k / n) * 300;
      const Y = (v: number) => 104 - (v / max) * 96;
      const pts = vals.map((v, k) => `${X(k).toFixed(1)},${Y(v).toFixed(1)}`);
      const svg = box.querySelector("svg")!;
      svg.innerHTML = `<line class="grid" x1="0" x2="300" y1="104" y2="104"/><line class="grid" x1="0" x2="300" y1="8" y2="8" stroke-dasharray="2 4"/>
        <polyline class="ghost" points="${pts.join(" ")}" vector-effect="non-scaling-stroke"/>
        <polyline class="ln ${m.cls}" points="${pts.slice(0, i + 1).join(" ")}" vector-effect="non-scaling-stroke"/>
        <line class="xh" x1="${X(i)}" x2="${X(i)}" y1="4" y2="104" vector-effect="non-scaling-stroke"/>`;
      box.querySelector(".ch-val")!.textContent = m.fmt(vals[i]);
    }
  };
  const loop = (now: number) => {
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    if (playing) {
      const prev = Math.floor(t);
      t += dt * SPEED;
      if (t > total()) t = 0;
      if (Math.floor(t) !== prev) draw();
    }
    raf = requestAnimationFrame(loop);
  };
  playBtn.textContent = playing ? "Pause" : "Play";
  playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? "Pause" : "Play"; last = performance.now(); };
  for (const b of $$<HTMLButtonElement>(".seg button", host))
    b.onclick = () => {
      scen = b.dataset.s!;
      for (const x of $$<HTMLButtonElement>(".seg button", host)) x.setAttribute("aria-pressed", String(x === b));
      t = 0; draw();
    };
  for (const svg of $$<SVGElement>(".chart svg", host)) {
    const scrub = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      t = Math.max(0, Math.min(total(), ((e.clientX - r.left) / r.width) * total()));
      playing = false; playBtn.textContent = "Play";
      draw();
    };
    svg.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || e.buttons) scrub(e); });
    svg.addEventListener("pointerdown", scrub);
  }
  if (!playing) t = total();
  draw();
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}


