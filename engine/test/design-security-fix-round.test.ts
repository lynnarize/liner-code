/*
  The fix round of the right-panel build in Liner Design and Liner Security: Build stays in reach while Send or Update
  has the inspector foot's ink, the dock's tray shows at most one ink button and never the foot's own action twice,
  Dismiss › Other dismisses with no note again, a finding opened in a narrow window is a drawer of the paper, and the
  Design pages draw Show the sidebar with the one shared part. The pure logic is run; the wiring in the components is
  read from the source as written (precedent: review-fixes-design-security.test.ts).
  Run with `node --test engine/test/design-security-fix-round.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { footButtons } from "../../ui/src/app/design/build-foot.ts";
import { claimInk, inkClaims, trayInk } from "../../ui/src/app/design/tray-ink.ts";

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
const sheet = (file: string) => app(file).replace(/\/\*[\s\S]*?\*\//g, "");

test("A frame not built yet can still be built while another frame is ahead of the code or live changes wait", () => {
  // One frame Design-ahead and one Not built: Update code has the ink and Build sits beside it, quiet.
  assert.deepEqual(footButtons({ waiting: 0, ahead: 1, screens: 2, notBuilt: 1 }), { ink: "update", quietBuild: true });
  assert.deepEqual(footButtons({ waiting: 3, ahead: 1, screens: 2, notBuilt: 1 }), { ink: "send", quietBuild: true });
  // Nothing left to build: no quiet Build beside Send or Update.
  assert.deepEqual(footButtons({ waiting: 0, ahead: 2, screens: 2, notBuilt: 0 }), { ink: "update", quietBuild: false });
  assert.deepEqual(footButtons({ waiting: 1, ahead: 0, screens: 2, notBuilt: 0 }), { ink: "send", quietBuild: false });
  // Build alone is the ink; every screen built and in step is words with no button.
  assert.deepEqual(footButtons({ waiting: 0, ahead: 0, screens: 2, notBuilt: 1 }), { ink: "build", quietBuild: false });
  assert.deepEqual(footButtons({ waiting: 0, ahead: 0, screens: 0, notBuilt: 0 }), { ink: "build", quietBuild: false });
  assert.deepEqual(footButtons({ waiting: 0, ahead: 0, screens: 2, notBuilt: 0 }), { quietBuild: false });

  const foot = span(app("design/BuildTab.tsx"), "function BuildFoot(", "// The foot is the inspector's slot");
  assert.match(foot, /footButtons\(\{ waiting, ahead: ahead\.length, screens: screens\.length, notBuilt: none\.length \}\)/, "the foot does not ask build-foot.ts what it offers");
  const quiet = span(foot, "const quietBuild", "if (offer.ink === \"send\")");
  assert.match(quiet, /<PaneButton title=/, "the foot's Build beside Send or Update is gone");
  assert.ok(!/<PaneButton ink/.test(quiet), "the foot's Build beside Send or Update is ink: two ink buttons in one foot");
  assert.match(quiet, /buildAsk\(none\)/, "the quiet Build does not build the frames not built yet");
  // The quiet Build comes before the ink button in both branches, so the ink one stays last.
  for (const word of ["Send to code", "Update code"]) {
    const branch = span(foot, `if (offer.ink === "${word === "Send to code" ? "send" : "update"}")`, word);
    assert.match(branch, /\{quietBuild\}\s*<PaneButton ink/, `${word} has no quiet Build before it`);
  }
});

test("The Design dock's tray shows one ink button at most, and none that repeats the inspector foot's ink action", () => {
  // Alone in the tray and not the foot's: ink.
  assert.equal(trayInk("keep", ["keep"], []), true);
  // Two rows with a button: both quiet.
  assert.equal(trayInk("keep", ["load", "keep"], []), false);
  assert.equal(trayInk("load", ["load", "keep"], []), false);
  // The foot shows Update code in ink: the tray's Update code is quiet, and what is left alone may be ink.
  assert.equal(trayInk("update", ["update"], ["update"]), false);
  assert.equal(trayInk("update", ["update", "fix"], ["update"]), false);
  assert.equal(trayInk("fix", ["update", "fix"], ["update"]), true);
  assert.equal(trayInk("fix", ["fix"], ["fix"]), false);
  // Claims come and go with the rows and the foot.
  const before = inkClaims();
  const off = [claimInk("tray", "send"), claimInk("foot", "send")];
  assert.deepEqual(inkClaims().tray.length - before.tray.length, 1);
  assert.equal(trayInk("send", inkClaims().tray, inkClaims().foot), false);
  off.forEach((f) => f());
  assert.deepEqual(inkClaims(), before);

  // Every tray row with a button asks tray-ink.ts, and none is ink by a literal any more.
  const rows: [string, string, string, string][] = [
    ["design/BuildTab.tsx", "export function WaitRow(", "useTrayInk(", "\"update\""],
    ["design/Ways.tsx", "export function WaysRow(", "useTrayInk(picked ? \"keep\"", "Keep"],
    ["design/ChecksTab.tsx", "export function ChecksRow(", "useTrayInk(all.length ? \"fix\"", "Fix all"],
    ["design/Skills.tsx", "function FitRow(", "useTrayInk(fit && place === \"dock\" ? \"load\"", "Load it"],
  ];
  for (const [file, from, hook] of rows) {
    const row = span(app(file), from, "\n}\n");
    assert.ok(row.includes(hook), `${from} in ${file} does not claim its ink from tray-ink.ts`);
    assert.ok(!row.includes('data-kind="ink"'), `${from} in ${file} still draws its button in ink whatever else shows`);
  }
  // The foot claims what it shows in ink: Send or Update from BuildFoot, Fix all from Checks.
  assert.match(span(app("design/BuildTab.tsx"), "function BuildFoot(", "// The foot is the inspector's slot"), /useInkClaim\("foot", [^;]*offer\.ink === "send" \|\| offer\.ink === "update" \? offer\.ink/, "BuildFoot does not claim its Send or Update");
  assert.match(span(app("design/ChecksTab.tsx"), "function ChecksFoot(", "\n}\n"), /useInkClaim\("foot", all\.length \? "fix" : undefined\)/, "the Checks foot does not claim Fix all");
});

test("Dismiss › Other dismisses without a note while the note is empty, since the message box sends only words", () => {
  const dismiss = span(app("security/FindingPanel.tsx"), "function Dismiss(", "export function FindingPanel(");
  const other = span(dismiss, "other ? (", ") : (");
  const row = span(other, "{!note.trim() && (", "</>\n            )}");
  assert.match(row, /<Row title="Dismiss without a note"/, "Other has no way to dismiss with an empty note");
  assert.match(row, /onDismiss\("other"\)/, "the row does not dismiss as Other");
  assert.match(row, /close\(\)/, "the row leaves the menu open after it dismissed");
});

test("A finding opened in a narrow window is a drawer of the paper, so the list and the page head never show through", () => {
  const css = sheet("security/findings.css");
  const narrow = span(css, "@container lf-page (max-width: 920px)");
  const drawer = narrow.match(/\.lf-x\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(drawer, /position:\s*absolute;/, "the narrow finding is no longer the drawer this test is about");
  assert.match(drawer, /background:\s*var\(--lc-paper\);/, "the drawer over the list has no background");
  assert.match(drawer, /z-index:\s*20;/, "the drawer no longer sits over the page head");
});

test("Liner Design's Home and Lean page draw Show the sidebar with the one shared part", () => {
  for (const file of ["design/LeanPage.tsx", "design/DesignHome.tsx"]) {
    const src = app(file);
    assert.match(src, /\{!sidebar && <ShowSidebar onShow=\{onSidebar\} \/>\}/, `${file} does not use ShowSidebar`);
    assert.ok(!/aria-label="Show the sidebar"/.test(src), `${file} still draws its own Show the sidebar button`);
  }
});
