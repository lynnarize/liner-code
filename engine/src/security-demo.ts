/*
  Liner Security's Demo: with the Demo tool (never a real account), the face shows the mockup's sample: Sample project
  (Foreshore), liner-site and harbour-notes, the four findings, the scan history, and a scripted scan that asks, finds
  and finishes as the boards show (the Demo provider's "## Security scan" turn, demoScan below, played through Liner's own
  tools exactly as any agent calls them).

  The sample is put in place once (seedDemo), when the Demo is shown (Settings › showDemo, the six taps) and Security has
  nothing of its own yet, and only into the Demo's own folders: the Sample project the engine makes for the Demo, and two
  empty folders under the engine's home (Demo projects/liner-site, Demo projects/harbour-notes) that stand in for the
  mockup's other projects. Nothing goes into a project of yours. The dates are laid out from today so the Overview's line
  reads as board A draws it: the free checks found an API key 24 days ago (fixed yesterday), a branch scan found one 5 days
  ago (dismissed 3 days ago, an accepted risk), and today's scan of the whole project found 4.

  The names on the sample's findings ("found by Claude", "confirmed by Codex") are the mockup's words, labels only: the
  Demo plays them, as it plays Claude's agents elsewhere. Its scripted scan's second look runs through the same quiet read
  as a real one, on the Demo, and is named as the Demo, the second look Start a scan offered.
*/
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FindingEvent, NewFinding, ScanRecord, SecurityFinding } from "../../contracts/src/index.ts";
import { noSeverities } from "../../contracts/src/index.ts";
import type { OpenOptions, TurnSink } from "./providers/types.ts";
import type { Security } from "./security.ts";

/** Who looked again at the sample's seeded findings: Codex, as board F draws it. A label on sample data only; no Codex is run. */
export const DEMO_LOOK_BY = "codex:gpt-5.5";
/** Who the sample's scans were by, as the boards name them. Labels only. */
const CLAUDE = "claude:claude-opus-5-5";
/** The branch board C and D read: six files on fix/tide-midnight. */
const DEMO_FILES = ["src/components/AlertCard.tsx", "src/db/alerts.sql", "src/pages/alerts.tsx", "src/routes/alerts.js", "src/tides.js", "src/tides.test.js"];
const DAY = 86_400_000;
const HOUR = 3_600_000;

const SECURITY_MD = `# Security

Foreshore shows the coast's tide tables to anyone, and lets people who sign up save alerts for a station.

## The API
Every route checks who is calling before it reads or changes anything.

## Sign-in
Only signed-in people save alerts; only staff change a station.

## Saved alerts
An alert is its owner's alone: nobody else reads, changes or deletes it.

## File uploads
Uploaded tide files are checked before they are read, and never served as pages.
`;

const markerOf = (sec: Security) => join(sec.store.home, "security", "demo.json");
const sampleOf = (sec: Security) => resolve(sec.store.home, "Sample project");
const demoHome = (sec: Security) => join(sec.store.home, "Demo projects");

/** For the Demo's Sample project, the branch boards C and D read (fix/tide-midnight, six files); undefined anywhere else. */
export function demoBranch(sec: Security, projectId: string): { name: string; base: string; files: string[] } | undefined {
  if (sec.store.settings.showDemo !== true) return undefined;
  const p = sec.store.projects.find((x) => x.id === projectId);
  if (!p || resolve(p.path) !== sampleOf(sec)) return undefined;
  return { name: "fix/tide-midnight", base: "main", files: DEMO_FILES };
}

/** Whether the Demo's sample should be shown: Settings show the Demo, it wasn't put in place before, and Security has nothing of its own yet. */
export function demoWanted(sec: Security): boolean {
  if (sec.store.settings.showDemo !== true || existsSync(markerOf(sec))) return false;
  return sec.projects().every((p) => !sec.findings(p.id).length && !sec.scans(p.id).length);
}

let seeding: Promise<void> | undefined;
/** Called as Security is used: puts the sample in place once when it's wanted; never throws. */
export function demoOnUse(sec: Security) {
  try {
    if (seeding || !demoWanted(sec)) return;
  } catch {
    return;
  }
  seeding = seedDemo(sec)
    .catch((e) => console.error("[security] the Demo's sample:", e))
    .finally(() => (seeding = undefined));
}

/** Puts the Demo's sample findings and scans in place (once; never over anything real). */
export async function seedDemo(sec: Security): Promise<void> {
  mkdirSync(join(sec.store.home, "security"), { recursive: true });
  writeFileSync(markerOf(sec), JSON.stringify({ at: Date.now() }));
  const now = Date.now();
  const today = new Date(now).setHours(0, 0, 0, 0);
  const day = (n: number, h = 0, m = 0) => today - n * DAY + h * HOUR + m * 60_000;
  const sample = await sec.host.call("project.add", { path: "@sample" });
  const folder = async (name: string) => {
    const dir = join(demoHome(sec), name);
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, "README.md"))) writeFileSync(join(dir, "README.md"), `# ${name}\n\nA folder Liner Code's Demo made, to stand in for a project in Liner Security's sample.\n`);
    const p = await sec.host.call("project.add", { path: dir });
    // Marked as the Demo's (Project.demoFor): shown in the Security face while the Demo is, never in Code's or Design's lists.
    return p.demoFor === "security" ? p : sec.store.putProject({ ...p, demoFor: "security" });
  };
  const site = await folder("liner-site");
  await folder("harbour-notes");

  // The threat model, written 12 Nov as board C says (five days before the mockup's today).
  const model = join(sample.path, "SECURITY.md");
  if (!existsSync(model)) {
    writeFileSync(model, SECURITY_MD);
    const at = new Date(day(5, 14));
    utimesSync(model, at, at);
  }

  /** A scan as it ended, at its time. */
  const scan = (projectId: string, r: { depth: ScanRecord["depth"]; title: string; at: number; ms: number; found?: Partial<ScanRecord["counts"]["bySeverity"]>; reader?: ScanRecord["reader"]; secondLook?: string; summary?: string; areasRead?: string[] }) => {
    const s = sec.newScan({ projectId, depth: r.depth, title: r.title, startedAt: r.at, state: "done", ...(r.reader ? { reader: r.reader } : {}), ...(r.secondLook ? { secondLook: r.secondLook } : {}) });
    const bySeverity = { ...noSeverities(), ...r.found };
    const found = Object.values(bySeverity).reduce((a, b) => a + b, 0);
    return sec.patchScan(s.id, { finishedAt: Math.min(r.at + r.ms, now), counts: { found, fresh: found, already: 0, leftOut: 0, bySeverity }, ...(r.summary ? { summary: r.summary } : {}), ...(r.areasRead ? { areasRead: r.areasRead } : {}), stopsAfter: r.depth === "checks" ? undefined : r.depth === "branch" ? 10 : 30 });
  };
  /** A finding, then its history and its parts laid out as the boards show them. */
  const finding = (projectId: string, n: NewFinding, by: string, shape: (f: SecurityFinding) => Partial<SecurityFinding> & { activity: FindingEvent[] }) => {
    const f = sec.add(projectId, n, by).finding;
    return sec.update(f.id, (x) => ({ ...x, ...shape(x) }), true);
  };

  // 24 Oct: the free checks find an API key in config.sample.js; it is fixed yesterday.
  const checks1 = scan(sample.id, { depth: "checks", title: "Sample project, free checks", at: day(24, 10, 12), ms: 8_000, found: { medium: 1 } });
  finding(sample.id, { title: "An API key is written in config.sample.js", severity: "medium", source: "checks", file: "config.sample.js", line: 3, rule: "secret/generic-secret", scan: checks1.id, explain: { lead: "Anyone who can read the repository can use the tide feed's API key, on your account.", wrong: "config.sample.js holds a real API key for the tide feed (TIDE…, masked here), not a placeholder. Every copy of the repository carries it.", who: "Anyone who can read the repository, or a copy of it.", gets: "Calls to the tide feed on your account, until the key is changed." } }, "free checks", () => ({
    foundAt: day(24, 10, 12),
    state: "fixed",
    activity: [
      { at: day(24, 10, 12), kind: "found", text: "Found by the free checks", by: "free checks", scan: checks1.id },
      { at: day(1, 16), kind: "fixed", text: "Fixed: the fix was merged" },
    ],
  }));

  // 12 Nov: a scan of the branch finds one, dismissed on 14 Nov as an accepted risk.
  const branch = scan(sample.id, { depth: "branch", title: "Sample project, this branch", at: day(5, 14, 30), ms: 3 * 60_000, found: { low: 1 }, reader: { kind: "own", agent: `@${CLAUDE}` }, areasRead: ["Saved alerts"] });
  const many = finding(sample.id, { title: "Anyone can make as many saved alerts as they like", severity: "low", source: "agent", file: "src/routes/alerts.js", line: 12, area: "Saved alerts", scan: branch.id, explain: { lead: "Someone signed in can save thousands of alerts, and each one sends mail.", wrong: "saveAlert in src/routes/alerts.js saves whatever it is sent, with no limit on how many alerts one person has." } }, CLAUDE, (x) => ({ foundAt: day(5, 14, 32), activity: [{ at: day(5, 14, 32), kind: "found", text: "Found by a scan", by: CLAUDE, scan: branch.id }], dismissed: x.dismissed }));
  sec.dismiss(many.id, "accepted-risk", "The mail provider caps what one account sends");
  sec.update(many.id, (x) => ({ ...x, dismissed: { reason: "accepted-risk", note: "The mail provider caps what one account sends", at: day(3, 11) }, activity: [...x.activity.filter((e) => e.kind !== "dismissed"), { at: day(3, 11), kind: "dismissed", text: "Dismissed: The mail provider caps what one account sends", by: "you" }] }), true);

  // Yesterday: liner-site's free checks, clean.
  const siteChecks = scan(site.id, { depth: "checks", title: "liner-site, free checks", at: day(1, 18), ms: 6_000 });
  sec.setChecks({ projectId: site.id, results: (["secrets", "packages", "files"] as const).map((check) => ({ check, state: "clean", count: 0, at: day(1, 18) })), added: 0, at: day(1, 18), scan: siteChecks.id });

  // Today, two hours ago: the whole project, by Claude, with Codex's second look. It found 4.
  const at = Math.min(Math.max(now - 2 * HOUR, today + 60_000), now - 60_000);
  const whole = scan(sample.id, { depth: "project", title: "Sample project, in full", at, ms: 25 * 60_000, found: { high: 1, medium: 2, low: 1 }, reader: { kind: "own", agent: `@${CLAUDE}` }, secondLook: DEMO_LOOK_BY, summary: "Anyone can read the database through a station's address, and anyone signed in can change any station.", areasRead: ["The API", "Sign-in", "Saved alerts", "File uploads"] });
  const t = (min: number) => Math.min(at + min * 60_000, now);
  const looked = (min: number, confirmed: boolean): FindingEvent => ({ at: t(min), kind: "looked", text: confirmed ? "Confirmed by a second look" : "A second look couldn't confirm it", by: DEMO_LOOK_BY, scan: whole.id });

  const station = finding(sample.id, {
    title: "The station id goes into the database query as text",
    severity: "high",
    source: "agent",
    file: "src/routes/station.js",
    line: 41,
    rule: "CWE-89",
    area: "The API",
    scan: whole.id,
    explain: {
      lead: "Anyone can read or change every saved alert, and the station table, by putting a piece of SQL in a station's address.",
      wrong: "The station route builds its query by pasting `req.params.id` into the text of the SQL, so whatever the address holds becomes part of the query. `db.query` is never handed the id as a value of its own.",
      where: [{ file: "src/routes/station.js", start: 40, lines: ["router.get(\"/api/station/:id\", async (req, res) => {", "  const rows = await db.query(`SELECT * FROM stations WHERE id = '${req.params.id}'`);", "  res.json(rows[0] ?? null);"], hit: [41] }],
      who: "Anyone who can open the site. The station pages are public, so they need no account.",
      gets: "Every row of every table the app's database user can read, saved alerts and email addresses among them, and the power to change them.",
      see: ["Open a station page and note its address, like /api/station/dover.", "Ask for a station whose id ends the query early:\n```\ncurl \"localhost:3000/api/station/x'%20OR%20'1'='1\"\n```", "It answers with the first station in the table instead of nothing: the query ran your words."],
    },
  }, CLAUDE, (x) => ({
    foundAt: t(6),
    sources: ["agent", "github"],
    look: { state: "confirmed", by: DEMO_LOOK_BY, words: "It read station.js and db.js: the id reaches the query as text, and nothing on the way checks it.", at: t(24) },
    activity: [{ at: t(6), kind: "found", text: "Found by a scan", by: CLAUDE, scan: whole.id }, { at: t(9), kind: "raised-again", text: "Raised again by GitHub", by: "gh" }, looked(24, true)],
    explain: x.explain,
  }));

  finding(sample.id, {
    title: "The admin page checks your role in the browser only",
    severity: "medium",
    source: "agent",
    file: "src/pages/admin.tsx",
    line: 12,
    area: "Sign-in",
    scan: whole.id,
    explain: {
      lead: "Anyone with an account can change any station and delete other people's saved alerts, by calling the admin addresses directly.",
      wrong: "The role check is in the wrong place. `AdminPage` hides its controls unless `localStorage.role` is `\"admin\"`, but the browser keeps that value, so a visitor can set it, or skip the page altogether. The server never asks: the two routes in `src/routes/admin.js` are registered with no check of who is calling, beyond being signed in.",
      where: [
        { file: "src/pages/admin.tsx", start: 11, lines: ["export function AdminPage() {", "  if (localStorage.role !== \"admin\") return <NotAllowed />;", "  return <StationEditor />;"], hit: [12] },
        { file: "src/routes/admin.js", start: 7, lines: ["// src/routes/admin.js", "router.post(\"/api/admin/station\", saveStation);", "router.delete(\"/api/admin/alert/:id\", deleteAlert);"], hit: [8, 9] },
      ],
      who: "Mallory signs up like anyone else. She never opens the admin page; she sends the request that page would send, with her own session.\n- She needs an account. Signing up is open to everyone.\n- She needs the two addresses. They are in the page's script, which every visitor downloads.\n- She does not need an admin's password or a leaked key.",
      gets: "She can change any station's details, so the tide table every visitor reads can be made wrong. She can delete any saved alert by its number, and the numbers count up, so she can delete all of them.",
      see: ["Sign in as an ordinary user and copy the session cookie.", "Send the request the admin page would send:\n```\ncurl -X POST localhost:3000/api/admin/station \\\n  -b \"session=YOUR-COOKIE\" -d \"id=dover&name=Calais\"\n```", "It answers `200` and the station changes, as it would for an admin."],
    },
  }, CLAUDE, (x) => ({
    foundAt: t(11),
    look: { state: "confirmed", by: DEMO_LOOK_BY, words: "It read admin.js and the sign-in code: no route in admin.js checks the role, and nothing in front of them does. It read only; it ran nothing.", at: t(24) },
    activity: [{ at: t(11), kind: "found", text: "Found by a scan", by: CLAUDE, scan: whole.id }, { at: t(12), kind: "note", text: "Ranked Medium: it takes an account, and signing up is open to everyone", by: CLAUDE, scan: whole.id }, looked(24, true)],
    explain: x.explain,
  }));

  finding(sample.id, {
    title: "lodash 4.17.20 has a known problem",
    severity: "medium",
    source: "checks",
    file: "package.json",
    rule: "GHSA-35jh-r3h4-6jhm",
    scan: whole.id,
    explain: {
      lead: "lodash's `template` can run code it is handed, so a page that ever passes it text a visitor wrote would run that text on the server.",
      wrong: "The lockfile pins lodash 4.17.20. `npm audit` lists GHSA-35jh-r3h4-6jhm against it: `_.template` builds a function from its options without checking them. It is fixed in 4.17.21. GitHub's alerts raised the same advisory, so it shows once.",
      where: [{ file: "package.json", start: 14, lines: ["  \"dependencies\": {", "    \"express\": \"^4.19.2\",", "    \"lodash\": \"4.17.20\","], hit: [16] }],
      see: ["Run the check yourself in the project's folder:\n```\nnpm audit --omit=dev\n```", "It names lodash and the advisory, and says `npm audit fix` moves it to 4.17.21."],
    },
  }, "free checks", () => ({
    foundAt: t(0),
    sources: ["checks", "github"],
    activity: [{ at: t(0), kind: "found", text: "Found by the free checks", by: "free checks", scan: whole.id }, { at: t(1), kind: "raised-again", text: "Raised again by GitHub", by: "gh" }],
  }));

  finding(sample.id, {
    title: "Error pages show where in the code it failed",
    severity: "low",
    source: "agent",
    file: "server.js",
    line: 88,
    area: "The API",
    scan: whole.id,
    explain: {
      lead: "A visitor who makes a request fail is shown the file names and lines of the code that failed, which makes the other findings easier to find.",
      wrong: "The last handler in `server.js` sends `err.stack` back as the page whenever something throws. It is meant for this Mac, but nothing turns it off when the site runs for everyone.",
      where: [{ file: "server.js", start: 86, lines: ["app.use((err, req, res, next) => {", "  console.error(err);", "  res.status(500).send(`<pre>${err.stack}</pre>`);", "});"], hit: [88] }],
      who: "Anyone who can open the site and send it something it does not expect.",
      gets: "The layout of the code and the names of its packages. Nothing on its own; a map for the next step.",
      see: ["Ask for a station with an id the database cannot read, like a very long one.", "The page that comes back lists the files and lines the request went through."],
    },
  }, CLAUDE, (x) => ({
    foundAt: t(17),
    look: { state: "unconfirmed", by: DEMO_LOOK_BY, words: "It read server.js and found the handler, but could not tell from the code whether the site runs with NODE_ENV set to production, which a host often sets.", at: t(24) },
    activity: [{ at: t(17), kind: "found", text: "Found by a scan", by: CLAUDE, scan: whole.id }, looked(24, false)],
    explain: x.explain,
  }));

  sec.setChecks({ projectId: sample.id, results: [{ check: "secrets", state: "clean", count: 0, at }, { check: "packages", state: "found", count: 1, note: "from npm audit", at }, { check: "files", state: "clean", count: 0, at }], added: 0, at, scan: whole.id });

  // A fix at work on the station id query: a Demo session in a worktree of its own (made, not run).
  try {
    const fix = await sec.host.call("thread.create", { projectId: sample.id, agent: "@demo:demo", worktree: true, title: "Fix the station id query", security: { kind: "fix", finding: station.id } });
    sec.update(station.id, (x) => ({ ...x, fix: { threadId: fix.id, state: "working", at: now - 3 * 60_000 }, activity: [...x.activity, { at: now - 3 * 60_000, kind: "fix-started", text: "A fix started, in a worktree of its own", by: "you" }] }), true);
  } catch (e) {
    console.error("[security] the Demo's fix session:", e);
  }
  sec.changed(["findings", "scans", "checks", "model", "projects"]);
}

/* ---------- The Demo's scripted scan, played by the Demo provider ---------- */

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("stopped"));
    const stop = () => (clearTimeout(t), reject(new Error("stopped")));
    const t = setTimeout(() => (signal.removeEventListener("abort", stop), resolve()), ms);
    signal.addEventListener("abort", stop, { once: true });
  });
async function stream(say: (t: string) => void, text: string, signal: AbortSignal, ms = 26) {
  const words = text.match(/\S+\s*/g) ?? [];
  for (let i = 0; i < words.length; i += 2) {
    say(words.slice(i, i + 2).join(""));
    await wait(ms, signal);
  }
}
/** One of Liner Code's tools, called the way mcp.ts calls it for any agent. */
async function liner(o: OpenOptions, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ text: string; failed: boolean }> {
  try {
    if (!o.mcp) throw new Error("Liner Code's tools aren't with this session.");
    const r = await fetch(o.mcp.env.LINER_SURFACE_URL, { method: "POST", headers: { "content-type": "application/json", "x-liner-surface": o.mcp.key ?? "" }, body: JSON.stringify({ tool, args }), signal });
    const b = (await r.json()) as { ok: boolean; result?: { content: { type: string; text?: string }[]; isError?: boolean }; error?: string };
    return { text: b.result?.content.find((c) => c.type === "text")?.text ?? b.error ?? "", failed: !b.ok || Boolean(b.result?.isError) };
  } catch (e) {
    if (signal.aborted) throw e;
    return { text: e instanceof Error ? e.message : String(e), failed: true };
  }
}

/** The plan board D and E show, ticked off as the script goes. */
const STEPS = ["The free checks: secrets, packages, files that should not be in git", "Read SECURITY.md and the 6 files this branch changed", "The new alerts API, which you asked for first", "The tide times this branch changed"];
/** The plan, with its last step naming who gives the second look (as the scan's first message says), or no such step when none does. */
const planOf = (lookBy?: string) => (done: number) => [...STEPS, ...(lookBy ? [`Hand what I found to ${lookBy} for a second look`] : [])].map((title, i) => ({ title, status: i < done ? ("completed" as const) : i === done ? ("in_progress" as const) : ("pending" as const) }));

/** The three questions of board D, each with the scan's guess first and why it guessed it. */
export const DEMO_QUESTIONS = [
  { question: "Can anyone sign up, or only people you invite?", header: "Sign-up", answers: ["Anyone can sign up", "Only people you invite", "Only your staff"], guess_reason: "the sign-up form asks for no invite" },
  { question: "Should one person ever see another person's alerts?", header: "Alerts", answers: ["No, never", "Yes, when its owner shares it", "Only your staff may"], guess_reason: "every alert is saved with its owner" },
  { question: "May an alert's text hold links or formatting?", header: "Alert text", answers: ["No, plain text only", "Yes, links", "Yes, any formatting"], guess_reason: "the alert form has a plain text box" },
];

/**
  The scan boards D, E and F show, on the Demo: it lists what's known, reads SECURITY.md and the branch, asks its three
  questions and waits for you, finds two problems in the alerts API (lodash, open already, isn't raised again), and ends
  with what it read and what it didn't get to. Every step is a call to Liner's own tools, so the engine records it as it
  would a real scan's; the second look follows from the engine, after the turn.
*/
export async function demoScan(o: OpenOptions, sink: TurnSink, signal: AbortSignal, t: string, text = "") {
  const lookBy = /^When you finish, (.+?) gives what you found a second look/m.exec(text)?.[1];
  const planAt = planOf(lookBy);
  const call = async (key: string, title: string, tool: string, args: Record<string, unknown>, ms = 350) => {
    const row = { key: `${t}-${key}`, tool: `mcp__liner__${tool}`, toolKind: "other" as const, title, input: JSON.stringify(args) };
    sink.tool({ ...row, status: "running" });
    await wait(ms, signal);
    const r = await liner(o, tool, args, signal);
    sink.tool({ ...row, status: r.failed ? "failed" : "done", output: r.text.slice(0, 2000) });
    return r;
  };
  const read = async (key: string, path: string, ms: number) => {
    sink.tool({ key: `${t}-${key}`, tool: "Read", toolKind: "read", title: `Read ${path}`, path, status: "running" });
    await wait(ms, signal);
    sink.tool({ key: `${t}-${key}`, tool: "Read", toolKind: "read", title: `Read ${path}`, path, status: "done" });
  };
  await stream((d) => sink.reasoning(d, `${t}-r`), "A scan of what this branch changed, with the new alerts API first. I'll see what's known already, read SECURITY.md and the six files, and ask what SECURITY.md doesn't say before I rank anything.", signal, 18);
  sink.plan(planAt(0));
  await call("known", "List what's known already", "security_list_findings", {});
  sink.plan(planAt(1));
  const model = await call("model", "Read the threat model", "security_read_model", {});
  // What SECURITY.md answers already (an earlier scan's answers) isn't asked again.
  const open = DEMO_QUESTIONS.filter((q) => !model.text.includes(q.question));
  for (const [i, f] of DEMO_FILES.entries()) await read(`f${i}`, f, 260);
  await call("u1", "Sign-in: not touched", "security_note_area", { area: "Sign-in", state: "untouched" }, 120);
  await call("u2", "File uploads: not touched", "security_note_area", { area: "File uploads", state: "untouched" }, 120);
  let said = model.text;
  if (open.length) {
    const many = ["One answer", "Two answers", "Three answers"][open.length - 1];
    await stream((d) => sink.text(d, `${t}-a`), `${many} would change how I rank what I find, and SECURITY.md does not give ${open.length === 1 ? "it" : "them"}. I have guessed ${open.length === 1 ? "it" : "each one"} from the code: take my guess, pick another, or skip. Where you skip, I go by my guess and say so in the finding.`, signal);
    said = (await call("ask", `Ask ${open.length === 1 ? "1 question" : `${open.length} questions`}`, "security_ask", { questions: open }, 200)).text;
  } else await stream((d) => sink.text(d, `${t}-a`), "SECURITY.md already says what would change how I rank things here, from your answers last time, so I won't ask again.", signal);
  const shares = /another person's alerts\? Yes/.test(said);
  sink.plan(planAt(2));
  await call("r1", "Reading The API", "security_note_area", { area: "The API", state: "reading" }, 120);
  await call("r2", "Reading Saved alerts", "security_note_area", { area: "Saved alerts", state: "reading" }, 120);
  await call("lodash", "Report a finding: lodash 4.17.20 has a known problem", "security_report_finding", { title: "lodash 4.17.20 has a known problem", severity: "medium", file: "package.json", rule: "GHSA-35jh-r3h4-6jhm", lead: "A crafted object sent to the server can change how every object in it behaves.", wrong: "package.json still asks for lodash 4.17.20, which npm audit reports." }, 200);
  await stream((d) => sink.text(d, `${t}-b`), "The free checks found nothing new: lodash is still open from the last scan, so I am not raising it again. In the alerts API I have one finding so far.", signal);
  await read("a1", "src/routes/alerts.js", 900);
  await call("f1", "Report a finding: Anyone signed in can read another person's alert", "security_report_finding", {
    title: "Anyone signed in can read another person's alert",
    severity: shares ? "low" : "medium",
    file: "src/routes/alerts.js",
    line: 27,
    area: "Saved alerts",
    rule: "CWE-639",
    lead: "Anyone with an account can read any saved alert, the station it watches and the address it mails, by changing the number in its address.",
    wrong: "getAlert in src/routes/alerts.js loads an alert by the number in the address and sends it back. It checks that someone is signed in, but never compares the alert's owner with who is asking.",
    where: [{ file: "src/routes/alerts.js", start: 25, lines: ["router.get(\"/api/alerts/:id\", signedIn, async (req, res) => {", "  const alert = await db.alerts.find(req.params.id);", "  res.json(alert);", "});"], hit: [26, 27] }],
    who: "Mallory signs up like anyone else and asks for alerts by number.\n- She needs an account. Signing up is open to everyone.\n- She needs an alert's number. They count up, so she can try them in turn.",
    gets: "Every saved alert: whose it is, the station it watches, and the e-mail address it goes to.",
    see: ["Sign in as an ordinary user and save an alert; note its number.", "Ask for the alert one number lower:\n```\ncurl localhost:3000/api/alerts/41 -b \"session=YOUR-COOKIE\"\n```", "It answers with someone else's alert."],
    why: shares ? "You said an owner may share an alert, but nothing here asks the owner, so I still report it, as Low." : "You said nobody should see another person's alerts, so I rank it Medium.",
  });
  await stream((d) => sink.text(d, `${t}-c`), `getAlert loads an alert by the number in the address and never compares its owner with who is asking. ${shares ? "You said an owner may share one, but nothing asks the owner, so I rank it Low." : "You said nobody should see another person's alerts, so I rank it Medium."} I am now checking the two other routes.`, signal);
  await read("a2", "src/routes/alerts.js", 700);
  await read("a3", "src/components/AlertCard.tsx", 800);
  await call("f2", "Report a finding: An alert's text may reach the page as HTML", "security_report_finding", {
    title: "An alert's text may reach the page as HTML",
    severity: "low",
    file: "src/components/AlertCard.tsx",
    line: 19,
    area: "Saved alerts",
    lead: "Someone who saves an alert with markup in its text might have it drawn as HTML where alerts are listed.",
    wrong: "AlertCard passes the alert's note through formatNote, which turns links into anchors with a string replace, and draws what comes back as the card's text. If that reached the page as HTML, a note could carry a script.",
    where: [{ file: "src/components/AlertCard.tsx", start: 18, lines: ["  const note = formatNote(alert.note);", "  return <p className=\"note\">{note}</p>;"], hit: [19] }],
    who: "Anyone signed in, who can save an alert.",
    gets: "Possibly a script running in the page of whoever reads the alert.",
    why: "You said an alert's text is plain, so markup in it is never meant to show: Low, until it's checked.",
  });
  await call("d1", "Read The API", "security_note_area", { area: "The API", state: "read" }, 120);
  await call("d2", "Read Saved alerts", "security_note_area", { area: "Saved alerts", state: "read" }, 120);
  sink.plan(planAt(3));
  await read("tides", "src/tides.js", 700);
  sink.plan(planAt(lookBy ? 5 : 4));
  const summary = "This branch lets anyone who is signed in read another person's alerts.";
  const readList = ["The alerts API: its three routes and everything they call.", "The tide times change: it only reads, and takes nothing from a visitor.", "The free checks: nothing new. lodash is still open, so it is not raised again."];
  const missed = ["The e-mail an alert sends. It goes through a package whose code is not here.", "Sign-in and file uploads. This branch did not touch them; a whole-project scan reads them."];
  await call("end", "Say how the scan ended", "security_finish", { summary, read: readList, missed }, 200);
  await stream((d) => sink.text(d, `${t}-z`), `\n\n${summary} A second, smaller finding may let an alert's text reach the page as HTML.${lookBy ? ` ${lookBy} gives both a second look next.` : ""}\n\n**What I read**\n\n${readList.map((l) => `- ${l}`).join("\n")}\n\n**What I did not get to**\n\n${missed.map((l) => `- ${l}`).join("\n")}`, signal, 20);
  sink.usage({ inputTokens: 9400, outputTokens: 1300, cacheReadTokens: 6100, costUsd: 0, contextTokens: 21000, contextWindow: 200000 });
}

/** The second look, on the Demo: the first finding holds, the others it couldn't confirm, in board F's words. */
export async function demoLook(text: string, sink: TurnSink, signal: AbortSignal, t: string) {
  const ids = [...text.matchAll(/^### (\S+)$/gm)].map((m) => m[1]);
  const words = "I read alerts.js and the sign-in code myself. The first finding holds: nothing compares an alert's owner with who is asking. I couldn't confirm the second: React escapes the text on its way to the page.";
  const findings = ids.map((id, i) => ({ id, verdict: i === 0 ? "confirmed" : "unconfirmed", why: i === 0 ? "getAlert never compares the alert's owner with who is asking; nothing in front of the route does either." : "React escapes the text on its way to the page, and formatNote returns text, not HTML." }));
  await wait(1200, signal);
  await stream((d) => sink.text(d, `${t}-l`), `${words}\n\n<second-look>${JSON.stringify({ words, findings })}</second-look>`, signal, 10);
  sink.usage({ inputTokens: 5200, outputTokens: 400, cacheReadTokens: 0, costUsd: 0 });
}

/** A question about a finding, on the Demo: a short, plain answer about the finding named in the message. */
export async function demoAbout(text: string, sink: TurnSink, signal: AbortSignal, t: string) {
  const title = /<finding>\n(.+?) \((?:Critical|High|Medium|Low)\)/.exec(text)?.[1] ?? "this finding";
  await stream((d) => sink.reasoning(d, `${t}-r`), "They want to know about a finding. I'll read the code it names and say whether it holds, how bad it is here, and how it would be fixed.", signal, 18);
  sink.tool({ key: `${t}-1`, tool: "Read", toolKind: "read", title: "Read the code it names", status: "running" });
  await wait(700, signal);
  sink.tool({ key: `${t}-1`, tool: "Read", toolKind: "read", title: "Read the code it names", status: "done" });
  await stream((d) => sink.text(d, `${t}-a`), `“${title}” holds as the scan describes it: the check it needs happens in the wrong place, or not at all. It matters here because signing up is open to everyone, so anyone can be the person it describes.\n\nThe fix is to make the server decide, on every request, whether the person asking may do this, and to add a test that tries it as someone who may not. Press Fix on the finding to start that in a worktree of its own. This session only reads, so I've changed nothing.`, signal);
  sink.usage({ inputTokens: 2100, outputTokens: 240, cacheReadTokens: 800, costUsd: 0 });
}


/**
  A fix, on the Demo: it reads the file the finding names and says the change it needs, about that finding. The sample
  doesn't hold the mockup's files, so it changes nothing and says so.
*/
export async function demoFix(text: string, sink: TurnSink, signal: AbortSignal, t: string) {
  const title = /<finding>\n(.+?) \((?:Critical|High|Medium|Low)\)/.exec(text)?.[1] ?? "this finding";
  const where = /^Where: (\S+?)(?::(\d+))?(?:-\d+)?$/m.exec(text);
  const file = where?.[1];
  await stream((d) => sink.reasoning(d, `${t}-r`), `The brief: ${title}. I'll read where it starts, close it there, and add a test that fails without the fix.`, signal, 18);
  sink.plan([{ title: `Read ${file ?? "the code it names"}`, status: "in_progress" }, { title: "Close it where it starts", status: "pending" }, { title: "Add a test that fails without the fix", status: "pending" }]);
  sink.tool({ key: `${t}-1`, tool: "Read", toolKind: "read", title: `Read ${file ?? "the code it names"}`, ...(file ? { path: file } : {}), status: "running" });
  await wait(800, signal);
  sink.tool({ key: `${t}-1`, tool: "Read", toolKind: "read", title: `Read ${file ?? "the code it names"}`, ...(file ? { path: file } : {}), status: "done", output: "(not in the Demo's sample project)" });
  sink.plan([{ title: `Read ${file ?? "the code it names"}`, status: "completed" }, { title: "Close it where it starts", status: "pending" }, { title: "Add a test that fails without the fix", status: "pending" }]);
  await stream(
    (d) => sink.text(d, `${t}-a`),
    `The fix for “${title}” belongs ${file ? `in ${file}${where?.[2] ? ` at line ${where[2]}` : ""}` : "where the finding starts"}: the server has to decide, on every request, whether the person asking may do this, rather than trusting what the page sends. A test beside the project's own would ask as someone who may not, and expect a refusal.\n\nThis is the Demo, and its sample project doesn't hold that file, so I've changed nothing.`,
    signal,
  );
  sink.usage({ inputTokens: 2400, outputTokens: 300, cacheReadTokens: 900, costUsd: 0 });
}
