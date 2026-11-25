/*
  Faults found in the review of the app before 0.3.2: the inspector looping on a frame, the Wall's Review queue missing
  open pull requests, a team turned off by one press, a bulk Dismiss reaching findings out of sight, a question's own words
  coming back twice, split view's Previous, Next and line asks finding nothing, a Browser ask card holding the app's keys,
  Mark unread undone at once, a dragged queued message dropping its id in the box, and pages Liner Design's keyboard
  couldn't reach. The deciding part is run as a pure function where one could be pulled out; the wiring in the
  components is read from the source as written (precedent: reviewed-faults.test.ts).
  Run with `node --test engine/test/release-review-0-3-2.test.ts`.
*/
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { Thread } from "../../contracts/src/index.ts";
import { needsReview } from "../../ui/src/app/session-state.ts";
import { answerOf, OTHER, seedOf } from "../../ui/src/app/question-seed.ts";
import { pickedToAct } from "../../ui/src/app/security/picks.ts";
import { anyModal } from "../../ui/src/app/menu-keys.ts";
import { clearsUnread, markUnread, shownAfresh } from "../../ui/src/app/row-menu.ts";
import { SPLIT_CHANGE, SPLIT_LINE } from "../../ui/src/app/review-words.ts";
import { draftRead, draftSaves } from "../../ui/src/app/kept.ts";

const APP = fileURLToPath(new URL("../../ui/src/app/", import.meta.url));
const app = (file: string) => readFileSync(join(APP, file), "utf8");
const span = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker not found: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `end marker not found after "${from}": ${to}`);
  return src.slice(a, b);
};
/** Each call's argument text: `name(` up to its matching `)`. */
function callsOf(src: string, name: string) {
  const out: string[] = [];
  for (let i = src.indexOf(`${name}(`); i >= 0; i = src.indexOf(`${name}(`, i + 1)) {
    let depth = 0;
    let j = i + name.length;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) break;
    }
    out.push(src.slice(i + name.length + 1, j));
  }
  return out;
}
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

test("Every Liner Design selector hands back the same value while nothing changed, so picking a frame never loops the inspector", () => {
  // useDesign is a bare useSyncExternalStore: a selector that builds a new array or object on each read never settles, and
  // React re-renders it until it gives up (the Style tab with a frame picked did).
  const fresh: string[] = [];
  for (const file of walk(join(APP, "design")).filter((f) => /\.tsx?$/.test(f))) {
    for (const body of callsOf(readFileSync(file, "utf8"), "useDesign")) {
      const builds = /\.map\(|\.filter\(|\[\.\.\.|new Set\(|=>\s*\(?\{|=>\s*\[/.test(body);
      const settles = /\.join\([^()]*\)\s*$|\.length\s*$/.test(body.trim());
      if (builds && !settles) fresh.push(`${file.slice(APP.length)}: ${body.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  assert.deepEqual(fresh, [], "a selector builds a fresh array or object on every read");
});

test("The Wall's Review queue counts a session whose pull request is open, as gh says it", () => {
  const t = { archived: false, done: false, status: "idle", toReview: 0, pr: { number: 4, url: "u", state: "OPEN" } } as unknown as Thread;
  assert.equal(needsReview(t), true, "an open pull request is not in the Review queue");
  assert.equal(needsReview({ ...t, pr: { ...t.pr!, state: "MERGED" } }), false);
  assert.equal(needsReview({ ...t, pr: undefined }), false);
});

test("Multi-agent's Off asks before it turns a running team off, as the team card's Turn it off does", () => {
  const row = span(app("SessionInfo.tsx"), "export function MultiAgentRow(", "function Setup(");
  assert.match(row, /<ConfirmRow[^>]*title="Off"[^>]*onConfirm=\{\(\) => multiAgent\("off", done\)\}/, "Off stops every worker on one press");
  assert.match(row, /mode === "Off" \?/, "Off is a confirm even while nothing is on");
});

test("A bulk Dismiss or Reopen acts only on the picked findings still shown in the tab", () => {
  const shown = [{ id: "a" }, { id: "c" }];
  assert.deepEqual(pickedToAct(new Set(["a", "b", "c"]), shown), ["a", "c"], "it acts on findings filtered out of sight");
  assert.deepEqual(pickedToAct(new Set(["b"]), shown), []);
  const page = app("security/Findings.tsx");
  assert.match(span(page, "const bulkAction = async", "const counts"), /const ids = pickedToAct\(pickedIds, shown\);/, "the bulk action doesn't go by what is shown");
  assert.match(page, /const pickedShown = pickedToAct\(pickedIds, shown\)\.length;/, "the bar counts findings that aren't shown");
});

test("Your own words in a multiple choice come back once after the card is drawn again, commas and all", () => {
  const q = { question: "Which store?", multiSelect: true, options: [{ label: "Redis" }, { label: "SQLite, on disk" }] };
  for (const [picks, other] of [
    [["Redis", OTHER], { "Which store?": "Postgres, not MySQL" }],
    [[OTHER], { "Which store?": "Postgres" }],
    [["SQLite, on disk"], {}],
    [["SQLite, on disk", "Redis", OTHER], { "Which store?": "a file" }],
  ] as [string[], Record<string, string>][]) {
    const said = answerOf(q, { [q.question]: picks }, other);
    const back = seedOf([q], { [q.question]: said });
    assert.equal(answerOf(q, back.picks, back.other), said, `"${said}" comes back as "${answerOf(q, back.picks, back.other)}"`);
    assert.ok(back.picks[q.question].filter((p) => p === OTHER).length <= 1, "your own words are picked twice");
  }
  const one = { question: "Name?", options: [{ label: "Tide" }] };
  assert.deepEqual(seedOf([one], { "Name?": "Ebb" }), { picks: { "Name?": [OTHER] }, other: { "Name?": "Ebb" } });
  assert.match(app("Timeline.tsx"), /seedOf\(it\.questions, it\.partial\)/, "the card doesn't seed from question-seed.ts");
});

test("Split view's Previous and Next and its line asks find what CodeDiff draws", () => {
  const diff = readFileSync(new URL("../../ui/src/liner/pro/code-diff/code-diff.tsx", import.meta.url), "utf8");
  // A change in split view is a pair of lines whose first carries the change's index; each line's number is its own span,
  // the old file's on the left and the new file's on the right.
  assert.match(diff, /className="l-cdiff__pair" data-change=\{pr\.change\}/);
  assert.match(diff, /<Line row=\{pr\.l\} side="old" p=\{p\} \/>\s*<Line row=\{pr\.r\} side="new" p=\{p\} \/>/);
  assert.match(diff, /<div className="l-cdiff__line"[^>]*>\s*<span className="l-cdiff__n"/);
  assert.equal(SPLIT_CHANGE, ".l-cdiff__pair[data-change]", "Previous and Next look for rows CodeDiff never draws");
  assert.equal(SPLIT_LINE, ".l-cdiff__pair > .l-cdiff__line:last-child > .l-cdiff__n", "a line ask looks for numbers CodeDiff never draws, or takes the old file's");
  const review = app("Review.tsx");
  assert.match(review, /querySelectorAll<HTMLElement>\(SPLIT_CHANGE\)/);
  assert.match(review, /closest<HTMLElement>\(SPLIT_LINE\)/);
});

test("An ask card left in the Browser, the Device or the design, or one in a hidden surface, doesn't hold the app's keys", () => {
  const el = (o: { ask?: boolean; shows?: boolean }) => ({ closest: (s: string) => (o.ask && s === ".lc-br-ask" ? {} : null), checkVisibility: () => o.shows !== false });
  assert.equal(anyModal([el({ ask: true })]), false, "a Browser ask card blocks every shortcut");
  assert.equal(anyModal([el({ shows: false })]), false, "a dialog in a hidden surface blocks every shortcut");
  assert.equal(anyModal([el({})]), true, "an open popup no longer holds the keys");
  assert.equal(anyModal([]), false);
  assert.match(app("App.tsx"), /const hasOpenModal = \(\) => anyModal\(document\.querySelectorAll\(MODAL\)\);/);
});

test("Mark unread on the session you are looking at stays until you leave it, and opening it again reads it", () => {
  shownAfresh("s1");
  assert.equal(clearsUnread("s1", true, true), true, "a turn that ends while you look is read");
  markUnread("s1", true);
  assert.equal(clearsUnread("s1", true, true), false, "Mark unread is undone at once");
  shownAfresh("s1");
  assert.equal(clearsUnread("s1", true, true), true, "opened again, it stays unread");
  markUnread("s2", true);
  markUnread("s2", false);
  assert.equal(clearsUnread("s2", true, true), true);
  assert.equal(clearsUnread("s1", true, false), false, "read in a window without focus");
  const unread = app("unread.ts");
  assert.match(unread, /clearsUnread\(id, unread, document\.hasFocus\(\)\)/);
  assert.match(unread, /shownAfresh\(id\)/);
  assert.match(app("App.tsx"), /markUnread\(here\.id, unreadRow\(here\)\.unread\)/, "⌘K's Mark unread isn't kept");
  assert.match(app("Sidebar.tsx"), /markUnread\(t\.id, unreadRow\(t\)\.unread\)/, "the row menu's Mark unread isn't kept");
});

test("A queued message dragged over the message box drops nothing into it", () => {
  const composer = app("Composer.tsx");
  assert.doesNotMatch(composer, /setData\("text\/plain", q\.id\)/, "the queued message's id lands in the box as text");
  assert.match(composer, /setData\(QUEUED_DRAG, q\.id\)/);
});

test("Liner Design's pages are reached and opened from the keyboard, as they were when each was a button", () => {
  const layers = app("design/Layers.tsx");
  const row = layers.slice(layers.indexOf("{file.pages.map((p) => ("), layers.indexOf('<SideLabel name="Layers" />'));
  assert.match(row, /tabIndex=\{0\}/, "a page row takes no focus");
  assert.match(row, /role="button"/);
  assert.match(row, /onKeyDown=\{\(e\) => \{[\s\S]*?e\.target !== e\.currentTarget[\s\S]*?e\.key === "Enter" \|\| e\.key === " "[\s\S]*?design\.setPage\(p\.id\)/, "Enter or Space on a page doesn't open it");
});

test("A key the engine missed while it reconnected leaves the shell and its scrollback on screen", () => {
  // The write's error was kept as the shell's, which hides the terminal behind "The shell couldn't start" for good.
  const term = app("Terminal.tsx");
  const write = span(term, 'void rpc("term.write", { id: idRef.current, data: d })', "});\n    /*");
  assert.doesNotMatch(write, /setSt\(/, "a failed key write takes the terminal's place");
  assert.match(write, /e instanceof EngineAway/, "a key lost while the engine reconnects is said on top of the Reconnecting pill");
});

test("A draft's kept files aren't let go by the empty box that opens before they are read back", () => {
  // The box first draws with no files, and writing that wiped the files kept for the draft before the read came back:
  // always so under StrictMode's second mount, and whenever the box went before the read did.
  assert.equal(draftSaves("d1", []), false, "the empty box wipes the kept files before they are read");
  assert.equal(draftSaves("d1", ["a file"]), true, "a file attached before the read is not kept");
  draftRead("d1");
  assert.equal(draftSaves("d1", []), true, "the last file taken out is still kept");
  const composer = app("Composer.tsx");
  assert.match(composer, /if \(draftSaves\(draftKey, files\)\) void saveDraftFiles\(draftKey, files, MAX_DRAFTS\);/);
  assert.match(composer, /draftRead\(draftKey\);/);
});

test("Ending a Swarm worker from its ··· asks once more, as turning the team off does", () => {
  const crew = app("Crew.tsx");
  assert.doesNotMatch(crew, /<Row title="End worker"/, "End worker ends a worker on one press");
  assert.match(crew, /<ConfirmRow title="End worker" sure=\{`End @\$\{m\.name\}: it stops for good`\}[^\n]*onConfirm=\{\(\) => \(close\(\), void rpc\("swarm\.killWorker", \{ threadId: thread\.id, name: m\.name \}\)\.catch\(fail\)\)\}/);
});

test("A permission rule's × asks before it removes the rule, so a stray click can't drop a deny", () => {
  const matrix = span(app("Settings.tsx"), "function PermissionMatrix(", "function Safety(");
  assert.doesNotMatch(matrix, /onClick=\{\(\) => onSave\(rules\.filter/, "the × removes the rule on one press");
  assert.match(matrix, /const step = confirmPress\(sure\?\.key === key \? sure\.at : null, now\);/, "the × doesn't go through the app's two-press confirm");
  assert.match(matrix, /if \(step === "ask"\) return setSure\(\{ key, at: now \}\);\s*if \(step === "wait"\) return;/);
  assert.match(matrix, /onBlur=\{\(\) => setSure\(null\)\}/, "the ask stays armed after the focus leaves it");
  assert.match(matrix, /setTimeout\(\(\) => setSure\(null\), CONFIRM_LAPSE\)/, "the ask stays red long after it lapsed");
  assert.match(matrix, /"Remove it"/);
});

test("A page's rename, delete or new page answered after you moved to another design leaves that design alone", () => {
  const store = app("design/store.ts");
  for (const [from, to] of [["  addPage(name: string) {", "  /** Renames a page"], ["  renamePage(id: string, name: string) {", "  /** Deletes a page"], ["  removePage(id: string) {", "  /** Moves one or more frames"]]) {
    const fn = span(store, from, to);
    assert.doesNotMatch(fn, /\.then\(\(file\) => setNow\(\{ file \}\)\)/, `${from.trim()} takes a reply for a design no longer open`);
    assert.match(fn, /\.then\(keepIfOpen\(s\.file\.id\)\)/);
  }
  assert.match(store, /const keepIfOpen = \(id: string\) => \(file: DesignFile\) => void \(state\.file\?\.id === id && setNow\(\{ file \}\)\);/);
});
