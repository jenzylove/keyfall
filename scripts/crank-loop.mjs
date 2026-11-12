// The arena heartbeat without a server: run one crank every LOOP_SEC seconds for LOOP_MIN minutes.
// GitHub Actions runs this as one long job, so game tabs never have to wake the bots.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const every = Number(process.env.LOOP_SEC || 30) * 1000;
const until = Date.now() + Number(process.env.LOOP_MIN || 345) * 60_000;
let n = 0, fails = 0;
while (Date.now() < until) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(here, "crank.mjs")], { stdio: "inherit", env: process.env, timeout: 120_000 });
  n += 1;
  if (r.status !== 0) fails += 1;
  const wait = Math.max(1000, every - (Date.now() - t0));
  await new Promise((z) => setTimeout(z, wait));
}
console.log(`loop done: ${n} ticks, ${fails} failed`);
