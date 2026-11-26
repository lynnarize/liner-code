/*
  Settings › Source control & issues: which tools that know about your code are on this Mac, and whether they're signed
  in. Each is asked the way T3 Code asks it (the source-control packages, server halves, MIT): its version, then its own sign-in
  status, with short timeouts and the PATH agents get. Only names come back, never a token; the two keys Liner keeps
  itself (a Bitbucket app password, a Linear API key) live in the keychain like the Models keys, and the engine holds them
  in memory under scmKey(id). Of these, only GitHub (through gh) and Linear drive lists in this build (worklists.ts).

  It also holds the small pieces the Source control settings change elsewhere: the merge method a Merge uses when none is
  picked, the commit style a drafted message follows, and the pull request template a drafted body follows.
*/
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MergeMethod, ScmTool, ScmTokenId, Settings } from "../../contracts/src/index.ts";
import { scmKey, scmSettings } from "../../contracts/src/index.ts";
import { run as runCmd, which as whichCmd, type RunResult } from "./exec.ts";

export type Runner = (cmd: string, args: string[], o: { env?: NodeJS.ProcessEnv; timeout?: number; cwd?: string }) => Promise<RunResult>;
/** What a scan is handed: the PATH agents get, the keys in memory, and (for tests) stand-ins for running and finding commands and for fetch. */
export type ScmCtx = { env: NodeJS.ProcessEnv; keys: Map<string, string>; run?: Runner; which?: (cmd: string, env: NodeJS.ProcessEnv) => string | null; fetch?: typeof fetch };

const mac = process.platform === "darwin";
const win = process.platform === "win32";

/* ---------- What each tool prints ---------- */

/** The first version number in a tool's --version output ("gh version 2.98.0 (2026-…)", "git version 2.55.0", "azure-cli  2.67.0"). */
export function versionIn(text: string): string | undefined {
  return /\b(\d+\.\d+(?:\.\d+)?)\b/.exec(text)?.[1];
}

/**
  gh's sign-in: `gh auth status --json hosts` (gh 2.81 and later) names each account and whether it's active; older gh
  prints "Logged in to github.com account NAME" (or "as NAME"). The active, signed-in account wins (T3 Code's
  gitHubAuthStatus.ts). Never a token: gh shows only a masked one, and nothing here keeps it.
*/
export function parseGhAuth(out: string): { signedIn: boolean; account?: string } {
  try {
    const j = JSON.parse(out) as { hosts?: Record<string, { state?: string; active?: boolean; login?: string; host?: string }[]> };
    if (j && typeof j === "object" && j.hosts && typeof j.hosts === "object") {
      const all = Object.values(j.hosts).flat().filter((a) => a && typeof a.login === "string" && a.login.trim());
      const ok = all.filter((a) => a.state === "success");
      const pick = ok.find((a) => a.active) ?? ok[0];
      return pick ? { signedIn: true, account: pick.login!.trim() } : { signedIn: false };
    }
  } catch {
    // the older words, below
  }
  const m = /Logged in to \S+ (?:account|as)\s+([^\s(]+)/i.exec(out);
  return m ? { signedIn: true, account: m[1] } : { signedIn: false };
}

/** glab's sign-in, from `glab auth status`'s words: "Logged in to gitlab.com as NAME" (T3 Code's gitLabAuthStatus.ts). */
export function parseGlabAuth(out: string): { signedIn: boolean; account?: string } {
  const m = /Logged in to .+? as\s+([^\s(]+)/i.exec(out);
  return m ? { signedIn: true, account: m[1] } : { signedIn: false };
}

/** Whether az has its devops extension, from `az extension list -o json`. */
export function azHasDevops(out: string): boolean {
  try {
    const l = JSON.parse(out) as { name?: string }[];
    return Array.isArray(l) && l.some((e) => e?.name === "azure-devops");
  } catch {
    return /\bazure-devops\b/.test(out);
  }
}

/** tea's logins, from `tea login list --output json`: the default one, else the first (T3 Code's ForgejoCli.ts). */
export function parseTeaLogins(out: string): { signedIn: boolean; account?: string } {
  try {
    const l = JSON.parse(out) as { user?: string; default?: string | boolean; valid?: string | boolean }[];
    if (!Array.isArray(l) || !l.length) return { signedIn: false };
    const pick = l.find((x) => String(x.default) === "true") ?? l[0];
    return { signedIn: String(pick.valid ?? "true") === "true" && Boolean(pick.user), account: pick.user || undefined };
  } catch {
    return { signedIn: false };
  }
}

/** fj's logins, from `fj auth list`: lines of "name@host", none when it has no login. */
export function parseFjAuth(out: string): { signedIn: boolean; account?: string } {
  const line = out.split(/\r?\n/).map((l) => l.trim()).find((l) => /^[^\s@]+@\S+$/.test(l));
  return line ? { signedIn: true, account: line.split("@")[0] } : { signedIn: false };
}

/** Cursor Origin's sign-in, from `origin auth status --json` (T3 Code's OriginCli.ts): its email names the account. */
export function parseOriginAuth(out: string): { signedIn: boolean; account?: string } {
  try {
    const j = JSON.parse(out) as { authenticated?: boolean; tokenValid?: boolean; account?: { email?: string | null } | null };
    if (!j?.authenticated || j.tokenValid === false) return { signedIn: false };
    return { signedIn: true, account: j.account?.email?.trim() || undefined };
  } catch {
    return { signedIn: false };
  }
}

/** A key as it may be shown: its last 4 characters at most, and none of a short one. */
export const keyEnd = (key: string) => (key.length >= 12 ? `…${key.slice(-4)}` : "…");

/* ---------- The hints ---------- */

const HOW = {
  git: mac ? "Not found. Run `xcode-select --install`, or `brew install git`." : win ? "Not found. Run `winget install Git.Git`." : "Not found. Install git with your package manager.",
  gh: `Not found. Run \`${win ? "winget install --id GitHub.cli" : "brew install gh"}\`, then \`gh auth login\`.`,
  ghOut: "Not signed in. Run `gh auth login`.",
  glab: `Not found. Run \`${win ? "winget install glab.glab" : "brew install glab"}\`, then \`glab auth login\`.`,
  glabOut: "Not signed in. Run `glab auth login`.",
  az: "Not found. Install the az CLI with its devops extension, then `az login`.",
  azExt: "Add its devops extension with `az extension add --name azure-devops`, then `az login`.",
  azOut: "Not signed in. Run `az login`.",
  forgejo: "Not found. Install `fj` or `tea`, then sign in to each server.",
  forgejoOut: "Not signed in. Run `tea login add`, or `fj auth add-token`, for each server.",
  origin: "Not found. Install the Origin CLI, then `origin auth login`.",
  originOut: "Not signed in. Run `origin auth login`.",
  // Nothing sends the password in this build, so the hint says where it's kept rather than where it goes.
  bitbucket: "Kept in your keychain. Pull requests from Bitbucket come later.",
  linear: "A Linear team's issues, with a key you make in Linear. The key goes to linear.app and nowhere else.",
};
const later = (name: string) => `Pull requests from ${name} come later.`;

/* ---------- The scan ---------- */

const SHORT = 8_000;

/** One tool's version and sign-in. `auth` runs only once the tool is found. */
async function probe(ctx: ScmCtx, id: ScmTool["id"], cmd: string, o: { versionArgs?: string[]; timeout?: number; auth?: (path: string) => Promise<Partial<ScmTool>>; missing: string }): Promise<ScmTool> {
  const run = ctx.run ?? runCmd;
  const path = (ctx.which ?? whichCmd)(cmd, ctx.env);
  if (!path) return { id, found: false, how: o.missing };
  const v = await run(path, o.versionArgs ?? ["--version"], { env: ctx.env, timeout: o.timeout ?? SHORT }).catch(() => null);
  const version = v && v.code === 0 ? versionIn(v.stdout || v.stderr) : undefined;
  const base: ScmTool = { id, found: true, path, ...(version ? { version } : {}) };
  if (!o.auth) return base;
  try {
    return { ...base, ...(await o.auth(path)) };
  } catch {
    return base;
  }
}

/** Every tool, asked at once. Hosts whose pull requests aren't listed yet say so in their hint once they're signed in. */
export async function scanTools(ctx: ScmCtx): Promise<ScmTool[]> {
  const run = ctx.run ?? runCmd;
  const say = (cmd: string, args: string[], timeout = SHORT) => run(cmd, args, { env: ctx.env, timeout }).catch(() => ({ code: 1, stdout: "", stderr: "" }) as RunResult);
  const git = probe(ctx, "git", "git", { missing: HOW.git });
  const gh = probe(ctx, "github", "gh", {
    missing: HOW.gh,
    auth: async (p) => {
      // The JSON form first; a gh too old for it answers with an error, and its words are read instead.
      const j = await say(p, ["auth", "status", "--json", "hosts"], 15_000);
      const old = async () => {
        const r = await say(p, ["auth", "status"], 15_000);
        return parseGhAuth(`${r.stdout}\n${r.stderr}`);
      };
      const a = j.stdout.trim().startsWith("{") ? parseGhAuth(j.stdout) : await old();
      return a.signedIn ? { signedIn: true, account: a.account } : { signedIn: false, how: HOW.ghOut };
    },
  });
  const glab = probe(ctx, "gitlab", "glab", {
    missing: HOW.glab,
    auth: async (p) => {
      const r = await say(p, ["auth", "status"], 15_000);
      const a = parseGlabAuth(`${r.stdout}\n${r.stderr}`);
      return a.signedIn ? { signedIn: true, account: a.account, how: later("GitLab") } : { signedIn: false, how: HOW.glabOut };
    },
  });
  // az starts Python, which is slow, so it gets longer (T3 Code's AzureDevOpsSourceControlProvider.ts).
  const az = probe(ctx, "azure", "az", {
    missing: HOW.az,
    timeout: 20_000,
    auth: async (p) => {
      const ext = await say(p, ["extension", "list", "-o", "json"], 20_000);
      if (!azHasDevops(ext.stdout)) return { signedIn: false, how: HOW.azExt };
      const r = await say(p, ["account", "show", "--query", "user.name", "-o", "tsv"], 20_000);
      const name = r.code === 0 ? r.stdout.trim().split(/\r?\n/)[0] : "";
      return name ? { signedIn: true, account: name, how: later("Azure DevOps") } : { signedIn: false, how: HOW.azOut };
    },
  });
  const forgejo = (async (): Promise<ScmTool> => {
    // fj first, then tea: either reaches Forgejo and Gitea servers.
    const fj = await probe(ctx, "forgejo", "fj", { versionArgs: ["version"], missing: HOW.forgejo, auth: async (p) => parseFjAuth((await say(p, ["auth", "list"])).stdout) });
    const tool = fj.found ? fj : await probe(ctx, "forgejo", "tea", { missing: HOW.forgejo, auth: async (p) => parseTeaLogins((await say(p, ["login", "list", "--output", "json"])).stdout) });
    return tool.found ? { ...tool, how: tool.signedIn ? later("Forgejo and Gitea") : HOW.forgejoOut } : tool;
  })();
  const origin = probe(ctx, "origin", "origin", {
    missing: HOW.origin,
    auth: async (p) => {
      const a = parseOriginAuth((await say(p, ["auth", "status", "--json"])).stdout);
      return a.signedIn ? { signedIn: true, account: a.account, how: later("Cursor Origin") } : { signedIn: false, how: HOW.originOut };
    },
  });
  const kept = (id: ScmTokenId, how: string): ScmTool => {
    const k = ctx.keys.get(scmKey(id));
    return k ? { id, found: true, signedIn: true, account: keyEnd(k), ...(id === "bitbucket" ? { how: later("Bitbucket") } : {}) } : { id, found: false, signedIn: false, how };
  };
  return [...(await Promise.all([git, gh, glab, az, forgejo, origin])), kept("bitbucket", HOW.bitbucket), kept("linear", HOW.linear)];
}

/** Asks Linear who a key belongs to: its one request to api.linear.app, with the key alone. Throws in plain words when Linear won't take it. */
export async function linearViewer(key: string, f: typeof fetch = fetch): Promise<string> {
  const r = await f("https://api.linear.app/graphql", { method: "POST", headers: { "content-type": "application/json", authorization: key }, body: JSON.stringify({ query: "query { viewer { name email } }" }), signal: AbortSignal.timeout(10_000), redirect: "error" }).catch(() => null);
  if (!r) throw new Error("Linear didn't answer. Try again in a minute.");
  if (r.status === 401 || r.status === 403) throw new Error("Linear didn't take that key.");
  if (!r.ok) throw new Error(`Linear answered ${r.status}. Try again in a minute.`);
  const j = (await r.json().catch(() => null)) as { data?: { viewer?: { name?: string; email?: string } }; errors?: unknown[] } | null;
  const v = j?.data?.viewer;
  if (!v) throw new Error("Linear didn't take that key.");
  return v.name || v.email || "Linear";
}

/**
  The engine's half of Settings › Source control & issues. Its scan is kept a minute, so opening the page twice doesn't
  ask every tool again; Look again asks anyway.
*/
export class SourceControl {
  ctx: ScmCtx;
  private last?: { at: number; tools: Promise<ScmTool[]> };
  constructor(ctx: ScmCtx) {
    this.ctx = ctx;
  }
  scan(force = false): Promise<ScmTool[]> {
    if (!force && this.last && Date.now() - this.last.at < 60_000) return this.last.tools;
    const tools = scanTools(this.ctx);
    this.last = { at: Date.now(), tools };
    tools.catch(() => (this.last = undefined));
    return tools;
  }
  /** Keeps a key in memory (the app put it in the keychain): Linear's is checked with Linear first. Answers with the tool as it now stands, never the key. */
  async setToken(id: ScmTokenId, token: string): Promise<ScmTool> {
    const t = token.trim();
    if (!t) throw new Error("Paste a key first.");
    if (/\s/.test(t) || t.length > 4096) throw new Error("That doesn't look like a key.");
    const account = id === "linear" ? await linearViewer(t, this.ctx.fetch) : undefined;
    this.ctx.keys.set(scmKey(id), t);
    this.last = undefined;
    return { id, found: true, signedIn: true, account: account ?? keyEnd(t), ...(id === "bitbucket" ? { how: later("Bitbucket") } : {}) };
  }
  clearToken(id: ScmTokenId) {
    this.ctx.keys.delete(scmKey(id));
    this.last = undefined;
  }
}

/* ---------- What the settings change elsewhere ---------- */

/** The merge method a Merge uses: the one picked, else the setting's. */
export function mergeMethodFor(s: Partial<Settings>, picked?: MergeMethod): MergeMethod {
  if (picked === "squash" || picked === "merge" || picked === "rebase") return picked;
  return scmSettings(s).mergeMethod;
}

/** What a drafted commit message is told about its style. The repository's own (the default) adds nothing, as before. */
export function commitStyleNote(s: Partial<Settings>): string {
  const c = scmSettings(s);
  if (c.commitStyle === "conventional") return "\n\nWrite it as a Conventional Commit: a subject of the form type(scope): summary, with type one of feat, fix, docs, style, refactor, perf, test, build, ci or chore; the scope only if it helps.";
  if (c.commitStyle === "custom" && c.commitInstructions?.trim()) return `\n\nHow this person wants commit messages written:\n${c.commitInstructions.trim().slice(0, 2000)}`;
  return "";
}

/** Where GitHub, GitLab and others look for a pull request template, in the order GitHub reads them. */
const TEMPLATE_PLACES = [".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md", "pull_request_template.md", "PULL_REQUEST_TEMPLATE.md", "docs/pull_request_template.md", "docs/PULL_REQUEST_TEMPLATE.md", ".gitlab/merge_request_templates/Default.md"];

/** The repository's pull request template, or undefined: one file of those places, else the first in .github/PULL_REQUEST_TEMPLATE/. */
export function prTemplate(root: string): string | undefined {
  const read = (p: string) => {
    try {
      const t = readFileSync(p, "utf8").trim();
      return t ? t.slice(0, 8000) : undefined;
    } catch {
      return undefined;
    }
  };
  for (const p of TEMPLATE_PLACES) {
    const t = read(join(root, p));
    if (t) return t;
  }
  const dir = join(root, ".github", "PULL_REQUEST_TEMPLATE");
  if (!existsSync(dir)) return undefined;
  try {
    const first = readdirSync(dir).filter((f) => /\.md$/i.test(f)).sort()[0];
    return first ? read(join(dir, first)) : undefined;
  } catch {
    return undefined;
  }
}

/** What a drafted pull request body is told about the repository's template, when the setting follows them and there is one. */
export function prTemplateNote(s: Partial<Settings>, root: string): string {
  if (!scmSettings(s).followPrTemplates) return "";
  const t = prTemplate(root);
  return t ? `\n\nThe repository has a pull request template. Write the description in its shape, filling its sections and keeping its headings and checkboxes; leave out a section only when it doesn't apply:\n<template>\n${t}\n</template>` : "";
}

/** Checks the Source control keys of a settings.save before anything is kept; commitInstructions is cut to a sane length. */
export function checkScmPatch(patch: Partial<Settings>) {
  if (patch.mergeMethod !== undefined && !["squash", "merge", "rebase"].includes(patch.mergeMethod)) throw new Error('The merge method is "squash", "merge" or "rebase".');
  if (patch.commitStyle !== undefined && !["repo", "conventional", "custom"].includes(patch.commitStyle)) throw new Error('Commit messages are written "repo", "conventional" or "custom".');
  if (patch.commitInstructions !== undefined) {
    if (typeof patch.commitInstructions !== "string") throw new Error("Commit instructions are words.");
    patch.commitInstructions = patch.commitInstructions.slice(0, 2000) || undefined;
  }
  if (patch.worklistRefresh !== undefined && (!Number.isInteger(patch.worklistRefresh) || patch.worklistRefresh < 0 || patch.worklistRefresh > 3600)) throw new Error("The refresh is a whole number of seconds from 0 to 3600.");
  for (const k of ["followPrTemplates", "scanNewPrs"] as const) if (patch[k] !== undefined && typeof patch[k] !== "boolean") throw new Error(`${k} is on or off.`);
  const flags = (v: unknown, keys: string[], what: string) => {
    if (v === undefined) return;
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.entries(v).some(([k, x]) => !keys.includes(k) || typeof x !== "boolean")) throw new Error(`${what} are switches by name.`);
  };
  flags(patch.hosts, ["github", "gitlab", "bitbucket", "azure", "forgejo", "origin"], "Hosts");
  flags(patch.trackers, ["github", "linear"], "Trackers");
}
