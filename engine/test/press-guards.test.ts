/*
  Compact and Send-now take one press (plan 019, steps 5-6): Compact is disabled from its own press, not only the
  turn's status an engine round-trip later, and a held ⌘⇧Enter sends one message, not one per key-repeat. These are
  SOURCE tests — the wiring is read from the files as written (precedent: layout-rules.test.ts, said-states.test.ts).
  Run with `node --test engine/test/press-guards.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const app = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
/** One region of a file, from its marker to the next marker (or the end of the file). */
const span = (src: string, from: string, to?: string) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker not found: ${from}`);
  if (to === undefined) return src.slice(a);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `end marker not found after "${from}": ${to}`);
  return src.slice(a, b);
};

test("Compact is disabled from its own press, not only the turn's status", () => {
  const sinfo = app("SessionInfo.tsx");
  const surface = span(sinfo, "export function SessionSurface(", "/** The pull request's checks");
  assert.ok(/const \[compacting, setCompacting\] = useState\(false\)/.test(surface), "Compact keeps no state of its own press");
  const press = span(surface, "const compactNow", "\n  };");
  assert.ok(/if \(compacting\) return;/.test(press), "a second press is not held back while the first is on its way");
  assert.ok(/setCompacting\(true\)/.test(press), "the press does not mark itself in flight");
  assert.ok(/setCompacting\(false\)/.test(press), "the settle does not clear the mark");
  assert.ok(/compacting=\{compacting\}/.test(surface), "the compacting state does not reach the card whose button reads it");
  const card = span(sinfo, "function ContextCard(");
  assert.ok(/disabled=\{running \|\| !ctx \|\| compacting\}/.test(card), "the Compact button does not read the compacting state");
});

test("a held Send-now shortcut sends one message", () => {
  const composer = app("Composer.tsx");
  const keys = span(composer, "// ⌘⇧Enter sends the first queued message", "}, [thread?.id]);");
  assert.ok(/e\.repeat/.test(keys), "the Send-now keydown does not ignore a held key's repeats");
  assert.ok(/const sendingNow = useRef\(new Set<string>\(\)\)/.test(composer), "sendNow keeps no in-flight set");
  const send = span(composer, "const sendNow = ", "\n  useEffect(");
  assert.ok(/sendingNow\.current\.has\(q\.id\)/.test(send), "sendNow does not hold back a message already on its way");
  assert.ok(/sendingNow\.current\.add\(q\.id\)/.test(send), "sendNow does not mark its message in flight");
  assert.ok(/sendingNow\.current\.delete\(q\.id\)/.test(send), "the catch does not clear the mark when the queue comes back");
  const steeredRegion = span(composer, "const sendNow = ", "}, [thread?.queue]);");
  const steered = steeredRegion.slice(steeredRegion.lastIndexOf("useEffect("));
  assert.ok(steered.includes("const s = steered.current;"), "the steered effect could not be read");
  assert.ok(/sendingNow\.current\.delete\(id\)/.test(steered), "the queue effect does not clear the mark once the message is gone");
});
test("Compact stays held from its press until its turn is seen running, not only until the send is accepted", () => {
  const surface = span(app("SessionInfo.tsx"), "export function SessionSurface(", "/** The pull request's checks");
  const press = span(surface, "const compactNow", "\n  };");
  // thread.send answers before the turn's status arrives, so clearing the mark on that answer leaves a gap a second press gets through.
  assert.ok(!/\.finally\(\(\) => setCompacting\(false\)\)/.test(press), "the mark clears as soon as the send is accepted, before the turn is seen running");
  assert.ok(/useEffect\(\(\) => \{\s*if \(!compacting\) return;\s*if \(running\) return void setCompacting\(false\);/.test(surface), "nothing hands the mark over to the turn's own running state");
  assert.ok(/setTimeout\(\(\) => setCompacting\(false\), 5000\)/.test(surface), "a mark whose turn never shows running is never let go");
});
