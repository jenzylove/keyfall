// Arcade sound, synthesised with WebAudio. No audio files. Unlocked by the
// first tap anywhere; on by default; the mute toggle is remembered.

const LS = "qday.sound.v1";

type Name = "blip" | "zap" | "crunch" | "coins" | "powerup" | "clang" | "thud" | "fanfare" | "siren" | "chime" | "tick" | "alarm" | "deny" | "whoosh";

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
}
export const isMuted = () => muted;
export const isUnlocked = () => unlocked;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem(LS, m ? "off" : "on"); } catch {}
  for (const l of listeners) l(m);
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
};

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
