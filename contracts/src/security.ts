/*
  Liner Security: the shapes the Security face, the engine and the scan's tools share. A finding is one
  problem in one project's code, from wherever it came (an agent's scan, the free checks run on this
  Mac, GitHub's alerts, a SARIF report), kept by the engine under its home, per project, never inside
  the repository. The same problem from two places shows once (findingKey); one you dismissed is
  remembered, so the next scan doesn't raise it again.

  A scan is an ordinary session of a tool you have, at Read only, tagged on the thread (Thread.security):
  it reports findings through Liner's own tools (security_report_finding and friends, engine/src/security-tools.ts),
  so it works with every CLI and endpoint. A Specialist scan is led by a model made for security work
  that a signed-in CLI lists (SPECIALIST_MODELS) or an endpoint you marked, and is sealed: none of your
  skills, plugins, hooks or add-ons load into it.

  The RPC and the events are in index.ts, beside the others; the engine's halves are engine/src/security*.ts.
*/
import type { Effort, ProviderId } from "./index.ts";
import { familyOf } from "./index.ts";

/** How bad a finding is, worst first. */
export type Severity = "critical" | "high" | "medium" | "low";
/** Every severity, worst first: the order lists, bars and legends go in. */
export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
/** A severity's word, as the UI writes it. */
export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
/** A count per severity. */
export type SeverityCounts = Record<Severity, number>;
export const noSeverities = (): SeverityCounts => ({ critical: 0, high: 0, medium: 0, low: 0 });

/** Where a finding came from: an agent's scan, the free checks (no agent), GitHub's alerts through gh, a SARIF report you picked. */
export type FindingSource = "agent" | "checks" | "github" | "sarif";
export const SOURCE_LABEL: Record<FindingSource, string> = { agent: "Agent scan", checks: "Free checks", github: "GitHub alerts", sarif: "SARIF report" };
/** open: still there; fixed: its fix was merged (or a later scan found it gone); dismissed: you said why it isn't one to act on. */
export type FindingState = "open" | "fixed" | "dismissed";
/** Why you dismissed a finding, as the Dismiss menu offers it. */
export type DismissReason = "duplicate" | "false-positive" | "not-actionable" | "accepted-risk" | "mitigated" | "other";
export const DISMISS_LABEL: Record<DismissReason, string> = { duplicate: "Duplicate", "false-positive": "False positive", "not-actionable": "Not actionable", "accepted-risk": "Accepted risk", mitigated: "Mitigated", other: "Other" };

/** A piece of code a finding points at: a file's lines from `start` (1-based), the ones that matter in `hit`. */
export type CodeExcerpt = { file: string; start: number; lines: string[]; hit: number[] };
/**
  The finding explained in full, as its Summary tab reads: one sentence first (`lead`: what someone can
  do with it), then what is wrong, where (code excerpts), who can do it, what they get, and the steps to
  see it. Every part but `lead` and `wrong` may be missing (a free check knows less than an agent).
*/
export type FindingExplain = { lead: string; wrong: string; where?: CodeExcerpt[]; who?: string; gets?: string; see?: string[] };
/** none: nobody looked again; confirmed / unconfirmed: another maker's model read the code and said so, in its words. */
export type SecondLookState = "none" | "confirmed" | "unconfirmed";
/** The second look at a finding: what it said, which model ("<provider>:<model>"), its own sentence, when. */
export type SecondLook = { state: SecondLookState; by?: string; words?: string; at?: number };
/** A fix at work: the session (a worktree of its own) with the finding as its brief. merged closes the finding as fixed. */
export type FindingFix = { threadId: string; state: "working" | "ready" | "merged" | "stopped"; at: number };
/** What happened to a finding, for its Activity tab and the Overview's day-by-day line. Every state change is one. */
export type FindingEventKind = "found" | "raised-again" | "looked" | "dismissed" | "reopened" | "fix-started" | "fixed" | "note";
export type FindingEvent = { at: number; kind: FindingEventKind; text: string; /** Who: a model ref, "you", "free checks", "gh". */ by?: string; scan?: string };

/** One problem in one project's code. (Not the Reviewer's `Finding` in index.ts, a note on a diff.) */
export type SecurityFinding = {
  id: string;
  /** The Liner project it is in (a folder Liner Code knows). */
  projectId: string;
  /** One plain sentence: "The station id goes into the database query as text". */
  title: string;
  severity: Severity;
  /** The file it is in, relative to the project's folder, and its line. A package problem names the manifest, with no line. */
  file?: string;
  line?: number;
  endLine?: number;
  /** Where it was first found; `sources` holds every place that raised it since (deduplicated, once each). */
  source: FindingSource;
  sources: FindingSource[];
  /** The checker's own rule or advisory id when there is one (npm audit's GHSA, a SARIF ruleId, "secret/aws-key"). */
  rule?: string;
  /**
    Which instance of the rule this is, when the source says (a GitHub code-scanning alert's number "gh:12", a SARIF
    result's fingerprint "fp:…"): part of the key, so two places one rule fires in a file are two findings, and one keeps
    its key when the code above it moves. Unset: the rule and the file are the key.
  */
  instance?: string;
  /** The dedupe key: project + file + a normalised rule or title (findingKey). Set by the engine. */
  key: string;
  state: FindingState;
  /** Why it was dismissed, and when. */
  dismissed?: { reason: DismissReason; note?: string; at: number };
  explain?: FindingExplain;
  look: SecondLook;
  fix?: FindingFix;
  activity: FindingEvent[];
  /** The area of the threat model (a heading of SECURITY.md) it falls under. */
  area?: string;
  /** The scan that found it first; a free check or an import has none. */
  scan?: string;
  /** An address outside Liner where it lives too (a GitHub alert's page). */
  url?: string;
  foundAt: number;
  updatedAt: number;
};

/** What a scan, a free check or an import hands the store to add: the store fills in the rest (id, key, state, activity). */
export type NewFinding = Pick<SecurityFinding, "title" | "severity" | "source"> & Partial<Pick<SecurityFinding, "file" | "line" | "endLine" | "rule" | "instance" | "explain" | "area" | "scan" | "url">> & { look?: SecondLook };
/** What adding a finding did: added it, merged it into one already there, or left it out because you dismissed it before. */
export type SecurityFindingAdded = { finding: SecurityFinding; outcome: "new" | "already-open" | "reopened" | "dismissed-before" };

/** Normalised words of a rule or a title, for the dedupe key: lower case, letters and digits of any script only (a title in Japanese keeps its words), single spaces. */
export const normalKey = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/**
  The same problem from two sources shows once: same project, same file, same rule (or, with none, the same title in other
  words' case and punctuation), and the same instance of the rule when the source names one.
*/
export function findingKey(projectId: string, f: { file?: string; rule?: string; instance?: string; title: string }): string {
  return `${projectId}\n${(f.file ?? "").replace(/^\.\//, "")}\n${normalKey(f.rule || f.title)}${f.instance ? `\n${f.instance.trim()}` : ""}`;
}

/** How far a scan reads: the free checks only (no agent), what this branch changed, or the whole project. */
export type ScanDepth = "checks" | "branch" | "project";
export const DEPTH_LABEL: Record<ScanDepth, string> = { checks: "The free checks", branch: "This branch's changes", project: "The whole project" };
/**
  Who reads it. own: a tool you have (`agent`: a model ref "@<provider>:<model>" or one of your agents), the scan's
  lead. specialist: a security model leads (`model`, "@<provider>:<model>"; `source`: the SpecialistSource it came
  from), sealed and Read only; where the pairing exists, `sidekick` (your own tool's model ref, no @) does the reading.
*/
export type ScanReader =
  | { kind: "own"; agent: string; model?: string; effort?: Effort }
  | { kind: "specialist"; source: string; model: string; effort?: Effort; sidekick?: string };
/** The choices on Start a scan (board C). */
export type ScanOptions = {
  projectId: string;
  depth: ScanDepth;
  /** Unused for depth "checks". */
  reader: ScanReader;
  /** A second look by another maker's model, "<provider>:<model>"; unset: off. */
  secondLook?: string;
  /** The threat model: the file (SECURITY.md by default), and whether the scan may write it when it is missing (asked again on the card). */
  threatModel?: { file: string; write: boolean };
  /** Stops after this many minutes; unset: no limit, it runs till it finishes or you stop it. */
  stopsAfter?: number;
  /** "Look at first", in your words. */
  lookFirst?: string;
  /** For depth "branch": what it is compared with (the main branch when unset). */
  base?: string;
};
export type ScanState = "running" | "asking" | "done" | "stopped" | "failed";
/** One scan: the free checks alone, or a session of a tool (threadId). */
export type ScanRecord = {
  id: string;
  projectId: string;
  depth: ScanDepth;
  /** Unset for depth "checks". */
  reader?: ScanReader;
  /** The scan session, for an agent's scan. */
  threadId?: string;
  /** "Sample project, in full", "liner-site, free checks". */
  title: string;
  state: ScanState;
  startedAt: number;
  finishedAt?: number;
  /** found: every finding it reported; fresh: of those, new ones; already: open before, not raised again; left out: dismissed before. */
  counts: { found: number; fresh: number; already: number; leftOut: number; bySeverity: SeverityCounts };
  secondLook?: string;
  stopsAfter?: number;
  /** Areas of the threat model it has read so far, by name. */
  areasRead?: string[];
  /** Areas it is reading now. */
  areasReading?: string[];
  /** Areas this scan won't read ("This branch did not touch it"). */
  areasUntouched?: string[];
  /** Its closing words: what the branch lets someone do, what it didn't get to. */
  summary?: string;
  error?: string;
  /** When the engine stops it ("Stops after"): pushed on by the time it waits on your answers. Set while it runs. */
  endsAt?: number;
  /** The second look is reading what it found (after the scan's own turn ended). */
  looking?: boolean;
  /** What it read and what it did not get to, as it said at its end (security_finish), each a sentence. */
  read?: string[];
  missed?: string[];
};

/**
  A Liner Security line in a scan's chat (Item kind "security"), put there by the engine as the scan works:
  - finding: the scan reported one (as it was then: read the live one with security.finding.get). `outcome` says whether
    it is new, was already open (not raised again) or was dismissed before (left out; `finding` is "" then). `why`: the
    scan's own sentence on how it ranked it.
  - answers: your answers to its questions were taken (`lines`, each with whether it was the scan's guess, or skipped), and
    saved to the threat model's file (`saved`) or kept for when it is written.
  - look: the second look, a second voice: who (`by`, "<provider>:<model>"), its words, and what it said of each new finding.
    Put once as "running" and replaced (same item id) when it ends.
  - done: the scan ended (done, stopped at its time, stopped by you, failed): its counts and how many held up.
*/
export type SecurityItem =
  | { type: "finding"; scan: string; finding: string; title: string; severity: Severity; file?: string; line?: number; area?: string; outcome: SecurityFindingAdded["outcome"]; why?: string }
  | { type: "answers"; scan: string; asked: number; answered: number; skipped: number; saved?: string; lines: { question: string; answer?: string; guess: boolean }[] }
  | { type: "look"; scan: string; by: string; state: "running" | "done" | "failed"; words?: string; seconds?: number; results: { finding: string; title: string; state: SecondLookState; words?: string }[]; error?: string }
  | { type: "done"; scan: string; state: ScanState; summary?: string; read?: string[]; missed?: string[]; counts: ScanRecord["counts"]; confirmed: number; seconds: number };

/** One of the free checks, run on this Mac with no agent. */
export type FreeCheckId = "secrets" | "packages" | "files";
export const FREE_CHECK_LABEL: Record<FreeCheckId, string> = { secrets: "Secrets in tracked files", packages: "Packages with known problems", files: "Files that should not be in git" };
/** One free check's last result: clean, found some (count), skipped (no lockfile, not a repository), or failed. */
export type FreeCheckResult = { check: FreeCheckId; state: "clean" | "found" | "skipped" | "failed"; count: number; /** "from npm audit", "no lockfile", why it failed. */ note?: string; at: number };
/** A run of the free checks on one project, and the findings it added (outcome "new" or "reopened"). */
export type FreeCheckRun = { projectId: string; results: FreeCheckResult[]; added: number; at: number; scan?: string };
/** What bringing findings in did. */
export type BringInResult = { added: number; already: number; leftOut: number; note?: string };
/** gh on this Mac, for Bring in: installed, signed in, and the GitHub repository of the project (when one is asked about). */
export type GitHubReach = { installed: boolean; signedIn: boolean; repo?: string };

/** One area of the threat model: a heading of SECURITY.md and the line under it, with what is open in it. */
export type ThreatArea = { name: string; line: string; open: number };
/** The threat model: a file in the repository (SECURITY.md by default), its areas, whether it is there, and when it was last written. */
export type ThreatModel = { file: string; exists: boolean; areas: ThreatArea[]; written?: number };

/** A model made for security work that Liner can run a Specialist scan with. */
export type SpecialistSource = {
  /** "cli:<provider>:<model>" or "endpoint:<endpoint id>". */
  id: string;
  kind: "cli" | "endpoint";
  provider: ProviderId;
  model: string;
  /** "Claude Mythos". */
  label: string;
  /** "through Claude Code", "an API endpoint". */
  via: string;
  /** The model ref a scan's thread runs on, "@<provider>:<model>". */
  ref: string;
  /** Its tool can run it sealed (no skills, plugins, hooks or add-ons): only these are offered. */
  sealable: boolean;
};
/**
  The security models Liner knows by name, matched on the model lists the CLIs report (ProviderInfo.models).
  `family`: the tool that lists it; `match`: tested against the model's id and its label, case aside.
  Keep every name here, in one table.
*/
export const SPECIALIST_MODELS: { family: "claude" | "codex"; label: string; match: string }[] = [
  { family: "claude", label: "Claude Mythos", match: "mythos" },
  { family: "codex", label: "GPT Cyber", match: "cyber" },
];
/**
  Whether a tool can run a sealed session (OpenOptions.sealed: Liner's own tools kept, none of your skills, plugins,
  hooks, MCP servers or add-ons): Claude Code can (and an endpoint run through it), the Demo has none to load.
  Codex, OpenCode and ACP agents can't promise it today, so a Specialist scan is never offered on them.
*/
export const sealable = (provider: ProviderId) => familyOf(provider) === "claude" || provider === "demo";

/** A depth as Start a scan offers it: its words and its cost line. */
export type ScanDepthChoice = { depth: ScanDepth; label: string; note: string; cost: string; costNote?: string };
/** What Start a scan needs for one project (security.scan.options). */
export type ScanChoices = {
  projectId: string;
  depths: ScanDepthChoice[];
  /** The security models found; empty shows board C2. */
  specialist: SpecialistSource[];
  /** Where it looked for them, for C2's words: "Claude Code or Codex". */
  lookedIn: string[];
  /** Of those, the tools installed here but signed out ("Claude Code"): a CLI lists its security model only to an account signed in. */
  signedOut?: string[];
  /** What a scan starts with unless you change it. */
  defaults: ScanOptions;
  threatModel: ThreatModel;
  /** For "This branch's changes": the branch, what it is compared with, how many files changed. Unset outside a repository. */
  branch?: { name: string; base?: string; files: number };
};

/** One folder Liner Code knows, as Projects (board G) and Overview's split read it. */
export type SecurityProject = {
  projectId: string;
  name: string;
  path: string;
  open: number;
  bySeverity: SeverityCounts;
  lastScan?: ScanRecord;
  threatModel: ThreatModel;
  checks?: FreeCheckRun;
  /** Its scans, newest first (a few). */
  scans: ScanRecord[];
  /** Who has scanned it, as model refs or "free checks", newest first, once each. */
  readers: string[];
};

/** One day of the Overview's line: what was open at its end, and what happened in it. `day` is local "YYYY-MM-DD", `at` its start. */
export type OverviewDay = { day: string; at: number; open: number; scans: string[]; found: number; fixed: number; dismissed: number };
/** The Overview (board A), for a period of days and one project or all. */
export type SecurityOverview = {
  days: number;
  projectId?: string;
  open: number;
  /** Open seven days ago, for "3 more than a week ago". */
  openWeekAgo: number;
  /** In the period: found, by how many scans; fixed (and the last fix); dismissed (and by which reasons). */
  found: number;
  scans: number;
  fixed: number;
  lastFixedAt?: number;
  dismissed: number;
  dismissReasons: Partial<Record<DismissReason, number>>;
  /** Open findings with a fix still at work (its session working), and those sessions. */
  beingFixed: number;
  fixThreads: string[];
  /** Open findings whose fix session has finished and waits for you to look (ready), not counted in beingFixed. */
  fixesReady?: number;
  series: OverviewDay[];
  bySeverity: SeverityCounts;
  byLook: Record<SecondLookState, number>;
  byProject: { projectId: string; name: string; open: number; bySeverity: SeverityCounts }[];
  /** Open, worst first (a few). */
  worst: SecurityFinding[];
  /** The free checks' latest result for each check, across the projects asked about. */
  checks: FreeCheckResult[];
};

/** What the Security sidebar shows (board A's sidebar): open count, Bring in's two rows, the scans, the fix sessions. */
export type SecuritySide = {
  open: number;
  github: { open: number; reach: GitHubReach };
  sarif: { open: number };
  scans: ScanRecord[];
  /** Fix sessions (Thread.security.kind "fix"), newest first, by thread id. */
  fixes: string[];
};

/** A session's Security tag (Thread.security): a scan (sealed for a Specialist scan), a fix, or a question about a finding. */
export type SecurityTag = { kind: "scan" | "fix" | "ask"; scan?: string; finding?: string; sealed?: boolean };
/** What changed, for security.changed. */
export type SecurityChange = "findings" | "scans" | "checks" | "model" | "projects";

