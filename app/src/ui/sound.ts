// Arcade sound, synthesised with WebAudio. No audio files. Unlocked by the
// first tap anywhere; on by default; the mute toggle is remembered.

const LS = "qday.sound.v1";

type Name = "blip" | "zap" | "crunch" | "coins" | "powerup" | "clang" | "thud" | "fanfare" | "siren" | "chime" | "tick" | "alarm" | "deny" | "whoosh" | "jackpot" | "combo";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = (() => { try { return localStorage.getItem(LS) === "off"; } catch { return false; } })();
let unlocked = false;
const listeners = new Set<(m: boolean) => void>();

function ac(): AudioContext | null {
  if (ctx) return ctx;
  const C = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  master = ctx!.createGain();
  master.gain.value = 0.5;
  master.connect(ctx!.destination);
  const len = ctx!.sampleRate * 0.6;
  noise = ctx!.createBuffer(1, len, ctx!.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

/** Call from a user gesture. Safe to call often. */
export function unlock() {
  const c = ac();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  unlocked = true;
  if (musicWanted) musicOn();
}
export const isMuted = () => muted;
export const isUnlocked = () => unlocked;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem(LS, m ? "off" : "on"); } catch {}
  for (const l of listeners) l(m);
  if (m) musicOff(); else if (musicWanted) musicOn();
}
export const toggleMute = () => setMuted(!muted);
export const onMute = (fn: (m: boolean) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export function vibrate(pattern: number | number[]) {
  try { if (!muted && navigator.vibrate) navigator.vibrate(pattern); } catch {}
}

function tone(freq: number, t0: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master!);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
function hiss(t0: number, dur: number, vol: number, lp = 1200) {
  const c = ctx!;
  const s = c.createBufferSource();
  s.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(lp, t0);
  f.frequency.exponentialRampToValueAtTime(80, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(master!);
  s.start(t0);
  s.stop(t0 + dur + 0.02);
}

const SFX: Record<Name, (t: number) => void> = {
  blip: (t) => tone(880, t, 0.06, "square", 0.12, 1320),
  tick: (t) => tone(1400, t, 0.025, "square", 0.05),
  deny: (t) => { tone(220, t, 0.09, "square", 0.12); tone(160, t + 0.1, 0.14, "square", 0.12); },
  zap: (t) => { tone(180, t, 0.32, "sawtooth", 0.16, 1800); tone(90, t, 0.2, "square", 0.08, 700); },
  whoosh: (t) => hiss(t, 0.28, 0.18, 2600),
  crunch: (t) => { hiss(t, 0.22, 0.5, 900); tone(140, t, 0.18, "square", 0.2, 40); },
  coins: (t) => { [1568, 1976, 2349, 2637, 3136].forEach((f, i) => tone(f, t + i * 0.055, 0.09, "square", 0.09)); },
  powerup: (t) => { [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.07, 0.16, "square", 0.11)); tone(1047, t + 0.3, 0.35, "triangle", 0.12, 1568); },
  clang: (t) => { tone(2200, t, 0.12, "square", 0.12, 900); tone(640, t, 0.26, "triangle", 0.14, 420); hiss(t, 0.12, 0.25, 4000); },
  thud: (t) => { tone(110, t, 0.3, "sine", 0.4, 35); hiss(t, 0.2, 0.35, 500); },
  fanfare: (t) => {
    const seq: [number, number][] = [[784, 0], [784, 0.1], [784, 0.2], [1047, 0.3], [932, 0.55], [1047, 0.7]];
    for (const [f, d] of seq) { tone(f, t + d, 0.16, "square", 0.1); tone(f / 2, t + d, 0.16, "triangle", 0.08); }
    tone(1319, t + 0.95, 0.5, "square", 0.1);
  },
  siren: (t) => { for (let i = 0; i < 2; i++) { tone(440, t + i * 0.5, 0.25, "square", 0.05, 660); tone(660, t + i * 0.5 + 0.25, 0.25, "square", 0.05, 440); } },
  alarm: (t) => { tone(520, t, 0.14, "square", 0.1, 780); tone(520, t + 0.18, 0.14, "square", 0.1, 780); },
  chime: (t) => { tone(1047, t, 0.3, "triangle", 0.12); tone(1568, t + 0.12, 0.5, "triangle", 0.1); },
  jackpot: (t) => {
    [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => tone(f, t + i * 0.045, 0.14, "square", 0.1));
    [2093, 2637, 3136, 2637, 3136, 3520].forEach((f, i) => tone(f, t + 0.34 + i * 0.06, 0.1, "square", 0.08));
    tone(130, t, 0.4, "triangle", 0.25, 65); hiss(t + 0.3, 0.5, 0.12, 6000);
  },
  combo: (t) => { const k = Math.min(comboLevel, 6); [0, 4, 7].forEach((st, i) => tone(660 * Math.pow(2, (st + k * 2) / 12), t + i * 0.05, 0.1, "square", 0.1)); },
};
let comboLevel = 2;
/** The combo sting climbs with the combo. */
export function playCombo(n: number) { comboLevel = n; play("combo"); }

// ------------------------------------------------------------------ music
// A looping chiptune bed, synthesised once into a buffer (no files) and then looped by the audio
// thread: no per note work on the main thread while you play. 16 bars at 132 bpm in A minor:
// Am F C G, a melody over the second half. Game page only, after the first tap, follows the mute
// toggle and ducks under the intro.

const BPM = 132;
const STEP = 60 / BPM / 4; // a sixteenth
const STEPS = 16 * 16;
const MUSIC_VOL = 0.34; // into master (0.5): quiet under the effects
let musicWanted = false;
let ducked = false;
let bus: GainNode | null = null;
let loop: AudioBuffer | null = null;
let rendering: Promise<AudioBuffer | null> | null = null;
let src: AudioBufferSourceNode | null = null;
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
// roots per bar (A2 F2 C3 G2), chord tones as semitones over the root
const ROOTS = [45, 41, 48, 43];
const CHORD = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];
// the melody over bars 9 to 16: [step in the 8 bar half, midi note, length in steps]
const MEL: [number, number, number][] = [
  [0, 76, 3], [4, 74, 2], [6, 72, 2], [8, 74, 4], [12, 76, 4],
  [16, 77, 3], [20, 76, 2], [22, 74, 2], [24, 72, 6],
  [32, 72, 3], [36, 74, 2], [38, 76, 2], [40, 79, 4], [44, 76, 4],
  [48, 74, 3], [52, 72, 2], [54, 71, 2], [56, 74, 6],
  [64, 76, 3], [68, 74, 2], [70, 72, 2], [72, 74, 4], [76, 76, 4],
  [80, 77, 3], [84, 79, 2], [86, 81, 2], [88, 79, 6],
  [96, 76, 3], [100, 79, 2], [102, 81, 2], [104, 84, 4], [108, 83, 4],
  [112, 81, 4], [116, 79, 4], [120, 76, 8],
];
const MELAT = new Map(MEL.map((m) => [m[0], m]));

/** Render the 16 bars once, offline. The graph is built a bar at a time between frames so the first tap never hitches. */
async function renderLoop(sr: number): Promise<AudioBuffer | null> {
  const O = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!O || !noise) return null;
  const len = Math.ceil(STEP * STEPS * sr);
  const c: OfflineAudioContext = new O(1, len, sr);
  const out = c.createGain(); out.gain.value = 1; out.connect(c.destination);
  const note = (f: number, t0: number, dur: number, type: OscillatorType, vol: number) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
    g.gain.setValueAtTime(vol, t0 + Math.max(0.01, dur - 0.03));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + dur + 0.02);
  };
  const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000; hp.connect(out);
  const hat = (t0: number, vol: number) => {
    const s = c.createBufferSource(); s.buffer = noise;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
    s.connect(g).connect(hp); s.start(t0, Math.random() * 0.4); s.stop(t0 + 0.05);
  };
  const kick = (t0: number) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(150, t0); o.frequency.exponentialRampToValueAtTime(40, t0 + 0.12);
    g.gain.setValueAtTime(0.5, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + 0.18);
  };
  for (let i = 0; i < STEPS; i++) {
    if (i % 16 === 0 && i) await new Promise((r) => setTimeout(r, 16));
    const t = i * STEP + 0.002;
    const bar = Math.floor(i / 16), s = i % 16, ch = bar % 4;
    const root = ROOTS[ch], tones = CHORD[ch];
    if (s % 2 === 0) note(midi(root + (s % 4 === 2 ? 12 : 0)), t, STEP * 1.8, "triangle", 0.5); // bass: eighths, root and octave
    if (s === 0 || s === 8 || (bar % 4 === 3 && s === 14)) kick(t);
    if (s % 4 === 2) hat(t, 0.16); else if (s % 2 === 1 && bar >= 4) hat(t, 0.06);
    if ((s === 4 || s === 12) && bar >= 2) hat(t, 0.22);
    if (bar >= 4) { const k = tones[s % 3] + 24 + (s % 6 >= 3 ? 12 : 0); note(midi(root + k), t, STEP * 0.9, "square", 0.045); } // arpeggio from bar 5
    if (bar >= 8) { const m = MELAT.get(i - 128); if (m) note(midi(m[1]), t, STEP * m[2] * 0.95, "square", 0.085); } // melody, second half
  }
  try { return await c.startRendering(); } catch { return null; }
}
function level() { return ducked ? MUSIC_VOL * 0.25 : MUSIC_VOL; }
function musicOn() {
  if (muted || !unlocked || src) return;
  const c = ac(); if (!c || !master) return;
  if (!bus) { bus = c.createGain(); bus.gain.value = 0.0001; bus.connect(master); }
  if (!loop) {
    if (!rendering) rendering = renderLoop(c.sampleRate).then((b) => { loop = b; return b; });
    rendering.then((b) => { if (b && musicWanted && !muted && !document.hidden) musicOn(); });
    return;
  }
  const s = c.createBufferSource();
  s.buffer = loop; s.loop = true; s.connect(bus); s.start();
  src = s;
  bus.gain.cancelScheduledValues(c.currentTime);
  bus.gain.setTargetAtTime(level(), c.currentTime, 0.4);
}
function musicOff() {
  if (!src || !ctx || !bus) return;
  const s = src, t = ctx.currentTime;
  src = null;
  bus.gain.cancelScheduledValues(t);
  bus.gain.setTargetAtTime(0.0001, t, 0.08);
  try { s.stop(t + 0.4); } catch {}
}
/** The game page wants the bed: it starts on the first tap (or now, when sound is already unlocked). */
export function startMusic() { musicWanted = true; if (unlocked) musicOn(); }
/** For checks: is the bed playing, ducked, and is the audio clock running. */
export const musicState = () => ({ on: !!src, ducked, wanted: musicWanted, ctx: ctx?.state || "none", loopSeconds: loop ? +loop.duration.toFixed(2) : 0 });
export function stopMusic() { musicWanted = false; musicOff(); }
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.hidden) musicOff(); else if (musicWanted && !muted) musicOn(); });
/** Quieter under the intro. */
export function duckMusic(on: boolean) {
  ducked = on;
  if (bus && ctx && src) bus.gain.setTargetAtTime(level(), ctx.currentTime, 0.25);
}

export function play(name: Name) {
  if (muted) return;
  const c = ac();
  if (!c || !master || !noise) return;
  if (c.state === "suspended") { if (!unlocked) return; c.resume().catch(() => {}); }
  try { SFX[name](c.currentTime); } catch {}
}

// First gesture anywhere unlocks the context.
if (typeof document !== "undefined") {
  const once = () => { unlock(); document.removeEventListener("pointerdown", once); document.removeEventListener("keydown", once); };
  document.addEventListener("pointerdown", once, { passive: true });
  document.addEventListener("keydown", once);
}

export const SPEAKER = `<svg viewBox="0 0 24 24" aria-hidden="true" shape-rendering="crispEdges"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M15 9v6M18 7v10M21 5v14" stroke="currentColor" stroke-width="2"/></svg>`;
export const SPEAKER_OFF = `<svg viewBox="0 0 24 24" aria-hidden="true" shape-rendering="crispEdges"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2.2"/></svg>`;
