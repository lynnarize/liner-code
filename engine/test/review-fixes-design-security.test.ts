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

test("Pressing the pressed Search on Liner Security's Projects closes an empty search, as on Findings", () => {
  const find = span(app("security/Projects.tsx"), '<span className="lo-find">', "</span>");
  // A blur that emptied the query ran before the toggle's click, which then saw it closed and opened it again.
  assert.doesNotMatch(find, /onBlur/, "the search field still closes on blur, so the toggle opens an empty search again");
  assert.match(app("security/Projects.tsx"), /onClick=\{\(\) => setQuery\(query === null \? "" : null\)\}/, "the toggle no longer opens and closes the search");
  assert.doesNotMatch(span(app("security/Findings.tsx"), "{query !== null ? (", "</button>"), /onBlur/, "Findings' search and Projects' no longer behave alike");
});

test("The design's ··· opens on its menu after the chooser was left open, and Back from the chooser keeps the focus on its row", () => {
  const face = app("design/DesignFace.tsx");
  const more = span(face, "function TopMore(", "function TopRow(");
  // The chooser's state outlives the panel: something mounted with the panel's content puts it back when the panel goes.
  assert.match(span(face, "function OnGone(", "/**"), /useEffect\(\(\) => \(\) => was\.current\(\), \[\]\)/, "nothing runs when the menu's content goes");
  assert.match(more, /\{\(close\) => \(\s*<>[\s\S]*?<OnGone run=\{\(\) => setChoosing\(false\)\} \/>/, "closing the menu leaves the chooser for the next ···");
  // Back: the focused button goes with the chooser, so focus is put on the row that opened it.
  assert.match(more, /className="ld-own-back l-focus" onClick=\{\(e\) => back\(e\.currentTarget\)\}/, "Back from the chooser drops the focus to the page");
  assert.match(span(more, "const back = ", "return ("), /textContent === BUILD_IN\)\?\.focus\(/, "Back does not focus the Build in a project row");
  assert.match(more, /<Row title=\{BUILD_IN\}/, "the row Back looks for is not named by the same words");
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

test("A running scan shows one working mark: under the live line the status row only counts, with Stop", () => {
  const scan = app("security/ScanSession.tsx");
  assert.match(scan, /const liveShown = useMemo\(\(\) => Boolean\(turnsOf\(items\)\.at\(-1\)\?\.items\.some\(\(x\) => x\.kind === "turn" && x\.status === "running"\)\), \[items\]\);/, "the scan does not judge when the live line shows as LiveLine does");
  const row = span(scan, "isScan && scan && !finished ? (", ") : isScan && scan && finished ? (");
  assert.match(row, /\{!liveShown && <StateMark state="working"/, "the status row keeps its working mark under the live line's");
  assert.match(row, /\[liveShown \? "" : "Working", total \? `\$\{done\} of \$\{total\} done` : ""/, "the status row still says Working under the live line");
  assert.match(row, />\s*Stop\s*<\/button>/, "Stop is gone from the status row");
});

test("A frame's Rename, Duplicate and Delete wait while an old turn is shown, and Took the frame away is said only when it went", () => {
  const more = span(app("design/Layers.tsx"), "function FrameMore(", "/** Opens the Lean page");
  assert.match(more, /const old = useDesign\(\(s\) => s\.scrub !== undefined\)/, "the frame's menu does not know an old turn is shown");
  for (const row of ["Rename", "Duplicate"]) assert.match(more, new RegExp(`<Row title="${row}"[^\\n]*disabled=\\{old\\}`), `${row} is offered while an old turn is shown`);
  assert.match(span(more, 'title="Delete"', "onPick"), /disabled=\{old\}/, "Delete is offered while an old turn is shown");
  assert.match(more, /title=\{old \? OLD_SHOWN : undefined\}/, "the waiting rows don't say why");
  assert.match(app("design/Layers.tsx"), /const OLD_SHOWN = "An old turn is shown: go back to now to change the design";/, "the reason is not the canvas's own words");
  assert.match(more, /\.then\(\(step\) => step && toast\("Took the frame away"/, "the menu says Took the frame away when nothing was removed");
  // The canvas's Delete key had the same toast.
  const remove = span(app("design/DesignFace.tsx"), "async function remove()", "\n}\n");
  assert.match(remove, /if \(step\) toast\(whole\.length === 1 \? "Took the frame away"/, "Delete on the canvas says Took the frame away when nothing was removed");
});
