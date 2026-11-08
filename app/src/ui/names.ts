// Readable names for every player. NPCs by character, human vaults by the name
// they chose, everyone else by a codename made from the account id.

import { CONTRACT } from "../chain";
import { isNpc as npcRule, npcName } from "../../npc/rules.mjs";

const ADJ = [
  "Amber", "Ashen", "Azure", "Bitter", "Blazing", "Bold", "Brass", "Brave",
  "Bright", "Chrome", "Cobalt", "Copper", "Crimson", "Cyber", "Dark", "Dusty",
  "Electric", "Emerald", "Feral", "Fierce", "Frosty", "Gilded", "Golden", "Grim",
  "Hollow", "Hidden", "Icy", "Indigo", "Iron", "Ivory", "Jade", "Lucky",
  "Lunar", "Magnetic", "Midnight", "Misty", "Neon", "Noble", "Obsidian", "Onyx",
  "Pale", "Phantom", "Quiet", "Rapid", "Rogue", "Ruby", "Rusty", "Sable",
  "Scarlet", "Shadow", "Silent", "Silver", "Sly", "Solar", "Static", "Steel",
  "Stormy", "Swift", "Thunder", "Velvet", "Violet", "Wild", "Wired", "Zinc",
];
const ANIMAL = [
  "Badger", "Bat", "Bear", "Beetle", "Bison", "Boar", "Cobra", "Condor",
  "Coyote", "Crane", "Crow", "Dingo", "Eagle", "Eel", "Falcon", "Ferret",
  "Finch", "Fox", "Gecko", "Goat", "Hare", "Hawk", "Heron", "Hyena",
  "Ibex", "Jackal", "Jaguar", "Kestrel", "Koala", "Lemur", "Lion", "Lizard",
  "Lynx", "Magpie", "Marten", "Mink", "Moose", "Moth", "Newt", "Ocelot",
  "Orca", "Otter", "Owl", "Panda", "Panther", "Pike", "Puma", "Python",
  "Quail", "Raven", "Rhino", "Shark", "Shrew", "Sloth", "Squid", "Stoat",
  "Swan", "Tiger", "Toad", "Viper", "Walrus", "Wasp", "Wolf", "Yak",
];

/** FNV 1a, 32 bit. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function codename(id: string): string {
  const h = hash32(id);
  return `${ADJ[h & 63]} ${ANIMAL[(h >>> 6) & 63]}`;
}

export const isNpc = (account: string) => npcRule(account, CONTRACT);
export const isGameVault = (account: string) => account.endsWith(`.${CONTRACT}`);

/** The character name of an NPC: Shor, Grover, Qubit 01 ... Qubit 08. */
export function npcTitle(account: string): string {
  const n = npcName(account);
  if (n === "shor") return "Shor";
  if (n === "grover") return "Grover";
  const m = n.match(/^qubit-(\d+)$/);
  return m ? `Qubit ${m[1]}` : n;
}

/** What a player calls this account. `mine` lists the accounts on this device. */
export function nameOf(account: string | null | undefined, mine: string[] = []): string {
  if (!account) return "Someone";
  if (mine.includes(account)) return "You";
  if (account === "satoshi") return "Satoshi";
  if (isNpc(account)) return npcTitle(account);
  if (isGameVault(account)) return account.slice(0, -CONTRACT.length - 1);
  return codename(account);
}

/** A vault name suggestion that reads like a name: amberlynx27. */
export function suggestVaultName(seed: string): string {
  const [a, b] = codename(seed || String(Math.random())).toLowerCase().split(" ");
  const n = crypto.getRandomValues(new Uint8Array(1))[0] % 90 + 10;
  return `${a}${b}${n}`.slice(0, 20);
}
