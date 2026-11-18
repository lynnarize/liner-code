/*
  Liner Security: Overview (board A). An infographic, each group in its own bordered box: the figures (what is open now,
  and what was found, fixed and dismissed in the period, and what is being fixed: that one opens its fix session), the open
  count day by day (OpenChart), three wholes split into parts (how bad, what the second look said, which project), the open
  findings worst first (a row opens it in Findings), and the free checks' latest results. The period and the project are
  picked in the top row and kept in the face's store, so Findings reads the same scope. Everything is security.overview,
  asked again whenever the engine says Security changed. Builder U1.
*/
import { useMemo, useState } from "react";
import type { DismissReason, FreeCheckId, FreeCheckResult, SecondLookState, SecurityFinding, SecurityOverview, SeverityCounts } from "@contracts";
import { DISMISS_LABEL, FREE_CHECK_LABEL, SEVERITIES, SEVERITY_LABEL, noSeverities } from "@contracts";
import { useEngine } from "../engine";
import { I } from "../icons";
import { plural, providerLabel } from "../model";
import { Pop, Row } from "../ui";
import { useSec } from "./data";
import { OpenChart } from "./OpenChart";
import { Card, Legend, PageTop, Parts, SevBar, SevMark, SevSplit, Tag, type Part } from "./parts";
import { goSecurity, setSecurityScope, useSecurityScope } from "./store";
import { fixedAt, when } from "./when";
import "./overview.css";

const PERIODS = [7, 30, 90];
const CHECKS: FreeCheckId[] = ["secrets", "packages", "files"];
/** A dismissal's reason as the Dismissed figure says it: one ("an accepted risk"), or several of one kind ("2 accepted risks"). */
const REASON_ONE: Record<DismissReason, string> = { duplicate: "a duplicate", "false-positive": "a false positive", "not-actionable": "not actionable", "accepted-risk": "an accepted risk", mitigated: "mitigated", other: "for another reason" };
const REASON_MANY: Record<DismissReason, (n: number) => string> = { duplicate: (n) => `${n} duplicates`, "false-positive": (n) => `${n} false positives`, "not-actionable": () => "not actionable", "accepted-risk": (n) => `${n} accepted risks`, mitigated: () => "mitigated", other: () => "for other reasons" };

/** An overview with nothing in it, so the boxes stand at their size while the first answer comes. */
const blank = (days: number): SecurityOverview => ({ days, open: 0, openWeekAgo: 0, found: 0, scans: 0, fixed: 0, dismissed: 0, dismissReasons: {}, beingFixed: 0, fixThreads: [], series: [], bySeverity: noSeverities(), byLook: { none: 0, confirmed: 0, unconfirmed: 0 }, byProject: [], worst: [], checks: [] });

export function Overview({ sidebar, onSidebar }: { sidebar: boolean; onSidebar: () => void }) {
  const scope = useSecurityScope();
  const { data, error } = useSec("security.overview", { days: scope.days, ...(scope.projectId ? { projectId: scope.projectId } : {}) });
  const { data: projects } = useSec("security.projects", {});
  const { data: scans } = useSec("security.scans.list", scope.projectId ? { projectId: scope.projectId } : {}, ["scans"]);
  // A fixed finding's time is read from the finding itself (when.ts fixedAt), as its row in Findings reads it, so both agree.
  const { data: fixedList } = useSec("security.findings.list", { ...(scope.projectId ? { projectId: scope.projectId } : {}), state: "fixed" }, ["findings"]);
  const o = data ?? blank(scope.days);
  const lastFixed = fixedList?.length ? Math.max(...fixedList.map(fixedAt)) : o.lastFixedAt;
  const picked = projects?.find((p) => p.projectId === scope.projectId);
  // Nothing was ever scanned or checked anywhere (or in the project picked): say so and offer a scan, in place of empty boxes.
  const none = projects !== null && data !== null && !(picked ? [picked] : projects).some((p) => p.lastScan || p.checks) && o.open === 0;
  // Only projects that were scanned (an agent's scan or the free checks) or have findings count here: a folder Liner Code
  // knows but never scanned is not news. Worst first, five at most, then "and N more".
  const scanned = (id: string) => {
    const p = projects?.find((x) => x.projectId === id);
    return !p || Boolean(p.lastScan || p.checks || p.open);
  };
  const rank = (c: SeverityCounts) => SEVERITIES.map((v) => String(999 - c[v]).padStart(3, "0")).join("");
  const byProject = o.byProject.filter((p) => p.open > 0 || scanned(p.projectId)).sort((a, b) => b.open - a.open || rank(a.bySeverity).localeCompare(rank(b.bySeverity)) || a.name.localeCompare(b.name));
  const pickable = (projects ?? []).filter((p) => p.lastScan || p.checks || p.open);
  const unscanned = (projects ?? []).length - pickable.length;
  const [everyProject, setEveryProject] = useState(false);

  return (
    <div className="ls-page">
      <PageTop title="Overview" sidebar={sidebar} onSidebar={onSidebar}>
        <Pop label="Period" menu width={200} align="end" triggerClass="lo-cb l-focus" trigger={<><Calendar />{`Last ${scope.days} days`}<I.chevD size={12} /></>}>
          {(close) => PERIODS.map((d) => <Row key={d} title={`Last ${d} days`} on={d === scope.days} onPick={() => (close(), setSecurityScope({ days: d }))} />)}
        </Pop>
        <Pop label="Project" menu width={240} align="end" triggerClass="lo-cb l-focus" trigger={<>{picked?.name ?? "All projects"}<I.chevD size={12} /></>}>
          {(close) => (
            <>
              <Row title="All projects" on={!scope.projectId} onPick={() => (close(), setSecurityScope({ projectId: undefined }))} />
              {(everyProject ? (projects ?? []) : (projects ?? []).filter((p) => pickable.includes(p) || p.projectId === scope.projectId)).map((p) => (
                <Row key={p.projectId} title={p.name} on={p.projectId === scope.projectId} onPick={() => (close(), setSecurityScope({ projectId: p.projectId }))} />
              ))}
              {/* Never-scanned folders wait behind one quiet row, so the menu stays short with many projects. */}
              {!everyProject && unscanned > 0 && <Row title={`${unscanned} not scanned yet`} note="Show them too" onPick={() => setEveryProject(true)} />}
            </>
          )}
        </Pop>
        <button type="button" className="lc-btn lo-go l-focus" data-kind="ink" data-size="sm" onClick={() => goSecurity({ kind: "start", ...(scope.projectId ? { projectId: scope.projectId } : {}) })}>
          Start a scan
        </button>
      </PageTop>
      <div className="ls-scroll">
        <div className="lo-col lo-ov" data-loading={data === null || undefined}>
          {error && data === null ? (
            <div className="ls-none">
              <b>The overview didn't load</b>
              <span>{error}</span>
            </div>
          ) : none ? (
            <Nothing picked={picked?.name} projectId={scope.projectId} />
          ) : (
            <>
              <Figures o={o} lastFixed={lastFixed} />
              <div className="lo-g2">
                <Card title="Open findings, day by day" end={<span className="lo-key"><i aria-hidden />a scan ran</span>}>
                  <OpenChart series={o.series} scans={scans ?? []} />
                </Card>
                <div className="lo-stack">
                  <Card title="Open, by how bad">
                    <SevSplit counts={o.bySeverity} />
                  </Card>
                  <Card title="Open, by the second look">
                    <LookSplit by={o.byLook} />
                  </Card>
                  <Card title="Open, by project" end={<button type="button" className="lo-lk l-focus" onClick={() => goSecurity({ kind: "projects" })}>All projects</button>}>
                    {byProject.length ? (
                      byProject.slice(0, 5).map((p) => (
                        <button key={p.projectId} type="button" className="lo-rw lo-sm l-focus" onClick={() => goSecurity({ kind: "projects", projectId: p.projectId })}>
                          <span className="lo-grow lo-ell">{p.name}</span>
                          <span className="lo-pf" data-quiet={!p.open || undefined}>
                            <SevBar counts={p.bySeverity} width={80} />
                            <b>{p.open}</b>
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="lo-q lo-pad">No project scanned in this period.</p>
                    )}
                    {byProject.length > 5 && (
                      <button type="button" className="lo-more l-focus" onClick={() => goSecurity({ kind: "projects" })}>
                        and {byProject.length - 5} more
                      </button>
                    )}
                  </Card>
                </div>
              </div>
              <div className="lo-g2">
                <Card title="Open, worst first" end={<button type="button" className="lo-lk l-focus" onClick={() => goSecurity({ kind: "findings" })}>All findings</button>}>
                  {o.worst.length ? o.worst.map((f) => <Worst key={f.id} f={f} />) : <p className="lo-q lo-pad">{data ? "Nothing open. The next scan's findings show here, worst first." : ""}</p>}
                </Card>
                <Card title="Free checks, no agent">
                  {CHECKS.map((c) => (
                    <div key={c} className="lo-rw lo-sm lo-chk">
                      <span className="lo-grow">{FREE_CHECK_LABEL[c]}</span>
                      <CheckState r={o.checks.find((r) => r.check === c)} />
                    </div>
                  ))}
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The figures: open now as the one large number, then four counts for the period, each named above it. */
function Figures({ o, lastFixed }: { o: SecurityOverview; lastFixed?: number }) {
  const threads = useEngine((s) => s.threads);
  const providers = useEngine((s) => s.providers);
  const diff = o.open - o.openWeekAgo;
  const where = o.byProject.filter((p) => p.open > 0);
  const inWhere = o.projectId ? "" : where.length === 1 ? `, all in ${where[0].name}` : where.length > 1 ? `, in ${plural(where.length, "project")}` : "";
  const trend = diff > 0 ? `${diff} more than a week ago` : diff < 0 ? `${-diff} fewer than a week ago` : o.open ? "the same as a week ago" : "nothing open";
  // The Dismissed note names the largest reason: all of them ("an accepted risk", "2 duplicates"), or most ("mostly false positives").
  const reasons = (Object.entries(o.dismissReasons).filter(([, n]) => n) as [DismissReason, number][]).sort((a, b) => b[1] - a[1]);
  const top = reasons[0];
  const dismissedNote = !o.dismissed || !top ? `none in ${o.days} days` : top[1] >= o.dismissed ? (top[1] === 1 ? REASON_ONE[top[0]] : REASON_MANY[top[0]](top[1])) : `mostly ${DISMISS_LABEL[top[0]].toLowerCase()}`;
  // Being fixed counts only fixes whose session still works (or waits on you); one whose session finished is ready to look
  // at, said on its own. The engine counts it so; a session that finished since its last answer is moved over here too.
  const fixThreads = o.fixThreads.map((id) => ({ id, t: threads.find((t) => t.id === id) }));
  const live = fixThreads.filter(({ t }) => !t || t.status === "running" || t.status === "waiting");
  const beingFixed = Math.max(0, o.beingFixed - (fixThreads.length - live.length));
  const ready = (o.fixesReady ?? 0) + (fixThreads.length - live.length);
  const fix = live[0]?.t;
  const readyNote = ready ? `${ready} ready to look at` : "";
  const working = !beingFixed ? "" : fix ? `${providerLabel((fix.model ?? fix.agent).replace(/^@/, ""), providers)}, ${fix.status === "waiting" ? "waiting on you" : "working"}` : beingFixed === 1 ? "one fix at work" : `${beingFixed} fixes at work`;
  const fixNote = [working, readyNote].filter(Boolean).join(", ") || "no fix at work";
  return (
    <section className="ls-card lo-figs" aria-label="Figures">
      <div className="lo-hero">
        <span className="lo-lb">Open findings</span>
        <b>{o.open}</b>
        <p>{`${trend}${inWhere}`}</p>
      </div>
      <div className="lo-tile">
        <span className="lo-lb">Found</span>
        <b>{o.found}</b>
        <small>{o.scans ? `by ${plural(o.scans, "scan")} in ${o.days} days` : `in ${o.days} days`}</small>
      </div>
      <div className="lo-tile">
        <span className="lo-lb">Fixed</span>
        <b>{o.fixed}</b>
        <small>{o.fixed && lastFixed ? `merged ${when(lastFixed)}` : `none in ${o.days} days`}</small>
      </div>
      <div className="lo-tile">
        <span className="lo-lb">Dismissed</span>
        <b>{o.dismissed}</b>
        <small>{dismissedNote}</small>
      </div>
      {fixThreads[0] ? (
        <button type="button" className="lo-tile lo-tile-go l-focus" onClick={() => goSecurity({ kind: "scan", threadId: (live[0] ?? fixThreads[0]).id })} aria-label={`Being fixed: ${beingFixed}${ready ? `, ${ready} ready to look at` : ""}. Open the fix session`}>
          <span className="lo-lb">Being fixed</span>
          <b>{beingFixed}</b>
          <small>{fixNote}</small>
        </button>
      ) : (
        <div className="lo-tile">
          <span className="lo-lb">Being fixed</span>
          <b>{beingFixed}</b>
          <small>{fixNote}</small>
        </div>
      )}
    </section>
  );
}

/** What the second look said of the open findings, as parts. */
function LookSplit({ by }: { by: Record<SecondLookState, number> }) {
  const parts: Part[] = useMemo(() => [
    { tone: "ok", value: by.confirmed, label: "Confirmed" },
    { tone: "no", value: by.unconfirmed, label: "Couldn't confirm" },
    { tone: "na", value: by.none, label: "Not looked at" },
  ], [by.confirmed, by.unconfirmed, by.none]);
  return (
    <>
      <Parts parts={parts} label="Open findings by the second look" />
      <Legend parts={parts} tight />
    </>
  );
}

/** Where a finding's tag comes from: the second look when there was one, else where it was found. */
function tagOf(f: SecurityFinding) {
  if (f.look.state === "confirmed") return <Tag tone="ok">Confirmed</Tag>;
  if (f.look.state === "unconfirmed") return <Tag>Couldn't confirm</Tag>;
  if (f.source === "checks") return <Tag>{/package(-lock)?\.json$|npm-shrinkwrap/.test(f.file ?? "") || /^GHSA-/i.test(f.rule ?? "") ? "npm audit" : "Free checks"}</Tag>;
  return <Tag>{f.source === "github" ? "GitHub" : f.source === "sarif" ? "SARIF" : "Not looked at"}</Tag>;
}

/** An open finding in a row: how bad, what, where, what the second look said. Opens it in Findings. */
function Worst({ f }: { f: SecurityFinding }) {
  const where = f.file ? `${f.file.split("/").pop()}${f.line ? `:${f.line}` : ""}` : "";
  return (
    <button type="button" className="lo-rw lo-c4 l-focus" onClick={() => goSecurity({ kind: "findings", finding: f.id })} aria-label={`${SEVERITY_LABEL[f.severity]}: ${f.title}${where ? `, ${where}` : ""}`}>
      <SevMark severity={f.severity} />
      <span className="lo-ell">{f.title}</span>
      <span className="lo-mono lo-q lo-ell" title={f.file}>{where}</span>
      {tagOf(f)}
    </button>
  );
}

/** A free check's latest result in a few words: "None found", "1, from npm audit", "no package-lock.json", "Not run". */
function CheckState({ r }: { r?: FreeCheckResult }) {
  if (!r) return <span className="lo-stt">Not run</span>;
  if (r.state === "clean") return <span className="lo-stt" data-tone="ok">{r.note ? `None found, ${r.note}` : "None found"}</span>;
  if (r.state === "found") return <span className="lo-stt">{r.note ? `${r.count}, ${r.note}` : `${r.count} found`}</span>;
  // Skipped or failed: the engine's note says why in a few plain words ("no package-lock.json", "npm not installed"), shown as it is.
  return <span className="lo-stt">{r.note || (r.state === "skipped" ? "Not checked" : "Didn't run")}</span>;
}

/** Nothing scanned yet: say so, and offer the first scan. */
function Nothing({ picked, projectId }: { picked?: string; projectId?: string }) {
  return (
    <div className="ls-card lo-empty">
      <span className="ls-disc"><I.shield size={16} /></span>
      <b>{picked ? `${picked} hasn't been scanned yet` : "No project has been scanned yet"}</b>
      <span>A scan reads your code for what someone could misuse. The free checks run on this Mac with no agent and cost nothing.</span>
      <button type="button" className="lc-btn l-focus" data-kind="ink" data-size="sm" onClick={() => goSecurity({ kind: "start", ...(projectId ? { projectId } : {}) })}>
        Start a scan
      </button>
    </div>
  );
}

/** The period picker's calendar, drawn on the app's 16px grid. */
function Calendar() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.75" y="3.5" width="10.5" height="9.75" rx="2" />
      <path d="M2.75 6.75h10.5M5.5 2.25v2.5M10.5 2.25v2.5" />
    </svg>
  );
}
