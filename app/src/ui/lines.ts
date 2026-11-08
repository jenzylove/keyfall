// What the rivals say. Flavour only: every number in the game comes from the
// chain, these are just words in character. Keyed by character and event.

import { npcName } from "../../npc/rules.mjs";
import { hash32, isNpc } from "./names";

export type Event = "raids" | "escaped" | "defended" | "raided" | "defends" | "idle" | "hit" | "won";

type Lines = Record<Event, string[]>;

const SHOR: Lines = {
  raids: ["Your keys are showing.", "Old key. Big bag. Mine.", "Factoring you now."],
  escaped: ["...a quantum key. Annoying.", "Fine. Hide.", "You moved. Noted."],
  defended: ["Impossible.", "A lucky block.", "Next time."],
  raided: ["You dare?", "Bold. Pointless.", "I see your beam."],
  defends: ["Denied.", "My wall holds.", "Try harder."],
  idle: ["Who still uses old keys?", "I can smell an exposed bag.", "Tick. Tock."],
  hit: [],
  won: ["Harvested.", "Thanks for the coins.", "Told you."],
};
const GROVER: Lines = {
  raids: ["Found you.", "Weakest vault in the room.", "Searching... done."],
  escaped: ["Lost the signal.", "Slippery.", "Hm. Where did you go."],
  defended: ["Recalculating.", "Noted.", "Your shield was stronger than it looked."],
  raided: ["Interesting choice.", "I was looking for you too.", "Beam detected."],
  defends: ["Blocked.", "Searched. Blocked.", "Not today."],
  idle: ["Who forgot their shield?", "Scanning vaults.", "Thin walls everywhere."],
  hit: [],
  won: ["Found it.", "Easy search.", "Thanks."],
};
const QUBIT: Lines = {
  raids: ["hi! :) gimme.", "new friend! raid!", "hello hello hello", "welcome!! gimme coins"],
  escaped: ["aw. you ran.", "no fair :(", "where'd it go??"],
  defended: ["ow ow ow.", "owie.", "that hurt :("],
  raided: ["eep!", "oh no oh no", "why me??"],
  defends: ["nope!", "hehe no.", "blocked u :)"],
  idle: ["hi!", "anyone new?", "boop.", "we are many."],
  hit: [],
  won: ["yay coins!", "thank u!!", "tasty."],
};
const SATOSHI: Lines = {
  raids: [], escaped: [], defended: [], raided: [], defends: [], idle: ["...", "I was here first."],
  hit: ["I was here first.", "Take it. There is more.", "You are late.", "..."],
  won: [],
};
const HUMAN: Lines = {
  raids: ["Hand it over.", "Nothing personal.", "Nice bag."],
  escaped: ["Slippery.", "Next time."],
  defended: ["Ouch.", "Fair."],
  raided: ["Really?", "Come on then."],
  defends: ["Blocked.", "Not today."],
  idle: [],
  hit: [],
  won: ["Thanks.", "Easy."],
};

function table(account: string): Lines {
  if (account === "satoshi") return SATOSHI;
  if (isNpc(account)) {
    const n = npcName(account);
    if (n === "shor") return SHOR;
    if (n === "grover") return GROVER;
    return QUBIT;
  }
  return HUMAN;
}

/** A line for this character and moment, or "" if they have nothing to say. */
export function line(account: string, ev: Event, salt = ""): string {
  const t = table(account)[ev];
  if (!t.length) return "";
  return t[hash32(account + ev + salt + String(Date.now() >> 12)) % t.length];
}

/** One line per rival for the title screen. */
export const RIVALS = [
  { who: "shor", name: "Shor", line: "Hunts the biggest exposed bag." },
  { who: "grover", name: "Grover", line: "Hunts the weakest vault." },
  { who: "qubit", name: "The Qubits", line: "Greet every new player with a raid." },
  { who: "satoshi", name: "Satoshi", line: "The boss. Everyone hits his stash." },
];
