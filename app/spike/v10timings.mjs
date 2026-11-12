// Timings from a v10play timeline: gaps between attacks on the player, how long
// Satoshi lives per round, how fast his life bar drains.
// Usage: node spike/v10timings.mjs <timeline.jsonl> [more.jsonl...]
import fs from "node:fs";
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(0) : "-");
for (const file of process.argv.slice(2)) {
  const ev = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const att = ev.filter((e) => e.kind === "attacked");
  const bOn = ev.find((e) => e.kind === "break_on")?.t, bOff = ev.find((e) => e.kind === "break_off")?.t;
  const opened = att.map((e) => Number(e.opened));
  const gaps = opened.slice(1).map((t, i) => (t - opened[i]) / 1000);
  const settleGaps = att.slice(1).map((e, i) => (Number(e.opened) - Number(att[i].deadline)) / 1000); // from the last raid's clock end to the next shot
  const onBreak = att.filter((e) => bOn && bOff && Number(e.opened) > bOn && Number(e.opened) < bOff);
  const ar = ev.filter((e) => e.kind === "arena");
  const ends = ev.filter((e) => e.kind === "round_end");
  const lives = ends.filter((e) => e.started && e.ended).map((e) => ({ s: (Number(e.ended) - Number(e.started)) / 1000, blast: !!e.killer }));
  // drain: life lost per minute inside one round
  const drains = [];
  for (let i = 1; i < ar.length; i++) if (ar[i].round === ar[i - 1].round) { const d = Number(BigInt(ar[i - 1].hp) - BigInt(ar[i].hp)) / Number(BigInt(ar[i].spawn)); drains.push((d * 60_000) / (ar[i].t - ar[i - 1].t)); }
  const drain = drains.reduce((a, b) => a + b, 0) / Math.max(1, drains.length);
  const start = ev[0].t, end = ev[ev.length - 1].t;
  console.log(`\n${file}`);
  console.log(`  played ${f1((end - start) / 60000)} min · attacks on you ${att.length} (on break: ${onBreak.length}) · answered ${ev.filter((e) => e.kind === "answered").length} · shots ${ev.filter((e) => e.kind === "shot").length}`);
  console.log(`  gap between attacks (open to open) s: median ${f1(med(gaps))} min ${f1(Math.min(...gaps))} max ${f1(Math.max(...gaps))} [${gaps.map(f1).join(", ")}]`);
  console.log(`  quiet time after a raid's clock ends s: median ${f1(med(settleGaps))} [${settleGaps.map(f1).join(", ")}]`);
  console.log(`  rounds ended ${ends.length}: ${lives.map((l) => `${f1(l.s)}s ${l.blast ? "blast" : "timeout"}`).join(", ") || "-"}`);
  console.log(`  Satoshi life drain: ${(drain * 100).toFixed(1)}% of his bar per minute -> a full bar lasts about ${f1(100 / Math.max(0.01, drain * 100))} min`);
}
