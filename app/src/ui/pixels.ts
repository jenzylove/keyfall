// Pixel art drawn as crisp SVG: the KEYFALL logotype, the coin bag, the vault
// door, the raid panel and the big Satoshi boss. Parts carry classes so CSS can
// animate them (drips fall, the door slams, beams run).

function grid(rows: string[], colors: Record<string, string>, cls: Record<string, string> = {}, extra = "", pad = 0): string {
  const h = rows.length, w = rows[0].length;
  let r = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      const c = row[x];
      let run = 1;
      while (x + run < w && row[x + run] === c) run++;
      if (colors[c]) r += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${colors[c]}"${cls[c] ? ` class="${cls[c]}"` : ""}/>`;
      x += run;
    }
  });
  return `<svg viewBox="${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}" shape-rendering="crispEdges" aria-hidden="true">${r}${extra}</svg>`;
}

// ------------------------------------------------------------------ logotype

const GLYPH: Record<string, string[]> = {
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
};
/** The KEYFALL logotype as pixels. The falling key (the dot of the second L,
 * drawn as a dropped pixel) is red; the rest inherits currentColor. */
export function logotype(): string {
  const word = "KEYFALL";
  let x = 0;
  let out = "";
  for (const ch of word) {
    const g = GLYPH[ch];
    g.forEach((row, y) => {
      [...row].forEach((c, i) => {
        if (c !== "#") return;
        out += `<rect x="${x + i}" y="${y}" width="1" height="1" fill="currentColor"/>`;
      });
    });
    x += 6;
  }
  // the key that fell: a red pixel dropping off the Y
  out += `<rect x="14" y="8" width="1" height="1" fill="var(--hazard)" class="fallpx"/>`;
  return `<svg class="logotype" viewBox="0 0 ${x - 1} 9" shape-rendering="crispEdges" role="img" aria-label="KEYFALL">${out}</svg>`;
}

/** Small mark for the top bar: a Q with a red slash. */
export const MARK = `<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><path d="M2 1h4v1h1v4h-1v1H2V6H1V2h1z M3 3v2h2V3z" fill="#FFD60A" fill-rule="evenodd"/><path d="M6 5h1v1H6zM5 6h1v1H5z M7 4h1v1H7z" fill="#FF3D2E"/></svg>`;

// ------------------------------------------------------------------ illustrations

const GOLD = "#FFD60A", GOLD2 = "#D9B000", GOLD3 = "#8A6D00", RED = "#FF3D2E", GREY = "#4b4f5c", GREY2 = "#2a2d38", CYAN = "#27F0FF", WHITE = "#F2F3F7";

/** A pile of coins behind an old key, dripping. */
export const ART_BAG = grid(
  [
    "................",
    "................",
    ".......gg.......",
    ".....gGggGg.....",
    "....gggGggGg....",
    "...gGggggggGg...",
    "..ggggGgGggggg..",
    ".gGggggggggGggg.",
    "gggggGgggggggGgg",
    "kkkkkkkkkkkkkkkk",
    "..d.....d....d..",
    "..d.........d...",
    "......d.........",
    "......d......d..",
    "............d...",
    "................",
  ],
  { g: GOLD, G: GOLD2, k: GREY, d: RED },
  { d: "drip" },
);

/** A pixel safe door with a dial. */
export const ART_VAULT = grid(
  [
    "................",
    ".yyyyyyyyyyyyyy.",
    ".yYYYYYYYYYYYYy.",
    ".yYkkkkkkkkkkYy.",
    ".yYkkkkkkkkkkYy.",
    ".yYkkkkcckkkkYy.",
    ".yYkkkcwwckkkYy.",
    ".yYkkkkcckkkkYy.",
    ".yYkkkkkkkkkkYy.",
    ".yYkkkkkkkkkkYy.",
    ".yYkkkkkkkkkkYy.",
    ".yYYYYYYYYYYYYy.",
    ".yyyyyyyyyyyyyy.",
    "..y..........y..",
    "..y..........y..",
    "................",
  ],
  { y: GOLD, Y: GOLD2, k: GREY2, c: GOLD, w: WHITE },
  { c: "dial", w: "dial" },
);

/** A beam across the radar hitting a bag. */
export const ART_RAID = grid(
  [
    "................",
    ".......w........",
    ".......w........",
    "....wwwwwww.....",
    "...w...w...w....",
    "..w..ccccc..w...",
    "..w.cccccc..w...",
    "wwwwcccccccwwww.",
    "..w.ccccccc.w...",
    "..w..ccccc..w...",
    "...w...w...w....",
    "....wwwwwww.....",
    ".......w........",
    ".......w...rr...",
    "..........rrrr..",
    "...........rr...",
  ],
  { w: GREY, c: CYAN, r: RED },
  { c: "beam" },
);

/** The boss, big: a hooded figure over a coin stash. */
/** The boss as the danger he is: dark cloak, hazard red eyes and a red stash. Gold means safe in this game. */
export const ART_SATOSHI_RED = grid(
  [
    "......####......",
    ".....######.....",
    "....########....",
    "...###....###...",
    "...##......##...",
    "..##..y..y..##..",
    "..##........##..",
    "..##........##..",
    "..###......###..",
    "..####....####..",
    ".######cc######.",
    ".#####cggc#####.",
    ".####cgggGc####.",
    "#####cgGggc#####",
    "######cccc######",
    "################",
  ],
  { "#": "#2a1d22", y: "#ff3d2e", c: "#7a1a10", g: "#ff3d2e", G: "#ff8a7a" },
  { y: "eye" },
);
export const ART_SATOSHI = grid(
  [
    "......####......",
    ".....######.....",
    "....########....",
    "...###....###...",
    "...##......##...",
    "..##..y..y..##..",
    "..##........##..",
    "..##........##..",
    "..###......###..",
    "..####....####..",
    ".######cc######.",
    ".#####cggc#####.",
    ".####cgggGc####.",
    "#####cgGggc#####",
    "######cccc######",
    "################",
  ],
  { "#": "#3b3e4a", y: GOLD, c: GOLD3, g: GOLD, G: GOLD2 },
  { y: "eye" },
);

/** A quantum computer waking up (cold open 1). */
export const ART_QC = grid(
  [
    "................",
    "....kkkkkkkk....",
    "...kccccccccck..",
    "...kc.c..c..ck..",
    "...kcc.cc.c.ck..",
    "...kc.c..c.cck..",
    "...kccccccccck..",
    "....kkkkkkkk....",
    "......kkkk......",
    ".....kkkkkk.....",
    "....kk.kk.kk....",
    "...kk..kk..kk...",
    "...k...kk...k...",
    "...k...kk...k...",
    "...kkkkkkkkkk...",
    "................",
  ],
  { k: GREY, c: CYAN, ".": "" },
  { c: "wake" },
);

/** An open door with a key (cold open 2). */
export const ART_DOOR = grid(
  [
    "................",
    "..rrrrrrrrrrrr..",
    "..r..........r..",
    "..r..........r..",
    "..r...kkkk...r..",
    "..r..kk..kk..r..",
    "..r..kk..kk..r..",
    "..r...kkkk...r..",
    "..r....kk....r..",
    "..r....kk.k..r..",
    "..r....kkkk..r..",
    "..r..........r..",
    "..r..........r..",
    "..r..........r..",
    "..rrrrrrrrrrrr..",
    "................",
  ],
  { r: RED, k: GREY },
  { k: "key" },
);

export { grid };
