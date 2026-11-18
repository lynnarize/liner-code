/*
  Liner Security's free checks: run on this Mac with no agent and no model, when a scan starts and when you ask.
  Secrets in tracked files (well-known patterns over `git ls-files`, size-capped), packages with known problems
  (`npm audit --json` where there is a package-lock.json; skipped quietly where there isn't), and files that should not
  be in git (.env, private keys and the like, tracked). Each problem becomes a finding with source "checks", through
  Security.add (deduplicated, never raising what you dismissed), and the run is kept as the project's last
  (Security.setChecks). A problem a check raised before and doesn't find now is closed as fixed, with a line saying so.

  A secret is never kept or shown: a finding names the file, the line, the kind of secret and a masked preview (its first
  four characters, then dots), and its code excerpt has the secret masked the same way. The patterns are few and precise
  (the shapes gitleaks and GitHub's secret scanning know best), with obvious placeholders left out, so a finding here is
  worth reading. Everything works offline but npm audit, which asks the registry and fails soft.
*/
import { lstatSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { FreeCheckId, FreeCheckResult, FreeCheckRun, FindingExplain, NewFinding, SecurityFinding, SecurityFindingAdded, Severity, CodeExcerpt } from "../../contracts/src/index.ts";
import { findingKey } from "../../contracts/src/index.ts";
import { outside, run, which } from "./exec.ts";
import { insideReal, type Security } from "./security.ts";

/** Who the free checks are, on a finding's activity. */
const BY = "free checks";
/** A tracked file bigger than this isn't read for secrets (generated, vendored or data). */
const FILE_CAP = 512 * 1024;
/** At most this many tracked files are read, and this many bytes in all: a huge repository is read in part, not for minutes. */
const FILES_CAP = 20_000;
const BYTES_CAP = 200 * 1024 * 1024;
/** npm audit asks the registry: this long at most. */
const AUDIT_MS = 60_000;

/** Git asked safely in a folder that may not be yours: no file monitor (a repository's own config can name a command), no signatures, paths as they are. */
export const SAFE_GIT = ["-c", "core.fsmonitor=false", "-c", "log.showSignature=false", "-c", "core.quotepath=off"];
const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv, timeout = 30_000) => run("git", [...SAFE_GIT, ...args], { cwd, env, timeout });

/* ---------- Secrets ---------- */

type SecretPattern = { id: string; name: string; severity: Severity; re: RegExp; /** The capture group holding the secret itself (0: the whole match). */ group?: number; /** A floor on the secret's Shannon entropy (bits a character), for the loose ones. */ entropy?: number; /** What a reader sees instead of the masked value. */ shown?: string };

/**
  The secrets looked for: a short table of shapes that are almost never anything else. The generic `api_key = "…"` one is
  the only loose one, held to quoted values of 12 characters or more with letters and digits and an entropy floor.
*/
export const SECRET_PATTERNS: SecretPattern[] = [
  { id: "private-key", name: "A private key", severity: "critical", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g, shown: "-----BEGIN PRIVATE KEY-----" },
  { id: "aws-access-key", name: "An AWS access key", severity: "critical", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "github-token", name: "A GitHub token", severity: "critical", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/g },
  { id: "stripe-live-key", name: "A Stripe live key", severity: "critical", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,247}\b/g },
  { id: "slack-token", name: "A Slack token", severity: "high", re: /\bxox[abposr]-[A-Za-z0-9-]{10,250}\b/g },
  { id: "slack-webhook", name: "A Slack webhook", severity: "high", re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{20,}/g },
  { id: "google-api-key", name: "A Google API key", severity: "high", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "anthropic-key", name: "An Anthropic API key", severity: "critical", re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,120}\b/g },
  { id: "generic-secret", name: "A secret", severity: "medium", re: /\b(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|access[_-]?key|private[_-]?key|secret|password|passwd)\b["']?\s*[:=]\s*["']([^"'\s]{12,200})["']/gi, group: 1, entropy: 3.2 },
];

/** Values that only stand in for a secret: "xxxx", "your-key-here", "<token>", "example", "${API_KEY}"… */
const PLACEHOLDER = /x{4,}|example|sample|placeholder|your[-_ ]?(?:api[-_ ]?)?(?:key|token|secret|password)|changeme|change[-_]me|dummy|redacted|replace[-_]?me|insert[-_]|fake|<[^>]*>|\.{3}|\*{4,}|^(.)\1+$|0{8,}|12345678|abcdefgh/i;
/** A value that is code, not a secret: an environment read, a template, a path or an address. */
const NOT_A_VALUE = /^[$%{]|process\.env|\$\{|\{\{|^https?:\/\/|^\/|^\.\.?\//;

/** Shannon entropy, bits a character. */
export function entropy(s: string): number {
  const c = new Map<string, number>();
  for (const ch of s) c.set(ch, (c.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of c.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}
/** What a finding shows of a secret: its first four characters, then dots. Never more. */
export const masked = (v: string) => `${v.slice(0, 4)}••••••••`;
/** Whether a matched value is an obvious stand-in, not a secret. */
export const isPlaceholder = (v: string) => PLACEHOLDER.test(v);

export type SecretHit = { pattern: SecretPattern; line: number; preview: string };

/** A secret on a line: its pattern, where it sits (a private key's runs to the line's end: what follows the marker is the key), and its value. */
type Span = { p: SecretPattern; start: number; end: number; v: string };
/** Patterns made once, with indices for the ones whose secret is a group. */
const FIND = SECRET_PATTERNS.map((p) => ({ p, re: new RegExp(p.re.source, p.re.flags.replace("g", "") + "g" + (p.group ? "d" : "")) }));

/**
  The secrets on one line. The table goes specific first, and a later pattern's match over a span already taken is left
  out: an AWS key in `api_key = "AKIA…"` is one AWS key, not also a generic secret.
*/
function spansIn(line: string): Span[] {
  const out: Span[] = [];
  for (const { p, re } of FIND) {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) {
      const v = m[p.group ?? 0];
      if (!v || isPlaceholder(v)) continue;
      if (p.entropy !== undefined && (NOT_A_VALUE.test(v) || !/[A-Za-z]/.test(v) || !/\d/.test(v) || entropy(v) < p.entropy)) continue;
      const at = p.group ? (m as RegExpMatchArray & { indices: [number, number][] }).indices[p.group] : [m.index!, m.index! + m[0].length];
      const span = { p, start: at[0], end: p.shown ? line.length : at[1], v };
      if (out.some((o) => span.start < o.end && o.start < span.end)) continue;
      out.push(span);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The secrets in a file's text, by line (1-based): each with its pattern and its masked preview, never the value. One of a kind a line. */
export function secretsIn(text: string): SecretHit[] {
  const out: SecretHit[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length > 20_000) continue;
    const kinds = new Set<string>();
    for (const sp of spansIn(l)) {
      if (kinds.has(sp.p.id)) continue;
      kinds.add(sp.p.id);
      out.push({ pattern: sp.p, line: i + 1, preview: sp.p.shown ?? masked(sp.v) });
    }
  }
  return out;
}
/**
  A line with every secret on it masked, for a code excerpt: a value becomes its first four characters and dots, and a
  private key's marker hides everything after it on the line (a key written on one line, as in a service account's JSON).
*/
export function maskLine(line: string): string {
  let out = line;
  for (const sp of spansIn(line).reverse()) out = out.slice(0, sp.start) + (sp.p.shown ? `${sp.p.shown}••••••••` : masked(sp.v)) + out.slice(sp.end);
  return out;
}
/** Every secret masked, then cut at `cap` characters: masked first, so a secret over the cut can't show any of itself. */
export const shownLine = (line: string, cap = 400) => {
  const m = maskLine(line);
  return m.length > cap ? `${m.slice(0, cap)}…` : m;
};

/** Files read for neither secrets nor anything else: lockfiles, minified bundles, pictures, fonts, archives, media. */
const LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock", "cargo.lock", "gemfile.lock", "composer.lock", "poetry.lock", "pipfile.lock", "go.sum", "uv.lock", "flake.lock", "podfile.lock", "packages.lock.json", "mix.lock", "pubspec.lock"]);
const SKIP_EXT = /\.(?:png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|psd|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|woff2?|ttf|otf|eot|mp[34]|mov|avi|webm|wav|ogg|flac|exe|dll|so|dylib|a|o|class|wasm|node|bin|dat|db|sqlite3?|svgz|map)$/i;
const skippedForSecrets = (path: string) => LOCKFILES.has(basename(path).toLowerCase()) || SKIP_EXT.test(path) || /\.min\.(?:js|css|mjs)$/i.test(path) || /(?:^|\/)(?:node_modules|vendor|dist|build)\//.test(path);

/* ---------- Files that should not be in git ---------- */

type BadFile = { id: string; severity: Severity; title: (f: string) => string; wrong: string; /** Only when its text says so (a .pem holding a private key, an .npmrc holding a token). */ holds?: RegExp };
/** What a tracked file's name (and sometimes its text) says it should not be in git. The first that fits wins. */
function badFile(path: string): BadFile | null {
  const name = basename(path);
  const low = name.toLowerCase();
  if (/^\.env(?:\..+)?$/i.test(name) && !/\.(?:example|sample|template|dist|defaults?|schema|test|ci)$/i.test(name)) return { id: "env", severity: "high", title: (f) => `The environment file ${f} is tracked in git`, wrong: "Environment files usually hold passwords and keys for this project's services. Tracked, they go wherever the repository goes: every clone, every fork, every copy on a laptop." };
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?$/.test(low)) return { id: "ssh-key", severity: "critical", title: (f) => `The SSH private key ${f} is tracked in git`, wrong: "An SSH private key lets whoever holds it sign in wherever its public half is trusted." };
  if (/\.(?:pem|key)$/.test(low)) return { id: "private-key-file", severity: "critical", title: (f) => `The private key ${f} is tracked in git`, wrong: "A private key in the repository is no longer private: anyone with a copy can use it.", holds: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY/ };
  if (/\.(?:p12|pfx|keystore|jks)$/.test(low)) return { id: "keystore", severity: "high", title: (f) => `The key store ${f} is tracked in git`, wrong: "A key store holds private keys and certificates; its password is often weak or written nearby." };
  if (low === ".npmrc" || low === ".yarnrc.yml") return { id: "npm-token", severity: "high", title: (f) => `${f} holds a registry token and is tracked in git`, wrong: "A registry token lets whoever has it publish packages as you.", holds: /(?:_authToken|_auth|_password|npmAuthToken)\s*[=:]\s*["']?(?!\$\{)[^\s"']{8,}/ };
  if (low === ".pypirc") return { id: "pypi-password", severity: "high", title: (f) => `${f} holds a PyPI password and is tracked in git`, wrong: "A PyPI password or token lets whoever has it publish packages as you.", holds: /^\s*password\s*[=:]\s*\S{6,}/m };
  if (low === ".netrc" || low === "_netrc" || low === ".git-credentials") return { id: "credentials", severity: "critical", title: (f) => `The credentials file ${f} is tracked in git`, wrong: "This file holds sign-ins for other machines and services, in plain text." };
  if (/(?:^|\/)\.aws\/credentials$/.test(path)) return { id: "aws-credentials", severity: "critical", title: (f) => `The AWS credentials file ${f} is tracked in git`, wrong: "This file holds AWS access keys in plain text." };
  if (/\.tfstate(?:\.backup)?$/.test(low)) return { id: "tfstate", severity: "high", title: (f) => `The Terraform state ${f} is tracked in git`, wrong: "Terraform state keeps every resource's attributes, passwords and keys among them, in plain text." };
  if (low === ".htpasswd") return { id: "htpasswd", severity: "medium", title: (f) => `The password file ${f} is tracked in git`, wrong: "This file holds password hashes, which can be cracked offline once copied." };
  return null;
}

/* ---------- Packages ---------- */

const NPM_SEVERITY: Record<string, Severity> = { critical: "critical", high: "high", moderate: "medium", medium: "medium", low: "low", info: "low" };
type Vuln = { name: string; severity: Severity; titles: string[]; ids: string[]; url?: string; range?: string; fix?: string; direct?: boolean; via: string[] };

/**
  The vulnerable packages in npm audit's JSON, one each: npm 7 and later (`vulnerabilities`, keyed by package, `via` holding
  advisories or the names of the packages that bring the problem in) and npm 6 (`advisories`, keyed by advisory id). Null
  for output that is neither (an error, or not JSON).
*/
export function parseAudit(text: string): Vuln[] | null {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    // npm can print a warning line before the JSON.
    const at = text.indexOf("{");
    if (at < 0) return null;
    try {
      j = JSON.parse(text.slice(at));
    } catch {
      return null;
    }
  }
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const out = new Map<string, Vuln>();
  const sev = (s: unknown): Severity => NPM_SEVERITY[String(s ?? "").toLowerCase()] ?? "medium";
  const worse = (a: Severity, b: Severity) => (["critical", "high", "medium", "low"].indexOf(a) <= ["critical", "high", "medium", "low"].indexOf(b) ? a : b);
  if (o.vulnerabilities && typeof o.vulnerabilities === "object") {
    for (const [key, raw] of Object.entries(o.vulnerabilities as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object") continue;
      const v = raw as Record<string, unknown>;
      const name = typeof v.name === "string" ? v.name : key;
      const via = Array.isArray(v.via) ? v.via : [];
      const advisories = via.filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object");
      const titles = advisories.map((a) => String(a.title ?? "")).filter(Boolean);
      const ids = advisories.map((a) => /GHSA-[\w-]+/i.exec(String(a.url ?? ""))?.[0] ?? (a.source !== undefined ? `npm-${a.source}` : "")).filter(Boolean);
      const fix = v.fixAvailable === true ? "a fix is available" : v.fixAvailable && typeof v.fixAvailable === "object" ? `fixed by ${(v.fixAvailable as { name?: string }).name ?? "an update"}@${(v.fixAvailable as { version?: string }).version ?? "a later version"}` : undefined;
      out.set(name, { name, severity: sev(v.severity), titles, ids, url: advisories.map((a) => (typeof a.url === "string" ? a.url : "")).find(Boolean), range: typeof v.range === "string" ? v.range : undefined, fix, direct: v.isDirect === true, via: via.filter((a): a is string => typeof a === "string") });
    }
    return [...out.values()];
  }
  if (o.advisories && typeof o.advisories === "object") {
    for (const raw of Object.values(o.advisories as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object") continue;
      const a = raw as Record<string, unknown>;
      const name = typeof a.module_name === "string" ? a.module_name : "";
      if (!name) continue;
      const id = /GHSA-[\w-]+/i.exec(String(a.url ?? a.github_advisory_id ?? ""))?.[0] ?? (a.id !== undefined ? `npm-${a.id}` : "");
      const had = out.get(name);
      const title = String(a.title ?? "");
      out.set(name, had ? { ...had, severity: worse(had.severity, sev(a.severity)), titles: [...had.titles, title].filter(Boolean), ids: [...had.ids, id].filter(Boolean) } : { name, severity: sev(a.severity), titles: title ? [title] : [], ids: id ? [id] : [], url: typeof a.url === "string" ? a.url : undefined, range: typeof a.vulnerable_versions === "string" ? a.vulnerable_versions : undefined, fix: typeof a.patched_versions === "string" ? `patched in ${a.patched_versions}` : undefined, via: [] });
    }
    return [...out.values()];
  }
  // npm audit with nothing to report on, in some versions: only metadata.
  if (o.metadata && typeof o.metadata === "object" && !("error" in o)) return [];
  return null;
}

/** A package's finding: "package.json" is its file, so GitHub's Dependabot alert for the same package is the same finding. */
export function packageFinding(v: Vuln, dir = ""): NewFinding {
  const n = v.titles.length;
  const what = n ? `${v.titles[0]}${n > 1 ? `, and ${n - 1} more` : ""}` : "a known problem";
  const explain: FindingExplain = {
    lead: `The package ${v.name}${v.range ? ` (${v.range})` : ""} has ${n > 1 ? `${n} known problems` : "a known problem"}: ${n ? v.titles[0] : "see the advisory"}.`,
    wrong: `npm audit reports ${v.name} as ${v.severity === "medium" ? "moderate" : v.severity}${v.direct ? ", a package this project names itself" : v.via.length ? `, brought in by ${v.via.slice(0, 3).join(", ")}` : ""}. ${v.fix ? `npm says ${v.fix}.` : "npm knows no fix yet."}${v.ids.length ? ` Advisories: ${[...new Set(v.ids)].join(", ")}.` : ""}`,
    see: ["Run npm audit in the project's folder.", ...(v.url ? [`Read the advisory at ${v.url}.`] : [])],
  };
  return { title: `The package ${v.name} has ${what}`.slice(0, 300), severity: v.severity, source: "checks", file: `${dir}package.json`, rule: `npm/${v.name}`, explain, ...(v.url ? { url: v.url } : {}) };
}

/* ---------- Code excerpts ---------- */

/**
  Lines of a file inside the project for a finding's Code tab: from `around` lines before `start` to as many after `end`, the
  finding's own lines marked. Every secret on them is masked. Null when the file isn't there, isn't inside the folder, or is
  too big. A secret's excerpt is its line alone (`around` 0): the lines beside a private key's first are the key.
*/
export function excerptOf(root: string, file: string, start: number, end = start, around = 2): CodeExcerpt | null {
  try {
    const abs = resolve(root, file);
    const rel = relative(resolve(root), abs);
    if (!rel || outside(rel)) return null;
    // Inside by real path too: a symlinked folder on the way (link -> /etc) reads nothing outside.
    if (!insideReal(root, abs)) return null;
    const st = statSync(abs);
    if (!st.isFile() || st.size > FILE_CAP) return null;
    const all = readFileSync(abs, "utf8").split(/\r?\n/);
    if (start < 1 || start > all.length) return null;
    const last = Math.min(Math.max(end, start), all.length, start + 40);
    const from = Math.max(1, start - around);
    const to = Math.min(all.length, last + around);
    // The lines of a private key written over many lines are hidden: from its marker to its end.
    let inKey = false;
    const hidden = new Set<number>();
    for (let i = 0; i < to; i++) {
      const l = all[i];
      if (inKey) {
        if (/-----END [A-Z ]*PRIVATE KEY/.test(l)) inKey = false;
        else hidden.add(i);
      } else if (/-----BEGIN [A-Z ]*PRIVATE KEY/.test(l) && !/-----END [A-Z ]*PRIVATE KEY/.test(l)) inKey = true;
    }
    const lines = all.slice(from - 1, to).map((l, i) => (hidden.has(from - 1 + i) ? "••••••••" : shownLine(l)));
    return { file: rel.split("\\").join("/"), start: from, lines, hit: Array.from({ length: last - start + 1 }, (_, i) => start + i) };
  } catch {
    return null;
  }
}

/* ---------- The run ---------- */

type Found = { check: FreeCheckId; finding: NewFinding };
type CheckOut = { result: FreeCheckResult; found: Found[]; /** For secrets: the files read in full, so a finding in one of them that isn't found again is closed. Unset: every finding of the check may be closed. */ read?: Set<string>; tracked?: Set<string> };

/** The tracked files, relative to the project's folder; null outside a repository. */
async function tracked(root: string, env: NodeJS.ProcessEnv): Promise<string[] | null> {
  const r = await git(root, ["ls-files", "-z"], env);
  if (r.code !== 0) return null;
  return r.stdout.split("\0").filter(Boolean);
}

async function secretsCheck(root: string, files: string[] | null, skip: Set<string>): Promise<CheckOut> {
  const at = Date.now();
  if (!files) return { result: { check: "secrets", state: "skipped", count: 0, note: "not a git repository", at }, found: [] };
  const found: Found[] = [];
  const read = new Set<string>();
  let bytes = 0;
  let cut = false;
  let slice = Date.now();
  for (const f of files) {
    if (skip.has(f) || skippedForSecrets(f)) continue;
    // Never more than a few milliseconds at a time: the engine streams every session on this same thread.
    if (Date.now() - slice > 8) {
      await new Promise((r) => setImmediate(r));
      slice = Date.now();
    }
    if (read.size >= FILES_CAP || bytes >= BYTES_CAP) {
      cut = true;
      break;
    }
    let buf: Buffer;
    try {
      const abs = join(root, f);
      const st = lstatSync(abs);
      if (!st.isFile() || st.size > FILE_CAP || st.size === 0) continue;
      buf = readFileSync(abs);
    } catch {
      continue;
    }
    bytes += buf.length;
    // Binary: a NUL early on.
    if (buf.subarray(0, 8000).includes(0)) continue;
    const text = buf.toString("utf8");
    // Minified or generated: very long lines on average.
    const nl = text.split("\n").length;
    if (text.length / nl > 1000) continue;
    read.add(f);
    const byKind = new Map<string, SecretHit[]>();
    for (const h of secretsIn(text)) byKind.set(h.pattern.id, [...(byKind.get(h.pattern.id) ?? []), h]);
    for (const hits of byKind.values()) {
      const h = hits[0];
      const p = h.pattern;
      const more = hits.length - 1;
      const ex = excerptOf(root, f, h.line, h.line, 0);
      found.push({
        check: "secrets",
        finding: {
          title: `${p.name} is written in ${f}`,
          severity: p.severity,
          source: "checks",
          file: f,
          line: h.line,
          rule: `secret/${p.id}`,
          explain: {
            lead: `${p.name} (${h.preview}) is in a tracked file, so everyone with a copy of the repository has it.`,
            wrong: `Line ${h.line} of ${f} holds ${p.name.replace(/^An? /, (a) => a.toLowerCase())}${more ? `, and ${more} more line${more > 1 ? "s" : ""} of the file hold${more > 1 ? "" : "s"} another` : ""}. Once in git it stays in the history, even after the line is gone: turn the secret off where it was issued, make a new one, and read it from the environment instead.`,
            ...(ex ? { where: [ex] } : {}),
            who: "Anyone who can read the repository, or any copy of it.",
            gets: "Whatever the secret opens, as whoever it belongs to.",
            see: [`Open ${f} at line ${h.line}.`],
          },
        },
      });
    }
  }
  return { result: { check: "secrets", state: found.length ? "found" : "clean", count: found.length, ...(cut ? { note: `read the first ${read.size} files` } : {}), at }, found, read, tracked: new Set(files) };
}

function filesCheck(root: string, files: string[] | null): CheckOut & { flagged: Set<string> } {
  const at = Date.now();
  const flagged = new Set<string>();
  if (!files) return { result: { check: "files", state: "skipped", count: 0, note: "not a git repository", at }, found: [], flagged };
  const found: Found[] = [];
  for (const f of files) {
    const b = badFile(f);
    if (!b) continue;
    if (b.holds) {
      try {
        const abs = join(root, f);
        const st = lstatSync(abs);
        if (!st.isFile() || st.size > FILE_CAP || !b.holds.test(readFileSync(abs, "utf8"))) continue;
      } catch {
        continue;
      }
    }
    flagged.add(f);
    found.push({ check: "files", finding: { title: b.title(f), severity: b.severity, source: "checks", file: f, rule: `file/${b.id}`, explain: { lead: `${f} is tracked in git, and a file like it should never be.`, wrong: `${b.wrong} Take it out of git (git rm --cached), add it to .gitignore, and change what it held: it stays in the history.`, who: "Anyone who can read the repository, or any copy of it.", see: [`Run git ls-files ${f} in the project's folder.`] } } });
  }
  return { result: { check: "files", state: found.length ? "found" : "clean", count: found.length, at }, found, flagged };
}

async function packagesCheck(root: string, env: NodeJS.ProcessEnv): Promise<CheckOut> {
  const at = Date.now();
  const has = (f: string) => {
    try {
      return lstatSync(join(root, f)).isFile();
    } catch {
      return false;
    }
  };
  const skipped = (note: string): CheckOut => ({ result: { check: "packages", state: "skipped", count: 0, note, at }, found: [] });
  if (!has("package-lock.json") && !has("npm-shrinkwrap.json")) {
    const other = ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"].find(has);
    return skipped(other ? `${other} not read yet` : has("package.json") ? "no package-lock.json" : "no package.json");
  }
  if (!which("npm", env)) return skipped("npm not installed");
  // --package-lock-only: the lockfile alone, nothing installed, nothing run.
  const r = await run("npm", ["audit", "--json", "--package-lock-only"], { cwd: root, env: { ...env, npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_yes: "false" }, timeout: AUDIT_MS });
  const vulns = parseAudit(r.stdout);
  if (!vulns) {
    const why = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network|offline/i.test(r.stdout + r.stderr) ? "couldn't reach the npm registry" : r.code !== 0 && !r.stdout.trim() && /timed out|killed|SIGTERM/i.test(r.stderr) ? "npm audit took too long" : "npm audit didn't answer";
    return { result: { check: "packages", state: "failed", count: 0, note: why, at }, found: [] };
  }
  const found = vulns.map((v) => ({ check: "packages" as const, finding: packageFinding(v) }));
  return { result: { check: "packages", state: found.length ? "found" : "clean", count: found.length, note: "from npm audit", at }, found };
}

const RULE_OF: Record<FreeCheckId, RegExp> = { secrets: /^secret\//, files: /^file\//, packages: /^npm\// };

/** A run at a time for each project: asking again while one runs gets that one. */
const running = new WeakMap<Security, Map<string, Promise<FreeCheckRun>>>();

/** Runs the three free checks on a project now; `scan`: the scan record they run for, when a scan started them (each finding counts on it). */
export function runChecks(sec: Security, projectId: string, scan?: string): Promise<FreeCheckRun> {
  let p: ReturnType<Security["project"]>;
  try {
    p = sec.project(projectId);
  } catch (e) {
    return Promise.reject(e);
  }
  const mine = running.get(sec) ?? new Map<string, Promise<FreeCheckRun>>();
  running.set(sec, mine);
  const had = mine.get(p.id);
  if (had) return had;
  const go = checkNow(sec, p.id, resolve(p.path), scan).finally(() => mine.delete(p.id));
  mine.set(p.id, go);
  return go;
}

async function checkNow(sec: Security, projectId: string, root: string, scan?: string): Promise<FreeCheckRun> {
  const at = Date.now();
  const files = await tracked(root, sec.env);
  const bad = filesCheck(root, files);
  const [secrets, packages] = await Promise.all([secretsCheck(root, files, bad.flagged), packagesCheck(root, sec.env)]);
  const outs: Record<FreeCheckId, CheckOut> = { secrets, packages, files: bad };
  let added = 0;
  const seen = new Set<string>();
  const results: FreeCheckResult[] = [];
  const onScan: SecurityFindingAdded[] = [];
  for (const id of ["secrets", "packages", "files"] as FreeCheckId[]) {
    const o = outs[id];
    let count = 0;
    const list = o.found.map(({ finding }): NewFinding => (scan ? { ...finding, scan } : finding));
    for (const n of list) seen.add(findingKey(projectId, n));
    // The check's findings in one write; counted on the scan once, after all three.
    for (const a of sec.addMany(projectId, list, BY) as SecurityFindingAdded[]) {
      if (a.outcome === "new" || a.outcome === "reopened") added++;
      // What you dismissed before isn't counted as found.
      if (a.outcome !== "dismissed-before") count++;
      onScan.push(a);
    }
    results.push(o.result.state === "found" ? { ...o.result, count, state: count ? "found" : "clean" } : o.result);
  }
  if (scan) {
    try {
      sec.countMany(scan, onScan);
    } catch {
      // the scan's record went: the findings stay
    }
  }
  // What a check raised before and finds no more is fixed; only where the check ran in full, and a secret only where its file was read again (or isn't tracked any more).
  const closing = (f: SecurityFinding) => {
    if (f.state !== "open" || seen.has(f.key) || f.sources.some((s) => s !== "checks") || !f.rule) return false;
    const id = (Object.keys(RULE_OF) as FreeCheckId[]).find((k) => RULE_OF[k].test(f.rule!));
    if (!id) return false;
    const o = outs[id];
    if (o.result.state !== "clean" && o.result.state !== "found") return false;
    if (id === "secrets" && f.file && o.read && !o.read.has(f.file) && o.tracked?.has(f.file)) return false;
    return true;
  };
  const now = Date.now();
  sec.updateMany(projectId, (x) => (closing(x) ? { ...x, state: "fixed", activity: [...x.activity, { at: now, kind: "fixed", text: "Fixed: the free checks no longer find it", by: BY, ...(scan ? { scan } : {}) }] } : null));
  const done: FreeCheckRun = { projectId, results, added, at, ...(scan ? { scan } : {}) };
  sec.setChecks(done);
  sec.changed(["findings"], projectId);
  return done;
}
