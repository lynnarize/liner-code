/*
  Settings › Source control & issues: what each tool prints read into found, version and sign-in (captured sample output,
  no real CLIs), the keys Liner keeps never coming back, and the settings that change a merge, a commit message and a
  pull request's body. Run with `node --test engine/test/sourcecontrol.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCM_DEFAULTS, scmKey, scmSettings } from "../../contracts/src/index.ts";
import { azHasDevops, checkScmPatch, commitStyleNote, keyEnd, linearViewer, mergeMethodFor, parseFjAuth, parseGhAuth, parseGlabAuth, parseOriginAuth, parseTeaLogins, prTemplate, prTemplateNote, scanTools, SourceControl, versionIn, type Runner } from "../src/sourcecontrol.ts";

const GH_VERSION = "gh version 2.98.0 (2026-10-02)\nhttps://github.com/cli/cli/releases/tag/v2.98.0\n";
const GH_JSON = JSON.stringify({ hosts: { "github.com": [{ state: "success", active: false, host: "github.com", login: "old-me", tokenSource: "keyring", scopes: "repo" }, { state: "success", active: true, host: "github.com", login: "harbour-dev", tokenSource: "keyring" }] } });
const GH_OLD = "github.com\n  ✓ Logged in to github.com account harbour-dev (keyring)\n  - Active account: true\n  - Git operations protocol: https\n  - Token: gho_************************************\n";
const GLAB_OK = "gitlab.com\n  ✓ Logged in to gitlab.com as tide-person (/Users/x/.config/glab-cli/config.yml)\n  ✓ Git operations for gitlab.com configured to use https protocol.\n  ✓ Token: **************************\n";
const AZ_VERSION = "azure-cli                         2.67.0\n\ncore                              2.67.0\ntelemetry                          1.1.0\n\nExtensions:\nazure-devops                       1.0.1\n";

test("A tool's version is the first version number in what --version prints, whatever words come round it", () => {
  assert.equal(versionIn(GH_VERSION), "2.98.0");
  assert.equal(versionIn("git version 2.55.0 (Apple Git-155)"), "2.55.0");
  assert.equal(versionIn(AZ_VERSION), "2.67.0");
  assert.equal(versionIn("glab 1.53.0 (2025-03-04)"), "1.53.0");
  assert.equal(versionIn("Version: 0.9.2\tgolang: 1.21"), "0.9.2");
  assert.equal(versionIn("nothing to see"), undefined);
});

test("gh's JSON sign-in names the active signed-in account, and its older words are read too", () => {
  assert.deepEqual(parseGhAuth(GH_JSON), { signedIn: true, account: "harbour-dev" });
  assert.deepEqual(parseGhAuth(GH_OLD), { signedIn: true, account: "harbour-dev" });
  assert.deepEqual(parseGhAuth("github.com\n  ✓ Logged in to github.com as harbour-dev (oauth_token)\n"), { signedIn: true, account: "harbour-dev" });
  assert.deepEqual(parseGhAuth(JSON.stringify({ hosts: { "github.com": [{ state: "error", active: true, host: "github.com", login: "harbour-dev", error: "token expired" }] } })), { signedIn: false });
  assert.deepEqual(parseGhAuth("You are not logged into any GitHub hosts. To log in, run: gh auth login\n"), { signedIn: false });
});

test("glab, tea, fj and Cursor Origin each say who is signed in in their own words", () => {
  assert.deepEqual(parseGlabAuth(GLAB_OK), { signedIn: true, account: "tide-person" });
  assert.deepEqual(parseGlabAuth("gitlab.com\n  x gitlab.com: api call failed: 401 Unauthorized\n"), { signedIn: false });
  assert.deepEqual(parseTeaLogins(JSON.stringify([{ name: "codeberg", url: "https://codeberg.org", user: "tides", default: "true", valid: "true" }])), { signedIn: true, account: "tides" });
  assert.deepEqual(parseTeaLogins("[]"), { signedIn: false });
  assert.deepEqual(parseFjAuth("tides@codeberg.org\n"), { signedIn: true, account: "tides" });
  assert.deepEqual(parseFjAuth("No logins.\n"), { signedIn: false });
  assert.deepEqual(parseOriginAuth(JSON.stringify({ authenticated: true, tokenValid: true, account: { email: "me@example.com" } })), { signedIn: true, account: "me@example.com" });
  assert.deepEqual(parseOriginAuth(JSON.stringify({ authenticated: true, tokenValid: false })), { signedIn: false });
  assert.equal(azHasDevops(JSON.stringify([{ name: "azure-devops", version: "1.0.1" }])), true);
  assert.equal(azHasDevops("[]"), false);
});

/** A Mac with git, gh (signed in) and glab (signed out), and nothing else. */
function fakeMac(calls: string[][] = []) {
  const which = (cmd: string) => (["git", "gh", "glab"].includes(cmd) ? `/opt/bin/${cmd}` : null);
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const tool = cmd.split("/").pop();
    const a = args.join(" ");
    if (a === "--version") return { code: 0, stdout: tool === "git" ? "git version 2.55.0\n" : tool === "gh" ? GH_VERSION : "glab 1.53.0 (2025-03-04)\n", stderr: "" };
    if (tool === "gh" && a === "auth status --json hosts") return { code: 0, stdout: GH_JSON, stderr: "" };
    if (tool === "glab" && a === "auth status") return { code: 1, stdout: "", stderr: "gitlab.com\n  x No token found\n" };
    return { code: 1, stdout: "", stderr: "unknown" };
  };
  return { which, run };
}

test("A scan finds git and a signed-in gh, says how to get each missing tool, and never runs one that isn't there", async () => {
  const calls: string[][] = [];
  const tools = await scanTools({ env: {}, keys: new Map(), ...fakeMac(calls) });
  const by = Object.fromEntries(tools.map((t) => [t.id, t]));
  assert.deepEqual(by.git, { id: "git", found: true, path: "/opt/bin/git", version: "2.55.0" });
  assert.equal(by.github.found, true);
  assert.equal(by.github.version, "2.98.0");
  assert.equal(by.github.signedIn, true);
  assert.equal(by.github.account, "harbour-dev");
  assert.equal(by.gitlab.found, true);
  assert.equal(by.gitlab.signedIn, false);
  assert.match(by.gitlab.how ?? "", /glab auth login/);
  for (const id of ["azure", "forgejo", "origin"]) {
    assert.equal(by[id].found, false, id);
    assert.ok(by[id].how, `${id} says how to get it`);
  }
  assert.ok(!calls.some((c) => /\/(az|tea|fj|origin)$/.test(c[0])), "a missing tool is never run");
  assert.deepEqual(by.bitbucket, { id: "bitbucket", found: false, signedIn: false, how: "Kept in your keychain. Pull requests from Bitbucket come later." });
  assert.doesNotMatch(JSON.stringify(tools), /api\.bitbucket\.org/, "nothing sends the password anywhere in this build, so no hint says it goes somewhere");
  assert.deepEqual(tools.map((t) => t.id), ["git", "github", "gitlab", "azure", "forgejo", "origin", "bitbucket", "linear"]);
});

test("A kept key is shown by its last four characters at most, and never whole", async () => {
  const key = "lin_api_abcdefghijklmnopqrstuvwxyz0123456789WXYZ";
  const keys = new Map([[scmKey("linear"), key], [scmKey("bitbucket"), "ATBBshort"]]);
  const tools = await scanTools({ env: {}, keys, which: () => null, run: async () => ({ code: 1, stdout: "", stderr: "" }) });
  const text = JSON.stringify(tools);
  assert.ok(!text.includes(key) && !text.includes("ATBBshort"), "no key in the scan");
  const lin = tools.find((t) => t.id === "linear")!;
  assert.equal(lin.signedIn, true);
  assert.equal(lin.account, "…WXYZ");
  assert.equal(tools.find((t) => t.id === "bitbucket")!.account, "…", "a short key shows none of itself");
  assert.equal(keyEnd("x".repeat(40) + "1234"), "…1234");
});

test("Setting Linear's key asks Linear who it is, keeps it in memory under its name, and answers without it", async () => {
  const keys = new Map<string, string>();
  const sent: { url: string; auth: string }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, auth: String((init.headers as Record<string, string>).authorization) });
    return new Response(JSON.stringify({ data: { viewer: { name: "Kai Harbour", email: "kai@example.com" } } }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const scm = new SourceControl({ env: {}, keys, fetch, which: () => null, run: async () => ({ code: 1, stdout: "", stderr: "" }) });
  const key = "lin_api_0123456789abcdefghijklmnop";
  const tool = await scm.setToken("linear", key);
  assert.deepEqual(tool, { id: "linear", found: true, signedIn: true, account: "Kai Harbour" });
  assert.ok(!JSON.stringify(tool).includes(key));
  assert.equal(keys.get(scmKey("linear")), key);
  assert.deepEqual(sent, [{ url: "https://api.linear.app/graphql", auth: key }]);
  scm.clearToken("linear");
  assert.equal(keys.has(scmKey("linear")), false);
});

test("A key Linear refuses isn't kept, and the refusal says so plainly", async () => {
  const keys = new Map<string, string>();
  const fetch = (async () => new Response("{}", { status: 401 })) as unknown as typeof globalThis.fetch;
  const scm = new SourceControl({ env: {}, keys, fetch });
  await assert.rejects(scm.setToken("linear", "lin_api_wrongwrongwrongwrong"), /didn't take that key/);
  assert.equal(keys.size, 0);
  await assert.rejects(linearViewer("k", (async () => { throw new Error("offline"); }) as unknown as typeof globalThis.fetch), /didn't answer/);
});

test("A Bitbucket app password is kept without a request anywhere", async () => {
  const keys = new Map<string, string>();
  const fetch = (async () => assert.fail("Bitbucket's key is never sent in this build")) as unknown as typeof globalThis.fetch;
  const tool = await new SourceControl({ env: {}, keys, fetch }).setToken("bitbucket", "ATBB0123456789abcdefWXYZ");
  assert.equal(tool.account, "…WXYZ");
  assert.equal(keys.get(scmKey("bitbucket")), "ATBB0123456789abcdefWXYZ");
});

test("The scan is kept a minute, and Look again asks every tool again", async () => {
  const calls: string[][] = [];
  const scm = new SourceControl({ env: {}, keys: new Map(), ...fakeMac(calls) });
  await scm.scan();
  const n = calls.length;
  await scm.scan();
  assert.equal(calls.length, n, "the second look is the kept one");
  await scm.scan(true);
  assert.equal(calls.length, 2 * n);
});

test("The settings' defaults are squash, the repository's own style, templates not followed, no scans, and a two-minute refresh", () => {
  assert.equal(SCM_DEFAULTS.followPrTemplates, false, "a drafted pull request reads as before until you turn templates on");
  assert.deepEqual(scmSettings({}), { ...SCM_DEFAULTS, commitInstructions: undefined, hosts: undefined, trackers: undefined });
  assert.equal(SCM_DEFAULTS.worklistRefresh, 120);
});

test("A merge with no method picked uses the setting, and a picked one wins", () => {
  assert.equal(mergeMethodFor({}), "squash");
  assert.equal(mergeMethodFor({ mergeMethod: "rebase" }), "rebase");
  assert.equal(mergeMethodFor({ mergeMethod: "rebase" }, "merge"), "merge", "a pick wins");
});

test("A saved Last used merge method, which nothing could fill, reads as squash and can't be saved again", () => {
  const old = { mergeMethod: "last", lastMergeMethod: "merge" } as never;
  assert.equal(mergeMethodFor(old), "squash");
  assert.equal(scmSettings(old).mergeMethod, "squash");
  assert.throws(() => checkScmPatch({ mergeMethod: "last" } as never), /merge method/);
});

test("A commit message's prompt is unchanged at the default style, and follows Conventional Commits or your words when asked", () => {
  assert.equal(commitStyleNote({}), "");
  assert.equal(commitStyleNote({ commitStyle: "repo" }), "");
  assert.match(commitStyleNote({ commitStyle: "conventional" }), /Conventional Commit/);
  assert.match(commitStyleNote({ commitStyle: "custom", commitInstructions: "Start with the ticket number." }), /Start with the ticket number\./);
  assert.equal(commitStyleNote({ commitStyle: "custom", commitInstructions: "   " }), "", "custom with no words adds nothing");
});

test("A pull request's prompt carries the repository's template only when the setting follows them and it has one", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-scm-"));
  assert.equal(prTemplate(root), undefined);
  assert.equal(prTemplateNote({}, root), "", "no template, the prompt is as before");
  mkdirSync(join(root, ".github"));
  writeFileSync(join(root, ".github", "pull_request_template.md"), "## What\n\n## Why\n\n- [ ] Tests\n");
  assert.equal(prTemplate(root), "## What\n\n## Why\n\n- [ ] Tests");
  assert.equal(prTemplateNote({}, root), "", "off by default: the prompt is as before even with a template");
  assert.match(prTemplateNote({ followPrTemplates: true }, root), /<template>\n## What/);
  assert.equal(prTemplateNote({ followPrTemplates: false }, root), "");
  const other = mkdtempSync(join(tmpdir(), "lc-scm-"));
  mkdirSync(join(other, ".github", "PULL_REQUEST_TEMPLATE"), { recursive: true });
  writeFileSync(join(other, ".github", "PULL_REQUEST_TEMPLATE", "feature.md"), "Feature: ");
  assert.equal(prTemplate(other), "Feature:");
});

test("Settings › Source control refuses values it doesn't know", () => {
  assert.throws(() => checkScmPatch({ mergeMethod: "fast" as never }), /merge method/);
  assert.throws(() => checkScmPatch({ worklistRefresh: -1 }), /refresh/);
  assert.throws(() => checkScmPatch({ hosts: { github: "yes" } as never }), /switches/);
  assert.throws(() => checkScmPatch({ trackers: { jira: true } as never }), /switches/);
  const p = { commitInstructions: "x".repeat(3000), hosts: { gitlab: false }, worklistRefresh: 0 };
  checkScmPatch(p);
  assert.equal(p.commitInstructions.length, 2000);
});
