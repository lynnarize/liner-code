/*
  Liner Security's keys, the second review's cases: two problems of one rule in one file stay two (a SARIF report with no
  fingerprints, an agent giving one CWE to two problems), a CodeQL report and GitHub's alert for the same result are one,
  a key from before instances still meets its record and its dismissal, a retitle never makes two findings share a key,
  and the same source finding an open problem again adds no line each time (a scan adds one, for its "already open" list).
  Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeScanningFinding, parseSarif } from "../src/security-bringin.ts";
import { Security } from "../src/security.ts";
import { Store } from "../src/store.ts";

const temp = (n: string) => realpathSync(mkdtempSync(join(tmpdir(), `lc-keys-${n}-`)));
function rig() {
  const store = new Store(temp("home"));
  const path = temp("p");
  store.putProject({ id: "p", name: "p", path, git: false, createdAt: 1 });
  return { sec: new Security(store, {}), path };
}
const result = (line: number, msg: string, fp?: string) => ({ ruleId: "js/sql-injection", message: { text: msg }, ...(fp ? { partialFingerprints: { primaryLocationLineHash: fp } } : {}), locations: [{ physicalLocation: { artifactLocation: { uri: "src/db.js" }, region: { startLine: line } } }] });
const sarif = (results: unknown[], tool = "eslint") => JSON.stringify({ version: "2.1.0", runs: [{ tool: { driver: { name: tool } }, results }] });

test("keys: two problems of one rule in one file stay two, and what you dismissed of them stays dismissed", () => {
  const { sec, path } = rig();
  const s = parseSarif(sarif([result(10, "Query built from user input in getUser."), result(80, "Query built from user input in deleteAlert.")]), path);
  assert.deepEqual(sec.addMany("p", s.findings, "SARIF report").map((a) => a.outcome), ["new", "new"]);
  assert.equal(sec.findings("p").length, 2);
  const [first] = sec.findings("p");
  sec.dismiss(first.id, "false-positive");
  assert.deepEqual(sec.addMany("p", parseSarif(sarif([result(10, "Query built from user input in getUser."), result(80, "Query built from user input in deleteAlert.")]), path).findings).map((a) => a.outcome), ["dismissed-before", "already-open"]);
  // An agent giving one CWE to two problems in one file: two findings (security-scan.ts keys a rule'd one on its title too).
  const a = sec.add("p", { title: "Anyone can read another's alert", severity: "medium", source: "agent", file: "src/alerts.js", rule: "CWE-639", instance: "t:anyone can read another s alert" });
  const b = sec.add("p", { title: "Anyone can delete another's alert", severity: "medium", source: "agent", file: "src/alerts.js", rule: "CWE-639", instance: "t:anyone can delete another s alert" });
  assert.deepEqual([a.outcome, b.outcome], ["new", "new"]);
});

test("keys: a CodeQL report and GitHub's alert for the same result are one finding", () => {
  const { sec, path } = rig();
  const s = parseSarif(sarif([result(41, "This query depends on a user-provided value.", "abc123:1")], "CodeQL"), path);
  assert.equal(sec.addMany("p", s.findings).at(0)?.outcome, "new");
  const alert = codeScanningFinding({ number: 7, rule: { id: "js/sql-injection", description: "Database query built from user-controlled sources", security_severity_level: "high" }, most_recent_instance: { location: { path: "src/db.js", start_line: 44 }, message: { text: "This query depends on a user-provided value." }, partial_fingerprints: { primaryLocationLineHash: "abc123:1" } }, tool: { name: "CodeQL" } })!;
  assert.equal(alert.instance, "fp:primaryLocationLineHash=abc123:1");
  const r = sec.add("p", alert);
  assert.equal(r.outcome, "already-open");
  assert.deepEqual(r.finding.sources, ["sarif", "github"]);
  // An alert with no fingerprint goes by its number.
  assert.equal(codeScanningFinding({ number: 9, rule: { id: "js/xss" }, most_recent_instance: { location: { path: "a.js" } } })!.instance, "gh:9");
});

test("keys: a key from before instances still meets its record and its dismissal", () => {
  const { sec } = rig();
  const old = sec.add("p", { title: "Query built from user input", severity: "high", source: "sarif", file: "src/db.js", rule: "js/sql-injection" }).finding;
  assert.equal(old.instance, undefined);
  const r = sec.add("p", { title: "Query built from user input", severity: "high", source: "sarif", file: "src/db.js", rule: "js/sql-injection", instance: "fp:primaryLocationLineHash=x" });
  assert.deepEqual([r.outcome, r.finding.id], ["already-open", old.id]);
  const gone = sec.add("p", { title: "Old one", severity: "low", source: "agent", file: "src/x.js", rule: "CWE-1" }).finding;
  sec.dismiss(gone.id, "accepted-risk");
  assert.equal(sec.add("p", { title: "Old one", severity: "low", source: "agent", file: "src/x.js", rule: "CWE-1", instance: "t:old one" }).outcome, "dismissed-before");
  // And the other way: one with no instance meets the single record of its key that has one.
  const withOne = sec.add("p", { title: "lodash has a known problem", severity: "medium", source: "agent", file: "package.json", rule: "GHSA-1", instance: "t:lodash has a known problem" }).finding;
  const plain = sec.add("p", { title: "lodash has a known problem", severity: "medium", source: "checks", file: "package.json", rule: "GHSA-1" });
  assert.deepEqual([plain.outcome, plain.finding.id], ["already-open", withOne.id]);
});

test("keys: a retitle whose key is taken keeps its own, so no two findings share a key", () => {
  const { sec } = rig();
  const a = sec.add("p", { title: "First problem", severity: "low", source: "agent", file: "a.js" }).finding;
  const b = sec.add("p", { title: "Second problem", severity: "low", source: "agent", file: "a.js" }).finding;
  const moved = sec.update(b.id, (x) => ({ ...x, title: "First problem" }));
  assert.equal(moved.title, "First problem");
  assert.notEqual(moved.key, sec.finding(a.id).key);
  assert.equal(moved.key, b.key);
  // A free key is taken up.
  assert.notEqual(sec.update(b.id, (x) => ({ ...x, title: "Third problem" })).key, b.key);
});

test("keys: the same source finding an open problem again adds no line each run; a scan adds one, once", () => {
  const { sec } = rig();
  const n = { title: "A secret is in config.js", severity: "high" as const, source: "checks" as const, file: "config.js", rule: "secret/aws" };
  const f = sec.add("p", n, "free checks").finding;
  for (let i = 0; i < 5; i++) sec.add("p", n, "free checks");
  assert.deepEqual(sec.finding(f.id).activity.map((e) => e.kind), ["found"]);
  for (let i = 0; i < 3; i++) sec.add("p", { ...n, scan: "sc_1" }, "free checks");
  sec.add("p", { ...n, scan: "sc_2" }, "free checks");
  assert.deepEqual(sec.finding(f.id).activity.map((e) => [e.kind, e.scan]), [["found", undefined], ["raised-again", "sc_1"], ["raised-again", "sc_2"]]);
  // Another source still says so.
  sec.add("p", { ...n, source: "github" });
  assert.equal(sec.finding(f.id).activity.at(-1)?.text, "Raised again by GitHub");
});
