/*
  Seven faults found in review of Liner Design and Liner Security, each held here: seeded words kept when a design's
  dock gets its session, Skip the rest on a scan's questions, an empty search that closes, focus kept through the
  project chooser's Back and a ··· that opens on its menu, a paid picture never made by a plain Enter, one working mark
  on a running scan, and a frame's menu that waits while an old turn is shown. These are SOURCE tests (the faces are
  component markup, so the wiring is read from the file as written; precedent: said-states.test.ts).
  Run with `node --test engine/test/review-fixes-design-security.test.ts`.
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

test("Words seeded for a design's session reach its box when the dock's draft key turns into the session's id", () => {
  const composer = span(app("Composer.tsx"), "export function Composer(", "const caretToEnd = useRef(false);");
  // The box stays mounted when its key changes, so its useState initialiser alone never reads the new key's draft.
  const keyed = span(composer, "const keyWas = useRef(draftKey);", "}, [draftKey]);");
  assert.match(keyed, /keyWas\.current === draftKey\) return/, "the box does not notice its draft key changing");
  assert.match(keyed, /const saved = draftOf\(draftKey\)/, "the box does not read the draft saved under its new key");
  assert.match(keyed, /if \(text\.trim\(\) \|\| editing \|\| !saved\) return/, "the new key's draft is taken over words already in the box");
  assert.match(keyed, /setText\(saved\)/, "the new key's draft is not put in the box");
  assert.match(keyed, /caretToEnd\.current = true/, "the caret does not land after the seeded words (after https://)");
  // The empty text queued for the new key in the same commit is replaced, so it can never be written over the seed.
  assert.match(keyed, /pendingDraft\.current = \{ key: draftKey, text: saved \}/, "the empty box can still be saved over the seeded draft");
  // The lean page seeds by the session's id, which is what the dock's key becomes.
  assert.match(span(app("design/LeanPage.tsx"), "const seed = async", "return ("), /seedComposer\(id, text\)/, "the lean page no longer seeds the session's box");
});

test("A scan's questions offer Skip the rest beside Skip while two or more are left, and it skips them all at once", () => {
  const q = app("security/Questions.tsx");
  const acts = span(q, '<div className="lc-dask-acts">', "</section>");
  assert.match(acts, /Skip <kbd>esc<\/kbd>/, "Skip is gone from the card's foot");
  const rest = acts.match(/\{total - at >= 2 && \(\s*<button type="button" className="lc-dask-ghost l-focus"[^>]*onClick=\{\(\) => onDone\(state\.answers\)\}>\s*Skip the rest\s*<\/button>/);
  assert.ok(rest, "no quiet Skip the rest, shown while two or more questions are left, that sends the answers given so far");
});

test("Liner Security's Projects and Findings have one find field that is always there, so no toggle can open an empty search again", () => {
  // A toggle once got out of step with its field (a blur emptied it before the toggle's click opened it again): the field is always there now.
  for (const [file, words] of [["security/Projects.tsx", "Find a project"], ["security/Findings.tsx", "Find a finding"]]) {
    const src = app(file);
    const field = span(src, "<PaneField", "</PaneField>");
    assert.match(field, new RegExp(`placeholder="${words}"`), `${file}'s field does not say ${words}`);
    assert.doesNotMatch(field, /onBlur/, `${file}'s field still closes on blur`);
    assert.doesNotMatch(src, /setQuery\(query === null \? "" : null\)/, `${file} still toggles its search in and out`);
  }
});

test("The design's ··· keeps its menu whole: Build in a project opens the chooser to its side, so nothing is left behind or loses the focus", () => {
  const face = app("design/DesignFace.tsx");
  const more = span(face, "function TopMore(", "function TopRow(");
  // The chooser was once swapped in for the menu, which needed a way back and a reset when the menu closed: it opens beside the menu now, as a sidebar row's Snooze until does.
  assert.match(more, /<SubMenu title="Build in a project"[\s\S]*?<ProjectChooser/, "Build in a project no longer opens the chooser to the menu's side");
  assert.doesNotMatch(more, /ld-own-back|setChoosing/, "the ··· still swaps the chooser in for the menu, with its own back row");
  // Going in, the chooser's own Find field takes the focus as it mounts.
  assert.match(span(app("Projects.tsx"), "export function ProjectChooser(", "lc-pc-list"), /<input autoFocus /, "the chooser's Find field no longer takes the focus when it opens");
});

test("A paid picture is made by Cmd-Enter, not a plain Enter, and its words stay writable with no model or while one is made", () => {
  const composer = app("Composer.tsx");
  const box = span(composer, "export function SendBox(", "type PlusRow");
  assert.match(box, /enter = "send"/, "SendBox's Enter no longer sends by default");
  assert.match(box, /enter === "line" && e\.key === "Enter"\) \{\s*if \(!\(os\.macKeys \? e\.metaKey : e\.ctrlKey\)\) return;/, "under enter=\"line\" a plain Enter still sends");
  assert.match(box, /title=\{enter === "line" \? `Send \(\$\{os\.mod\}Enter\)` : "Send \(Enter\)"\}/, "Send's title does not name the key that sends");
  assert.match(box, /const ready = Boolean\(value\.trim\(\)\) && !disabled && !sendOff;/, "Send cannot wait while the field stays writable");
  const pic = span(app("design/Pictures.tsx"), '<SendBox field={field} className="ld-pic-ask"', "/>");
  assert.match(pic, /enter="line"/, "the picture prompt sends on a plain Enter, which costs money");
  assert.match(pic, /sendOff=\{!model \|\| busy\}/, "Send is not held while there is no model or a picture is being made");
  assert.doesNotMatch(pic, /\bdisabled=/, "the picture's words cannot be written while there is no model or one is being made");
});

test("A running scan says its count, step and time once: under the live line the status row goes, and Stop stays the message box's", () => {
  const scan = app("security/ScanSession.tsx");
  assert.match(scan, /const liveShown = useMemo\(\(\) => Boolean\(turnsOf\(items\)\.at\(-1\)\?\.items\.some\(\(x\) => x\.kind === "turn" && x\.status === "running"\)\), \[items\]\);/, "the scan does not judge when the live line shows as LiveLine does");
  assert.match(scan, /isScan && scan && !finished && \(!liveShown \|\| scan\.looking\) \? \(/, "the status row still shows under the live line, repeating it");
  const row = span(scan, "isScan && scan && !finished && (!liveShown || scan.looking) ? (", ") : isScan && scan && finished ? (");
  assert.match(row, /<StepMark state="working"/, "the status row's mark is not a step's");
  // The Plan card in the chat says "N of M done" (Timeline's cards): the row no longer counts again.
  assert.doesNotMatch(row, /of \$\{total\} done/, "the status row repeats the Plan card's count");
  assert.match(row, />\s*Stop\s*<\/button>/, "Stop is gone from the status row between turns");
  assert.match(scan, /onStop=\{stop\}/, "the message box's Stop is not the scan's");
});

test("A frame's Rename, Duplicate and Delete wait while an old turn is shown, and Deleted is said only when it went", () => {
  const more = span(app("design/Layers.tsx"), "function FrameMore(", "/** Opens the Lean page");
  assert.match(more, /const old = useDesign\(\(s\) => s\.scrub !== undefined\)/, "the frame's menu does not know an old turn is shown");
  for (const row of ["Rename", "Duplicate"]) assert.match(more, new RegExp(`<Row title="${row}"[^\\n]*disabled=\\{old\\}`), `${row} is offered while an old turn is shown`);
  assert.match(span(more, 'title="Delete"', "onPick"), /disabled=\{old\}/, "Delete is offered while an old turn is shown");
  assert.match(more, /title=\{old \? OLD_SHOWN : undefined\}/, "the waiting rows don't say why");
  assert.match(app("design/Layers.tsx"), /const OLD_SHOWN = "An old turn is shown: go back to now to change the design";/, "the reason is not the canvas's own words");
  assert.match(more, /\.then\(\(step\) => step && toast\(`Deleted \$\{f\.name\}`/, "the menu says Deleted when nothing was removed");
  // The canvas's Delete key had the same toast.
  const remove = span(app("design/DesignFace.tsx"), "async function remove()", "\n}\n");
  assert.match(remove, /if \(step\) toast\(whole\.length === 1 \? `Deleted \$\{named\}`/, "Delete on the canvas says Deleted when nothing was removed");
});
