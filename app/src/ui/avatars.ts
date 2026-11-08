// Pixel portraits, drawn as SVG so they stay crisp at any size.
// NPCs have a character each; humans get an identicon from their codename.

import { hash32, isNpc, nameOf } from "./names";
import { npcName } from "../../npc/rules.mjs";

const TILE = "#191815";

function grid(rows: string[], colors: Record<string, string>, extra = ""): string {
  const h = rows.length, w = rows[0].length;
  let r = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      const c = row[x];
      let run = 1;
      while (x + run < w && row[x + run] === c) run++;
      if (colors[c]) r += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${colors[c]}"/>`;
      x += run;
    }
  });
  return `<svg viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${w}" height="${h}" fill="${TILE}"/>${r}${extra}</svg>`;
}

const SHOR = grid(
  [
    "............",
    "............",
    "....####....",
    "..##wwww##..",
    ".#wwwrrwww#.",
    "#wwwrrrrwww#",
    "#wwrrkkrrww#",
    "#wwwrrrrwww#",
    ".#wwwrrwww#.",
    "..##wwww##..",
    "....####....",
    "............",
  ],
  { "#": "#ff3d2e", w: "#f2efe6", r: "#ff3d2e", k: "#0c0c0b" },
);

const GROVER = grid(
  [
    "............",
    "...####.....",
    "..#gggg#....",
    ".#gwgggg#...",
    ".#wggggg#...",
    ".#gggggg#...",
    ".#gggggg#...",
    "..#gggg#....",
    "...####y....",
    "........yy..",
    ".........yy.",
    "..........y.",
  ],
  { "#": "#e6e2d6", g: "#5aa9e6", w: "#cfeaff", y: "#ffd60a" },
);

const SATOSHI = grid(
  [
    "....####....",
    "...######...",
    "..###..###..",
    "..##....##..",
    ".##.y..y.##.",
    ".##......##.",
    ".###....###.",
    ".####..####.",
    "####cccc####",
    "###cckkcc###",
    "###cccccc###",
    "####cccc####",
  ],
  { "#": "#4a4842", y: "#ffd60a", c: "#ffd60a", k: "#8a6d00" },
);

const QUBIT_HUES = ["#5ee6c4", "#9fd8ff", "#c79bff", "#ff9f5a", "#b6f36a", "#ff7eb6", "#7fe0ff", "#e8c3ff"];
function qubit(n: number): string {
  const c = QUBIT_HUES[(n - 1) % QUBIT_HUES.length];
  const face = grid(
    [
      "............",
      ".##########.",
      ".#ffffffff#.",
      ".#fkkffkkf#.",
      ".#fkkffkkf#.",
      ".#ffffffff#.",
      ".#ffffffff#.",
      ".#ffffffff#.",
      ".#ffffffff#.",
      ".#ffffffff#.",
      ".##########.",
      "............",
    ],
    { "#": "#0c0c0b", f: c, k: "#0c0c0b" },
    `<text x="6" y="9.3" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-weight="700" font-size="3.6" fill="#0c0c0b">${String(n).padStart(2, "0")}</text>`,
  );
  return face;
}

const HUES = ["#5ee6c4", "#9fd8ff", "#c79bff", "#ff9f5a", "#b6f36a", "#ff7eb6", "#7fe0ff", "#f2efe6", "#e8c3ff", "#9ff2a8"];
function identicon(seed: string): string {
  const h = hash32(seed + "#face");
  const h2 = hash32(seed + "#body");
  const col = HUES[h % HUES.length];
  let r = "";
  // 5 rows x 3 columns, mirrored to 5, drawn at 2 units per cell on a 12 grid
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++) {
      const bit = ((y * 3 + x) % 2 ? h2 : h) >>> (y * 3 + x) & 1;
      if (!bit) continue;
      for (const xx of x === 2 ? [2] : [x, 4 - x]) r += `<rect x="${1 + xx * 2}" y="${1 + y * 2}" width="2" height="2" fill="${col}"/>`;
    }
  return `<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><rect width="12" height="12" fill="${TILE}"/>${r}</svg>`;
}

/** Portrait SVG for any account. */
export function avatar(account: string): string {
  if (account === "satoshi") return SATOSHI;
  if (isNpc(account)) {
    const n = npcName(account);
    if (n === "shor") return SHOR;
    if (n === "grover") return GROVER;
    const m = n.match(/^qubit-(\d+)$/);
    if (m) return qubit(Number(m[1]));
  }
  return identicon(nameOf(account));
}

export const satoshiAvatar = () => SATOSHI;
