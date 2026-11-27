import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SwarmMember } from "../../contracts/src/swarm.ts";
import { DEPTH_MAX, foldOf, hasAgents, ROWS_MAX, setFold, shownRows, startsOpen, swarmRows, type AgentRow } from "../../ui/src/app/agent-rows.ts";

const read = (path: string) => readFileSync(new URL(`../../ui/src/app/${path}`, import.meta.url), "utf8");
/** The body of the first rule with exactly this selector. */
const rule = (css: string, sel: string) => {
  const at = css.indexOf(`\n${sel} {`);
  assert.ok(at >= 0, `no rule ${sel}`);
  return css.slice(at, css.indexOf("\n}", at));
};

test("The session details card floats from the top row's first toggle, one choice kept for every session and across launches", () => {
  const toggles = read("Switcher.tsx");
  const top = toggles.slice(toggles.indexOf("export function TopToggles("), toggles.indexOf("/** A tab's icon"));
  // The first of the three toggles is the details card's, lit while it is on.
  assert.match(top, /aria-pressed=\{details\.on\}[\s\S]*?onClick=\{details\.onToggle\}[\s\S]*?<I\.list size=\{16\} \/>/, "the first toggle isn't the details card's");
  const at = (s: string) => top.indexOf(`onClick={${s}}`);
  assert.ok(at("details.onToggle") > 0 && at("details.onToggle") < at("onBelow") && at("onBelow") < at("panel.onShow"), "the toggles are not details, terminal, panel in that order");
  const session = read("Session.tsx");
  assert.match(session, /const sessionOpen = useSessionPinned\(\);/, "the card's state isn't the shared choice (pinned.ts)");
  assert.match(session, /<aside className="lc-pin"[\s\S]*?\{cardShown && project && \([\s\S]*?<DetailsCard[\s\S]*?<\/aside>/, "the card isn't in the column under the top row");
  assert.match(session, /const cardShown = sessionOpen && !dock\.open && !leaving;/, "the card shows with the panel open, where there is no room for it");
  // With the panel open the toggle shows the Session surface there instead.
  assert.match(session, /const toggleDetails = \(\) => \(dockNow\.current\.open \? setDock\(\(d\) => \(onScreen\(d, "session"\) \? closeTab\(d, "session"\) : openTab\(d, "session"\)\)\) : setSessionOpen\(\(o\) => !o\)\);/);
  assert.match(session, /else if \(s\.id === "session"\) !e\.repeat && toggleDetails\(\);/, "the Session key isn't the details toggle");
  assert.match(read("pinned.ts"), /localStorage\.setItem\(KEY, v \? "1" : "0"\)/, "the toggle's state isn't kept across launches");
});

test("While the details card shows, the chat and the message box keep a gutter clear of it and centre in the room that is left", () => {
  const css = read("app.css");
  assert.match(css, /@container lc-thread \(min-width: 640px\) \{\s*(?:\/\*[\s\S]*?\*\/\s*)?\.lc-thread:has\(\.lc-pin > \*\) \.lc-scroll \{\s*margin-right: calc\(var\(--lc-pin-w\) \+ 34px\);\s*\}\s*\.lc-thread:has\(\.lc-pin > \*\) \.lc-thread-foot \{\s*right: calc\(var\(--lc-pin-w\) \+ 34px\);/);
  // The chat's own box narrows, so what is in it (margin: 0 auto) centres in what is left; a padding would leave its scrollbar under the card.
  assert.doesNotMatch(css, /\.lc-thread:has\(\.lc-pin > \*\) \.lc-scroll \{\s*padding-right/, "the chat is padded, so its scrollbar runs under the card");
  assert.match(css, /\n\.lc-thread \{\s*--lc-pin-w: 284px;/, "the card is not the board's 284 wide");
  assert.match(rule(css, ".lc-pin"), /z-index: 4;/, "the column isn't under the message box's 5");
});

test("The details card is flat as T3 Code's is: its own fill and a 0.5px edge, no drop shadow, and scrolling never cuts its corner", () => {
  // The owner, 2026-11-27: "side session remove shadow. make it same background as t3 code". The card is parted from the
  // chat by the card fill (white on the light sheet, a step off the dark one) and its 0.5px edge alone. What the old
  // shadow test protected still holds: the scroller is the card itself, whose ring is drawn outside it, and the column
  // round it doesn't clip.
  const css = read("app.css");
  const card = rule(css, ".lc-dcard");
  assert.match(card, /background: var\(--lc-card\);/, "the card is not in the card fill");
  assert.match(card, /box-shadow: 0 0 0 0\.5px var\(--lc-line2\);/, "the card's edge is not one 0.5px ring");
  const shadows = [...css.matchAll(/\n([^{}\n]*\.lc-dcard[^{}\n]*) \{([^{}]*)\}/g)].map((m) => /box-shadow:\s*([^;]+);/.exec(m[2])?.[1]).filter(Boolean) as string[];
  for (const sh of shadows) assert.ok(sh.split(/,(?![^(]*\))/).every((part) => /^\s*0 0 0 0\.5px /.test(part)), `the card casts a shadow again: ${sh}`);
  assert.doesNotMatch(card, /--lc-float-shadow|--lc-raise/, "the card floats like a menu again");
  assert.match(card, /overflow: hidden auto;/, "the card doesn't scroll itself");
  assert.match(rule(css, ".lc-pin"), /overflow: visible;/, "the column clips the card's corner and edge");
});

test("The details card is as lean as a menu: 30px rows at 13 regular on a 6px corner, a card with a 12px corner 4 in, and no money anywhere in it", () => {
  // The owner, 2026-11-27: "make it more lean to capy". It was 34px rows at 13.5/500 on a 16px corner, 6 in.
  const css = read("app.css");
  const box = rule(css, ".lc-dcard");
  assert.match(box, /border-radius: var\(--lc-r-card\);/);
  assert.match(box, /padding: 4px;/);
  assert.match(box, /--lc-stroke: var\(--lc-menu-stroke\);/, "the card's icons are not drawn lighter, as a menu's");
  assert.match(rule(css, ".lc-dr"), /height: 30px;/);
  const main = rule(css, ".lc-dr-main");
  assert.match(main, /height: 30px;/);
  assert.match(main, /border-radius: 6px;/);
  assert.match(main, /font-size: 13px;\s*font-weight: 400;/, "a row's words are heavier than a menu row's");
  assert.match(rule(css, ".lc-dr-main > svg"), /width: 14px;\s*height: 14px;\s*color: var\(--lc-icon\);/, "a row's icon isn't 14 in the muted grey");
  assert.match(rule(css, ".lc-dr-sep"), /height: 0\.5px;\s*margin: 4px -4px;/, "a rule doesn't run edge to edge of the card's 4px");
  const env = read("Env.tsx");
  const card = env.slice(env.indexOf("export function DetailsCard("));
  assert.doesNotMatch(card, /money\(|costUsd|\$\{?\s*[\d.]|"\$/, "the details card says what the session costs");
  for (const words of ["Open in", "Add a project script", "Commit", "Changes", "Context", "Fusion"]) assert.ok(card.includes(words), `the card has no ${words} row`);
});

test("Teamwork and a Swarm are not pinned over the chat: their chip opens the team in the Agents panel, the right tab that lists it", () => {
  const crew = read("Crew.tsx");
  assert.doesNotMatch(crew, /export function TeamPin/, "the team still has a card pinned at the chat's right");
  assert.match(crew, /function TeamChip[\s\S]*?onClick=\{\(\) => showTeamView\(threadId, "all"\)\}/, "the team's chip doesn't open the Agents panel");
  assert.doesNotMatch(read("Session.tsx"), /<TeamPin\b/, "the pinned column still holds a team card");
});

test("A Code session keeps no agents, Teamwork or Swarm card at the chat's end, where its Agents panel lists them; Liner Design's chat and a Security scan, with no such panel, keep theirs", () => {
  const session = read("Session.tsx");
  assert.match(session, /<Timeline threadId=\{thread\.id\} docked teamCard=\{false\}/, "the Code session still pins the team's card at the chat's end");
  assert.match(read("Timeline.tsx"), /teamCard = true,/, "the other faces lost the team's card");
  assert.doesNotMatch(read("design/Chat.tsx"), /teamCard=\{false\}/);
  assert.doesNotMatch(read("security/ScanSession.tsx"), /teamCard=\{false\}/);
  const crew = read("Crew.tsx");
  assert.match(crew, /function CrewCardOf\(\{ thread, team \}[\s\S]*?if \(!team\) return null;/, "the card doesn't stand aside for the panel, for a team or a plain crew alike");
});

test("Turning Teamwork or a Swarm on opens the team in the Agents panel, from /teamwork and /swarm, the only way to start one since the Multi-agent row went", () => {
  const session = read("Session.tsx");
  const send = session.slice(session.indexOf("const send = async"), session.indexOf("const send = async") + 1200);
  assert.match(send, /showTeam\(thread\.id\);/, "/teamwork doesn't show the team");
  assert.doesNotMatch(read("SessionInfo.tsx"), /MultiAgentRow|swarm\.enable/, "the Session surface starts a team again");
  assert.match(read("Crew.tsx"), /export function showTeam\(threadId: string\) \{\s*showTeamView\(threadId, "all"\);/, "showing the team doesn't open the Agents panel");
});

test("The details card lists only the servers this session started, not every server that runs in the project's folder", () => {
  const env = read("Env.tsx");
  const card = env.slice(env.indexOf("export function DetailsCard("));
  assert.match(card, /rpc\("ports\.list", \{ threadId: thread\.id \}\)[^\n]*x\.owner === "session"/, "the card's servers aren't held to the session's own");
  assert.doesNotMatch(card, /x\.owner !== null/, "the card lists the project's servers too");
});

/* ---------- The details card's agents (the owner's ask, after Antigravity's overview card) ---------- */

const leaf = (key: string, state: AgentRow["state"] = "done"): AgentRow => ({ key, name: key, state, kids: [] });
const member = (o: Partial<SwarmMember> & { name: string }): SwarmMember => ({ role: "", model: "demo:demo", state: "hibernated", workspace: "inherit", mode: "read", channels: [], brief: "", lastReadSeq: 0, tokens: 0, costUsd: 0, ...o }) as SwarmMember;

test("The card's agents show only for a session with agents: Fusion, a tool's subagents, a Swarm or a Teamwork; a session that works alone has no section and no Agents row", () => {
  assert.equal(hasAgents({}), false, "a session that works alone shows agents");
  assert.equal(hasAgents({ sidekick: undefined, swarm: false, atWork: 0, worked: 0 }), false);
  assert.equal(hasAgents({ sidekick: "codex:gpt" }), true, "Fusion shows no agents");
  assert.equal(hasAgents({ worked: 3 }), true, "a tool's subagents that ran show nothing");
  assert.equal(hasAgents({ atWork: 1 }), true, "agents at work (the line under the message box) show nothing");
  assert.equal(hasAgents({ swarm: true }), true, "a Swarm or Teamwork shows nothing");
  const env = read("Env.tsx");
  const card = env.slice(env.indexOf("export function DetailsCard("), env.indexOf("/** A row's state mark"));
  assert.match(card, /<CardAgents thread=\{thread\} onAgents=\{onAgents\} \/>/, "the card has no agents section");
  assert.doesNotMatch(card, /worked\.count > 0 \? `\$\{worked\.count\} worked`|thread\.sidekick \|\| worked\.count > 0/, "today's last row (Fusion · N worked / Agents) is drawn again");
  const section = env.slice(env.indexOf("function CardAgents("));
  assert.match(section, /if \(!hasAgents\(\{ sidekick: thread\.sidekick, swarm: swarmOn, atWork: thread\.agentsAtWork, worked \}\)\) return null;/, "the section shows for a session with no agents");
  // The Session surface's "N agents worked" asks the same.
  assert.match(read("SessionInfo.tsx"), /hasAgents\(\{ sidekick: thread\.sidekick, swarm: isSwarm\(thread\), atWork: thread\.agentsAtWork, worked: worked\.count \}\) && worked\.count > 0/);
});

test("The card's agent tree is the app's own: crewOf through crewRows for a message's crew, teamTree for a Swarm or a Teamwork, and it asks for nothing", () => {
  const env = read("Env.tsx");
  const section = env.slice(env.indexOf("function CardAgents("));
  assert.match(section, /swarmRows\(swarm\.members, swarm\.mode === "swarm", Boolean\(swarm\.paused\)\) : crew \? crewRows\(crew, providers, asking\)/, "the card builds its tree some other way");
  assert.match(section, /const crew = useCrew\(thread\);/, "the crew isn't the Agents surface's");
  assert.doesNotMatch(section, /rpc\(|setInterval|setTimeout/, "the section asks or polls on its own");
  assert.doesNotMatch(read("agent-rows.ts"), /\.parent\b|rpc\(/, "agent-rows works out who is whose child itself");
  assert.match(read("Crew.tsx"), /export function crewRows\(crew: Crew,[\s\S]*?kids: n\.kids\.map\(node\)/, "crewRows doesn't follow crewOf's nesting");
  // A Teamwork: the coordinator, its team as teamTree nests it (a gone parent's member under the coordinator).
  const team = swarmRows([member({ name: "coordinator", role: "Coordinator" }), member({ name: "orch", role: "Project Orchestrator", state: "working" }), member({ name: "tree", role: "Working Tree Explorer", parent: "orch", state: "working" }), member({ name: "lost", role: "Task Interviewer", parent: "gone" })], false, false);
  assert.equal(team.length, 1);
  assert.equal(team[0].name, "Coordinator");
  assert.deepEqual(team[0].kids.map((k) => k.name), ["Project Orchestrator", "Task Interviewer"]);
  assert.deepEqual(team[0].kids[0].kids.map((k) => [k.name, k.state]), [["Working Tree Explorer", "working"]]);
  // A Swarm paused for you: the coordinator waits on you (amber).
  assert.equal(swarmRows([member({ name: "coordinator" }), member({ name: "scout" })], true, true)[0].state, "waits");
  assert.equal(swarmRows([member({ name: "coordinator" }), member({ name: "scout" })], true, false)[0].kids[0].name, "@scout", "a Swarm's peers don't go by @name");
});

test("The card's agent rows: 28 high on a 0.5px guide line 16 in a level, three levels at most, eight rows at most with N more", () => {
  const css = read("app.css");
  const row = rule(css, ".lc-da");
  assert.match(row, /height: 28px;/);
  assert.match(row, /padding-left: calc\(var\(--lc-da-d\) \* 16px\);/, "a level isn't 16 in");
  assert.match(row, /repeating-linear-gradient\(90deg, var\(--lc-hair\) 0 0\.5px, transparent 0\.5px 16px\)/, "children sit on no guide line");
  // At a menu row's 13 regular since the lean pass (2026-11-27), still 28 high.
  assert.match(rule(css, ".lc-da-main"), /height: 28px;[\s\S]*font-size: 13px;/);
  // Three levels: a fourth folds into its parent's count, and its parent can't unfold.
  const deep: AgentRow = { key: "a", name: "a", state: "working", kids: [{ key: "b", name: "b", state: "working", kids: [{ key: "c", name: "c", state: "working", kids: [leaf("d", "working")] }] }] };
  const shown = shownRows([deep], () => true).rows;
  assert.deepEqual(shown.map((r) => [r.node.key, r.depth]), [["a", 0], ["b", 1], ["c", 2]], "more than three levels show");
  assert.equal(DEPTH_MAX, 3);
  assert.deepEqual([shown[2].folds, shown[2].count], [false, 1], "the third level's children don't fold into its count");
  // Eight at most: past that seven and "N more".
  const many = Array.from({ length: 12 }, (_, i) => leaf(`w${i}`));
  const capped = shownRows(many, () => true);
  assert.equal(ROWS_MAX, 8);
  assert.deepEqual([capped.rows.length, capped.more], [7, 5], "more than eight rows show, or N more counts wrong");
  assert.deepEqual([shownRows(many.slice(0, 8), () => true).rows.length, shownRows(many.slice(0, 8), () => true).more], [8, 0], "eight rows don't all show");
  assert.match(read("Env.tsx"), /\{more > 0 && \([\s\S]*?\{more\} more/, "the card has no N more row");
});

test("Folding: a parent with a child at work or waiting starts open, one whose children all finished starts folded, and your folding stays per session", () => {
  const done: AgentRow = { key: "p1", name: "p", state: "done", kids: [leaf("k1"), leaf("k2", "failed")] };
  const busy: AgentRow = { key: "p2", name: "p", state: "working", kids: [leaf("k3"), leaf("k4", "working")] };
  const asks: AgentRow = { key: "p3", name: "p", state: "working", kids: [leaf("k5", "waits")] };
  assert.equal(startsOpen(done), false, "a parent whose children all finished starts open");
  assert.equal(startsOpen(busy), true, "a parent with a child at work starts folded");
  assert.equal(startsOpen(asks), true, "a parent with a child waiting on you starts folded");
  assert.equal(foldOf("t1", done), false);
  setFold("t1", "p1", true);
  assert.equal(foldOf("t1", done), true, "your unfolding isn't kept");
  assert.equal(foldOf("t2", done), false, "one session's folding reaches another");
  assert.deepEqual(shownRows([done], (n) => foldOf("t2", n)).rows.map((r) => r.node.key), ["p1"], "a folded parent's children show");
  assert.deepEqual(shownRows([done], (n) => foldOf("t1", n)).rows.map((r) => r.node.key), ["p1", "k1", "k2"]);
});
