/*
  Liner Security's scan, drawn without the engine's scan runner (dev only, ?ls-mock= in the dev URL): Start a scan as
  board C (a security model found) or C2 (none), and a scan session as board D (asking), E (running) or F (finished),
  with the mockup's sample words. Shaped like the contract (ScanChoices, ScanRecord, SecurityFinding, the question
  item), so the screens read it as they read the engine. Nothing here ships: every export answers null outside dev.
*/
import type { Item, ScanChoices, ScanRecord, SecurityFinding, ThreatModel } from "@contracts";
import { noSeverities } from "@contracts";

export type MockMode = "c" | "c2" | "d" | "e" | "f";
const MODES: MockMode[] = ["c", "c2", "d", "e", "f"];

/** The board the dev URL asks for (?ls-mock=d), or null: always null in a build. */
export function mockMode(): MockMode | null {
  if (!import.meta.env.DEV || typeof location === "undefined") return null;
  const v = new URLSearchParams(location.search).get("ls-mock");
  return v === null ? null : MODES.includes(v as MockMode) ? (v as MockMode) : "c";
}

const DAY = 86_400_000;
const AREAS = [
  { name: "The API", line: "Routes under src/routes, who may call each", open: 0 },
  { name: "Saved alerts", line: "Each alert belongs to the person who saved it", open: 0 },
  { name: "Sign-in", line: "Accounts, sessions and their cookies", open: 0 },
  { name: "File uploads", line: "Tide tables people upload as CSV", open: 0 },
];
const MODEL: ThreatModel = { file: "SECURITY.md", exists: true, areas: AREAS, written: new Date(new Date().getFullYear(), 10, 12).getTime() };

/** Start a scan's choices as boards C and C2 draw them, over what the engine said. */
export function mockChoices(c: ScanChoices, mode: MockMode): ScanChoices {
  return {
    ...c,
    depths: [
      { depth: "checks", label: "The free checks only", note: "Secrets in tracked files, packages with known problems, files that should not be in git. No agent.", cost: "Free", costNote: "a few seconds" },
      { depth: "branch", label: "What this branch changed", note: "The agent reads the 6 files fix/tide-midnight changed, and what they call, against the threat model.", cost: "About 3 min", costNote: "on your Claude plan" },
      { depth: "project", label: "The whole project", note: "Each area the threat model names, one after another: sign-in, the API, saved alerts, file uploads.", cost: "About 25 min", costNote: "from your last scan" },
    ],
    specialist: mode === "c2" ? [] : [{ id: "cli:claude:claude-mythos", kind: "cli", provider: "claude", model: "claude-mythos", label: "Claude Mythos", via: "found in Claude Code", ref: "@claude:claude-mythos", sealable: true }],
    lookedIn: ["Claude Code", "Codex"],
    defaults: { ...c.defaults, depth: "branch", stopsAfter: 10, lookFirst: undefined },
    threatModel: MODEL,
    branch: { name: "fix/tide-midnight", base: "main", files: 6 },
  };
}

/** The whole of one mocked scan: its record, its findings, its threat model and its timeline. */
export type MockScan = { scan: ScanRecord; findings: SecurityFinding[]; model: ThreatModel; items: Item[]; status: "running" | "waiting" | "idle"; /** Where the question card starts (board D: on the second, the first answered). */ seed?: { at: number; answers: Record<string, string> } };

const finding = (id: string, title: string, severity: SecurityFinding["severity"], file: string, line: number, p: Partial<SecurityFinding>): SecurityFinding => ({
  id,
  projectId: "@sample",
  title,
  severity,
  file,
  line,
  source: "agent",
  sources: ["agent"],
  key: id,
  state: "open",
  look: { state: "none" },
  activity: [],
  foundAt: Date.now() - DAY,
  updatedAt: Date.now() - DAY,
  ...p,
});

/** A scan session as board D, E or F, for the thread it is drawn in (`agent`: who the session runs on). */
export function mockScan(mode: "d" | "e" | "f", threadId: string, agent: string, now = Date.now()): MockScan {
  const started = now - (mode === "d" ? 25_000 : mode === "e" ? 100_000 : 250_000);
  const lodash = finding("f-lodash", "lodash 4.17.20 has a known problem", "medium", "package.json", 0, { line: undefined, source: "checks", sources: ["checks"], rule: "GHSA-35jh-r3h4-6jhm", area: "The API", activity: [{ at: now - 60_000, kind: "raised-again", text: "Raised again by the free checks", scan: "mock" }] });
  const alert = finding("f-alert", "Anyone signed in can read another person's alert", "medium", "src/routes/alerts.js", 27, { scan: "mock", area: "Saved alerts", foundAt: now - 40_000, look: mode === "f" ? { state: "confirmed", by: "codex:gpt-5.5", words: "I read alerts.js and the sign-in code myself. The first finding holds: nothing compares an alert's owner with who is asking.", at: now - 5_000 } : { state: "none" } });
  const html = finding("f-html", "An alert's text may reach the page as HTML", "low", "src/ui/AlertCard.tsx", 19, { scan: "mock", area: "Saved alerts", foundAt: now - 20_000, look: { state: "unconfirmed", by: "codex:gpt-5.5", words: "I couldn't confirm the second: React escapes the text on its way to the page.", at: now - 5_000 } });
  const findings = mode === "d" ? [lodash] : mode === "e" ? [lodash, alert] : [lodash, alert, html];
  const fresh = findings.filter((f) => f.scan === "mock");
  const bySeverity = noSeverities();
  for (const f of fresh) bySeverity[f.severity]++;
  const scan: ScanRecord = {
    id: "mock",
    projectId: "@sample",
    depth: "branch",
    reader: { kind: "own", agent },
    threadId,
    title: "Sample project, this branch",
    state: mode === "d" ? "asking" : mode === "e" ? "running" : "done",
    startedAt: started,
    finishedAt: mode === "f" ? now - 2_000 : undefined,
    counts: { found: fresh.length, fresh: fresh.length, already: 1, leftOut: 0, bySeverity },
    secondLook: "codex:gpt-5.5",
    stopsAfter: 10,
    areasRead: mode === "f" ? ["The API", "Saved alerts"] : [],
    areasReading: mode === "e" ? ["The API", "Saved alerts"] : [],
    areasUntouched: ["Sign-in", "File uploads"],
  };
  const t = (n: number) => started + n * 1000;
  const plan = (done: number): Item => ({
    id: "m-plan",
    turn: 1,
    at: t(2),
    kind: "plan",
    entries: ["The free checks: secrets, packages, files that should not be in git", "Read SECURITY.md and the 6 files this branch changed", "The new alerts API, which you asked for first", "The tide times this branch changed", "Hand what I found to Codex for a second look"].map((title, i) => ({ title, status: i < done ? "completed" : i === done ? "in_progress" : "pending" })),
  });
  const user: Item = { id: "m-you", turn: 1, at: t(0), kind: "user", text: "Scan what this branch changed. Look at the new alerts API first.", shown: { text: "Scan what this branch changed. Look at the new alerts API first." } };
  const mark = (status: "running" | "done", seconds?: number): Item => ({ id: "m-turn", turn: 1, at: t(0), kind: "turn", agent, model: agent.replace(/^@/, ""), status, seconds, ...(mode === "d" ? { waitingSince: t(20) } : {}) });
  const ask = "Three answers would change how I rank what I find, and SECURITY.md does not give them. I have guessed each one from the code: take my guess, pick another, or skip. Where you skip, I go by my guess and say so in the finding.";
  const q1 = { question: "Can anyone sign up, or only people you invite?", options: [{ label: "Anyone can sign up", description: "the sign-up route takes any e-mail", suggested: true }, { label: "Only people you invite" }, { label: "Only your staff" }] };
  const q2 = { question: "Should one person ever see another person's alerts?", options: [{ label: "No, never", description: "every alert is saved with its owner", suggested: true }, { label: "Yes, when its owner shares it" }, { label: "Only your staff may" }] };
  const q3 = { question: "Is a tide table someone uploads ever shown to anyone else?", options: [{ label: "No, only to them", description: "uploads are kept per account", suggested: true }, { label: "Yes, once they publish it" }] };
  const items: Item[] = [user, mark(mode === "f" ? "done" : "running", mode === "f" ? 248 : undefined)];
  if (mode === "d") {
    items.push(plan(1), { id: "m-ask", turn: 1, at: t(14), kind: "text", text: ask, streaming: false });
    // The three questions wait on the card; the first is answered there already (seed), so board D shows the second.
    items.push({ id: "m-q", turn: 1, at: t(16), kind: "question", questions: [q1, q2, q3], state: "asking" });
    return { scan, findings, model: MODEL, items, status: "waiting", seed: { at: 1, answers: { [q1.question]: "Anyone can sign up" } } };
  }
  // As the engine puts them: the report call, and its "finding" line with the finding's id.
  const report = (id: string, f: SecurityFinding, at: number): Item[] => [
    { id, turn: 1, at: t(at), kind: "tool", tool: "mcp__liner__security_report_finding", toolKind: "other", title: "Security", input: JSON.stringify({ title: f.title, severity: f.severity, file: f.file, line: f.line }), status: "done" },
    { id: `${id}-l`, turn: 1, at: t(at), kind: "security", event: { type: "finding", scan: "mock", finding: f.id, title: f.title, severity: f.severity, file: f.file, line: f.line, area: f.area, outcome: "new" } },
  ];
  items.push({ id: "m-q", turn: 1, at: t(16), kind: "question", questions: [q1, q2, q3], state: "answered", answers: { [q1.question]: "Anyone can sign up", [q2.question]: "No, never" }, answeredAt: t(40) });
  items.push({ id: "m-a", turn: 1, at: t(40), kind: "security", event: { type: "answers", scan: "mock", asked: 3, answered: 2, skipped: 1, saved: "SECURITY.md", lines: [{ question: q1.question, answer: "Anyone can sign up", guess: true }, { question: q2.question, answer: "No, never", guess: true }, { question: q3.question, guess: false }] } });
  if (mode === "e") {
    items.push(plan(2), { id: "m-said", turn: 1, at: t(60), kind: "text", text: "The free checks found nothing new: lodash is still open from the last scan, so I am not raising it again. In the alerts API I have one finding so far.", streaming: false });
    items.push(...report("m-r1", alert, 70));
    items.push({ id: "m-why", turn: 1, at: t(72), kind: "text", text: "`getAlert` loads an alert by the number in the address and never compares its owner with who is asking. You said nobody should see another person's alerts, so I rank it Medium. I am now checking the two other routes.", streaming: false });
    items.push({ id: "m-read", turn: 1, at: t(90), kind: "tool", tool: "Read", toolKind: "read", title: "Read src/routes/alerts.js", path: "src/routes/alerts.js", status: "running" });
    return { scan, findings, model: MODEL, items, status: "running" };
  }
  items.push(plan(5));
  items.push({ id: "m-lead", turn: 1, at: t(200), kind: "text", text: "**This branch lets anyone who is signed in read another person's alerts. That finding is confirmed; a second, smaller one is not.**", streaming: false });
  items.push(...report("m-r1", alert, 201), ...report("m-r2", html, 202));
  items.push({ id: "m-end", turn: 1, at: t(205), kind: "text", text: "#### What I read\n\n- The alerts API: its three routes and everything they call.\n- The tide times change: it only reads, and takes nothing from a visitor.\n- The free checks: nothing new. lodash is still open, so it is not raised again.\n\n#### What I did not get to\n\n- The e-mail an alert sends. It goes through a package whose code is not here.\n- Sign-in and file uploads. This branch did not touch them; a whole-project scan reads them.", streaming: false });
  items.push({ id: "m-look", turn: 1, at: t(206), kind: "security", event: { type: "look", scan: "mock", by: "codex:gpt-5.5", state: "done", seconds: 50, words: "I read alerts.js and the sign-in code myself. The first finding holds: nothing compares an alert's owner with who is asking. I couldn't confirm the second: React escapes the text on its way to the page.", results: [{ finding: alert.id, title: alert.title, state: "confirmed" }, { finding: html.id, title: html.title, state: "unconfirmed" }] } });
  items.push({ id: "m-done", turn: 1, at: t(248), kind: "security", event: { type: "done", scan: "mock", state: "done", counts: scan.counts, confirmed: 1, seconds: 248 } });
  return { scan, findings, model: MODEL, items, status: "idle" };
}
