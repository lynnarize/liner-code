/*
  A dev-only stand-in for the engine's Security answers, so the Overview and Projects can be drawn before the Demo's data
  lands (or with no engine data at all): open the dev URL with ?ls-mock. It is the mockup's sample, shaped exactly like the
  contract types (SecurityOverview, SecurityProject, SecurityFinding, ScanRecord) and dated from today, so the day-by-day
  line, "2h ago" and "yesterday" read as they do on boards A and G. Like design/store.ts's ?ld-mock: never in a build,
  where import.meta.env.DEV is false and the whole of it is dropped.
*/
import type { FreeCheckResult, FreeCheckRun, RpcMethod, RpcParams, RpcResult, ScanRecord, SecondLookState, SecurityFinding, SecurityOverview, SecurityProject, Severity, SeverityCounts } from "@contracts";
import { SEVERITIES, noSeverities } from "@contracts";

export const MOCK = import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).has("ls-mock");

const DAY = 86400000;
const midnight = (at: number) => new Date(new Date(at).toDateString()).getTime();
const dayKey = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type Sample = { findings: SecurityFinding[]; scans: ScanRecord[]; projects: { id: string; name: string; path: string }[]; checks: Record<string, FreeCheckRun> };

/** The sample, dated from now: Sample project (Foreshore) with four open, liner-site clean, harbour-notes never scanned. */
function sample(now = Date.now()): Sample {
  const today = midnight(now);
  const on = (daysAgo: number, hour = 11) => today - daysAgo * DAY + hour * 3600000;
  const sev = (s: Partial<SeverityCounts>): SeverityCounts => ({ ...noSeverities(), ...s });
  const projects = [
    { id: "p-sample", name: "Sample project", path: "/Users/you/Projects/foreshore" },
    { id: "p-site", name: "liner-site", path: "/Users/you/Projects/liner-site" },
    { id: "p-notes", name: "harbour-notes", path: "/Users/you/Projects/harbour-notes" },
  ];
  const scans: ScanRecord[] = [
    { id: "s4", projectId: "p-sample", depth: "project", reader: { kind: "own", agent: "@claude:claude-opus-5-5", model: "claude:claude-opus-5-5" }, threadId: "mock-scan", title: "Sample project, in full", state: "done", startedAt: now - 2.3 * 3600000, finishedAt: now - 2 * 3600000, counts: { found: 4, fresh: 4, already: 0, leftOut: 0, bySeverity: sev({ high: 1, medium: 2, low: 1 }) }, secondLook: "codex:gpt-6.1" },
    { id: "s3", projectId: "p-site", depth: "checks", title: "liner-site, free checks", state: "done", startedAt: on(1, 16), finishedAt: on(1, 16), counts: { found: 0, fresh: 0, already: 0, leftOut: 0, bySeverity: sev({}) } },
    { id: "s2", projectId: "p-sample", depth: "branch", reader: { kind: "own", agent: "@claude:claude-opus-5-5", model: "claude:claude-opus-5-5" }, title: "Sample project, this branch", state: "done", startedAt: on(5), finishedAt: on(5), counts: { found: 1, fresh: 1, already: 0, leftOut: 0, bySeverity: sev({ low: 1 }) } },
    { id: "s1", projectId: "p-sample", depth: "checks", title: "Sample project, free checks", state: "done", startedAt: on(24), finishedAt: on(24), counts: { found: 1, fresh: 1, already: 0, leftOut: 0, bySeverity: sev({ high: 1 }) } },
  ];
  const look = (state: SecondLookState, words?: string) => ({ state, ...(state !== "none" ? { by: "codex:gpt-6.1", words, at: now - 1.9 * 3600000 } : {}) });
  const f = (id: string, o: Partial<SecurityFinding> & Pick<SecurityFinding, "title" | "severity" | "source" | "foundAt">): SecurityFinding => ({ id, projectId: "p-sample", key: id, sources: [o.source], state: "open", look: look("none"), activity: [{ at: o.foundAt, kind: "found", text: "Found" }], updatedAt: o.foundAt, ...o });
  const findings: SecurityFinding[] = [
    f("f1", { title: "The station id goes into the database query as text", severity: "high", source: "agent", file: "station.js", line: 41, area: "The API", scan: "s4", foundAt: now - 2.1 * 3600000, look: look("confirmed", "The id reaches the query unchanged.") }),
    f("f2", { title: "The admin page checks your role in the browser only", severity: "medium", source: "agent", file: "admin.tsx", line: 12, area: "Sign-in", scan: "s4", foundAt: now - 2.1 * 3600000, look: look("confirmed", "The server never asks for the role.") }),
    f("f3", { title: "lodash 4.17.20 has a known problem", severity: "medium", source: "checks", rule: "GHSA-35jh-r3h4-6jhm", file: "package.json", scan: "s4", foundAt: now - 2.2 * 3600000 }),
    f("f4", { title: "Error pages show where in the code it failed", severity: "low", source: "agent", file: "server.js", line: 88, area: "The API", scan: "s4", foundAt: now - 2.1 * 3600000, look: look("unconfirmed", "Only in development mode, as far as I can see."), fix: { threadId: "mock-fix", state: "working", at: now - 4 * 60000 } }),
    f("f5", { title: "An API key sits in config.sample.js", severity: "high", source: "checks", file: "config.sample.js", line: 3, scan: "s1", state: "fixed", foundAt: on(24), updatedAt: on(1, 10) }),
    f("f6", { title: "The upload size isn't limited", severity: "low", source: "agent", file: "upload.js", line: 20, area: "File uploads", scan: "s2", state: "dismissed", dismissed: { reason: "accepted-risk", at: on(3) }, foundAt: on(5), updatedAt: on(3) }),
  ];
  const res = (check: FreeCheckResult["check"], state: FreeCheckResult["state"], count = 0, note?: string): FreeCheckResult => ({ check, state, count, at: now - 2.2 * 3600000, ...(note ? { note } : {}) });
  const checks: Record<string, FreeCheckRun> = {
    "p-sample": { projectId: "p-sample", results: [res("secrets", "clean"), res("packages", "found", 1, "from npm audit"), res("files", "clean")], added: 1, at: now - 2.2 * 3600000 },
    "p-site": { projectId: "p-site", results: [res("secrets", "clean"), res("packages", "clean"), res("files", "clean")], added: 0, at: on(1, 16) },
  };
  return { findings, scans, projects, checks };
}

/** When a finding stopped being open (fixed or dismissed), for the day-by-day line. */
const closedAt = (f: SecurityFinding) => (f.state === "open" ? Infinity : (f.dismissed?.at ?? f.updatedAt));

function overview(days: number, projectId: string | undefined, now = Date.now()): SecurityOverview {
  const s = sample(now);
  const mine = (p: string) => !projectId || p === projectId;
  const all = s.findings.filter((x) => mine(x.projectId));
  const open = all.filter((x) => x.state === "open");
  const from = midnight(now) - (days - 1) * DAY;
  const openAt = (at: number) => all.filter((x) => x.foundAt <= at && closedAt(x) > at).length;
  const scans = s.scans.filter((x) => mine(x.projectId));
  const series = Array.from({ length: days }, (_, i) => {
    const at = from + i * DAY;
    const end = Math.min(at + DAY - 1, now);
    const inDay = (t: number) => t >= at && t < at + DAY;
    return { day: dayKey(at), at, open: openAt(end), scans: scans.filter((x) => inDay(x.startedAt)).map((x) => x.id), found: all.filter((x) => inDay(x.foundAt)).length, fixed: all.filter((x) => x.state === "fixed" && inDay(closedAt(x))).length, dismissed: all.filter((x) => x.state === "dismissed" && inDay(closedAt(x))).length };
  });
  const bySeverity = noSeverities();
  for (const x of open) bySeverity[x.severity]++;
  const byLook: Record<SecondLookState, number> = { none: 0, confirmed: 0, unconfirmed: 0 };
  for (const x of open) byLook[x.look.state]++;
  const fixedIn = all.filter((x) => x.state === "fixed" && closedAt(x) >= from);
  const dismissedIn = all.filter((x) => x.state === "dismissed" && closedAt(x) >= from);
  const reasons: SecurityOverview["dismissReasons"] = {};
  for (const x of dismissedIn) reasons[x.dismissed!.reason] = (reasons[x.dismissed!.reason] ?? 0) + 1;
  const rank = (v: Severity) => SEVERITIES.indexOf(v);
  const fixing = open.filter((x) => x.fix?.state === "working");
  return {
    days,
    ...(projectId ? { projectId } : {}),
    open: open.length,
    openWeekAgo: openAt(now - 7 * DAY),
    found: all.filter((x) => x.foundAt >= from).length,
    scans: scans.filter((x) => x.startedAt >= from).length,
    fixed: fixedIn.length,
    ...(fixedIn.length ? { lastFixedAt: Math.max(...fixedIn.map(closedAt)) } : {}),
    dismissed: dismissedIn.length,
    dismissReasons: reasons,
    beingFixed: fixing.length,
    fixThreads: fixing.map((x) => x.fix!.threadId),
    fixesReady: open.filter((x) => x.fix?.state === "ready").length,
    series,
    bySeverity,
    byLook,
    byProject: s.projects.filter((p) => mine(p.id) && s.scans.some((x) => x.projectId === p.id)).map((p) => {
      const c = noSeverities();
      for (const x of open) if (x.projectId === p.id) c[x.severity]++;
      return { projectId: p.id, name: p.name, open: open.filter((x) => x.projectId === p.id).length, bySeverity: c };
    }),
    worst: [...open].sort((a, b) => rank(a.severity) - rank(b.severity)).slice(0, 8),
    checks: Object.values(s.checks).filter((r) => mine(r.projectId)).flatMap((r) => r.results).reduce<FreeCheckResult[]>((acc, r) => {
      const had = acc.find((x) => x.check === r.check);
      if (!had) acc.push({ ...r });
      else if (r.state === "found") (had.state = "found"), (had.count += r.count), (had.note = had.note ?? r.note);
      return acc;
    }, []),
  };
}

function projects(now = Date.now()): SecurityProject[] {
  const s = sample(now);
  return s.projects.map((p) => {
    const open = s.findings.filter((x) => x.projectId === p.id && x.state === "open");
    const bySeverity = noSeverities();
    for (const x of open) bySeverity[x.severity]++;
    const scans = s.scans.filter((x) => x.projectId === p.id);
    const areas = p.id === "p-sample" ? ["The API", "Sign-in", "Saved alerts", "File uploads"].map((name) => ({ name, line: "", open: open.filter((x) => x.area?.toLowerCase() === name.toLowerCase()).length })) : [];
    return { projectId: p.id, name: p.name, path: p.path, open: open.length, bySeverity, ...(scans[0] ? { lastScan: scans[0] } : {}), threatModel: { file: "SECURITY.md", exists: areas.length > 0, areas, ...(areas.length ? { written: now - 2 * 3600000 } : {}) }, ...(s.checks[p.id] ? { checks: s.checks[p.id] } : {}), scans, readers: p.id === "p-sample" ? ["claude:claude-opus-5-5", "free checks"] : scans.length ? ["free checks"] : [] };
  });
}

/** The mock's answer to a security.* call, or undefined for one it doesn't stand in for. */
export function mockAnswer<M extends RpcMethod>(method: M, params: RpcParams<M>): RpcResult<M> | undefined {
  const p = params as { days?: number; projectId?: string; state?: string; scan?: string };
  const s = sample();
  const answer: unknown =
    method === "security.overview" ? overview(p.days ?? 30, p.projectId)
    : method === "security.projects" ? projects()
    : method === "security.scans.list" ? s.scans.filter((x) => !p.projectId || x.projectId === p.projectId)
    : method === "security.findings.list" ? s.findings.filter((x) => (!p.projectId || x.projectId === p.projectId) && (!p.state || x.state === p.state) && (!p.scan || x.scan === p.scan))
    : undefined;
  return answer as RpcResult<M> | undefined;
}
