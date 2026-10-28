/*
  A tiny spring engine. Interruptible by design: calling set() mid-flight keeps
  the current velocity, so reversing a gesture never jumps.
*/

export type SpringConfig = { stiffness: number; damping: number; mass?: number };

export const springs = {
  /** Panels, heights, values, anything that reports state. Never overshoots. */
  smooth: { stiffness: 170, damping: 26 },
  /** Presses, small indicators, icon swaps. A hint of life. */
  snappy: { stiffness: 420, damping: 32 },
  /** Shared highlights and width morphs. */
  morph: { stiffness: 300, damping: 26 },
  /** Celebrations and physics toys only. */
  bouncy: { stiffness: 300, damping: 17 },
} satisfies Record<string, SpringConfig>;

const reduceQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
export const prefersReducedMotion = () => !!reduceQuery?.matches;

type Listener = (value: number, velocity: number) => void;

export class Spring {
  value: number;
  target: number;
  velocity = 0;
  config: SpringConfig;
  private raf = 0;
  private last = 0;
  private onChange: Listener;
  private onRest?: () => void;

  constructor(value: number, config: SpringConfig, onChange: Listener) {
    this.value = value;
    this.target = value;
    this.config = config;
    this.onChange = onChange;
  }

  get moving() {
    return this.raf !== 0;
  }

  set(target: number, opts: { velocity?: number; config?: SpringConfig; onRest?: () => void } = {}) {
    this.target = target;
    if (opts.velocity !== undefined) this.velocity = opts.velocity;
    if (opts.config) this.config = opts.config;
    this.onRest = opts.onRest;
    if (prefersReducedMotion()) return this.jump(target);
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  /** Move instantly, for drags that follow the finger 1:1. */
  jump(value: number) {
    this.stop();
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.onChange(value, 0);
    const rest = this.onRest;
    this.onRest = undefined;
    rest?.();
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = (now: number) => {
    // Fixed sub-steps keep stiff springs stable on slow frames.
    let dt = Math.min(0.064, (now - this.last) / 1000);
    this.last = now;
    const { stiffness, damping, mass = 1 } = this.config;
    const step = 1 / 240;
    while (dt > 0) {
      const h = Math.min(step, dt);
      const force = -stiffness * (this.value - this.target) - damping * this.velocity;
      this.velocity += (force / mass) * h;
      this.value += this.velocity * h;
      dt -= h;
    }
    const settled = Math.abs(this.velocity) < 0.01 && Math.abs(this.value - this.target) < 0.005 * Math.max(1, Math.abs(this.target) / 100);
    if (settled) {
      this.value = this.target;
      this.velocity = 0;
      this.raf = 0;
      this.onChange(this.value, 0);
      const rest = this.onRest;
      this.onRest = undefined;
      rest?.();
      return;
    }
    this.onChange(this.value, this.velocity);
    this.raf = requestAnimationFrame(this.tick);
  };
}

/** Rubber band past a limit, like iOS overscroll. */
export function rubber(overflow: number, dimension: number, constant = 0.55) {
  const sign = Math.sign(overflow);
  const x = Math.abs(overflow);
  return sign * (1 - 1 / ((x * constant) / dimension + 1)) * dimension;
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
