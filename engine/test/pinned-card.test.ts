import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../../ui/src/app/${path}`, import.meta.url), "utf8");

test("The Session icon pins its card at the chat's right as T3 Code does, one choice kept for every session, instead of dropping a popup", () => {
  const switcher = read("Switcher.tsx");
  assert.doesNotMatch(switcher, /label="Session: where it runs, its context and its setup"/, "Session still opens a popup");
  assert.match(switcher, /aria-pressed=\{session\.open\}[\s\S]*?onClick=\{\(\) => session\.onOpen\(!session\.open\)\}/, "the Session icon isn't a toggle");
  const session = read("Session.tsx");
  assert.match(session, /const sessionOpen = useSessionPinned\(\);/, "the pin isn't the shared choice (pinned.ts)");
  assert.match(session, /<aside className="lc-pin"[\s\S]*?<SessionPopup thread=\{thread\}[\s\S]*?onClose=\{\(\) => \{\}\}[\s\S]*?<\/aside>/, "the pinned column doesn't hold the Session card");
  assert.match(read("pinned.ts"), /localStorage\.setItem\(KEY, v \? "1" : "0"\)/, "the pin isn't kept across launches");
});

test("Teamwork and a Swarm are not pinned over the chat: their chip opens the team in the Agents panel, the right tab that lists it", () => {
  const crew = read("Crew.tsx");
  assert.doesNotMatch(crew, /export function TeamPin/, "the team still has a card pinned at the chat's right");
  assert.match(crew, /function TeamChip[\s\S]*?onClick=\{\(\) => showTeamView\(threadId, "all"\)\}/, "the team's chip doesn't open the Agents panel");
  assert.doesNotMatch(read("Session.tsx"), /<TeamPin\b/, "the pinned column still holds a team card");
});

test("A Code session keeps no Teamwork or Swarm card at the chat's end, where its Agents panel lists the team; Liner Design's chat and a Security scan, with no such panel, keep theirs", () => {
  const session = read("Session.tsx");
  assert.match(session, /<Timeline threadId=\{thread\.id\} docked teamCard=\{false\}/, "the Code session still pins the team's card at the chat's end");
  assert.match(read("Timeline.tsx"), /teamCard = true,/, "the other faces lost the team's card");
  assert.doesNotMatch(read("design/Chat.tsx"), /teamCard=\{false\}/);
  assert.doesNotMatch(read("security/ScanSession.tsx"), /teamCard=\{false\}/);
  const crew = read("Crew.tsx");
  assert.match(crew, /function CrewCardOf\(\{ thread, team \}[\s\S]*?if \(swarmOn && !team\) return null;/, "the card doesn't stand aside for the panel");
});

test("Where the thread is wide, the chat and the message box make room for the pinned column; narrower, the message box stays over it", () => {
  const css = read("app.css");
  assert.match(css, /@container lc-thread \(min-width: 1000px\) \{\s*(?:\/\*[\s\S]*?\*\/\s*)?\.lc-thread:has\(\.lc-pin > \*\) \.lc-scroll \{\s*margin-right: calc\(var\(--lc-pin-w\) \+ 24px\);\s*\}\s*\.lc-thread:has\(\.lc-pin > \*\) \.lc-thread-foot \{\s*right: calc\(var\(--lc-pin-w\) \+ 24px\);/);
  const pin = /\.lc-pin \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(pin, /z-index: 4;/, "the column isn't under the message box's 5");
});

test("Turning Teamwork or a Swarm on opens the team in the Agents panel, from /teamwork, /swarm and Multi-agent alike", () => {
  const session = read("Session.tsx");
  const send = session.slice(session.indexOf("const send = async"), session.indexOf("const send = async") + 1200);
  assert.match(send, /showTeam\(thread\.id\);/, "/teamwork doesn't show the team");
  const info = read("SessionInfo.tsx");
  assert.match(info, /rpc\("swarm\.enable", \{ threadId: thread\.id, enabled: true, mode: to \}\)\.then\(\(\) => showTeam\(thread\.id\), fail\)/, "Multi-agent doesn't show the team");
  assert.match(read("Crew.tsx"), /export function showTeam\(threadId: string\) \{\s*showTeamView\(threadId, "all"\);/, "showing the team doesn't open the Agents panel");
});

test("Picking Off, Teamwork or Swarm shuts Multi-agent's side menu, which the pinned Session card, closing nothing, left up", () => {
  const info = read("SessionInfo.tsx");
  const row = info.slice(info.indexOf("export function MultiAgentRow("), info.indexOf("export function MultiAgentRow(") + 1600);
  assert.match(row, /const multiAgent = \(to: "off" \| "teamwork" \| "swarm", done: \(\) => void\) => \{\s*(?:\/\/[^\n]*\n\s*)?done\(\);/, "a pick doesn't shut the side menu");
  for (const to of ["off", "teamwork", "swarm"]) assert.match(row, new RegExp(`multiAgent\\("${to}", done\\)`), `${to} doesn't pass the side menu's done`);
});

test("The pinned cards are flat, a hairline on the paper, with a small shadow only where they stand over the chat; the chat's scrollbar stays out from under them", () => {
  const css = read("app.css");
  const card = /\.lc-pin-card \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(card, /background: var\(--lc-paper\);/, "the card isn't the paper's colour");
  assert.match(card, /box-shadow: inset 0 0 0 1px var\(--l-line\);/, "the card isn't a hairline alone");
  assert.doesNotMatch(card, /--l-shadow-float|backdrop-filter/, "the card still floats like a popup");
  assert.match(css, /@container lc-thread \(max-width: 999\.98px\) \{\s*\.lc-pin-card \{\s*box-shadow:\s*inset 0 0 0 1px var\(--l-line\),\s*0 4px 12px -4px/, "narrow, over the chat, the card has nothing to lift it");
  const pin = /\.lc-pin \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(pin, /padding: 8px 12px 12px;/, "no room for the narrow form's small shadow, which the scrolling column would cut");
  assert.doesNotMatch(css, /\.lc-thread:has\(\.lc-pin > \*\) \.lc-scroll \{\s*padding-right/, "the chat is padded, so its scrollbar runs under the cards");
});
