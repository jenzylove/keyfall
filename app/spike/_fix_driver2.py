p = 'spike/judge-path.mjs'
s = open(p, encoding='utf8').read()
s = s.replace('t = await waitText((s) => /Hit Satoshi|Charge shield/i.test(s), 90000);',
              't = await p.waitForSelector("#bs-go", { visible: true, timeout: 150000 }).catch(() => null);')
tail = '''
// Outcome of the greeting raid, read from the chain (not the page).
const RPC = "https://rpc.testnet.near.org";
const CONTRACT = "qday-live-mw6vii9l47s.testnet";
const callView = async (method, args) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
  const j = await r.json();
  return JSON.parse(Buffer.from(j.result.result).toString());
};
const wallet = JSON.parse(await p.evaluate(() => localStorage.getItem("qday.wallet.v1")) || "{}").accountId;
const vault = JSON.parse(await p.evaluate(() => localStorage.getItem("qday.vault.v1")) || "{}").accountId;
log("wallet", wallet); log("vault", vault);
const stats = await callView("stats", {});
let raid = null;
for (let id = Number(stats.raids); id > 0 && id > Number(stats.raids) - 40; id--) {
  const r = await callView("get_raid", { raid_id: String(id) });
  if (r && r.target === wallet) { raid = r; break; }
}
log("greeting raid", raid ? `#${raid.id} by ${raid.attacker.split(".")[0]}, status ${raid.status}` : "none found");
if (raid) {
  const end = Date.now() + 15 * 60 * 1000;
  while (raid.status === "open" && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 20000));
    raid = await callView("get_raid", { raid_id: String(raid.id) });
  }
  await p.screenshot({ path: `${OUT}/11-after-raid.png`, fullPage: false });
  log("raid outcome", `status ${raid.status}, take ${raid.take} (0 means the escape worked)`);
}
const vh = vault ? await callView("holder", { account_id: vault }) : null;
log("vault balance", vh ? vh.balance : "none");
await b.close();
'''
s = s.replace('await b.close();\n', tail, 1)
open(p, 'w', encoding='utf8').write(s)
print("ok")
