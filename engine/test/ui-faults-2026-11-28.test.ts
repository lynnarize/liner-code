/*
  Faults found in the app on 2026-11-28, in the review before 0.3.3. Where the deciding part could be run on its own it
  is run here with small stand-ins for the browser; the rest is read from the source as written (precedent:
  ui-faults-2026-11-27.test.ts). Run with `node --test engine/test/ui-faults-2026-11-28.test.ts`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";

/** Just enough of a page for homeTide.ts: timers and frames are held so the test can see what is still waiting. */
function fakePage() {
  const timers = new Map<number, () => void>();
  const frames = new Map<number, (now: number) => void>();
  let next = 1;
  const watchers: (() => void)[] = [];
  const noop = () => {};
  const g = globalThis as Record<string, unknown>;
  const kept = Object.fromEntries(["window", "document", "requestAnimationFrame", "cancelAnimationFrame", "clearTimeout", "matchMedia", "ResizeObserver", "IntersectionObserver", "MutationObserver", "getComputedStyle"].map((k) => [k, g[k]]));
  g.window = { setTimeout: (f: () => void) => (timers.set(next, f), next++), devicePixelRatio: 1, addEventListener: noop, removeEventListener: noop };
  g.document = { hidden: false, hasFocus: () => true, documentElement: {}, addEventListener: noop, removeEventListener: noop, createElement: () => ({ getContext: () => null }) };
  g.requestAnimationFrame = (f: (now: number) => void) => (frames.set(next, f), next++);
  g.cancelAnimationFrame = (id: number) => frames.delete(id);
  g.clearTimeout = (id: number) => timers.delete(id);
  g.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  g.getComputedStyle = () => ({ color: "red" });
  g.ResizeObserver = class { observe() {} disconnect() {} };
  g.IntersectionObserver = class { observe() {} disconnect() {} };
  g.MutationObserver = class {
    constructor(f: () => void) {
      watchers.push(f);
    }
    observe() {}
    disconnect() {}
  };
  // A WebGL context that accepts every call and says every shader compiled.
  const gl = new Proxy({}, { get: (_t, k) => (k === "getShaderParameter" || k === "getProgramParameter" ? () => true : () => ({})) });
  const canvas = { width: 0, height: 0, getContext: () => gl, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }), addEventListener: noop, removeEventListener: noop };
  const home = { addEventListener: noop, removeEventListener: noop };
  /** Runs what is due: the frames waiting, then the timers, a few rounds. */
  const run = (rounds = 4) => {
    for (let r = 0; r < rounds; r++) {
      for (const [id, f] of [...frames]) frames.delete(id), f(performance.now());
      for (const [id, f] of [...timers]) timers.delete(id), f();
    }
  };
  const restore = () => {
    for (const [k, v] of Object.entries(kept)) g[k] = v;
  };
  return { timers, frames, watchers, canvas, home, run, restore };
}

test("Home's drifting corner draws nothing more once Home has gone, even when the theme changed just before", async () => {
  const page = fakePage();
  try {
    // Loaded by its URL, so the engine's typecheck (no DOM types) doesn't take in a file written for the page.
    const tideUrl = new URL("../../ui/src/app/homeTide.ts", import.meta.url).href;
    const { startTide } = (await import(tideUrl)) as { startTide: (canvas: unknown, home: unknown, onPaper: () => boolean, onLost: () => void) => { stop(): void } | null };
    const tide = startTide(page.canvas, page.home, () => true, () => {});
    assert.ok(tide, "the tide didn't start on the stand-in WebGL");
    page.run();
    // The root's style changes (a new look, a notice placed) and, before the next frame, Home goes.
    for (const w of page.watchers) w();
    tide.stop();
    page.run();
    assert.equal(page.timers.size + page.frames.size, 0, "the tide keeps drawing 20 frames a second on a canvas no one holds");
  } finally {
    page.restore();
  }
});

test("Enable Fusion switched on and off again in the picker puts the lead's effort back as it was", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../ui/src/app/Composer.tsx", import.meta.url), "utf8");
  const on = /const fusionOn = \(\) => \{[\s\S]*?\n  \};/.exec(src)?.[0];
  const off = /const fusionOff = [\s\S]*?\n  \};|const fusionOff = .*;/.exec(src)?.[0];
  assert.ok(on && off, "the Fusion switch's handlers are not where they were");
  // On sets the pair's effort (Medium unless Settings says otherwise); off has to hand back the level from before.
  assert.match(on, /pairEffortFor\(/);
  assert.match(on, /beforeFusion\.current = /, "switching Fusion on forgets the effort the model ran at");
  assert.match(off, /effort: (was|beforeFusion\.current)/, "switching Fusion off leaves the model at the pair's effort, High turned to Medium");
});

/* The second round (2026-11-28): presses that act outward or can't be undone ask for a second press first, and three
   fields that did more than was asked. The wiring is read from the source; the two-press rule itself is confirm.ts's,
   which reviewed-faults.test.ts runs. */
const uiSrc = async (file: string) => (await import("node:fs")).readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker not found: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `end marker not found after "${from}": ${to}`);
  return src.slice(a, b);
};

test("The session details card's Push and Open a pull request go out only on a second press", async () => {
  const card = between(await uiSrc("Env.tsx"), "export function DetailsCard(", "\n}\n");
  const commit = between(card, "const commit = () => {", "\n  };");
  assert.match(card, /useConfirm\(\)/, "the details card has no two-press confirm");
  assert.match(commit, /outward\.press\(/, "one stray click on the card's Commit row pushes the branch or sends the agent a turn");
});

test("Restore defaults in Settings asks for a second press, since what it puts back can't be undone", async () => {
  const restore = between(await uiSrc("Settings.tsx"), "{reset && (", "Restore defaults");
  assert.match(restore, /<SureButton/, "one press of Restore defaults wipes your look and your saved dots");
  assert.doesNotMatch(restore, /onClick=\{\(\) => \(reset\(\)/);
});

test("Removing a Bitbucket or Linear key, or your wallpaper picture, asks for a second press", async () => {
  const sc = await uiSrc("settings/SourceControl.tsx");
  assert.doesNotMatch(sc, /onClick=\{\(\) => void forget\(/, "a key goes from the keychain on one press");
  assert.equal(sc.match(/<SureButton[^>]*onConfirm=\{\(\) => void forget\(/g)?.length, 2);
  const dots = await uiSrc("Dots.tsx");
  assert.doesNotMatch(dots, /onClick=\{remove\}/, "your picture is deleted on one press");
  assert.match(dots, /<SureButton[^>]*onConfirm=\{remove\}/);
});

test("Enter in Setup's clone field starts no second clone while one is running", async () => {
  const clone = between(await uiSrc("Setup.tsx"), "const doClone = async () => {", "\n  };");
  assert.match(clone, /cloningNow\.current\) return;/, "a second Enter starts a second clone of the same repository");
  assert.match(clone, /cloningNow\.current = false/);
});

test("A key Setup's engine turns away is not left in the Keychain", async () => {
  const save = between(await uiSrc("Setup.tsx"), "const save = async () => {", "\n  };");
  const engine = save.indexOf('rpc("keys.set"');
  const keychain = save.indexOf("bridge.keychainSet(");
  assert.ok(engine >= 0 && keychain >= 0, "the key's save is not where it was");
  assert.ok(engine < keychain, "the key is in the Keychain before the engine has taken it, and stays there when it is turned away");
});

test("Escape on an app's new name in Liner MCP cancels it, even when the field's blur comes after", async () => {
  const mcp = await uiSrc("settings/LinerMcp.tsx");
  const rename = between(mcp, "const rename = () => {", "\n  };");
  assert.match(rename, /if \(dropped\.current\)/, "a blur after Escape saves the name you meant to drop");
  assert.match(mcp, /e\.key === "Escape" \? \(\(dropped\.current = true\), setNaming\(null\)\)/);
});
