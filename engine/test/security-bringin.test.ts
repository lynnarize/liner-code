/*
  Liner Security's Bring in, with a fake gh on PATH and throwaway repositories (no real account, no network): GitHub
  fails soft in plain words (not installed, not signed in, no GitHub remote, code scanning not turned on) and brings in
  what it can; a Dependabot alert for an npm package is the same finding as npm audit's free check for it; an alert
  closed on GitHub closes here; a SARIF report in odd shapes (rules by index, a location by artifact index, a file:// uri,
  messages from messageStrings, passes and suppressed results, security-severity scores) comes in once, and again only
  as "already open", also when its lines moved (no line in a key: a fingerprint or an alert's number is the instance);
  findings stored by the first build, with a line in their rule, still dedupe and stay dismissed; a batch is one write;
  an excerpt never reads through a symlinked folder out of the project; a file that isn't SARIF 2 is an error that says
  why. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Security } from "../src/security.ts";
import { Store } from "../src/store.ts";
import { bringGitHub, bringSarif, githubReach, githubRepoOf, parseSarif } from "../src/security-bringin.ts";
import { excerptOf, runChecks } from "../src/security-checks.ts";

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore", env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", HOME: cwd } });
}
function rig(o: { remote?: string; files?: Record<string, string> } = {}) {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-bi-home-")));
  const path = mkdtempSync(join(tmpdir(), "lc-bi-p-"));
  const bin = mkdtempSync(join(tmpdir(), "lc-bi-bin-"));
  for (const [f, t] of Object.entries(o.files ?? {})) writeFileSync(join(path, f), t);
  git(path, "init", "-q");
  git(path, "add", "-A");
  if (o.remote) git(path, "remote", "add", "origin", o.remote);
  store.putProject({ id: "p", name: "harbour-notes", path, git: true, createdAt: 1 });
  const sec = new Security(store, { PATH: `${bin}:/usr/bin:/bin`, GIT_CONFIG_NOSYSTEM: "1", HOME: path });
  return { store, path, bin, sec };
}
/** A fake gh: `auth status` exits `auth`; `api …dependabot…` prints `dep` (one alert a line, as --jq '.[]' does); code scanning prints `code`, or fails with `codeErr`. */
function fakeGh(bin: string, o: { auth?: number; dep?: object[]; code?: object[]; codeErr?: string }) {
  writeFileSync(join(bin, "dep.out"), (o.dep ?? []).map((a) => JSON.stringify(a)).join("\n"));
  writeFileSync(join(bin, "code.out"), (o.code ?? []).map((a) => JSON.stringify(a)).join("\n"));
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh
echo "$@" >> "${join(bin, "gh.args")}"
case "$1 $2" in
  "auth status") exit ${o.auth ?? 0} ;;
esac
case "$*" in
  *dependabot*) cat "${join(bin, "dep.out")}" ;;
  *code-scanning*) ${o.codeErr ? `echo '${o.codeErr}' >&2; exit 1` : `cat "${join(bin, "code.out")}"`} ;;
esac
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
}
const dependabot = (name: string, n: number, sev = "high") => ({ number: n, state: "open", dependency: { package: { ecosystem: "npm", name }, manifest_path: "package-lock.json" }, security_advisory: { ghsa_id: "GHSA-35jh-r3h4-6jhm", cve_id: "CVE-2021-23337", summary: "Command Injection in lodash", description: "lodash versions prior to 4.17.21 are vulnerable to Command Injection via the template function.", severity: sev }, security_vulnerability: { severity: sev, vulnerable_version_range: "< 4.17.21", first_patched_version: { identifier: "4.17.21" } }, html_url: `https://github.com/acme/harbour/security/dependabot/${n}` });
const codeAlert = (n: number, line: number) => ({ number: n, state: "open", rule: { id: "js/sql-injection", severity: "error", security_severity_level: "high", description: "Database query built from user-controlled sources" }, tool: { name: "CodeQL" }, most_recent_instance: { location: { path: "src/station.js", start_line: line, end_line: line }, message: { text: "This query depends on a user-provided value." } }, html_url: `https://github.com/acme/harbour/security/code-scanning/${n}` });

test("bring in: GitHub remotes are read in every spelling, others aren't GitHub", () => {
  for (const u of ["git@github.com:acme/harbour.git", "https://github.com/acme/harbour", "https://github.com/acme/harbour.git\n", "ssh://git@github.com/acme/harbour.git", "https://token@github.com/acme/harbour/"]) assert.equal(githubRepoOf(u), "acme/harbour", u);
  for (const u of ["git@gitlab.com:acme/harbour.git", "https://example.com/github.com/acme/harbour", ""]) assert.equal(githubRepoOf(u), null, u);
});

test("bring in: GitHub fails soft, in words, at each thing in the way", async () => {
  const none = rig({ remote: "git@github.com:acme/harbour.git" });
  assert.match((await bringGitHub(none.sec, "p")).note!, /isn't installed/);
  assert.deepEqual(await githubReach(none.sec, "p"), { installed: false, signedIn: false, repo: "acme/harbour" });

  const out = rig({ remote: "git@github.com:acme/harbour.git" });
  fakeGh(out.bin, { auth: 1 });
  const r = await bringGitHub(out.sec, "p");
  assert.deepEqual(r, { added: 0, already: 0, leftOut: 0, note: "The GitHub CLI isn't signed in. Run gh auth login." });

  const local = rig();
  fakeGh(local.bin, {});
  assert.equal((await bringGitHub(local.sec, "p")).note, "This project has no GitHub remote (origin).");
  assert.deepEqual(await githubReach(local.sec, "p"), { installed: true, signedIn: true });
  const lab = rig({ remote: "git@gitlab.com:acme/harbour.git" });
  fakeGh(lab.bin, {});
  assert.equal((await bringGitHub(lab.sec, "p")).note, "This project has no GitHub remote (origin).");
});

test("bring in: Dependabot's alert and npm audit's check are one finding; code scanning not turned on is a note; closed on GitHub closes here", async () => {
  const { bin, sec } = rig({ remote: "https://github.com/acme/harbour.git", files: { "package.json": "{}", "package-lock.json": "{}" } });
  // The free check first, through a fake npm.
  writeFileSync(join(bin, "npm"), `#!/bin/sh\necho '${JSON.stringify({ auditReportVersion: 2, vulnerabilities: { lodash: { name: "lodash", severity: "high", isDirect: true, via: [{ title: "Command Injection in lodash", url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm", severity: "high" }], range: "<4.17.21", fixAvailable: true } } })}'\nexit 1\n`);
  chmodSync(join(bin, "npm"), 0o755);
  await runChecks(sec, "p");
  assert.equal(sec.findings("p").length, 1);

  fakeGh(bin, { dep: [dependabot("lodash", 4, "critical"), dependabot("minimist", 5, "medium"), { number: 6, state: "open" }], codeErr: "gh: no analysis found (HTTP 404)" });
  const r = await bringGitHub(sec, "p");
  assert.deepEqual(r, { added: 1, already: 1, leftOut: 0, note: "Code scanning alerts aren't turned on for acme/harbour." });
  const lodash = sec.findings("p").find((f) => f.rule === "npm/lodash")!;
  assert.deepEqual(lodash.sources, ["checks", "github"]);
  assert.equal(lodash.severity, "critical", "the worst severity is kept");
  const minimist = sec.findings("p").find((f) => f.rule === "npm/minimist")!;
  assert.equal(minimist.file, "package.json");
  assert.equal(minimist.source, "github");
  assert.equal(minimist.url, "https://github.com/acme/harbour/security/dependabot/5");
  assert.match(minimist.explain!.wrong, /Fixed in 4\.17\.21/);
  // Asked through the API with paging, read only.
  assert.match(readFileSync(join(bin, "gh.args"), "utf8"), /api -X GET repos\/acme\/harbour\/dependabot\/alerts\?state=open&per_page=100 --paginate --jq \.\[\]/);

  // minimist's alert closed on GitHub: fixed here. lodash stays open (the free checks raised it too).
  fakeGh(bin, { dep: [dependabot("lodash", 4)], code: [codeAlert(9, 3)] });
  const again = await bringGitHub(sec, "p");
  assert.deepEqual(again, { added: 1, already: 1, leftOut: 0 });
  assert.equal(sec.finding(minimist.id).state, "fixed");
  assert.equal(sec.finding(minimist.id).activity.at(-1)?.text, "Fixed: the alert was closed on GitHub");
  assert.equal(sec.finding(lodash.id).state, "open");
});

test("bring in: a SARIF report in odd shapes comes in once, and its keys and GitHub's hold when lines move", async () => {
  const { bin, path, sec } = rig({ remote: "git@github.com:acme/harbour.git", files: { "station.js": "a\nb\nconst q = `select * from t where id = ${id}`;\nd\n" } });
  const sarif = {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: { driver: { name: "CodeQL", rules: [{ id: "js/sql-injection", shortDescription: { text: "Database query built from user-controlled sources" }, defaultConfiguration: { level: "error" }, properties: { "security-severity": "8.8" }, helpUri: "https://codeql.github.com/js-sql-injection" }, { id: "js/log-injection", messageStrings: { default: { text: "Log entry depends on a user-provided value." } }, defaultConfiguration: { level: "note" } }] } },
        artifacts: [{ location: { uri: "station.js" } }],
        results: [
          { ruleId: "js/sql-injection", message: { text: "This query depends on a user-provided value." }, partialFingerprints: { primaryLocationLineHash: "sql1:1" }, locations: [{ physicalLocation: { artifactLocation: { uri: pathToFileURL(join(path, "station.js")).href }, region: { startLine: 3 } } }] },
          { ruleIndex: 1, message: { id: "default" }, locations: [{ physicalLocation: { artifactLocation: { index: 0 }, region: { startLine: 1, endLine: 2 } } }] },
          { ruleId: "js/sql-injection", kind: "pass", message: { text: "fine" } },
          { ruleId: "js/sql-injection", message: { text: "Suppressed." }, suppressions: [{ kind: "inSource" }], locations: [{ physicalLocation: { artifactLocation: { uri: "other.js" }, region: { startLine: 9 } } }] },
          { ruleId: "custom/critical", level: "warning", properties: { "security-severity": 9.4 }, partialFingerprints: { primaryLocationLineHash: "log9:1" }, message: { markdown: "Secrets are logged. More words here." }, locations: [{ physicalLocation: { artifactLocation: { uri: "lib/log.js" }, region: { startLine: "12" } } }] },
          null,
          "junk",
        ],
      },
      { tool: { driver: { name: "Empty" } } },
      { tool: {}, results: [{ message: {} }] },
    ],
  };
  const file = join(bin, "report.sarif");
  writeFileSync(file, JSON.stringify(sarif));
  const r = await bringSarif(sec, { projectId: "p", path: file });
  assert.deepEqual(r, { added: 3, already: 0, leftOut: 0 });
  const all = sec.findings("p");
  const sql = all.find((f) => f.rule === "js/sql-injection")!;
  assert.equal(sql.file, "station.js", "a file:// uri inside the project is made relative");
  assert.equal(sql.line, 3);
  assert.equal(sql.severity, "high", "8.8 is high");
  assert.equal(sql.title, "This query depends on a user-provided value");
  assert.deepEqual(sql.explain?.where?.[0], { file: "station.js", start: 1, lines: ["a", "b", "const q = `select * from t where id = ${id}`;", "d", ""], hit: [3] });
  const log = all.find((f) => f.rule === "js/log-injection")!;
  assert.deepEqual([log.file, log.line, log.endLine, log.severity, log.title], ["station.js", 1, 2, "low", "Log entry depends on a user-provided value"]);
  const crit = all.find((f) => f.rule === "custom/critical")!;
  assert.deepEqual([crit.severity, crit.file, crit.line, crit.title], ["critical", "lib/log.js", 12, "Secrets are logged"]);
  assert.equal(all.length, 3, "a pass, a suppressed result and empty ones don't come in");

  // The same report again: already open, nothing new.
  assert.deepEqual(await bringSarif(sec, { projectId: "p", text: JSON.stringify(sarif) }), { added: 0, already: 3, leftOut: 0 });
  // The code above moved: the same results at other lines are the same findings (their fingerprints are the key, not the line).
  const moved = JSON.parse(JSON.stringify(sarif).replaceAll('"startLine":3', '"startLine":7').replaceAll('"startLine":"12"', '"startLine":"20"'));
  assert.deepEqual(await bringSarif(sec, { projectId: "p", text: JSON.stringify(moved) }), { added: 0, already: 3, leftOut: 0 });
  // GitHub's code-scanning alert is its own instance (its number): a second finding, kept when it moves too.
  fakeGh(bin, { code: [{ ...codeAlert(1, 3), most_recent_instance: { location: { path: "station.js", start_line: 3 }, message: { text: "This query depends on a user-provided value." } } }] });
  assert.deepEqual([(await bringGitHub(sec, "p")).added], [1]);
  const alert = sec.findings("p").find((f) => f.instance === "gh:1")!;
  assert.equal(alert.rule, "js/sql-injection");
  fakeGh(bin, { code: [{ ...codeAlert(1, 30), most_recent_instance: { location: { path: "station.js", start_line: 30 }, message: { text: "x" } } }] });
  sec.dismiss(alert.id, "false-positive");
  assert.deepEqual([(await bringGitHub(sec, "p")).leftOut], [1], "dismissed, moved, still left out");
  // Dismissed, then brought in again: left out.
  sec.dismiss(crit.id, "accepted-risk");
  assert.deepEqual(await bringSarif(sec, { projectId: "p", path: file }), { added: 0, already: 2, leftOut: 1 });
  // Results the tool fingerprinted are told apart by it: one rule twice in one file is two findings, and a moved one is the same.
  const fp = (line: number, hash: string) => ({ ruleId: "js/xss", message: { text: "Cross-site scripting." }, partialFingerprints: { primaryLocationLineHash: hash }, locations: [{ physicalLocation: { artifactLocation: { uri: "station.js" }, region: { startLine: line } } }] });
  const two = { version: "2.1.0", runs: [{ tool: { driver: { name: "CodeQL" } }, results: [fp(1, "aaa:1"), fp(2, "bbb:1")] }] };
  assert.deepEqual(await bringSarif(sec, { projectId: "p", text: JSON.stringify(two) }), { added: 2, already: 0, leftOut: 0 });
  const shifted = { version: "2.1.0", runs: [{ tool: { driver: { name: "CodeQL" } }, results: [fp(11, "aaa:1"), fp(12, "bbb:1")] }] };
  assert.deepEqual(await bringSarif(sec, { projectId: "p", text: JSON.stringify(shifted) }), { added: 0, already: 2, leftOut: 0 });
});

test("bring in: what isn't a SARIF 2 report is an error that says why", async () => {
  const { sec, bin } = rig();
  await assert.rejects(bringSarif(sec, { projectId: "p", text: "not json" }), /isn't JSON/);
  await assert.rejects(bringSarif(sec, { projectId: "p", text: JSON.stringify({ version: "1.0.0", runs: [] }) }), /only SARIF 2\.1\.0/);
  await assert.rejects(bringSarif(sec, { projectId: "p", text: JSON.stringify({ version: "2.1.0" }) }), /has no runs/);
  await assert.rejects(bringSarif(sec, { projectId: "p", text: "[]" }), /has no runs/);
  await assert.rejects(bringSarif(sec, { projectId: "p", path: join(bin, "missing.sarif") }), /couldn't be read/);
  await assert.rejects(bringSarif(sec, { projectId: "p", path: bin }), /couldn't be read/);
  await assert.rejects(bringSarif(sec, { projectId: "p" }), /Pick a SARIF report/);
  assert.deepEqual(await bringSarif(sec, { projectId: "p", text: JSON.stringify({ version: "2.1.0", runs: [] }) }), { added: 0, already: 0, leftOut: 0, note: "The report has no problems in it." });
  // A location outside the project keeps its path, and gets no excerpt.
  const out = parseSarif(JSON.stringify({ runs: [{ tool: { driver: { name: "x" } }, results: [{ ruleId: "r", message: { text: "Hi." }, locations: [{ physicalLocation: { artifactLocation: { uri: "file:///etc/hosts" }, region: { startLine: 1 } } }] }] }] }), "/tmp/nowhere");
  assert.equal(out.findings[0].file, "/etc/hosts");
  assert.equal(out.findings[0].explain?.where, undefined);
});

test("bring in: findings stored with a line in their rule (before keys knew instances) still dedupe, and what was dismissed stays dismissed", async () => {
  const { store, sec, path } = rig();
  // A record as the first build wrote it: rule "js/sql-injection:3", dismissed by that key.
  const old = { id: "sf_old", projectId: "p", title: "Query from input", severity: "high", file: "station.js", line: 3, source: "sarif", sources: ["sarif"], rule: "js/sql-injection:3", key: "x", state: "dismissed", dismissed: { reason: "false-positive", at: 5 }, look: { state: "none" }, activity: [{ at: 1, kind: "found", text: "Brought in" }], foundAt: 1, updatedAt: 5 };
  const gh = { ...old, id: "sf_gh", source: "github", sources: ["github"], rule: "js/xss:9", state: "open", dismissed: undefined, url: "https://github.com/acme/harbour/security/code-scanning/7" };
  const file = join(store.home, "security", `${createHash("sha256").update(resolve(path)).digest("hex").slice(0, 16)}.json`);
  mkdirSync(join(store.home, "security"), { recursive: true });
  writeFileSync(file, JSON.stringify({ v: 1, path, findings: [old, gh], dismissed: [{ key: "station.js\njs sql injection 3", reason: "false-positive", at: 5 }], scans: [] }));
  const again = new Security(store, sec.env);
  assert.equal(again.finding("sf_old").rule, "js/sql-injection");
  assert.deepEqual([again.finding("sf_gh").rule, again.finding("sf_gh").instance], ["js/xss", "gh:7"]);
  const r = await bringSarif(again, { projectId: "p", text: JSON.stringify({ version: "2.1.0", runs: [{ tool: { driver: { name: "CodeQL" } }, results: [{ ruleId: "js/sql-injection", message: { text: "Query from input." }, locations: [{ physicalLocation: { artifactLocation: { uri: "station.js" }, region: { startLine: 40 } } }] }] }] }) });
  assert.deepEqual(r, { added: 0, already: 0, leftOut: 1 });
});

test("bring in: a GitHub alert met again under a finding stored without its instance stays open, and the next run says it is already there", async () => {
  const { store, sec, path, bin } = rig({ remote: "https://github.com/acme/harbour.git" });
  // As an older build stored GitHub's alert: its rule without a line and no instance, so its key is the bare one.
  const old = { id: "sf_bare", projectId: "p", title: "Database query built from user-controlled sources", severity: "high", file: "src/station.js", line: 3, source: "github", sources: ["github"], rule: "js/sql-injection", key: "x", state: "open", look: { state: "none" }, activity: [{ at: 1, kind: "found", text: "Brought in" }], foundAt: 1, updatedAt: 1, url: "https://github.com/acme/harbour/security/code-scanning/9" };
  const file = join(store.home, "security", `${createHash("sha256").update(resolve(path)).digest("hex").slice(0, 16)}.json`);
  mkdirSync(join(store.home, "security"), { recursive: true });
  writeFileSync(file, JSON.stringify({ v: 1, path, findings: [old], dismissed: [], scans: [] }));
  const again = new Security(store, sec.env);
  assert.equal(again.finding("sf_bare").instance, undefined);
  fakeGh(bin, { code: [codeAlert(9, 3)] });
  assert.deepEqual(await bringGitHub(again, "p"), { added: 0, already: 1, leftOut: 0 });
  assert.equal(again.finding("sf_bare").state, "open", "the alert that is still open on GitHub isn't closed here");
  assert.deepEqual(await bringGitHub(again, "p"), { added: 0, already: 1, leftOut: 0 });
  assert.equal(again.findings("p").length, 1);
});

test("bring in: a batch is one write of the project's record, not one a result", async () => {
  const { sec } = rig();
  let saves = 0;
  const own = sec as unknown as { save: (id: string) => void };
  const was = own.save.bind(sec);
  own.save = (id: string) => (saves++, was(id));
  const results = Array.from({ length: 300 }, (_, i) => ({ ruleId: `r${i}`, message: { text: `Problem ${i}.` }, locations: [{ physicalLocation: { artifactLocation: { uri: "a.js" }, region: { startLine: i + 1 } } }] }));
  const r = await bringSarif(sec, { projectId: "p", text: JSON.stringify({ version: "2.1.0", runs: [{ tool: { driver: { name: "x" } }, results }] }) });
  assert.equal(r.added, 300);
  assert.equal(saves, 1);
});

test("bring in: a code excerpt never reads outside the project, through a symlinked folder", async () => {
  const outside = mkdtempSync(join(tmpdir(), "lc-bi-out-"));
  writeFileSync(join(outside, "private.txt"), "outside line one\noutside line two\n");
  const { sec, path } = rig();
  symlinkSync(outside, join(path, "link"));
  const r = parseSarif(JSON.stringify({ runs: [{ tool: { driver: { name: "x" } }, results: [{ ruleId: "r", message: { text: "Hi." }, locations: [{ physicalLocation: { artifactLocation: { uri: "link/private.txt" }, region: { startLine: 1 } } }] }] }] }), path);
  assert.equal(r.findings[0].file, "link/private.txt");
  assert.equal(r.findings[0].explain?.where, undefined);
  assert.equal(excerptOf(path, "link/private.txt", 1), null);
  // Inside, through a link that stays inside: read.
  writeFileSync(join(path, "real.js"), "one\n");
  symlinkSync(join(path, "real.js"), join(path, "alias.js"));
  assert.deepEqual(excerptOf(path, "alias.js", 1, 1, 0)?.lines, ["one"]);
  void sec;
});
