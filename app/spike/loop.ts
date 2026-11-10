import { Arena, type ArenaBody } from "../src/ui/arena";
import { avatar } from "../src/ui/avatars";
const host = document.getElementById("host")!;
const log: any[] = [];
(window as any).log = log;
const now = () => Date.now();
const arena = new Arena(host, {
  onTouch: (id) => log.push(["touch", id]),
  onGate: () => log.push(["gate"]),
  onShot: (id) => { log.push(["shot", id]); return { ok: true }; },
  onPulse: () => {},
  chainNow: now,
});
arena.powerLocked = true;
arena.onAutoFire = () => { if (arena.shoot()) log.push(["autofire", arena.lockId]); };
arena.onLock = (id) => log.push(["lock", id]);
const body = (id: string, kind: "exposed" | "vault", state: ArenaBody["state"], bal = 50000): ArenaBody => ({
  id, name: id, bag: `${bal / 1000}k`, kind, balance: bal, state, shieldBps: 0, immune: false, npc: "", hunting: false,
  raidingMe: false, raidedByMe: false, svg: avatar(id), focus: true, showBag: state === "open",
});
const bodies = [body("red-a", "exposed", "open"), body("red-b", "exposed", "open"), body("red-c", "exposed", "open"), body("gold-a", "vault", "down"), body("gold-b", "vault", "rest")];
(window as any).setup = (kind: "exposed" | "vault") => {
  arena.setMe({ kind, bag: "120k", balance: 120000, shieldBps: 0, raidsLeft: 3, maxRaids: 3, inFlight: "", svg: avatar("me") });
  arena.setBodies(bodies);
  arena.setPlaces({ gate: kind === "exposed" ? "open" : "home", boss: { visible: true, ready: false, hp: 1 } });
  arena.targets = kind === "vault" ? new Set(["red-a", "red-b", "red-c"]) : new Set();
};
(window as any).arena = arena;
(window as any).markRaided = (id: string) => { const b = bodies.find((x) => x.id === id)!; b.raidedByMe = true; b.state = "busy"; b.until = Date.now() + 600000; arena.setBodies(bodies); arena.targets.delete(id); };
