/*
  Liner Design's chat made small from the keyboard gives the focus to the small row's way to open it again. The query
  that finds it is read from Chat.tsx and tried on the small row's markup as ChatMin draws it, since the source has
  nothing to run. Run with `node --test engine/test/design-chat-focus.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const chat = readFileSync(new URL("../../ui/src/app/design/Chat.tsx", import.meta.url), "utf8");
const query = chat.match(/export const OPEN_AGAIN = "([^"]+)";/)?.[1];

// A small selector matcher for the shapes the query uses: `.a > .b`, `.a [aria-label='…']` and `.a .b`, against a tree of {class, label, kids}.
type El = { cls: string[]; label?: string; kids: El[] };
const el = (cls: string, kids: El[] = [], label?: string): El => ({ cls: cls.split(" ").filter(Boolean), label, kids });
const one = (e: El, part: string) => (part.startsWith(".") ? e.cls.includes(part.slice(1)) : part === `[aria-label='${e.label}']`);
function finds(root: El, selector: string): boolean {
  // Compound selectors with the combinator that joins each to the one before it (" " for any ancestor, ">" for the parent).
  const steps: { part: string; by: " " | ">" }[] = [];
  let by: " " | ">" = " ";
  for (const t of selector.match(/\[[^\]]*\]|[^\s>[]+|>/g) ?? []) t === ">" ? (by = ">") : (steps.push({ part: t, by }), (by = " "));
  // Right to left, as a browser matches: `chain` is the element's ancestors, nearest last.
  const match = (chain: El[], i: number): boolean => {
    const e = chain[chain.length - 1];
    if (!e || !one(e, steps[i].part)) return false;
    if (i === 0) return true;
    const up = chain.slice(0, -1);
    if (steps[i].by === ">") return match(up, i - 1);
    for (let n = up.length; n > 0; n--) if (match(up.slice(0, n), i - 1)) return true;
    return false;
  };
  const all = (e: El, chain: El[]): boolean => match([...chain, e], steps.length - 1) || e.kids.some((k) => all(k, [...chain, e]));
  return all(root, []);
}
const any = (root: El) => (query ?? "").split(",").some((s) => finds(root, s));

test("Liner Design's chat made small gives the focus to the row's way to open it again, done or working", () => {
  assert.ok(query, "Chat.tsx no longer names the small row's way to open the chat");
  // Done: the row is a button named by its line (no aria-label of its own), beside the pin.
  const done = el("ld-dock", [el("ldc-min", [el("ldc-min-t l-focus"), el("ldc-v"), el("lc-tb l-focus", [], "Pin the chat beside the canvas")])]);
  // Working: the live line, with the open button and the pin at its end.
  const working = el("ld-dock", [el("lc-ll ldc-live", [el("lc-ll-end", [el("lc-tb l-focus", [], "Open the chat"), el("lc-tb l-focus", [], "Pin the chat beside the canvas")])])]);
  assert.ok(any(done), "with the turn done, nothing on the small row is found, so the focus is lost when the chat is made small");
  assert.ok(any(working), "while it works, the live line's open button is not found, so the focus is lost when the chat is made small");
  // The conversation's own live line, inside the open chat, has no open button: nothing there is taken for it.
  const open = el("ldc-open", [el("lc-ll ldc-live", [el("lc-ll-end")])]);
  assert.ok(!any(open), "the open chat's live line is taken for the way to open the chat");
  // And Chat.tsx focuses what it names.
  assert.match(chat, /querySelector<HTMLElement>\(OPEN_AGAIN\)\?\.focus/, "minimise no longer focuses the row's way to open the chat");
});
