/*
  Liner Security: Overview (board A). An infographic, each group in its own bordered box: the figures (what is open now,
  and what was found, fixed and dismissed in the period, and what is being fixed: that one opens its fix session), the open
  count day by day (OpenChart), three wholes split into parts (how bad, what the second look said, which project), the open
  findings worst first (a row opens it in Findings), and the free checks' latest results. The period and the project are
  picked in the top row and kept in the face's store, so Findings reads the same scope. Everything is security.overview,
  asked again whenever the engine says Security changed. Builder U1.
*/
import { useEffect, useMemo, useState } from "react";
import type { DismissReason, FreeCheckId, FreeCheckResult, SecondLookState, SecurityFinding, SecurityOverview, SecurityProject, SeverityCounts } from "@contracts";
import { DISMISS_LABEL, FREE_CHECK_LABEL, SEVERITIES, SEVERITY_LABEL, noSeverities } from "@contracts";
import { rpc, useEngine } from "../engine";
import { I, StepMark } from "../icons";
import { PaneNote } from "../Pane";
import { plural, providerLabel } from "../model";
import { Pop, Row } from "../ui";
import { useSec } from "./data";
import { OpenChart } from "./OpenChart";
import { Card, Legend, PageTop, Parts, SevBar, SevMark, SevSplit, Tag, type Part } from "./parts";
import { addSecurityFolder, goSecurity, onSecurity, setSecurityScope, useSecurityProjects, useSecurityScope } from "./store";
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
  const stored = useSecurityScope();
  // The Demo's Sample project is never one of Security's (store.ts useSecurityProjects): left out of every list here, and
  // never the project picked, so a scope left on it reads as All projects.
  const { hidden } = useSecurityProjects();
  const scope = hidden(stored.projectId) ? { ...stored, projectId: undefined } : stored;
  const { data: whole, error } = useSec("security.overview", { days: scope.days, ...(scope.projectId ? { projectId: scope.projectId } : {}) });
  const { data: everyOne } = useSec("security.projects", {});
  const projects = useMemo(() => everyOne?.filter((p) => !hidden(p.projectId)) ?? null, [everyOne, hidden]);
  // Across every project the engine still counts the Sample project in (its byProject lists it): its own overview is taken
  // off the figures, so they add up to the rows shown. Once the engine leaves it out, nothing is asked or taken off.
  const leftOut = !scope.projectId ? whole?.byProject.find((p) => hidden(p.projectId))?.projectId : undefined;
  const out = useOverviewOf(scope.days, leftOut);
  const data = useMemo(() => (!whole || !leftOut ? whole : out ? less(whole, out, projects ?? []) : null), [whole, leftOut, out, projects]);
  const { data: allScans } = useSec("security.scans.list", scope.projectId ? { projectId: scope.projectId } : {}, ["scans"]);
  const scans = useMemo(() => allScans?.filter((s) => !hidden(s.projectId)) ?? null, [allScans, hidden]);
  // A fixed finding's time is read from the finding itself (when.ts fixedAt), as its row in Findings reads it, so both agree.
  const { data: fixedAll } = useSec("security.findings.list", { ...(scope.projectId ? { projectId: scope.projectId } : {}), state: "fixed" }, ["findings"]);
  const fixedList = fixedAll?.filter((f) => !hidden(f.projectId));
  const o = useMemo(() => {
    const x = data ?? blank(scope.days);
    return { ...x, byProject: x.byProject.filter((p) => !hidden(p.projectId)), worst: x.worst.filter((f) => !hidden(f.projectId)) };
  }, [data, scope.days, hidden]);
  const lastFixed = fixedList?.length ? Math.max(...fixedList.map(fixedAt)) : o.lastFixedAt;
  const picked = projects?.find((p) => p.projectId === scope.projectId);
  // Nothing was ever scanned or checked anywhere (or in the project picked): say so and offer a scan, in place of empty boxes.
  // With no project of yours at all (the Sample project never counts), the same, worded as adding one.
  const none = projects !== null && data !== null && (!projects.length || (!(picked ? [picked] : projects).some((p) => p.lastScan || p.checks) && o.open === 0));
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
        <Pop label="Period" menu width={200} align="end" triggerClass="lo-cb l-focus" trigger={<><I.calendar size={14} />{`Last ${scope.days} days`}<I.chevD size={12} /></>}>
          {(close) => PERIODS.map((d) => <Row key={d} title={`Last ${d} days`} on={d === scope.days} onPick={() => (close(), setSecurityScope({ days: d }))} />)}
        </Pop>
        <Pop label="Project" menu width={240} align="end" triggerClass="lo-cb l-focus" trigger={<><span className="lc-strip-cap">{picked?.name ?? "All projects"}</span><I.chevD size={12} /></>}>
          {(close) => (
            <>
              <Row title="All projects" on={!scope.projectId} onPick={() => (close(), setSecurityScope({ projectId: undefined }))} />
              {(everyProject ? (projects ?? []) : (projects ?? []).filter((p) => pickable.includes(p) || p.projectId === scope.projectId)).map((p) => (
                <Row key={p.projectId} title={p.name} on={p.projectId === scope.projectId} onPick={() => (close(), setSecurityScope({ projectId: p.projectId }))} />
              ))}
              {/* Never-scanned folders wait behind one quiet row, so the menu stays short with many projects. */}
              {!everyProject && unscanned > 0 && <Row title={`${unscanned} not scanned yet`} note="Show them too" icon={<I.chevD size={16} />} onPick={() => setEveryProject(true)} />}
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
            <PaneNote icon={<I.shield size={16} />} title="The overview didn't load">{error}</PaneNote>
          ) : none ? (
            <Nothing picked={picked?.name} projectId={scope.projectId} noProject={!projects?.length} />
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

/** One project's overview, asked only while `projectId` is set, and again (at most once in 150 ms) whenever Security changes. */
function useOverviewOf(days: number, projectId: string | undefined): SecurityOverview | null {
  const key = projectId ? `${days} ${projectId}` : "";
  const [got, setGot] = useState<{ key: string; o: SecurityOverview } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    rpc("security.overview", { days, projectId }).then((o) => live && setGot({ key, o }), () => {});
    return () => void (live = false);
  }, [key, tick]);
  useEffect(() => {
    if (!projectId) return;
    let soon = 0;
    const off = onSecurity(() => void (soon ||= window.setTimeout(() => ((soon = 0), setTick((n) => n + 1)), 150)));
    return () => (off(), clearTimeout(soon));
  }, [projectId]);
  return got?.key === key ? got.o : null;
}

/** The free checks' latest result for each check across `ps`, read as the engine reads it: one that found something says more. */
function checksOf(ps: SecurityProject[]): FreeCheckResult[] {
  const latest = new Map<FreeCheckId, FreeCheckResult>();
  for (const p of ps) for (const r of p.checks?.results ?? []) {
    const had = latest.get(r.check);
    if (!had || (r.state === "found" && had.state !== "found") || (r.state === had.state && r.at > had.at)) latest.set(r.check, had && r.state === "found" && had.state === "found" ? { ...r, count: had.count + r.count } : r);
  }
  return [...latest.values()];
}

/** The overview across every project less one project's own (`out`): its counts taken off, day by day too; the checks read again from the projects kept. */
function less(all: SecurityOverview, out: SecurityOverview, kept: SecurityProject[]): SecurityOverview {
  const sub = (a = 0, b = 0) => Math.max(0, a - b);
  const sev = (a: SeverityCounts, b: SeverityCounts) => Object.fromEntries(SEVERITIES.map((v) => [v, sub(a[v], b[v])])) as SeverityCounts;
  const reasons = { ...all.dismissReasons };
  for (const [k, n] of Object.entries(out.dismissReasons) as [DismissReason, number][]) reasons[k] = sub(reasons[k], n);
  const theirs = new Map(out.series.map((d) => [d.day, d]));
  const series = all.series.map((d) => {
    const o = theirs.get(d.day);
    if (!o) return d;
    const scans = [...d.scans];
    for (const x of o.scans) {
      const i = scans.indexOf(x);
      if (i >= 0) scans.splice(i, 1);
    }
    return { ...d, open: sub(d.open, o.open), found: sub(d.found, o.found), fixed: sub(d.fixed, o.fixed), dismissed: sub(d.dismissed, o.dismissed), scans };
  });
  const threads = new Set(out.fixThreads);
  const fixed = sub(all.fixed, out.fixed);
  return {
    ...all,
    open: sub(all.open, out.open),
    openWeekAgo: sub(all.openWeekAgo, out.openWeekAgo),
    found: sub(all.found, out.found),
    scans: sub(all.scans, out.scans),
    fixed,
    lastFixedAt: fixed ? all.lastFixedAt : undefined,
    dismissed: sub(all.dismissed, out.dismissed),
    dismissReasons: reasons,
    beingFixed: sub(all.beingFixed, out.beingFixed),
    fixThreads: all.fixThreads.filter((t) => !threads.has(t)),
    fixesReady: sub(all.fixesReady, out.fixesReady),
    series,
    bySeverity: sev(all.bySeverity, out.bySeverity),
    byLook: { confirmed: sub(all.byLook.confirmed, out.byLook.confirmed), unconfirmed: sub(all.byLook.unconfirmed, out.byLook.unconfirmed), none: sub(all.byLook.none, out.byLook.none) },
    checks: checksOf(kept),
  };
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
          <small>
            {/* A fix at work says so with the working mark, as a row of a session that works does. */}
            {fix && fix.status === "running" && <StepMark state="working" size={12} />}
            {fixNote}
          </small>
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

/** Nothing scanned yet: say so, and offer the first scan; with no project at all, the way to add one. */
function Nothing({ picked, projectId, noProject }: { picked?: string; projectId?: string; noProject?: boolean }) {
  const { hidden } = useSecurityProjects();
  const addFolder = async () => {
    const id = await addSecurityFolder(hidden);
    if (id) goSecurity({ kind: "projects", projectId: id });
  };
  if (noProject)
    return (
      <PaneNote
        icon={<I.folder size={16} />}
        title="No project to scan yet"
        action={
          <button type="button" className="lc-btn l-focus" data-kind="ink" data-size="sm" onClick={() => void addFolder()}>
            Add a project
          </button>
        }
      >
        Add a folder you work on, then scan it. A scan reads your code for what someone could misuse; the free checks run on this Mac with no agent and cost nothing.
      </PaneNote>
    );
  return (
    <PaneNote
      icon={<I.shield size={16} />}
      title={picked ? `${picked} hasn't been scanned yet` : "No project has been scanned yet"}
      action={
        <button type="button" className="lc-btn l-focus" data-kind="ink" data-size="sm" onClick={() => goSecurity({ kind: "start", ...(projectId ? { projectId } : {}) })}>
          Start a scan
        </button>
      }
    >
      A scan reads your code for what someone could misuse. The free checks run on this Mac with no agent and cost nothing.
    </PaneNote>
  );
}
