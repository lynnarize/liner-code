/*
  Liner Security's free checks, on throwaway git repositories with a fake npm on PATH: secrets in tracked files are found by
  their well-known shapes and stand-ins ("your-api-key-here", AWS's own EXAMPLE key, "<token>") are not; a secret never
  reaches the stored finding, the run's result or the project's file on disk, only a masked preview (four characters, then
  dots); a second run raises nothing new; a secret taken out closes its finding as fixed; tracked .env files, SSH keys and
  an .npmrc holding a token are found, their example and ${VAR} cousins are not; npm audit's two JSON shapes give one
  finding per package with npm's "moderate" as medium; no package-lock.json, another lockfile or no repository is skipped
  in words; npm failing is a failed row, not an error; a private key written on one line or over many, and a secret over
  the cut of a long line, leave none of themselves in an excerpt; one secret is one finding; a big repository never holds
  the engine's thread for long. The secrets here are made up at run time, never written in this file
  whole. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Security } from "../src/security.ts";
import { Store } from "../src/store.ts";
import { entropy, excerptOf, isPlaceholder, masked, parseAudit, runChecks, secretsIn, shownLine } from "../src/security-checks.ts";

// Made-up secrets in the shapes the checks know, put together here so this file holds none whole.
const AWS = ["AK", "IA", "Q7RZ4MBN2XWD5KTE"].join("");
const GH = ["gh", "p_", "R8mKq2Lz9VtY4nB7wD1sF6hJ3cX0pA5eG2uN"].join("");
const GENERIC = ["q8Zr2Lm9", "Vt4Ny7Bw1Ds6"].join("");
const PEM = ["-----BEGIN ", "RSA PRIVATE KEY-----"].join("");

function git(cwd: string, ...args: string[]) {
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "ignore", env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", HOME: cwd } });
}

/** A project in a fresh git repository with `files` tracked, an engine home, and a bin folder for fake tools. */
function rig(files: Record<string, string>, o: { repo?: boolean } = {}) {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-chk-home-")));
  const path = mkdtempSync(join(tmpdir(), "lc-chk-p-"));
  const bin = mkdtempSync(join(tmpdir(), "lc-chk-bin-"));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(path, f, ".."), { recursive: true });
    writeFileSync(join(path, f), text);
  }
  if (o.repo !== false) {
    git(path, "init", "-q");
    git(path, "add", "-A");
  }
  store.putProject({ id: "p", name: "Sample project", path, git: o.repo !== false, createdAt: 1 });
  const env: NodeJS.ProcessEnv = { PATH: `${bin}:/usr/bin:/bin`, GIT_CONFIG_NOSYSTEM: "1", HOME: path };
  const sec = new Security(store, env);
  return { store, path, bin, env, sec };
}
/** A fake npm that prints `out` for npm audit and exits with `code`. */
function fakeNpm(bin: string, out: string, code = 1) {
  writeFileSync(join(bin, "npm.out"), out);
  writeFileSync(join(bin, "npm"), `#!/bin/sh\necho "$@" >> "${join(bin, "npm.args")}"\ncat "${join(bin, "npm.out")}"\nexit ${code}\n`);
  chmodSync(join(bin, "npm"), 0o755);
}
const rowOf = (run: { results: { check: string }[] }, id: string) => run.results.find((r) => r.check === id) as { check: string; state: string; count: number; note?: string; at: number };

test("checks: the shapes are found, stand-ins are not, and only a masked preview is kept", () => {
  assert.equal(GH.length, 40);
  const text = [`const aws = "${AWS}";`, `token: ${GH}`, `api_key = "${GENERIC}"`, `api_key = "your-api-key-here"`, `const k = "AKIAIOSFODNN7EXAMPLE";`, `token = "<token>"`, `secret = "${"ghp_" + "x".repeat(36)}"`, `password = "aaaaaaaaaaaaaaaa"`, `apiKey: "\${process.env.API_KEY}"`, `password = "short1"`].join("\n");
  const hits = secretsIn(text);
  assert.deepEqual(hits.map((h) => [h.pattern.id, h.line]), [["aws-access-key", 1], ["github-token", 2], ["generic-secret", 3]]);
  assert.deepEqual(hits.map((h) => h.preview), [masked(AWS), masked(GH), masked(GENERIC)]);
  for (const h of hits) assert.ok(!JSON.stringify(h).includes(AWS) && !JSON.stringify(h).includes(GH) && !JSON.stringify(h).includes(GENERIC));
  assert.ok(masked(AWS).startsWith("AKIA") && !masked(AWS).includes(AWS.slice(4)));
  assert.ok(isPlaceholder("your-key-here") && isPlaceholder("<token>") && isPlaceholder("AKIAIOSFODNN7EXAMPLE") && !isPlaceholder(GENERIC));
  assert.ok(entropy(GENERIC) > entropy("aaaaaaaaaaaaaaaa"));
  assert.equal(secretsIn(PEM).length, 1);
});

test("checks: a run finds secrets and bad files, never stores a secret, raises nothing new the second time, and closes what was taken out", async () => {
  const { path, store, bin, sec } = rig({
    "src/config.js": `export const aws = "${AWS}";\nexport const other = 1;\n`,
    "src/gh.js": `const t = "${GH}";\n`,
    "README.md": "Set api_key = \"your-api-key-here\" in your own .env.\n",
    ".env": `DB_PASSWORD=${GENERIC}\n`,
    ".env.example": "DB_PASSWORD=\n",
    ".npmrc": `//registry.npmjs.org/:_authToken=${GENERIC}\n`,
    "pkg/.npmrc": "//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n",
    "deploy/id_rsa": `${PEM}\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n`,
    "logo.png": "\0\x89PNG",
  });
  fakeNpm(bin, "should not run");
  const first = await runChecks(sec, "p");
  assert.equal(rowOf(first, "secrets").state, "found");
  assert.equal(rowOf(first, "secrets").count, 2);
  assert.equal(rowOf(first, "files").count, 3, ".env, .npmrc with a token, deploy/id_rsa");
  assert.deepEqual(rowOf(first, "packages"), { check: "packages", state: "skipped", count: 0, note: "no package.json", at: rowOf(first, "packages").at } as never);
  assert.equal(first.added, 5);
  const all = sec.findings("p");
  assert.deepEqual(all.map((f) => f.rule).sort(), ["file/env", "file/npm-token", "file/ssh-key", "secret/aws-access-key", "secret/github-token"]);
  assert.ok(all.every((f) => f.source === "checks" && f.state === "open" && f.activity[0].by === "free checks"));
  // The private key file is the files check's: its key block isn't a second finding.
  assert.ok(!all.some((f) => f.rule === "secret/private-key"));
  const aws = all.find((f) => f.rule === "secret/aws-access-key")!;
  assert.equal(aws.file, "src/config.js");
  assert.equal(aws.line, 1);
  assert.equal(aws.severity, "critical");
  assert.equal(aws.explain?.where?.[0].lines.length, 1, "a secret's excerpt is its own line");
  assert.match(aws.explain!.where![0].lines[0], /AKIA••••/);
  // Not in a finding, the run, the project's file on disk, or anything the store wrote.
  const disk = readdirSync(join(store.home, "security")).map((f) => readFileSync(join(store.home, "security", f), "utf8")).join("");
  for (const s of [AWS, GH, GENERIC]) {
    assert.ok(!JSON.stringify(all).includes(s), "no secret in a finding");
    assert.ok(!JSON.stringify(first).includes(s), "no secret in the run");
    assert.ok(!disk.includes(s), "no secret on disk");
  }
  assert.deepEqual(sec.checks("p")?.results.map((r) => r.check), ["secrets", "packages", "files"]);

  // Again: nothing new, nothing doubled.
  const second = await runChecks(sec, "p");
  assert.equal(second.added, 0);
  assert.equal(sec.findings("p").length, 5);
  // The same source finding them again on its next run adds no line each time (a scan's run adds one, once).
  assert.ok(sec.findings("p").every((f) => !f.activity.some((e) => e.kind === "raised-again")));

  // The AWS key taken out (in the working tree) and .env untracked: both fixed, with a line saying why; the rest stay open.
  writeFileSync(join(path, "src/config.js"), "export const aws = process.env.AWS_KEY;\n");
  git(path, "rm", "-q", "--cached", ".env");
  const third = await runChecks(sec, "p");
  assert.equal(third.added, 0);
  const now = sec.findings("p");
  for (const rule of ["secret/aws-access-key", "file/env"]) {
    const f = now.find((x) => x.rule === rule)!;
    assert.equal(f.state, "fixed", rule);
    assert.equal(f.activity.at(-1)?.text, "Fixed: the free checks no longer find it");
  }
  assert.equal(now.filter((f) => f.state === "open").length, 3);
  // Put back: open again.
  writeFileSync(join(path, "src/config.js"), `export const aws = "${AWS}";\n`);
  await runChecks(sec, "p");
  assert.equal(sec.findings("p").find((x) => x.rule === "secret/aws-access-key")?.state, "open");
});

test("checks: what you dismissed isn't raised again, and isn't counted as found", async () => {
  const { sec } = rig({ "a.js": `const t = "${GH}";\n` });
  await runChecks(sec, "p");
  const f = sec.findings("p")[0];
  sec.dismiss(f.id, "false-positive", "A revoked test token");
  const again = await runChecks(sec, "p");
  assert.equal(again.added, 0);
  assert.deepEqual([rowOf(again, "secrets").state, rowOf(again, "secrets").count], ["clean", 0]);
  assert.equal(sec.finding(f.id).state, "dismissed");
});

test("checks: npm audit's two shapes, one finding per package, and the skips said in words", async () => {
  const v7 = { auditReportVersion: 2, vulnerabilities: { lodash: { name: "lodash", severity: "moderate", isDirect: true, via: [{ source: 1096305, name: "lodash", title: "Prototype Pollution in lodash", url: "https://github.com/advisories/GHSA-p6mc-m468-83gw", severity: "moderate", range: "<4.17.19" }, { source: 1094499, name: "lodash", title: "Command Injection in lodash", url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm", severity: "high", range: "<4.17.21" }], range: "<=4.17.20", fixAvailable: true }, "body-parser": { name: "body-parser", severity: "high", isDirect: false, via: ["qs"], range: "<1.20.3", fixAvailable: { name: "express", version: "4.21.2", isSemVerMajor: false } }, qs: { name: "qs", severity: "critical", via: [{ title: "qs vulnerable to Prototype Pollution", url: "https://github.com/advisories/GHSA-hrpp-h998-j3pp", severity: "critical" }] } }, metadata: {} };
  const parsed = parseAudit(`npm warn something\n${JSON.stringify(v7)}`)!;
  assert.deepEqual(parsed.map((v) => [v.name, v.severity]), [["lodash", "medium"], ["body-parser", "high"], ["qs", "critical"]]);
  assert.deepEqual(parsed[0].ids, ["GHSA-p6mc-m468-83gw", "GHSA-35jh-r3h4-6jhm"]);
  const v6 = { advisories: { "1": { id: 1, module_name: "minimist", severity: "low", title: "Prototype Pollution", url: "https://npmjs.com/advisories/1", vulnerable_versions: "<0.2.1", patched_versions: ">=0.2.1" }, "2": { id: 2, module_name: "minimist", severity: "high", title: "Another", url: "https://github.com/advisories/GHSA-xvch-5gv4-984h" } }, metadata: { vulnerabilities: {} } };
  assert.deepEqual(parseAudit(JSON.stringify(v6))!.map((v) => [v.name, v.severity, v.ids.length]), [["minimist", "high", 2]]);
  assert.deepEqual(parseAudit(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} })), []);
  assert.equal(parseAudit(JSON.stringify({ error: { code: "ENOLOCK", summary: "no lockfile" } })), null);
  assert.equal(parseAudit("not json"), null);

  const { bin, sec, path } = rig({ "package.json": "{}", "package-lock.json": "{}" });
  fakeNpm(bin, JSON.stringify(v7));
  const run = await runChecks(sec, "p");
  assert.deepEqual(rowOf(run, "packages"), { check: "packages", state: "found", count: 3, note: "from npm audit", at: rowOf(run, "packages").at } as never);
  assert.match(readFileSync(join(bin, "npm.args"), "utf8"), /^audit --json --package-lock-only$/m, "audit reads the lockfile only: nothing installed");
  const lodash = sec.findings("p").find((f) => f.rule === "npm/lodash")!;
  assert.equal(lodash.file, "package.json");
  assert.equal(lodash.severity, "medium");
  assert.match(lodash.title, /lodash has Prototype Pollution in lodash, and 1 more/);
  // A second run, a package fixed: closed.
  fakeNpm(bin, JSON.stringify({ ...v7, vulnerabilities: { lodash: v7.vulnerabilities.lodash } }));
  await runChecks(sec, "p");
  assert.deepEqual(sec.findings("p").filter((f) => f.state === "open").map((f) => f.rule), ["npm/lodash"]);
  // npm can't reach the registry: a failed row, nothing closed.
  fakeNpm(bin, JSON.stringify({ message: "request to https://registry.npmjs.org/-/npm/v1/security/audits/quick failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org", error: {} }));
  const off = await runChecks(sec, "p");
  assert.deepEqual([rowOf(off, "packages").state, rowOf(off, "packages").note], ["failed", "couldn't reach the npm registry"]);
  assert.equal(sec.findings("p").find((f) => f.rule === "npm/lodash")?.state, "open");
  // Another lockfile: not checked, and said.
  rmSync(join(path, "package-lock.json"));
  writeFileSync(join(path, "yarn.lock"), "");
  assert.equal(rowOf(await runChecks(sec, "p"), "packages").note, "yarn.lock not read yet");
  rmSync(join(path, "yarn.lock"));
  assert.equal(rowOf(await runChecks(sec, "p"), "packages").note, "no package-lock.json");
});

test("checks: outside a git repository the file checks are skipped, and two runs at once are one", async () => {
  const { sec } = rig({ "a.js": `const t = "${GH}";\n` }, { repo: false });
  const [a, b] = [runChecks(sec, "p"), runChecks(sec, "p")];
  assert.equal(a, b);
  const run = await a;
  assert.deepEqual(run.results.map((r) => [r.check, r.state, r.note]), [["secrets", "skipped", "not a git repository"], ["packages", "skipped", "no package.json"], ["files", "skipped", "not a git repository"]]);
  assert.equal(sec.findings("p").length, 0);
});

test("checks: run for a scan, each finding counts on it", async () => {
  const { sec } = rig({ "a.js": `const t = "${GH}";\n`, ".env": "X=1\n" });
  const scan = sec.newScan({ projectId: "p", depth: "checks", title: "Sample project, free checks" });
  const run = await runChecks(sec, "p", scan.id);
  assert.equal(run.scan, scan.id);
  const s = sec.scan(scan.id);
  assert.equal(s.counts.found, 2);
  assert.equal(s.counts.fresh, 2);
  assert.equal(s.counts.bySeverity.critical + s.counts.bySeverity.high, 2);
  assert.ok(sec.findings("p").every((f) => f.scan === scan.id));
});

test("checks: a private key written on one line (a service account's JSON) leaves none of itself in the excerpt, the store or the run", async () => {
  const body = ["MIIEvQIBADANBgkqhkiG9w0BAQEFAASC", "BKcwggSjAgEAAoIBAQC7xQ3"].join("") + "k".repeat(300);
  const json = `{\n  "type": "service_account",\n  "private_key": "${PEM.replace("RSA ", "")}\\n${body}\\n-----END PRIVATE KEY-----\\n",\n  "client_email": "a@b.iam"\n}\n`;
  const { store, sec, path } = rig({ "sa.json": json, "keys/multi.txt": `before\n${PEM}\n${body.slice(0, 64)}\n${body.slice(64, 128)}\n-----END RSA PRIVATE KEY-----\nafter\n` });
  const run = await runChecks(sec, "p");
  const all = sec.findings("p");
  const sa = all.find((f) => f.file === "sa.json")!;
  assert.equal(sa.rule, "secret/private-key");
  assert.equal(sa.line, 3);
  const disk = readdirSync(join(store.home, "security")).map((f) => readFileSync(join(store.home, "security", f), "utf8")).join("");
  for (const s of [JSON.stringify(all), JSON.stringify(run), disk]) assert.ok(!s.includes(body.slice(0, 12)) && !s.includes("kkkk"), "no key material anywhere");
  assert.match(sa.explain!.where![0].lines[0], /"private_key": "-----BEGIN PRIVATE KEY-----••••••••$/);
  // A key over several lines: the lines between its markers are hidden in any excerpt around it.
  const ex = excerptOf(path, "keys/multi.txt", 2, 2, 3)!;
  assert.deepEqual(ex.lines, ["before", "-----BEGIN PRIVATE KEY-----••••••••", "••••••••", "••••••••", "-----END RSA PRIVATE KEY-----"]);
});

test("checks: a secret over the cut of a long line is masked before the line is cut", () => {
  const { path } = rig({ "long.js": `${" ".repeat(375)}const k = "${AWS}";\n` });
  const line = excerptOf(path, "long.js", 1, 1, 0)!.lines[0];
  assert.ok(!line.includes(AWS.slice(4, 8)), line.trim());
  assert.match(line, /AKIA•/);
  assert.equal(shownLine(`${" ".repeat(395)}${AWS}`).trim(), "AKIA•…");
});

test("checks: one secret is one finding, the specific kind over the generic, with its name in plain words", async () => {
  const { sec } = rig({ "src/config.js": `export const x = 1;\nconst access_key = "${AWS}";\nconst api_key = "${GENERIC}";\n` });
  await runChecks(sec, "p");
  const all = sec.findings("p");
  assert.deepEqual(all.map((f) => [f.rule, f.line]).sort(), [["secret/aws-access-key", 2], ["secret/generic-secret", 3]]);
  assert.match(all.find((f) => f.rule === "secret/aws-access-key")!.explain!.wrong, /^Line 2 of src\/config\.js holds an AWS access key\./);
});

test("checks: a big repository never holds the engine's thread for long", async () => {
  const files: Record<string, string> = {};
  const chunk = `const a = ${"1234567890abcdef".repeat(4)};\n`.repeat(1500);
  for (let i = 0; i < 300; i++) files[`f${i}.js`] = chunk;
  const { sec } = rig(files);
  let last = Date.now();
  let worst = 0;
  const beat = setInterval(() => {
    worst = Math.max(worst, Date.now() - last);
    last = Date.now();
  }, 1);
  const t = Date.now();
  await runChecks(sec, "p");
  worst = Math.max(worst, Date.now() - last);
  clearInterval(beat);
  assert.ok(Date.now() - t > 150, `the run took ${Date.now() - t} ms, too short to tell`);
  assert.ok(worst < 100, `the thread was held ${worst} ms`);
});
