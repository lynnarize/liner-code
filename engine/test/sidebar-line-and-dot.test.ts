/*
  The sidebar in line and dot (2026-11-27): what the person asked for by name, read from the source. The field that
  holds Search and New session in one border, the name at the foot, a session's rich second line, the open row as a
  raised card, Settled at the list's foot, and the traffic lights on the top rows' one centre line.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../../ui/src/app/${path}`, import.meta.url), "utf8");
/** Every block whose selector list is exactly `selector`, joined. */
const block = (css: string, selector: string) => {
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "g");
  const found = [...css.matchAll(re)].map((m) => m[2]);
  assert.ok(found.length > 0, `no ${selector} block`);
  return found.join("\n");
};
const side = read("Sidebar.tsx");
const list = read("SideList.tsx");
const css = read("app.css");

test("Search and New session share one field under the lights' row: one border, New session with no box of its own, and no key hint in it", () => {
  const field = side.slice(side.indexOf('<div className="lc-sb-field"'), side.indexOf("</div>", side.indexOf('<div className="lc-sb-field"')));
  assert.ok(field.length > 0, "there is no shared field");
  assert.match(field, /aria-label="Search"[^\n]*onClick=\{onSearch\}/, "the field doesn't open Search");
  assert.match(field, /<span>Search<\/span>/);
  assert.match(field, /className="lc-sb-field-new l-focus" aria-label=\{fresh\.label\}[^\n]*onClick=\{fresh\.onClick\}/, "New session isn't inside the field");
  assert.match(side, /\{ label: "New session", on: homeOn, onClick: \(\) => onNew\(\) \}/, "Code's field button isn't New session");
  assert.doesNotMatch(field, /Kbd|lc-kbd|⌘K/, "the field draws a key hint");
  // Search left the head row, and the separate New session place is gone.
  const head = side.slice(side.indexOf('<div className="lc-sb-head" data-drag>'), side.indexOf("</div>", side.indexOf('<div className="lc-sb-head" data-drag>')));
  assert.doesNotMatch(head, /aria-label="Search"/, "Search is still in the lights' row");
  for (const kept of ['aria-label="Hide the sidebar"', 'aria-label="Back"', 'aria-label="Forward"']) assert.ok(head.includes(kept), `${kept} left the lights' row`);
  assert.doesNotMatch(side, /<span>New session<\/span>/, "New session is still a place row of its own");
  // One border round both, and New session drawn bare, lit or not.
  const box = block(css, ".lc-sb-field");
  assert.match(box, /height: 30px;/);
  assert.match(box, /box-shadow: inset 0 0 0 0\.5px var\(--lc-hair\);/);
  const button = block(css, ".lc-sb-field-new");
  assert.match(button, /background: none;/);
  assert.match(button, /box-shadow: none;/);
  assert.doesNotMatch(block(css, ".lc-sb-field-new[aria-current]"), /background|box-shadow/, "New session gets a box of its own while Home is up");
});

test("The name at the foot stays: Liner in ink and the face in grey, the small arrow, Instrument Sans 16/600, with Pull requests, Issues and Settings beside it in Code", () => {
  const foot = side.slice(side.indexOf('<div className="lc-sb-foot"'), side.indexOf("</nav>", side.indexOf('<div className="lc-sb-foot"')));
  assert.match(foot, /triggerClass="lc-sb-facepick lc-sb-name"/, "the name is no longer the face switch");
  assert.match(foot, /<span className="lc-brand">Liner<\/span>\s*<span className="lc-sb-name-face">\{FACE_NAME\[face\]\}<\/span>\s*<I\.chevD size=\{12\} \/>/);
  for (const f of ['"code"', '"design"', '"security"']) assert.ok(foot.includes(`onFace(${f})`), `the menu can't switch to ${f}`);
  assert.match(foot, /onPullRequests && face === "code"/);
  assert.match(foot, /onIssues && face === "code"/);
  assert.match(foot, /aria-label="Settings and your account"/);
  const name = block(css, ".lc-sb-foot .lc-sb-name");
  assert.match(name, /font-family: var\(--lc-font-name\);/);
  assert.match(name, /font-size: 16px;/);
  assert.match(name, /font-weight: 600;/);
  assert.match(name, /color: var\(--l-ink\);/);
  assert.match(block(css, ".lc-sb-name-face"), /color: var\(--l-ink-3\);/, "the face isn't grey");
  assert.match(css, /--lc-font-name: "Instrument Sans/, "the name's type isn't Instrument Sans");
});

test("A session's row has a rich second line: what it does on the left, blue while it works and amber when it wants you; on the right the tool, where it runs, and its pull request in its state's colour", () => {
  // The order on the right: who runs it, where (a laptop for this Mac, a branch for a worktree), then the pull request with its mark.
  const facts = list.slice(list.indexOf("export function SideFacts("), list.indexOf("\n}\n", list.indexOf("export function SideFacts(")));
  const who = facts.indexOf("<ModelMark kind={model}");
  const branch = facts.indexOf("<I.branch size={12} />");
  const laptop = facts.indexOf("<I.laptop size={12} />");
  const pr = facts.indexOf("<I.pr size={12} />#{pr.number}");
  assert.ok(who > 0 && branch > who && laptop > branch && pr > laptop, "the facts aren't in the board's order: tool, where, pull request");
  assert.match(css, /\.lc-sl-pr\[data-s="open"\] \{\s*color: var\(--l-ok-text\);/, "an open pull request isn't green");
  assert.match(css, /\.lc-sl-pr\[data-s="merged"\] \{\s*color: var\(--lc-merged\);/, "a merged pull request isn't purple");
  // Code's rows pass the tool's mark, where it runs, and the pull request; the words are blue while it works.
  const row = side.slice(side.indexOf("const SessionRow = memo("), side.indexOf("\n});\n", side.indexOf("const SessionRow = memo(")));
  assert.match(row, /const runs = toolOn\(on\.ref, providers\);/, "the row doesn't name the tool that runs it");
  assert.match(row, /<SideFacts model=\{runs\.mark\} modelName=\{runs\.name\} branch=\{t\.worktree\?\.branch\} local=\{!t\.worktree\} pr=\{t\.pr \?/);
  assert.match(row, /const tone = appAsk \? "warn" : busy \? "live" : said\.tone;/, "a working row's words aren't the live blue");
  assert.match(css, /\.lc-sl-sub\[data-tone="live"\] \{\s*color: var\(--lc-blue\);/);
  assert.match(css, /\.lc-sl-sub\[data-tone="warn"\] \{\s*color: var\(--l-warn-text\);/);
  // Line one: the title, then the mark, the time or both at its end; one that works or waits says so and no time.
  assert.match(list, /<span className="lc-sl-title">\{title\}<\/span>\s*<span className="lc-sl-at">\s*<span className="lc-sl-mark">\{mark\}<\/span>\s*\{ago && <span className="lc-sl-ago">\{ago\}<\/span>\}/);
  assert.match(row, /ago=\{appAsk \|\| mark === "working" \|\| mark === "needs" \? undefined : ago\(t\.updatedAt, now\)\}/);
});

test("The open session's row is a raised card in both looks: the card fill and a half-pixel ring, not the deep black of before", () => {
  const plate = block(css, ".lc-sb-plate");
  assert.match(plate, /background: var\(--lc-well\);/);
  assert.match(plate, /box-shadow: var\(--lc-card-ring\);/);
  assert.match(block(css, ".lc-sl-row[data-current]"), /background: var\(--lc-well\);/);
  assert.doesNotMatch(css, /\[data-theme="dark"\] \.lc-sb-plate/, "the dark look still paints the open row its own colour");
});

test("Settled sits at the list's foot with its count and switches the list to Settled; The Wall says how many on it are live", () => {
  const settled = side.slice(side.indexOf('className="lc-sb-top lc-sb-settled"'), side.indexOf("</div>", side.indexOf('className="lc-sb-top lc-sb-settled"')));
  assert.match(settled, /onClick=\{\(\) => setView\(view === "settled" \? viewBefore\.current : "settled"\)\}/);
  assert.match(settled, /\{putAwayAll\.settled > 0 && <span className="lc-sb-nend">\{putAwayAll\.settled\}<\/span>\}/);
  assert.ok(side.indexOf('className="lc-sb-top lc-sb-settled"') > side.indexOf('className="lc-sb-scroll"'), "Settled isn't under the list");
  assert.match(side, /const wallLive = onWallNow\.filter\(worksNow\)\.length;/);
  assert.match(side, /\{wallLive > 0 && <span className="lc-sb-nend">\{wallLive\} live<\/span>\}/);
});

test("A project's header in the list is the fold arrow, the name, and folded, its count at the end", () => {
  const folder = list.slice(list.indexOf("{compact ? ("), list.indexOf(") : (", list.indexOf("{compact ? (")));
  const arrow = folder.indexOf("<I.chevR size={12} />");
  const name = folder.indexOf('<span className="lc-sl-fold-n">');
  const count = folder.indexOf('<span className="lc-sl-count">');
  assert.ok(arrow > 0 && name > arrow && count > name, "the header isn't arrow, name, then count");
  assert.match(folder, /\{!open && \(\s*<span className="lc-sl-fold-end">/, "an open folder still shows its count");
  assert.doesNotMatch(folder, /icon \?\? <I\.folder/, "every folder still draws a folder icon");
});

test("The traffic lights, the sidebar's top row and the sheet's top row share one centre line, 30 from the window's top", () => {
  const main = readFileSync(new URL("../../desktop/src/main.ts", import.meta.url), "utf8");
  const lights = main.match(/const LIGHTS = \{ x: (\d+), y: (\d+) \};/);
  assert.ok(lights, "no LIGHTS");
  // The buttons are 14 high: their centre is y + 7.
  const centre = Number(lights[2]) + 7;
  const gap = Number(css.match(/\.lc-app \{\s*--lc-gap: (\d+)px;/)?.[1]);
  const head = Number(css.match(/--lc-head: (\d+)px;/)?.[1]);
  assert.equal(centre, gap + head / 2, "the lights aren't on the sheet's top row's centre");
  assert.match(main, /if \(!isMac\) return \{ x: 0, y: 30 \};/, "a window with no lights doesn't report the same line");
  // The sidebar's head (34 high on a Mac, 17 its half) sits on the lights' centre, under the window's gap.
  assert.match(css, /html\[data-native="mac"\] \.lc-sb \{\s*padding-top: max\(0px, calc\(var\(--lc-lights-y, 30px\) - var\(--lc-gap\) - 17px\)\);/);
});

test("With Carry on switched off in Settings the sidebar names it nowhere: no Carry on row in More or in the list's menu, and More is not there at all when it would open empty", () => {
  assert.match(side, /import \{[^}]*\bcarryOnOn\b[^}]*\} from "@contracts";/);
  assert.match(side, /const carryOn = useEngine\(\(s\) => carryOnOn\(s\.settings\)\);/, "the sidebar doesn't read the switch");
  // More's row for Carry on is drawn only while it is on, and More itself only when it holds something.
  const more = side.slice(side.indexOf("{/* More:"), side.indexOf("</Pop>", side.indexOf("{/* More:")));
  assert.match(more, /\{\(carryOn \|\| \(onApp && pages\.length > 0\)\) && \(\s*<Pop/, "More opens empty with Carry on off and no apps");
  assert.match(more, /\{carryOn && \(\s*<Row\s+title="Carry on"/, "More still offers Carry on while it is off");
  // The list heading's menu too: a count left from before the switch went off must not bring its row back.
  assert.match(side, /\{carryOn && carryCount > 0 && \(/, "the list's menu still offers Carry on while it is off");
  assert.equal((side.match(/title="Carry on"/g) ?? []).length, 2, "Carry on is named somewhere else in the sidebar");
});

test("Design and Security put their own new thing in the sidebar's field as Code does, New design and Start a scan, and keep no separate row for it", () => {
  // The field's compose button is Code's New session, or the face body's own (SideList.tsx useFieldNew), named and lit as the face says.
  assert.match(side, /const fresh: FieldNew \| null = faceBody \? faceNew : \{ label: "New session", on: homeOn, onClick: \(\) => onNew\(\) \};/);
  assert.match(side, /\{fresh && \(\s*<button type="button" className="lc-sb-field-new l-focus" aria-label=\{fresh\.label\} aria-current=\{fresh\.on \? "page" : undefined\} title=\{`\$\{fresh\.title \?\? fresh\.label\}/, "a face's own new thing isn't the field's button");
  const security = read("security/Side.tsx");
  assert.match(security, /useFieldNew\(\{ label: "Start a scan", on: page\.kind === "start", onClick: \(\) => goSecurity\(\{ kind: "start" \}\) \}\);/, "Security doesn't put Start a scan in the field, lit on its page");
  assert.doesNotMatch(security, /<span>Start a scan<\/span>/, "Security still has a Start a scan row of its own");
  const design = read("design/Tabs.tsx");
  assert.match(design, /useFieldNew\(\{ label: "New design", onClick: \(\) => void newDesign\(\)\.catch\(fail\) \}\);/, "Design doesn't put New design in the field");
  assert.doesNotMatch(design, /<span>New design<\/span>/, "Design still has a New design row of its own");
  // ⌘N still makes each face's new thing (App.tsx's "new" goes by the face), so the key the rows named is kept.
  assert.match(read("App.tsx"), /if \(name === "new"\) getFace\(\) === "design" \? [^\n]*newDesign\(\)[^\n]*getFace\(\) === "security" \? [^\n]*goSecurity\(\{ kind: "start" \}\)[^\n]*: newSession\(\);/);
});

test("A session with no pull request shows the lines it left not committed at its second line's end, green and red, read from its own checkpoints with no read of its own", () => {
  // The same source as the details card's Changes: the timeline's checkpoints not undone and not committed.
  assert.match(read("model.ts"), /export const openLines = \(items: Item\[\]\) => sumLines\(checkpointsOf\(items\)\.filter\(\(c\) => !c\.reverted && !c\.committed\)\.flatMap\(\(c\) => c\.files\)\);/);
  assert.match(side, /\.filter\(\(t\) => !t\.pr && \(t\.toReview \?\? 0\) > 0 && s\.items\[t\.id\]\)/, "the lines are read for rows with a pull request, or by a read of their own");
  assert.match(side, /openLines\(itemsWhere\(s, t\.id, isCheckpoint\)\)/);
  assert.doesNotMatch(side.slice(side.indexOf("const linesLine"), side.indexOf("const lines = useMemo")), /rpc\(/, "the row's lines cost a read");
  assert.match(side, /lines=\{!t\.pr && lines \? \{ added, removed \} : undefined\}/, "the row doesn't pass its lines, or passes them beside a pull request");
  const facts = list.slice(list.indexOf("export function SideFacts("), list.indexOf("\n}\n", list.indexOf("export function SideFacts(")));
  assert.ok(facts.indexOf('className="lc-sl-lines"') > facts.indexOf("<I.pr size={12} />"), "the lines aren't where the pull request's number would be");
  assert.match(facts, /\{!pr && lines && \(lines\.added > 0 \|\| lines\.removed > 0\) && \(/);
  assert.match(facts, /<span data-k="add">\+\{lines\.added\}<\/span>\s*<span data-k="del">−\{lines\.removed\}<\/span>/);
  const box = block(css, ".lc-sl-lines");
  assert.match(box, /font-size: 11px;/);
  assert.match(box, /font-variant-numeric: tabular-nums;/);
  assert.match(block(css, '.lc-sl-lines > [data-k="add"]'), /color: var\(--l-ok-text\);/);
  assert.match(block(css, '.lc-sl-lines > [data-k="del"]'), /color: var\(--l-danger-text\);/);
});

test("Pressing Settled at the list's foot again goes back to the view you came from, By status, Snoozed or Archive as well as By folder", () => {
  assert.match(side, /const viewBefore = useRef<View>\("folder"\);\s*if \(view !== "settled"\) viewBefore\.current = view;/, "the view before Settled isn't kept");
  assert.match(side, /onClick=\{\(\) => setView\(view === "settled" \? viewBefore\.current : "settled"\)\}/, "Settled always goes back to By folder");
  assert.doesNotMatch(side, /setView\(view === "settled" \? "folder" : "settled"\)/);
});

test("A project's tile letters follow one rule wherever they are drawn: two words give their first letters, one word its first two, in any script", async () => {
  const { tileLetters } = await import("../../ui/src/app/letters.ts");
  assert.equal(tileLetters("Liner Code"), "LC");
  assert.equal(tileLetters("foreshore"), "FO");
  assert.equal(tileLetters("liner-code"), "LC");
  assert.equal(tileLetters("linercode.dev"), "LD");
  assert.equal(tileLetters("linerCode"), "LC");
  assert.equal(tileLetters("Überall"), "ÜB");
  assert.equal(tileLetters("東京 アプリ"), "東ア");
  assert.equal(tileLetters("😀app"), "😀A");
  assert.equal(tileLetters(""), "?");
  assert.equal(tileLetters(" - "), "?");
  // Home's chip, the session's top row and the sidebar's card all take it, and none keeps a rule of its own.
  for (const file of ["Home.tsx", "Session.tsx", "Sidebar.tsx"]) {
    const src = read(file);
    assert.match(src, /import \{ tileLetters \} from "\.\/letters";/, `${file} doesn't use the shared letters`);
    assert.doesNotMatch(src, /function (tileOf|badgeLetters)\(|const tileLetters = /, `${file} keeps letters of its own`);
  }
});

test("The face menu at the sidebar's foot shows each face's line whole at the sidebar's 240: Sessions in your projects, Frames drawn with an agent, Findings and scans", () => {
  const foot = side.slice(side.indexOf('<div className="lc-sb-foot"'), side.indexOf("</nav>", side.indexOf('<div className="lc-sb-foot"')));
  for (const line of ["Sessions in your projects", "Frames drawn with an agent", "Findings and scans"]) assert.ok(foot.includes(`<small>${line}</small>`), `"${line}" is gone or shortened`);
  // The room the line has, from the parts round it: the menu (222 inside the 240 sidebar, 4 in), the row's insets, the tile, the gaps and the chosen row's tick.
  const px = (v: string) => v.split(/\s+/).map((x) => Number.parseFloat(x));
  const opt = block(css, ".lc-face-opt");
  const [, right, , left] = px(opt.match(/padding: ([^;]+);/)![1]);
  const gap = px(opt.match(/gap: ([^;]+);/)![1])[0];
  const tile = px(block(css, ".lc-face-tile").match(/width: ([^;]+);/)![1])[0];
  const tick = Number(foot.match(/face === "code" && <I\.check size=\{(\d+)\} \/>/)![1]);
  const room = 222 - 4 * 2 - left - right - tile - gap * 2 - tick;
  // "Sessions in your projects" at 12px Inter measures 142 in the build (the longest of the three that sits beside the tick).
  assert.ok(room >= 142, `the first row's line has ${room}px, and needs 142`);
});

test("The empty list is the plain empty shape: its own small icon, what is missing, one sentence, and at most one white button", () => {
  const none = side.slice(side.indexOf("const none = ("), side.indexOf(");\n", side.indexOf("const none = (")));
  assert.equal((none.match(/<button/g) ?? []).length, 1, "the empty list has more than one button");
  assert.match(none, /className="lc-btn l-focus" data-kind="ink" data-size="sm"/);
  assert.match(side, /none\(<I\.compose size=\{16\} \/>, "No sessions yet", "A session you start shows up here\.", \{ label: "New session"/);
  assert.doesNotMatch(side, /none\(<I\.[a-z]+ size=\{20\}/, "an empty list's icon is still the big one");
});
