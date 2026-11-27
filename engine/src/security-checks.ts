/*
  Liner Security's free checks: run on this Mac with no agent and no model, when a scan starts and when you ask.
  Secrets in tracked files (well-known patterns over `git ls-files`, size-capped), packages with known problems
  (`npm audit --json` where there is a package-lock.json, run on a copy of the lockfile alone with an environment of
  nothing, so the repository's .npmrc can't send anything anywhere: npmAudit; skipped quietly where there isn't), and
  files that should not be in git (.env, private keys and the like, tracked). Each problem becomes a finding with source "checks", through
  Security.add (deduplicated, never raising what you dismissed), and the run is kept as the project's last
  (Security.setChecks). A problem a check raised before and doesn't find now is closed as fixed, with a line saying so.

  A secret is never kept or shown: a finding names the file, the line, the kind of secret and a masked preview (its first
  four characters, then dots), and its code excerpt has the secret masked the same way. The patterns are few and precise
  (the shapes gitleaks and GitHub's secret scanning know best), with obvious placeholders left out, so a finding here is
  worth reading. Everything works offline but npm audit, which asks the registry and fails soft.
*/
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, isAbsolute, join, relative, resolve } from "node:path";
import type { FreeCheckId, FreeCheckResult, FreeCheckRun, FindingExplain, NewFinding, SecurityFinding, SecurityFindingAdded, Severity, CodeExcerpt } from "../../contracts/src/index.ts";
import { normalKey } from "../../contracts/src/index.ts";
import { outside, pathOf, run, which } from "./exec.ts";
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
  A line with every secret on it masked, for anything shown or stored (a code excerpt, a scan's words, a report's message):
  a value of the free checks' table becomes its first four characters and dots, and a private key's marker hides
  everything after it on the line (a key written on one line, as in a service account's JSON). Masked here only, never
  raised as a finding: a JWT, looser token shapes, an AWS secret key, a password in an address, a bearer credential, and a
  setting whose name says secret (`API_KEY=…`, `password: …`, `DB_PASSWORD = "…"`, quoted or bare, six characters or
  more), which keeps fewer of its first characters the shorter it is.
*/
export function maskLine(line: string): string {
  // A line of a key's body on its own (an excerpt that starts inside a PEM block): nothing of it is shown.
  if (KEY_BODY.test(line)) return "••••••••";
  const spans: { start: number; end: number; shown: string }[] = spansIn(line).map((sp) => ({ start: sp.start, end: sp.end, shown: sp.p.shown ? `${sp.p.shown}••••••••` : masked(sp.v) }));
  const free = (start: number, end: number) => !spans.some((o) => start < o.end && o.start < end);
  const take = (start: number, end: number, v: string) => {
    if (end > start && !v.includes("•") && free(start, end)) spans.push({ start, end, shown: hidden(v) });
  };
  for (const { re, group, prose } of MASK_ONLY) {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) {
      const at = group ? (m as RegExpMatchArray & { indices: [number, number][] }).indices[group] : [m.index!, m.index! + m[0].length];
      if (prose && (NOT_A_CREDENTIAL.test(m[group ?? 0]) || isPlaceholder(m[group ?? 0]))) continue;
      if (at) take(at[0], at[1], m[group ?? 0]);
    }
  }
  ASSIGN.lastIndex = 0;
  for (const m of line.matchAll(ASSIGN)) {
    const name = m[1].split(".").pop()!;
    const quoted = m[5] !== undefined;
    const v = quoted ? m[5] : m[6];
    if (v === undefined || !secretName(name)) continue;
    // A line that is only this setting (.env, YAML, ini, a shell export): its bare value is a value, whatever it looks like.
    const whole = /^\s*(?:export\s+|set\s+|-\s+)?["']?$/.test(line.slice(0, m.index)) && /^\s*(?:#.*)?$/.test(line.slice(m.index! + m[0].length));
    if (!secretValue(v, quoted, whole)) continue;
    const at = (m as RegExpMatchArray & { indices: [number, number][] }).indices[quoted ? 5 : 6];
    take(at[0], at[1], v);
  }
  let out = line;
  for (const sp of spans.sort((a, b) => b.start - a.start)) out = out.slice(0, sp.start) + sp.shown + out.slice(sp.end);
  return out;
}

/** What a masked value keeps: its first four characters when it is long, two when it is middling, none when it is short. */
const hidden = (v: string) => `${v.slice(0, v.length >= 16 ? 4 : v.length >= 10 ? 2 : 0)}••••••••`;
/** A line that is nothing but a stretch of base64 (a private key's body, a certificate's): masked whole. */
const KEY_BODY = /^\s*["']?(?=[A-Za-z0-9+/]*[0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?:\\n)?["']?,?\s*$/;
/** Words with digits that follow "password" or "token" in prose and name a kind of thing, not a value: sha256, utf8, oauth2… */
const NOT_A_CREDENTIAL = /^(?:sha-?\d+|md5|utf-?\d+|base\d+|ipv[46]|http\d|oauth\d|x509|aes-?\d+|rsa-?\d+|hmac\w*|pbkdf\d|argon\w*|ed25519|p256|v\d+(?:\.\d+)*)$/i;
/**
  Shapes masked wherever they are, beyond the free checks' table: a JWT, the token prefixes of GitHub, GitLab, Slack, Stripe,
  OpenAI, Anthropic, npm and Google in their looser forms, a bearer, basic or token credential (any case, then with letters
  and digits both), a password in an address, a Slack or Discord webhook's secret part, an AWS secret access key (40
  characters after a key named aws… or secret…), and a password or token named in prose ("the password hunter2 for admin")
  only when it reads as one: letters and digits together, not a word of the trade like sha256 (`prose`).
*/
const MASK_ONLY: { re: RegExp; group?: number; prose?: boolean }[] = [
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,})/g },
  { re: /\b(?:xox[a-z]|xapp)-[A-Za-z0-9-]{10,}/g },
  { re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|\bwhsec_[A-Za-z0-9]{20,}/g },
  { re: /\bsk-(?:ant-|proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { re: /\b(?:Bearer|Basic|Token)\s+([A-Za-z0-9._~+/-]{12,}=*)/dg, group: 1 },
  { re: /\b(?:bearer|basic|token)\s+((?=[A-Za-z._~+/-]*\d)(?=[\d._~+/-]*[A-Za-z])[A-Za-z0-9._~+/-]{12,}=*)/dgi, group: 1 },
  { re: /\bhttps?:\/\/(?:hooks\.slack\.com\/(?:services|workflows|triggers)\/|(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/)([A-Za-z0-9_/-]{8,})/dgi, group: 1 },
  { re: /\b(?:passw(?:or)?d|passphrase|pwd|secret|token|api[ _-]?key|credentials?)s?\s+(?:(?:is|was|of|set\s+to|reads)\s+)?["'`]?((?=[A-Za-z!@#$%^&*_+~/-]*\d)(?=[\d!@#$%^&*_+~/-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9!@#$%^&*_+~/-]{5,99})(?![\w(!@#$%^&*+~/-])/dgi, group: 1, prose: true },
  { re: /:\/\/[^\s:/@"'`]+:([^\s@/"'`]{3,})@/dg, group: 1 },
  { re: /(?:aws|secret)[\w.-]*["']?\s*(?:=>|:=|[:=])\s*["'`]?([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+=])/dgi, group: 1 },
];
/**
  A setting on a line: a name (a variable, a key, a field, `user.password`), `=`, `:`, `=>` or `:=` (never `==`), and a
  value, quoted (escapes kept inside) or bare up to where code would go on or a string ends (a header written in one
  string, "x-api-key: …"). Whether it is a secret is the name's and the
  value's to say (secretName, secretValue).
*/
const ASSIGN = /(?<![\w$.-])([A-Za-z_$][\w$.-]{0,79})(["'\]]?)\s*(=>|:=|=(?![=>])|:(?![:=]))\s*(?:(["'`])((?:\\.|(?!\4)[^\\])*)\4|([^\s"'`,;(){}[\]<>]+)(?=\s*(?:$|[,;)}\]#"'`]|\/\/)))/dg;
/** Names that aren't secrets for all they say key or token: a public key, a sort key, a token count. */
const NOT_SECRET_NAME = /public[_-]?key|publishable|^(?:primary|foreign|sort|partition|cache|storage|query|hot|row|item|map|object|unique|lookup|list|group|idempotency|dedupe|route|i18n|translation|local[_-]?storage|session[_-]?storage)[_-]?key$|tokens$|tokeni[sz]e|token[_-]?(?:count|limit|type|url|uri|endpoint|expir\w*|ttl|length)$|(?:^|[_-])max[_-]?tokens/;
/** Whether a setting's name says its value is a secret: api_key, DB_PASSWORD, clientSecret, x-auth-token, db_pass, STRIPE_KEY… */
export function secretName(name: string): boolean {
  const n = name.toLowerCase();
  if (NOT_SECRET_NAME.test(n)) return false;
  return /api[_-]?key|apikey|secret|token|passw(?:or)?d|passwd|passphrase|credential|private[_-]?key|access[_-]?key|session[_-]?(?:id|key)|(?:^|[_-])(?:pass|pwd|pw)$|^_?auth$|[_-]auth$|authorization$|auth[_-]?(?:token|key|code|header)|[_-]key$/.test(n) || /[a-z0-9]Key$/.test(name);
}
/** Values a secret's name is often set to that are words of the code, not secrets: types, fetch's credentials, a field's type. */
const PLAIN_WORDS = new Set(["string", "number", "boolean", "bigint", "symbol", "object", "unknown", "never", "any", "null", "undefined", "true", "false", "none", "nil", "required", "optional", "include", "omit", "same-origin", "hidden", "password", "secret", "token", "bearer", "basic", "string[]", "text", "email"]);
/**
  Whether a setting's value is masked: six characters or more, not a stand-in, a read of the environment, a path, an
  address, a number or a word of the code. Quoted, or on a line of its own, that's all; a bare value in code is masked only
  when it doesn't read as code (letters and digits together, not a name or a chain of names), so `token = getToken()` and
  `password: req.body.password` stay readable.
*/
function secretValue(v: string, quoted: boolean, whole: boolean): boolean {
  if (v.length < 6 || v.length > 1000 || v.includes("•")) return false;
  if (isPlaceholder(v) || NOT_A_VALUE.test(v) || PLAIN_WORDS.has(v.toLowerCase()) || /^-?\d+(?:\.\d+)?$/.test(v)) return false;
  // A few plain words with spaces: a label or a message, not a password.
  if (quoted) return !/^[A-Za-z]+(?: [A-Za-z]+)+[.!?]?$/.test(v);
  if (whole) return true;
  return /[A-Za-z]/.test(v) && /\d/.test(v) && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(v);
}
/**
  Lines with every secret masked, a private key's body among them: from a BEGIN … PRIVATE KEY line to its END line, every
  line between shows only dots, though no line of it says what it is.
*/
export function maskLines(lines: string[]): string[] {
  let inKey = false;
  return lines.map((l) => {
    if (inKey) {
      if (/-----END [A-Z ]*PRIVATE KEY/.test(l)) {
        inKey = false;
        return maskLine(l);
      }
      return "••••••••";
    }
    if (/-----BEGIN [A-Z ]*PRIVATE KEY/.test(l) && !/-----END [A-Z ]*PRIVATE KEY/.test(l)) inKey = true;
    return maskLine(l);
  });
}
/** Text of any length (an explanation, a message) with every secret on every line masked, as maskLines does. */
export const maskText = (s: string) => (s.includes("\n") ? maskLines(s.split("\n")).join("\n") : maskLine(s));
/**
  A finding, new or stored, with every text it shows masked: its title, rule, address, explanation (every line of every
  excerpt, a key's body across lines), and its second look's words. Masking twice changes nothing, so a key made from what
  is stored is the key it was made with. An instance made of its title's words (a scan's `t:…`, a SARIF result's
  `t:…@line`) is made again of the masked title when masking changed it, as a report of it now makes it: a finding an
  earlier build stored raw keys as the same finding, and keeps none of the secret's words.
*/
export function maskFinding<T extends NewFinding | SecurityFinding>(f: T): T {
  const e = f.explain;
  const explain: FindingExplain | undefined = e && {
    ...e,
    lead: maskText(e.lead ?? ""),
    wrong: maskText(e.wrong ?? ""),
    ...(e.who !== undefined ? { who: maskText(e.who) } : {}),
    ...(e.gets !== undefined ? { gets: maskText(e.gets) } : {}),
    ...(Array.isArray(e.see) ? { see: e.see.map((x) => maskText(String(x))) } : {}),
    ...(Array.isArray(e.where) ? { where: e.where.map((w) => ({ ...w, lines: maskLines(Array.isArray(w.lines) ? w.lines.map(String) : []) })) } : {}),
  };
  const title = maskText(f.title);
  const at = typeof f.instance === "string" ? /^t:(.*?)(@\d+)?$/s.exec(f.instance) : null;
  const instance = at && title !== f.title && at[1] === normalKey(f.title) ? `t:${normalKey(title)}${at[2] ?? ""}` : f.instance;
  return {
    ...f,
    title,
    ...(instance !== f.instance ? { instance } : {}),
    ...(typeof f.rule === "string" ? { rule: maskLine(f.rule) } : {}),
    ...(typeof f.url === "string" ? { url: maskLine(f.url) } : {}),
    ...(explain ? { explain } : {}),
    ...(f.look && typeof f.look.words === "string" ? { look: { ...f.look, words: maskText(f.look.words) } } : {}),
  };
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

const WALK_SKIP = new Set([".git", "node_modules", "dist", "build", ".next", ".nuxt", ".svelte-kit", "vendor", ".venv", "venv", "__pycache__", "target", ".turbo", ".cache", "coverage"]);

/** Walks a non-git project folder safely (skipping vendor/build trees and symlinks) up to FILES_CAP files. */
function walkNonGit(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [""];
  while (stack.length && out.length < FILES_CAP) {
    const dir = stack.pop()!;
    const abs = dir ? join(root, dir) : root;
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= FILES_CAP) break;
      if (e.isSymbolicLink()) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!WALK_SKIP.has(e.name)) stack.push(rel);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  }
  return out;
}

/**
  The tracked files, relative to the project's folder, and whether it is a git repository: outside one, a safe
  ignore-walked list, which the secrets check reads but the files check doesn't, since nothing there is tracked in git.
*/
async function tracked(root: string, env: NodeJS.ProcessEnv): Promise<{ files: string[]; git: boolean }> {
  const r = await git(root, ["ls-files", "-z"], env);
  if (r.code === 0) return { files: r.stdout.split("\0").filter(Boolean), git: true };
  return { files: walkNonGit(root), git: false };
}

async function secretsCheck(root: string, files: string[], skip: Set<string>): Promise<CheckOut> {
  const at = Date.now();
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

function filesCheck(root: string, files: string[], inGit: boolean): CheckOut & { flagged: Set<string> } {
  const at = Date.now();
  const flagged = new Set<string>();
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
    if (inGit) found.push({ check: "files", finding: { title: b.title(f), severity: b.severity, source: "checks", file: f, rule: `file/${b.id}`, explain: { lead: `${f} is tracked in git, and a file like it should never be.`, wrong: `${b.wrong} Take it out of git (git rm --cached), add it to .gitignore, and change what it held: it stays in the history.`, who: "Anyone who can read the repository, or any copy of it.", see: [`Run git ls-files ${f} in the project's folder.`] } } });
    // Outside git nothing is tracked: the file is still worth knowing about, said as it is, with no git advice for a folder that has none.
    else found.push({ check: "files", finding: { title: b.title(f).replace(/ is tracked in git$/, " is in the project's folder"), severity: b.severity, source: "checks", file: f, rule: `file/${b.id}`, explain: { lead: `${f} is in the project's folder, which isn't a git repository.`, wrong: `${b.wrong.split(". ")[0].replace(/\.$/, "")}. If this folder is ever shared, zipped or put in git, add it to an ignore file first, and keep it out of copies.`, who: "Anyone who gets a copy of this folder.", see: [`Open ${f} in the project's folder.`] } } });
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
  if (has("package-lock.json") || has("npm-shrinkwrap.json")) {
    const r = await npmAudit(root, env);
    if (!r) return skipped("npm not installed");
    const vulns = parseAudit(r.stdout);
    if (!vulns) {
      const why = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network|offline/i.test(r.stdout + r.stderr) ? "couldn't reach the npm registry" : r.code !== 0 && !r.stdout.trim() && /timed out|killed|SIGTERM/i.test(r.stderr) ? "npm audit took too long" : "npm audit didn't answer";
      return { result: { check: "packages", state: "failed", count: 0, note: why, at }, found: [] };
    }
    const found = vulns.map((v) => ({ check: "packages" as const, finding: packageFinding(v) }));
    return { result: { check: "packages", state: found.length ? "found" : "clean", count: found.length, note: "from npm audit", at }, found };
  }
  const alt: { lock: string; bin: string; args: string[]; label: string } | undefined =
    has("pnpm-lock.yaml")
      ? { lock: "pnpm-lock.yaml", bin: "pnpm", args: ["audit", "--json"], label: "pnpm audit" }
      : has("yarn.lock")
        ? { lock: "yarn.lock", bin: "yarn", args: ["audit", "--json"], label: "yarn audit" }
        : has("bun.lock") || has("bun.lockb")
          ? { lock: has("bun.lock") ? "bun.lock" : "bun.lockb", bin: "bun", args: ["audit", "--json"], label: "bun audit" }
          : undefined;
  if (!alt) return skipped(has("package.json") ? "no lockfile" : "no package.json");
  const r = await altAudit(root, env, alt.bin, alt.args, alt.lock);
  if (!r) return skipped(`${alt.bin} not installed`);
  const vulns = parseAudit(r.stdout) ?? parseAltAudit(r.stdout);
  if (!vulns) {
    const why = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network|offline/i.test(r.stdout + r.stderr) ? `couldn't reach the registry (${alt.label})` : `${alt.label} didn't answer`;
    return { result: { check: "packages", state: "failed", count: 0, note: why, at }, found: [] };
  }
  const found = vulns.map((v) => ({ check: "packages" as const, finding: packageFinding(v) }));
  return { result: { check: "packages", state: found.length ? "found" : "clean", count: found.length, note: `from ${alt.label}`, at }, found };
}

/** Parses Yarn v1 NDJSON audit output into the same Vuln shape as parseAudit. */
function parseAltAudit(stdout: string): Vuln[] | null {
  const out = new Map<string, Vuln>();
  const sev = (s: unknown): Severity => NPM_SEVERITY[String(s ?? "").toLowerCase()] ?? "medium";
  let parsedAny = false;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const o = JSON.parse(trimmed) as { type?: string; data?: { advisory?: Record<string, unknown> } };
      parsedAny = true;
      if (o.type !== "auditAdvisory" || !o.data?.advisory) continue;
      const a = o.data.advisory;
      const name = String(a.module_name ?? a.name ?? "").trim();
      if (!name) continue;
      const title = String(a.title ?? `Vulnerability in ${name}`);
      const id = a.github_advisory_id ? String(a.github_advisory_id) : a.id ? String(a.id) : "";
      const cur = out.get(name) ?? { name, severity: sev(a.severity), titles: [], ids: [], url: typeof a.url === "string" ? a.url : undefined, fix: typeof a.patched_versions === "string" ? a.patched_versions : undefined, direct: true, via: [] };
      if (!cur.titles.includes(title)) cur.titles.push(title);
      if (id && !cur.ids.includes(id)) cur.ids.push(id);
      out.set(name, cur);
    } catch {
      // ignore non-json lines
    }
  }
  return parsedAny ? [...out.values()] : null;
}

/** Runs pnpm/yarn/bun audit in an isolated temp folder with only package.json + lockfile copied and a clean environment. */
async function altAudit(root: string, env: NodeJS.ProcessEnv, binName: string, args: string[], lockfile: string): Promise<{ code: number; stdout: string; stderr: string } | null> {
  const PATH = auditPath(env, root);
  const bin = which(binName, { PATH, ...(process.platform === "win32" && env.PATHEXT ? { PATHEXT: env.PATHEXT } : {}) });
  if (!bin || !isAbsolute(bin)) return null;
  const box = mkdtempSync(join(tmpdir(), "liner-audit-"));
  try {
    const dir = join(box, "project");
    const home = join(box, "home");
    for (const d of [dir, home]) mkdirSync(d);
    for (const f of ["package.json", lockfile]) {
      try {
        if (lstatSync(join(root, f)).isFile()) copyFileSync(join(root, f), join(dir, f));
      } catch {
        // not there
      }
    }
    try {
      lstatSync(join(dir, "package.json"));
    } catch {
      writeFileSync(join(dir, "package.json"), "{}\n");
    }
    const kept: NodeJS.ProcessEnv = {};
    for (const k of [...MANAGER_HOMES, ...(process.platform === "win32" ? WINDOWS_KEEP : [])]) if (env[k]) kept[k] = env[k];
    const clean: NodeJS.ProcessEnv = { ...kept, PATH, HOME: home, ...(process.platform === "win32" ? { USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TEMP: box, TMP: box } : { TMPDIR: box }) };
    return await run(bin, args, { cwd: dir, env: clean, timeout: AUDIT_MS });
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
}

/** Where npm audit asks: npm's own registry, always, whatever the repository's .npmrc says. Only tests point it at a fake one on this Mac. */
export const audit = { registry: "https://registry.npmjs.org/" };
/** Version managers' homes, passed on as they are: a shim on PATH (Volta, asdf, mise) finds its node through them, not through HOME. */
const MANAGER_HOMES = ["VOLTA_HOME", "ASDF_DIR", "ASDF_DATA_DIR", "MISE_DATA_DIR"];
/** What Windows needs of the environment for Node to start and reach the network at all. */
const WINDOWS_KEEP = ["SystemRoot", "SYSTEMROOT", "windir", "WINDIR", "ComSpec", "COMSPEC", "PATHEXT", "SystemDrive", "SYSTEMDRIVE"];

/**
  The engine's PATH (your login shell's) with what a folder could plant taken out: every relative entry (".",
  "node_modules/.bin"), and every entry inside the project. npm is looked up on this, and its node too.
*/
export function auditPath(env: NodeJS.ProcessEnv, root: string): string {
  const r = resolve(root);
  return pathOf(env)
    .split(delimiter)
    .map((d) => (process.platform === "win32" ? d.replace(/^"|"$/g, "") : d))
    .filter((d) => {
      if (!d || !isAbsolute(d)) return false;
      const rel = relative(r, resolve(d));
      return Boolean(rel) && outside(rel);
    })
    .join(delimiter);
}

/** The workspace folders a copied lockfile names (its packages outside node_modules), relative, each inside the folder; a few hundred at most. */
function workspacesOf(dir: string): string[] {
  let lock: { packages?: Record<string, unknown> };
  try {
    lock = JSON.parse(readFileSync(join(dir, existsIn(dir, "npm-shrinkwrap.json") ? "npm-shrinkwrap.json" : "package-lock.json"), "utf8"));
  } catch {
    return [];
  }
  const keys = lock && typeof lock.packages === "object" && lock.packages ? Object.keys(lock.packages) : [];
  return keys.filter((k) => k && !/(?:^|\/)node_modules\//.test(k) && !isAbsolute(k) && !k.split(/[\\/]/).includes("..") && /^[\w@.\/-]+$/.test(k)).slice(0, 500);
}
const existsIn = (dir: string, f: string) => {
  try {
    return lstatSync(join(dir, f)).isFile();
  } catch {
    return false;
  }
};

/**
  npm audit of a project's lockfile, kept from everything of the repository but the lockfile and package.json: those
  (and its workspaces' package.json) alone are copied into a folder of their own, and npm runs there with an environment of nothing (a clean PATH, an empty
  HOME, empty user and global configs, a cache of its own, no proxy, none of the engine's variables) against npm's own
  registry. So a repository's .npmrc, which npm reads from the folder it runs in and fills with ${VARIABLES} from the
  environment, never sends anything anywhere; nor can a node_modules/.bin/npm or a relative PATH entry run in its place.
  --package-lock-only: nothing installed, nothing run. Null when npm isn't on that PATH. The folder goes after.
*/
export async function npmAudit(root: string, env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string } | null> {
  const PATH = auditPath(env, root);
  const npm = which("npm", { PATH, ...(process.platform === "win32" && env.PATHEXT ? { PATHEXT: env.PATHEXT } : {}) });
  if (!npm || !isAbsolute(npm)) return null;
  const box = mkdtempSync(join(tmpdir(), "liner-audit-"));
  try {
    const dir = join(box, "project");
    const home = join(box, "home");
    const cache = join(box, "cache");
    // Two empty configs: npm won't load one file as both.
    const user = join(box, "user.npmrc");
    const global = join(box, "global.npmrc");
    for (const d of [dir, home, cache]) mkdirSync(d);
    for (const f of [user, global]) writeFileSync(f, "");
    for (const f of ["package.json", "package-lock.json", "npm-shrinkwrap.json"]) {
      try {
        if (lstatSync(join(root, f)).isFile()) copyFileSync(join(root, f), join(dir, f));
      } catch {
        // not there
      }
    }
    // A workspace's own package.json (the lockfile's packages that aren't under node_modules), so npm tells a package the
    // project names itself from one brought in, as it does in the folder. Only package.json files, only inside the project.
    for (const at of workspacesOf(dir)) {
      const from = join(root, at, "package.json");
      try {
        if (!lstatSync(from).isFile() || !insideReal(root, from)) continue;
        mkdirSync(join(dir, at), { recursive: true });
        copyFileSync(from, join(dir, at, "package.json"));
      } catch {
        // not there
      }
    }
    // npm looks up from where it runs for a package.json to call the project's root: one is there, so it never looks further.
    try {
      lstatSync(join(dir, "package.json"));
    } catch {
      writeFileSync(join(dir, "package.json"), "{}\n");
    }
    const kept: NodeJS.ProcessEnv = {};
    for (const k of [...MANAGER_HOMES, ...(process.platform === "win32" ? WINDOWS_KEEP : [])]) if (env[k]) kept[k] = env[k];
    const clean: NodeJS.ProcessEnv = {
      ...kept,
      PATH,
      HOME: home,
      ...(process.platform === "win32" ? { USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TEMP: box, TMP: box } : { TMPDIR: box }),
      npm_config_userconfig: user,
      npm_config_globalconfig: global,
      npm_config_cache: cache,
      npm_config_registry: audit.registry,
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
      npm_config_yes: "false",
    };
    return await run(npm, ["audit", "--json", "--package-lock-only", `--registry=${audit.registry}`], { cwd: dir, env: clean, timeout: AUDIT_MS });
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
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
  const { files, git: inGit } = await tracked(root, sec.env);
  const bad = filesCheck(root, files, inGit);
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
    // The check's findings in one write; counted on the scan once, after all three. What was met is known by the stored
    // finding's own key, which can differ from the one the check made (a record kept under an older key).
    for (const a of sec.addMany(projectId, list, BY) as SecurityFindingAdded[]) {
      seen.add(a.finding.key);
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
