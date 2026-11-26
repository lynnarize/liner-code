/*
  State the app kept past the moment it was for: a confirm row armed long after its first press (the team card stays up,
  so its row never unmounts), Security's Dismiss reopening on the last finding's note, the "/" list taken from another
  box's thread, and the design skills' tag the "/" row lost. The deciding part is run as a pure function where one could
  be pulled out (confirm.ts, composer-rules.ts, api.ts); the wiring in the components is read from the source as written
  (precedent: reviewed-faults.test.ts). Run with `node --test engine/test/stale-ui-state.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as confirm from "../../ui/src/app/confirm.ts";
import * as rules from "../../ui/src/app/composer-rules.ts";
import * as api from "../src/api.ts";

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

test("A confirm left armed past its lapse asks again, so a stray press minutes later doesn't act", () => {
  const lapse = (confirm as Record<string, unknown>).CONFIRM_LAPSE;
  assert.equal(typeof lapse, "number", "confirm.ts has no lapse after which an ask runs out");
  const { CONFIRM_SETTLE, confirmPress } = confirm;
  assert.ok((lapse as number) > CONFIRM_SETTLE * 4, "the lapse is too short to read the confirm and press it");
  assert.equal(confirmPress(1000, 1000 + CONFIRM_SETTLE), "do");
  assert.equal(confirmPress(1000, 1000 + (lapse as number) - 1), "do");
  assert.equal(confirmPress(1000, 1000 + (lapse as number)), "ask", "a press at the lapse still acts on the old ask");
  assert.equal(confirmPress(1000, 1000 + 10 * 60_000), "ask", "a press minutes after an abandoned ask acts at once");
});

test("A confirm row disarms by itself after the lapse and when the focus leaves it, wherever it stays mounted", () => {
  const ui = app("ui.tsx");
  const row = span(ui, "export function ConfirmRow(", "export const PanelHead");
  assert.match(row, /setTimeout\(\(\) => setAskedAt\(null\), CONFIRM_LAPSE\)/, "the row stays armed until it unmounts");
  assert.match(row, /onBlur=\{asked \? \(\) => setAskedAt\(null\) : undefined\}/, "the row stays armed after the focus has gone elsewhere");
  assert.match(span(ui, "export function Row(", "export function ConfirmRow("), /onBlur=\{onBlur\}/, "a row can't hear the focus leave it");
  // The Agents panel's team menu (the team card that never unmounted is gone, 2026-11-26) still uses the shared row.
  assert.match(app("Crew.tsx"), /<ConfirmRow title=\{isSwarmMode \? "Turn the swarm off" : "Turn Teamwork off"\}/);
});

test("Security's Dismiss starts at its reasons each time it opens, and never on another finding's note", () => {
  const panel = app("security/FindingPanel.tsx");
  const dismiss = span(panel, "function Dismiss(", "export function FindingPanel(");
  assert.match(dismiss, /onOpenChange=\{\(open\) => !open && \(setOther\(false\), setNote\(""\)\)\}/, "Dismiss closed by a click outside or Escape reopens on Other with the old note");
  assert.match(span(panel, "export function FindingPanel("), /<Dismiss key=\{f\.id\} /, "the next finding's Dismiss keeps the last one's Other and note");
});

test("A triage note typed on one finding is let go on Next, so Enter never adds it to the next finding", () => {
  const panel = span(app("security/FindingPanel.tsx"), "export function FindingPanel(");
  assert.match(panel, /useEffect\(\(\) => setNote\(""\), \[f\.id\]\)/, "the triage note box keeps the last finding's words");
});

test("The / list is asked and kept per thread, and a side chat with no thread yet asks without the team commands", () => {
  const commandsAsk = (rules as Record<string, unknown>).commandsAsk as ((projectId: string, agent: string, threadId: string | undefined, aside: boolean) => { key: string; ask: Record<string, unknown> }) | undefined;
  assert.equal(typeof commandsAsk, "function", "composer-rules.ts has no rule for how a box asks for its commands");
  const session = commandsAsk!("p", "claude", "t1", false);
  const other = commandsAsk!("p", "claude", "t2", false);
  const home = commandsAsk!("p", "claude", undefined, false);
  const sideNew = commandsAsk!("p", "claude", undefined, true);
  const sideThread = commandsAsk!("p", "claude", "s1", true);
  assert.equal(new Set([session.key, other.key, home.key, sideNew.key, sideThread.key]).size, 5, "two boxes share one cached answer the engine gives differently");
  assert.deepEqual(session.ask, { projectId: "p", agent: "claude", threadId: "t1" });
  assert.deepEqual(home.ask, { projectId: "p", agent: "claude", threadId: undefined }, "Home asks differently than before");
  assert.equal(sideNew.ask.team, false, "a side chat before its first turn is offered /teamwork and /swarm");
  assert.equal(sideThread.ask.team, false);

  const takesTeam = (api as Record<string, unknown>).takesTeam as ((t: { sideOf?: string; security?: unknown } | undefined, team?: boolean) => boolean) | undefined;
  assert.equal(typeof takesTeam, "function", "the engine has no rule for when the / list takes the team commands");
  assert.equal(takesTeam!(undefined), true, "Home lost /teamwork and /swarm");
  assert.equal(takesTeam!({}), true);
  assert.equal(takesTeam!({ sideOf: "t1" }), false);
  assert.equal(takesTeam!({ security: { kind: "scan" } }), false);
  assert.equal(takesTeam!(undefined, false), false, "the box's no-team hint is not heard");
  assert.equal(takesTeam!({}, true), true);
  assert.equal(takesTeam!({ sideOf: "t1" }, true), false, "a hint gives a side chat the team commands");

  const composer = app("Composer.tsx");
  assert.match(span(composer, "const commandsFor = ", "\n};\n"), /commandsAsk\(projectId, agent, threadId, aside\)/, "the box's cache is not keyed by commandsAsk");
  assert.match(composer, /commandsFor\(project\.id, who, thread\?\.id, aside\)/);
  assert.match(composer, /\}, \[mention\?\.kind, project\.id, who, thread\?\.id, aside, !tools\]\);/, "the box doesn't ask again when its thread changes");
  assert.match(composer, /useEffect\(\(\) => setTools\(null\), \[project\.id, who, thread\?\.id, aside\]\);/, "the box keeps the last thread's commands");
  assert.match(span(readFileSync(new URL("../src/api.ts", import.meta.url), "utf8"), '"agent.commands": async (', '"usage.limits"'), /const team = takesTeam\(t, hint\);/, "the engine doesn't hear the box's hint");
});

test("A design skill not loaded yet keeps its Load for this design tag in the / list", () => {
  const composer = app("Composer.tsx");
  const row = span(composer, 'f.kind === "/" ? (', ") : (");
  assert.match(row, /\{f\.tag && <span className="lc-mp-def">\{f\.tag\}<\/span>\}/, "the / row draws no tag");
  assert.ok(!row.includes('"Liner Code"'), "Liner Code's own commands are tagged again");
  assert.match(app("design/Skills.tsx"), /tag: "Load for this design"/);
  // With no note beside it the tag still sits at the row's end, where the note's room would end.
  assert.match(app("surfaces.css"), /\.lc-mention-row\[data-kind="\/"\] \.lc-mp-def \{\s*margin-left: auto;/);
});
