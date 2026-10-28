/*
  Optional sound and haptic feedback. Off by default; the host app turns it on.
  Sounds are synthesized, so there are no assets to ship.
*/

type Kind = "tick" | "tap" | "pop" | "success" | "error" | "toggle";

let enabled = false;
let ctx: AudioContext | null = null;
const listeners = new Set<(on: boolean) => void>();

try {
  enabled = localStorage.getItem("liner:sound") === "on";
} catch {
  enabled = false;
}

export const feedback = {
  get enabled() {
    return enabled;
  },
  setEnabled(on: boolean) {
    enabled = on;
    try {
      localStorage.setItem("liner:sound", on ? "on" : "off");
    } catch {
      /* storage can be unavailable; the toggle still works for this visit */
    }
    listeners.forEach((fn) => fn(on));
    if (on) play("toggle");
  },
  subscribe(fn: (on: boolean) => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  play,
};

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function blip(a: AudioContext, freq: number, at: number, length: number, gain: number, type: OscillatorType = "sine", glide = 0) {
  const osc = a.createOscillator();
  const amp = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glide) osc.frequency.exponentialRampToValueAtTime(freq * glide, at + length);
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(amp).connect(a.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** pitch nudges the tone, so a stepper can climb as the value rises. */
function play(kind: Kind, pitch = 0) {
  if (!enabled || typeof window === "undefined") return;
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const p = Math.pow(2, pitch / 12);
  switch (kind) {
    case "tick":
      blip(a, 1800 * p, t, 0.03, 0.035, "triangle");
      break;
    case "tap":
      blip(a, 620 * p, t, 0.05, 0.06, "sine", 0.7);
      break;
    case "toggle":
      blip(a, 880 * p, t, 0.05, 0.05, "triangle", 1.3);
      break;
    case "pop":
      blip(a, 520 * p, t, 0.09, 0.07, "sine", 1.8);
      break;
    case "success":
      blip(a, 660 * p, t, 0.08, 0.05, "sine");
      blip(a, 990 * p, t + 0.07, 0.14, 0.05, "sine");
      break;
    case "error":
      blip(a, 220 * p, t, 0.08, 0.06, "square", 0.8);
      blip(a, 180 * p, t + 0.09, 0.1, 0.05, "square", 0.8);
      break;
  }
  if (kind === "success" || kind === "error") navigator.vibrate?.(kind === "error" ? [12, 40, 12] : 14);
  else if (kind !== "tick") navigator.vibrate?.(6);
}
