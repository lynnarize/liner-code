/*
  Liner Security's Bring in: findings from elsewhere. GitHub's alerts (Dependabot and code scanning) through `gh api`,
  when gh is installed and signed in and the project's origin is on GitHub; and a SARIF 2.1.0 report you picked. Each
  alert or result becomes a finding with source "github" or "sarif", through Security.add (deduplicated, never raising
  what you dismissed).

  GitHub fails soft: anything in the way (gh not installed, not signed in, no GitHub remote, alerts not turned on, no
  access) comes back as BringInResult.note, in words the Bring in row can show as they are. A SARIF report that isn't one
  (not JSON, not SARIF 2, too big, unreadable) is an error with the reason, since you picked it and can pick another.

  Keys line up across sources: a Dependabot alert for an npm package is "package.json" + "npm/<name>", as npm audit's
  free check makes it, so the same package's problem shows once. A code-scanning alert and a SARIF result are their file
  + rule + the tool's fingerprint (fingerprintOf: CodeQL's primaryLocationLineHash first), which holds when the code above
  moves, so one you dismissed stays dismissed, and a CodeQL report brought in by hand and GitHub's alert for the same
  result are one finding. An alert whose instance carries no fingerprint goes by its alert number. A SARIF result with
  no fingerprint goes by its rule, its message and its start line together (normalKey), so two results of one rule in one
  file stay two findings; only such a result comes back as new when the lines above it move.
*/
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { BringInResult, FindingExplain, GitHubReach, NewFinding, SecurityFinding, Severity } from "../../contracts/src/index.ts";
import { findingKey, normalKey } from "../../contracts/src/index.ts";
import { run, which } from "./exec.ts";
import { excerptOf, SAFE_GIT } from "./security-checks.ts";
import type { Security } from "./security.ts";

/** A SARIF report bigger than this isn't read. */
const SARIF_CAP = 25 * 1024 * 1024;
/** At most this many results come in from one report (each is a write of the project's record). */
const RESULTS_CAP = 2000;
/** How long gh's answers about itself are trusted: security.side asks on every change. */
const REACH_MS = 60_000;

/* ---------- Adding a batch ---------- */

function addAll(sec: Security, projectId: string, list: NewFinding[], by: string): BringInResult & { keys: Set<string> } {
  const out = { added: 0, already: 0, leftOut: 0, keys: new Set<string>() };
  for (const n of list) out.keys.add(findingKey(projectId, n));
  // One write for the batch, however many results.
  for (const a of sec.addMany(projectId, list, by)) {
    if (a.outcome === "new" || a.outcome === "reopened") out.added++;
    else if (a.outcome === "already-open") out.already++;
    else out.leftOut++;
  }
  return out;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** The first sentence of a message, for a title. */
const sentence = (s: string) => clip((s.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "").replace(/[.:]$/, ""), 200);
/** A sentence ended with a full stop, unless it already ends with one, another mark, or the ellipsis a clip left. */
const ended = (s: string) => (!s || /[.!?…]$/.test(s) ? s : `${s}.`);

/* ---------- GitHub ---------- */

/** owner/repo of a GitHub remote address, or null: git@github.com:o/r.git, https://github.com/o/r, ssh://git@github.com/o/r. */
export function githubRepoOf(url: string): string | null {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|git@|git:\/\/)(?:www\.)?github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

type Reach = GitHubReach & { at: number };
type ReachCache = { gh?: Reach; asking?: Promise<Reach>; repos: Map<string, { repo: string | null; at: number }> };
const reachCache = new WeakMap<Security, ReachCache>();
const cacheOf = (sec: Security): ReachCache => {
  const c: ReachCache = reachCache.get(sec) ?? { repos: new Map() };
  reachCache.set(sec, c);
  return c;
};

/** gh on this Mac: installed, signed in. Asked once a minute at most, and once at a time. */
async function ghItself(sec: Security): Promise<Reach> {
  const c = cacheOf(sec);
  if (c.gh && Date.now() - c.gh.at < REACH_MS) return c.gh;
  if (c.asking) return c.asking;
  c.asking = (async (): Promise<Reach> => {
    if (!which("gh", sec.env)) return { installed: false, signedIn: false, at: Date.now() };
    const auth = await run("gh", ["auth", "status"], { env: sec.env, timeout: 15_000 });
    return { installed: true, signedIn: auth.code === 0, at: Date.now() };
  })()
    .catch((): Reach => ({ installed: false, signedIn: false, at: Date.now() }))
    .then((r) => ((c.gh = r), (c.asking = undefined), r));
  return c.asking;
}
async function repoOf(sec: Security, path: string): Promise<string | null> {
  const c = cacheOf(sec);
  const had = c.repos.get(path);
  if (had && Date.now() - had.at < REACH_MS) return had.repo;
  const r = await run("git", [...SAFE_GIT, "remote", "get-url", "origin"], { cwd: path, env: sec.env, timeout: 10_000 });
  const repo = r.code === 0 ? githubRepoOf(r.stdout) : null;
  c.repos.set(path, { repo, at: Date.now() });
  return repo;
}

/** Whether gh is there and signed in (and, with a project, its GitHub repository), for Bring in's row. Never throws. */
export async function githubReach(sec: Security, projectId?: string): Promise<GitHubReach> {
  try {
    const gh = await ghItself(sec);
    const out: GitHubReach = { installed: gh.installed, signedIn: gh.signedIn };
    if (projectId) {
      const repo = await repoOf(sec, resolve(sec.project(projectId).path));
      if (repo) out.repo = repo;
    }
    return out;
  } catch {
    return { installed: false, signedIn: false };
  }
}

/** Why gh api said no, in plain words; `what`: "Dependabot alerts", "Code scanning". */
export function ghWhy(stderr: string, what: string, repo: string): string {
  const s = stderr.toLowerCase();
  if (/disabled|not enabled|no analysis found|advanced security must be enabled|not available for this repository/.test(s)) return `${what} aren't turned on for ${repo}.`;
  if (/http 404|not found/.test(s)) return `GitHub didn't show ${what.toLowerCase()} for ${repo}: it isn't there, or this account can't see it.`;
  if (/http 403|forbidden|must have admin|resource not accessible/.test(s)) return `This GitHub account can't read ${what.toLowerCase()} for ${repo}.`;
  if (/http 401|authentication|auth login/.test(s)) return "The GitHub CLI isn't signed in. Run gh auth login.";
  if (/could not resolve|timeout|timed out|network|connection/.test(s)) return "GitHub couldn't be reached.";
  return `GitHub didn't give ${what.toLowerCase()} for ${repo}.`;
}

/** gh api's pages of a list, as one list (each item a line, through --jq). Null and why when it said no. */
async function ghList(sec: Security, cwd: string, path: string, what: string, repo: string): Promise<{ items: Record<string, unknown>[] } | { why: string }> {
  const r = await run("gh", ["api", "-X", "GET", path, "--paginate", "--jq", ".[]"], { cwd, env: sec.env, timeout: 60_000 });
  if (r.code !== 0) return { why: ghWhy(r.stderr || r.stdout, what, repo) };
  const items: Record<string, unknown>[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v === "object" && !Array.isArray(v)) items.push(v as Record<string, unknown>);
    } catch {
      // a line that isn't an alert
    }
  }
  return { items };
}

const GH_SEVERITY: Record<string, Severity> = { critical: "critical", high: "high", medium: "medium", moderate: "medium", low: "low", error: "high", warning: "medium", note: "low", none: "low" };
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : typeof v === "string" && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : undefined);

/** A Dependabot alert as a finding. An npm package's names package.json beside its manifest, as the free checks do. */
export function dependabotFinding(a: Record<string, unknown>): NewFinding | null {
  const dep = obj(a.dependency);
  const pkg = obj(dep.package);
  const name = text(pkg.name);
  if (!name) return null;
  const eco = text(pkg.ecosystem).toLowerCase() || "package";
  const adv = obj(a.security_advisory);
  const vuln = obj(a.security_vulnerability);
  const manifest = text(dep.manifest_path);
  const dir = manifest.includes("/") ? manifest.slice(0, manifest.lastIndexOf("/") + 1) : "";
  const file = eco === "npm" ? `${dir}package.json` : manifest || undefined;
  const severity = GH_SEVERITY[text(vuln.severity || adv.severity).toLowerCase()] ?? "medium";
  const summary = text(adv.summary) || "a known problem";
  const ids = [text(adv.ghsa_id), text(adv.cve_id)].filter(Boolean);
  const patched = text(obj(vuln.first_patched_version).identifier);
  const explain: FindingExplain = {
    lead: `The package ${name}${text(vuln.vulnerable_version_range) ? ` (${text(vuln.vulnerable_version_range)})` : ""} has a known problem: ${ended(sentence(summary))}`,
    wrong: `${clip(text(adv.description).trim() || summary, 1500)}${patched ? `\n\nFixed in ${patched}.` : ""}${ids.length ? `\n\nAdvisories: ${ids.join(", ")}.` : ""}`,
    see: [`GitHub's Dependabot alert${int(a.number) ? ` #${int(a.number)}` : ""}${text(a.html_url) ? `: ${text(a.html_url)}` : ""}.`],
  };
  return { title: clip(`The package ${name} has ${summary.replace(/\.$/, "")}`, 300), severity, source: "github", file, rule: `${eco}/${name}`, explain, ...(text(a.html_url) ? { url: text(a.html_url) } : {}) };
}

/**
  A result's instance from the tool's own fingerprints (SARIF partialFingerprints and fingerprints; a code-scanning alert's
  instance, when GitHub gives them): CodeQL's primaryLocationLineHash first, else the first by name. Undefined with none.
*/
export function fingerprintOf(...sets: unknown[]): string | undefined {
  const fps: Record<string, unknown> = Object.assign({}, ...sets.map(obj));
  const k = ["primaryLocationLineHash", ...Object.keys(fps).sort()].find((x) => text(fps[x]));
  return k ? `fp:${k}=${text(fps[k])}` : undefined;
}

/** A code-scanning alert as a finding: its rule and where. */
export function codeScanningFinding(a: Record<string, unknown>, root?: string): NewFinding | null {
  const rule = obj(a.rule);
  const inst = obj(a.most_recent_instance);
  const loc = obj(inst.location);
  const id = text(rule.id) || text(rule.name);
  if (!id) return null;
  const file = text(loc.path) || undefined;
  const line = int(loc.start_line);
  const endLine = int(loc.end_line);
  const severity = GH_SEVERITY[text(rule.security_severity_level).toLowerCase()] ?? GH_SEVERITY[text(rule.severity).toLowerCase()] ?? "medium";
  const message = text(obj(inst.message).text) || text(rule.description) || id;
  const ex = root && file && line ? excerptOf(root, file, line, endLine ?? line) : null;
  const tool = text(obj(a.tool).name);
  const explain: FindingExplain = { lead: ended(sentence(message)), wrong: clip(`${text(rule.description) || message}${tool ? `\n\nReported by ${tool} (${id}).` : ""}`, 1500), ...(ex ? { where: [ex] } : {}), see: [`GitHub's code scanning alert${int(a.number) ? ` #${int(a.number)}` : ""}${text(a.html_url) ? `: ${text(a.html_url)}` : ""}.`] };
  // The tool's fingerprint is the instance, as a SARIF report of the same run gives it (one finding for both); else the alert's number.
  const instance = fingerprintOf(inst.partial_fingerprints, inst.partialFingerprints, inst.fingerprints) ?? (int(a.number) ? `gh:${int(a.number)}` : undefined);
  return { title: sentence(text(rule.description) || message) || id, severity, source: "github", file, line, endLine, rule: id, ...(instance ? { instance } : {}), explain, ...(text(a.html_url) ? { url: text(a.html_url) } : {}) };
}

/** Brings GitHub's open alerts for the project in: Dependabot's and code scanning's. Anything in the way comes back as `note`. */
export async function bringGitHub(sec: Security, projectId: string): Promise<BringInResult> {
  const p = sec.project(projectId);
  const root = resolve(p.path);
  const none = (note: string): BringInResult => ({ added: 0, already: 0, leftOut: 0, note });
  const gh = await ghItself(sec);
  if (!gh.installed) return none(`The GitHub CLI isn't installed. ${process.platform === "win32" ? "winget install --id GitHub.cli" : "brew install gh"}, then gh auth login.`);
  if (!gh.signedIn) {
    // Signed in since it was last asked? Ask once more before saying no.
    cacheOf(sec).gh = undefined;
    if (!(await ghItself(sec)).signedIn) return none("The GitHub CLI isn't signed in. Run gh auth login.");
  }
  cacheOf(sec).repos.delete(root);
  const repo = await repoOf(sec, root);
  if (!repo) return none("This project has no GitHub remote (origin).");
  const [dep, code] = await Promise.all([ghList(sec, root, `repos/${repo}/dependabot/alerts?state=open&per_page=100`, "Dependabot alerts", repo), ghList(sec, root, `repos/${repo}/code-scanning/alerts?state=open&per_page=100`, "Code scanning alerts", repo)]);
  const list: NewFinding[] = [];
  if ("items" in dep) for (const a of dep.items) if (text(a.state) === "" || text(a.state) === "open") list.push(...[dependabotFinding(a)].filter((x): x is NewFinding => Boolean(x)));
  if ("items" in code) for (const a of code.items) if (text(a.state) === "" || text(a.state) === "open") list.push(...[codeScanningFinding(a, root)].filter((x): x is NewFinding => Boolean(x)));
  const got = addAll(sec, p.id, list, "gh");
  // An alert closed on GitHub since it came in is fixed here too, where its kind was read in full.
  const kindOf = (f: SecurityFinding) => (f.url?.includes("/security/dependabot/") ? "dep" : f.url?.includes("/security/code-scanning/") ? "code" : null);
  const closed = (f: SecurityFinding) => {
    const k = kindOf(f);
    return f.state === "open" && !got.keys.has(f.key) && !f.sources.some((s) => s !== "github") && Boolean(k) && "items" in (k === "dep" ? dep : code);
  };
  const now = Date.now();
  sec.updateMany(p.id, (x) => (closed(x) ? { ...x, state: "fixed", activity: [...x.activity, { at: now, kind: "fixed", text: "Fixed: the alert was closed on GitHub", by: "gh" }] } : null));
  sec.changed(["findings"], p.id);
  const whys = ["why" in dep ? dep.why : "", "why" in code ? code.why : ""].filter(Boolean);
  return { added: got.added, already: got.already, leftOut: got.leftOut, ...(whys.length ? { note: whys.join(" ") } : {}) };
}

/* ---------- SARIF ---------- */

/** A CVSS-like security-severity (0 to 10) as ours. */
const bySecurityScore = (v: unknown): Severity | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return n >= 9 ? "critical" : n >= 7 ? "high" : n >= 4 ? "medium" : "low";
};
const LEVEL: Record<string, Severity> = { error: "high", warning: "medium", note: "low", none: "low" };

/** A SARIF location's file, relative to the project when it is inside it: a relative uri, file:///…, or an artifact by index. */
function fileOfUri(uri: string, root: string): string | undefined {
  if (!uri) return undefined;
  let p = uri;
  try {
    if (/^file:/i.test(uri)) p = fileURLToPath(uri);
    else if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return undefined;
    else p = decodeURIComponent(uri);
  } catch {
    return undefined;
  }
  if (isAbsolute(p)) {
    const rel = relative(root, p);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return p.split(sep).join("/");
    p = rel;
  }
  return p.split(sep).join("/").replace(/^\.\//, "").replace(/^\/+/, "") || undefined;
}

/**
  The findings in a SARIF report's text: every run's results that are failures (not passes, not suppressed), each with
  its rule, its first location, a severity (the rule's or result's security-severity score, else its level, else the rule's
  default level) and its message. Throws, in words, when the text isn't a SARIF 2 report.
*/
export function parseSarif(textIn: string, root: string): { findings: NewFinding[]; skipped: number; cut: boolean } {
  let j: unknown;
  try {
    j = JSON.parse(textIn.replace(/^﻿/, ""));
  } catch {
    throw new Error("That file isn't a SARIF report: it isn't JSON.");
  }
  const o = obj(j);
  const version = text(o.version);
  if (!Array.isArray(o.runs) || (version && !version.startsWith("2."))) throw new Error(version && !version.startsWith("2.") ? `That report is SARIF ${version}; only SARIF 2.1.0 can be brought in.` : "That file isn't a SARIF report: it has no runs.");
  const findings: NewFinding[] = [];
  let skipped = 0;
  let cut = false;
  for (const runRaw of o.runs) {
    const r = obj(runRaw);
    const driver = obj(obj(r.tool).driver);
    const tool = text(driver.name) || "a tool";
    const rules = new Map<string, Record<string, unknown>>();
    const byIndex: Record<string, unknown>[] = [];
    for (const comp of [driver, ...(Array.isArray(obj(r.tool).extensions) ? (obj(r.tool).extensions as unknown[]).map(obj) : [])]) {
      for (const ru of Array.isArray(comp.rules) ? comp.rules.map(obj) : []) {
        if (comp === driver) byIndex.push(ru);
        if (text(ru.id)) rules.set(text(ru.id), ru);
      }
    }
    const artifacts = Array.isArray(r.artifacts) ? r.artifacts.map(obj) : [];
    for (const resRaw of Array.isArray(r.results) ? r.results : []) {
      const res = obj(resRaw);
      if (!Object.keys(res).length) {
        skipped++;
        continue;
      }
      const kind = text(res.kind) || "fail";
      const suppressed = Array.isArray(res.suppressions) && res.suppressions.some((s) => text(obj(s).status) !== "rejected");
      if (kind !== "fail" || suppressed) {
        skipped++;
        continue;
      }
      if (findings.length >= RESULTS_CAP) {
        cut = true;
        break;
      }
      const ruleRef = obj(res.rule);
      const id = text(res.ruleId) || text(ruleRef.id) || text(byIndex[typeof res.ruleIndex === "number" ? res.ruleIndex : typeof ruleRef.index === "number" ? ruleRef.index : -1]?.id);
      const rule = rules.get(id) ?? (typeof res.ruleIndex === "number" ? byIndex[res.ruleIndex] : undefined) ?? {};
      const msg = obj(res.message);
      const fromStrings = text(obj(obj(rule.messageStrings)[text(msg.id)]).text);
      const message = text(msg.text) || text(msg.markdown) || fromStrings || text(obj(rule.shortDescription).text) || text(obj(rule.fullDescription).text) || id;
      if (!message && !id) {
        skipped++;
        continue;
      }
      const phys = obj(obj((Array.isArray(res.locations) ? res.locations[0] : undefined)).physicalLocation);
      const art = obj(phys.artifactLocation);
      const uri = text(art.uri) || (typeof art.index === "number" ? text(obj(artifacts[art.index]?.location).uri) : "");
      const file = fileOfUri(uri, root);
      const region = obj(phys.region);
      const line = int(region.startLine);
      const endLine = int(region.endLine);
      const props = obj(res.properties);
      const ruleProps = obj(rule.properties);
      const level = text(res.level) || text(obj(rule.defaultConfiguration).level) || "warning";
      const severity = bySecurityScore(props["security-severity"]) ?? bySecurityScore(ruleProps["security-severity"]) ?? LEVEL[level.toLowerCase()] ?? "medium";
      const ex = file && line && !isAbsolute(file) ? excerptOf(root, file, line, endLine ?? line) : null;
      const help = text(rule.helpUri);
      const describe = text(obj(rule.fullDescription).text) || text(obj(rule.shortDescription).text);
      const explain: FindingExplain = { lead: ended(sentence(message) || id), wrong: clip(`${describe && describe !== message ? `${message}\n\n${describe}` : message}\n\nReported by ${tool}${id ? ` (${id})` : ""}.`, 1500), ...(ex ? { where: [ex] } : {}), ...(help ? { see: [`Read about the rule at ${help}.`] } : {}) };
      // A fingerprint is the instance (the tool's own, which holds when lines move); with none, its message and its start line
      // together, so two results of one rule in one file stay two findings.
      const title = sentence(message) || id || "A problem the report names";
      const instance = fingerprintOf(res.partialFingerprints, res.fingerprints) ?? `t:${normalKey(title)}${line ? `@${line}` : ""}`;
      findings.push({ title, severity, source: "sarif", file, line, endLine, rule: id || undefined, instance, explain, ...(help ? { url: help } : {}) });
    }
    if (cut) break;
  }
  return { findings, skipped, cut };
}

/** Brings a SARIF report in: a file you picked (`path`), or its text. */
export async function bringSarif(sec: Security, p: { projectId: string; path?: string; text?: string }): Promise<BringInResult> {
  const proj = sec.project(p.projectId);
  const root = resolve(proj.path);
  let body = typeof p.text === "string" ? p.text : "";
  if (!body) {
    if (typeof p.path !== "string" || !p.path.trim()) throw new Error("Pick a SARIF report.");
    const abs = isAbsolute(p.path) ? p.path : join(root, p.path);
    let size: number;
    try {
      const st = lstatSync(abs);
      if (!st.isFile()) throw new Error("not a file");
      size = st.size;
    } catch {
      throw new Error("That report couldn't be read: it isn't there, or it isn't a file.");
    }
    if (size > SARIF_CAP) throw new Error(`That report is too big to bring in (over ${SARIF_CAP / 1024 / 1024} MB).`);
    body = readFileSync(abs, "utf8");
  } else if (body.length > SARIF_CAP) throw new Error(`That report is too big to bring in (over ${SARIF_CAP / 1024 / 1024} MB).`);
  const parsed = parseSarif(body, root);
  const got = addAll(sec, proj.id, parsed.findings, "SARIF report");
  sec.changed(["findings"], proj.id);
  const note = parsed.cut ? `Only the first ${RESULTS_CAP} results were brought in.` : !parsed.findings.length ? "The report has no problems in it." : undefined;
  return { added: got.added, already: got.already, leftOut: got.leftOut, ...(note ? { note } : {}) };
}
