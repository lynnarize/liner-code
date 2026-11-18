/*
  Liner Security, dev only: board B's findings in memory, shaped exactly as the engine sends them (SecurityFinding), for
  building and checking the Findings page before the Demo's data is there. Loaded only with ?ls-mock in the dev URL
  (findings-data.ts imports it on demand); the production build never reaches it. The words are the mockup's
  (Findings.dc.html, Main.dc.html); the three findings the mockup didn't explain in full are explained in its manner.
*/
import type { SecurityFinding } from "@contracts";

const H = 3_600_000;
const D = 24 * H;

/** The six findings of the sample: four open, one fixed, one dismissed, in `projectId`, timed back from `now`. */
export function mockFindings(projectId: string, now = Date.now()): SecurityFinding[] {
  const scan = "scan-mock-full";
  const base = { projectId, scan, area: undefined, url: undefined, endLine: undefined, dismissed: undefined, fix: undefined };
  const found = now - 2 * H;
  return [
    {
      ...base,
      id: "f-station",
      title: "The station id goes into the database query as text",
      severity: "high",
      file: "src/routes/station.js",
      line: 41,
      source: "agent",
      sources: ["agent"],
      rule: "sql-injection",
      key: `${projectId}\nsrc/routes/station.js\nsql injection`,
      state: "open",
      area: "Tide data",
      explain: {
        lead: "Anyone can read or change every saved alert, and the station table, by putting a piece of SQL in a station's address.",
        wrong: "The station route builds its query by pasting `req.params.id` into the text of the SQL, so whatever the address holds becomes part of the query. `db.query` is never handed the id as a value of its own.",
        where: [{ file: "src/routes/station.js", start: 40, lines: ["router.get(\"/api/station/:id\", async (req, res) => {", "  const rows = await db.query(`SELECT * FROM stations WHERE id = '${req.params.id}'`);", "  res.json(rows[0] ?? null);"], hit: [41] }],
        who: "Anyone who can open the site. The station pages are public, so they need no account.",
        gets: "Every row of every table the app's database user can read, saved alerts and email addresses among them, and the power to change them.",
        see: ["Open a station page and note its address, like /api/station/dover.", "Ask for a station whose id ends the query early:\n```\ncurl \"localhost:3000/api/station/x'%20OR%20'1'='1\"\n```", "It answers with the first station in the table instead of nothing: the query ran your words."],
      },
      look: { state: "confirmed", by: "codex:gpt-5.5", words: "It read station.js and db.js: the id reaches the query as text, and nothing on the way checks it.", at: found + 20 * 60_000 },
      fix: { threadId: "thread-mock-fix", state: "working", at: now - 6 * 60_000 },
      activity: [
        { at: found, kind: "found", text: "Found by the scan of the whole project", by: "claude:claude-opus-5-5", scan },
        { at: found + 20 * 60_000, kind: "looked", text: "Confirmed on a second look", by: "codex:gpt-5.5", scan },
        { at: now - 6 * 60_000, kind: "fix-started", text: "A fix started in its own worktree", by: "you" },
      ],
      foundAt: found,
      updatedAt: now - 6 * 60_000,
    },
    {
      ...base,
      id: "f-admin",
      title: "The admin page checks your role in the browser only",
      severity: "medium",
      file: "src/pages/admin.tsx",
      line: 12,
      source: "agent",
      sources: ["agent"],
      rule: "client-side-authorization",
      key: `${projectId}\nsrc/pages/admin.tsx\nclient side authorization`,
      state: "open",
      area: "Accounts and roles",
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
      look: { state: "confirmed", by: "codex:gpt-5.5", words: "It read admin.js and the sign-in code: no route in admin.js checks the role, and nothing in front of them does. It read only; it ran nothing.", at: found + 22 * 60_000 },
      activity: [
        { at: found, kind: "found", text: "Found by the scan of the whole project", by: "claude:claude-opus-5-5", scan },
        { at: found + 4 * 60_000, kind: "note", text: "Ranked Medium from your answer: signing up is open, and the site holds no money", by: "claude:claude-opus-5-5", scan },
        { at: found + 22 * 60_000, kind: "looked", text: "Confirmed on a second look", by: "codex:gpt-5.5", scan },
      ],
      foundAt: found + 60_000,
      updatedAt: found + 22 * 60_000,
    },
    {
      ...base,
      scan: undefined,
      id: "f-lodash",
      title: "lodash 4.17.20 has a known problem",
      severity: "medium",
      file: "package.json",
      source: "checks",
      sources: ["checks", "github"],
      rule: "GHSA-35jh-r3h4-6jhm",
      key: `${projectId}\npackage.json\nghsa 35jh r3h4 6jhm`,
      state: "open",
      explain: {
        lead: "lodash's `template` can run code it is handed, so a page that ever passes it text a visitor wrote would run that text on the server.",
        wrong: "The lockfile pins lodash 4.17.20. `npm audit` lists GHSA-35jh-r3h4-6jhm against it: `_.template` builds a function from its options without checking them. It is fixed in 4.17.21. GitHub's alerts raised the same advisory, so it shows once.",
        where: [{ file: "package.json", start: 14, lines: ["  \"dependencies\": {", "    \"express\": \"^4.19.2\",", "    \"lodash\": \"4.17.20\","], hit: [16] }],
        see: ["Run the check yourself in the project's folder:\n```\nnpm audit --omit=dev\n```", "It names lodash and the advisory, and says `npm audit fix` moves it to 4.17.21."],
      },
      look: { state: "none" },
      activity: [
        { at: found - 10 * 60_000, kind: "found", text: "Found by the free checks, from npm audit", by: "free checks" },
        { at: found - 9 * 60_000, kind: "raised-again", text: "GitHub's alerts raised it too; shown once", by: "gh" },
      ],
      foundAt: found - 10 * 60_000,
      updatedAt: found - 9 * 60_000,
    },
    {
      ...base,
      id: "f-errors",
      title: "Error pages show where in the code it failed",
      severity: "low",
      file: "server.js",
      line: 88,
      source: "agent",
      sources: ["agent"],
      rule: "stack-trace-exposure",
      key: `${projectId}\nserver.js\nstack trace exposure`,
      state: "open",
      area: "Running the site",
      explain: {
        lead: "A visitor who makes a request fail is shown the file names and lines of the code that failed, which makes the other findings easier to find.",
        wrong: "The last handler in `server.js` sends `err.stack` back as the page whenever something throws. It is meant for this Mac, but nothing turns it off when the site runs for everyone.",
        where: [{ file: "server.js", start: 86, lines: ["app.use((err, req, res, next) => {", "  console.error(err);", "  res.status(500).send(`<pre>${err.stack}</pre>`);", "});"], hit: [88] }],
        who: "Anyone who can open the site and send it something it does not expect.",
        gets: "The layout of the code and the names of its packages. Nothing on its own; a map for the next step.",
        see: ["Ask for a station with an id the database cannot read, like a very long one.", "The page that comes back lists the files and lines the request went through."],
      },
      look: { state: "unconfirmed", by: "codex:gpt-5.5", words: "It read server.js and found the handler, but could not tell from the code whether the site runs with NODE_ENV set to production, which a host often sets.", at: found + 24 * 60_000 },
      activity: [
        { at: found + 2 * 60_000, kind: "found", text: "Found by the scan of the whole project", by: "claude:claude-opus-5-5", scan },
        { at: found + 24 * 60_000, kind: "looked", text: "Couldn't confirm on a second look", by: "codex:gpt-5.5", scan },
      ],
      foundAt: found + 2 * 60_000,
      updatedAt: found + 24 * 60_000,
    },
    {
      ...base,
      id: "f-cookie",
      title: "The session cookie can be read by the page's scripts",
      severity: "medium",
      file: "src/session.js",
      line: 9,
      source: "agent",
      sources: ["agent"],
      rule: "cookie-httponly",
      key: `${projectId}\nsrc/session.js\ncookie httponly`,
      state: "fixed",
      explain: {
        lead: "A script that gets onto a page could copy a visitor's session and sign in as them.",
        wrong: "The session cookie was set without `httpOnly`, so `document.cookie` could read it.",
        where: [{ file: "src/session.js", start: 8, lines: ["app.use(session({", "  cookie: { secure: true },"], hit: [9] }],
      },
      look: { state: "confirmed", by: "codex:gpt-5.5", words: "It read session.js: the cookie has no httpOnly flag." },
      fix: { threadId: "thread-mock-old-fix", state: "merged", at: now - 3 * D },
      activity: [
        { at: now - 5 * D, kind: "found", text: "Found by the scan of the whole project", by: "claude:claude-opus-5-5" },
        { at: now - 4 * D, kind: "fix-started", text: "A fix started in its own worktree", by: "you" },
        { at: now - 3 * D, kind: "fixed", text: "Fixed: its fix was merged", by: "you" },
      ],
      foundAt: now - 5 * D,
      updatedAt: now - 3 * D,
    },
    {
      ...base,
      id: "f-testkey",
      title: "A payment key is in a test file",
      severity: "high",
      file: "test/fixtures/payments.json",
      line: 3,
      source: "checks",
      sources: ["checks"],
      rule: "secret/stripe-key",
      key: `${projectId}\ntest/fixtures/payments.json\nsecret stripe key`,
      state: "dismissed",
      dismissed: { reason: "false-positive", note: "It is Stripe's published test key, not ours.", at: now - D },
      explain: { lead: "A key that looks like a payment key is in a file git tracks.", wrong: "`test/fixtures/payments.json` holds a string shaped like a Stripe key." },
      look: { state: "none" },
      activity: [
        { at: now - 2 * D, kind: "found", text: "Found by the free checks: secrets in tracked files", by: "free checks" },
        { at: now - D, kind: "dismissed", text: "Dismissed as a false positive: It is Stripe's published test key, not ours.", by: "you" },
      ],
      foundAt: now - 2 * D,
      updatedAt: now - D,
    },
  ];
}
