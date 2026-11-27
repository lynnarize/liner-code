/*
  Liner Security: Overview (board A). An infographic, each group in its own bordered box: the figures (what is open now,
  and what was found, fixed and dismissed in the period, and what is being fixed: that one opens its fix session), the open
  count day by day (OpenChart), three wholes split into parts (how bad, what the second look said, which project), the open
  findings worst first (a row opens it in Findings), and the free checks' latest results. The period and the project are
  picked in the top row and kept in the face's store, so Findings reads the same scope. Everything is security.overview,
  asked again whenever the engine says Security changed. Builder U1.
  Line and dot (2026-11-27, board Security): bordered boxes on a three-column grid. The figures and the day-by-day line
  share the wide box, with the red halftone in its corner while anything is open; the three splits stand in one box
  beside it; worst first and the free checks under them; a scan that runs is one strip with the dither of dots as its
  progress; then a card per scanned project.
*/
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DismissReason, FreeCheckId, FreeCheckResult, ScanRecord, SecondLookState, SecurityFinding, SecurityOverview, SecurityProject, SeverityCounts } from "@contracts";
import { DISMISS_LABEL, FREE_CHECK_LABEL, SEVERITIES, SEVERITY_LABEL, noSeverities } from "@contracts";
import { rpc, useEngine } from "../engine";
import { toast } from "@liner/components/toast/toast";
import { I, ModelMark, StateMark, StepMark } from "../icons";
import { PaneNote } from "../Pane";
import { modelLabel, plural, providerLabel, shortName, toolMarkOf } from "../model";
import { act, MOCK } from "./findings-data";
import { Pop, Row } from "../ui";
import { useSec } from "./data";
import { OpenChart } from "./OpenChart";
import { Card, Legend, PageTop, Parts, SevBar, SevMark, SevSplit, type Part } from "./parts";
import { addSecurityFolder, goSecurity, onSecurity, setSecurityScope, useSecurityProjects, useSecurityScope } from "./store";
import { fixedAt, when, whenShort } from "./when";
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
  // The scan that runs now (the newest, if several), as one strip; and a card for each project that was scanned or has
  // something open, in the order of the split above, three to a row.
  const running = scans?.filter((x) => x.state === "running" || x.state === "asking").sort((a, b) => b.startedAt - a.startedAt)[0];
  const cards = byProject.map((r) => projects?.find((p) => p.projectId === r.projectId)).filter((p): p is SecurityProject => Boolean(p));

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
          <I.shield size={14} />
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
            <div className="lo-grid">
              <Figures o={o} lastFixed={lastFixed}>
                <OpenChart series={o.series} scans={scans ?? []} />
              </Figures>
              <Card className="lo-splits" title="How bad">
                <SevSplit counts={o.bySeverity} />
                <div className="ls-blkh">A second look</div>
                <LookSplit by={o.byLook} />
                <div className="ls-blkh">
                  By project
                  <span className="ls-blkh-end">
                    <button type="button" className="lo-lk l-focus" onClick={() => goSecurity({ kind: "projects" })}>All projects</button>
                  </span>
                </div>
                {byProject.some((p) => p.open > 0) ? <ProjectSplit rows={byProject} /> : <p className="lo-q lo-pad">Nothing open in any project.</p>}
              </Card>
              <Card className="lo-wide lo-list" title="Worst first" end={<button type="button" className="lo-lk l-focus" onClick={() => goSecurity({ kind: "findings" })}>All findings<I.chevR size={12} /></button>}>
                {o.worst.length ? o.worst.map((f) => <Worst key={f.id} f={f} />) : <p className="lo-q lo-pad">{data ? "Nothing open. The next scan's findings show here, worst first." : ""}</p>}
              </Card>
              <Card className="lo-list" title={<>Free checks<span className="lo-q lo-hl-note">no agent, no cost</span></>}>
                {CHECKS.map((c) => {
                  const r = o.checks.find((r) => r.check === c);
                  return (
                    <div key={c} className="lo-wr lo-chk">
                      <CheckMark r={r} />
                      <span className="lo-grow">{FREE_CHECK_LABEL[c]}</span>
                      <CheckState r={r} />
                    </div>
                  );
                })}
              </Card>
              {running && <Running s={running} projects={projects ?? []} />}
              {cards.map((p) => <ProjectCard key={p.projectId} p={p} />)}
            </div>
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

/** The figures: open now as the one large number with what it means beside it, then four counts for the period, each
    named under it, and the day-by-day line (`children`) under them all; the red halftone in the box's corner while
    anything is open, since that is what wants you. */
function Figures({ o, lastFixed, children }: { o: SecurityOverview; lastFixed?: number; children?: ReactNode }) {
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
  const counts = (
    <>
      <span className="lo-ct" title={o.scans ? `by ${plural(o.scans, "scan")} in ${o.days} days` : `in ${o.days} days`}>
        <b>{o.found}</b>Found
      </span>
      <span className="lo-ct" title={o.fixed && lastFixed ? `merged ${when(lastFixed)}` : `none in ${o.days} days`}>
        <b>{o.fixed}</b>Fixed
      </span>
      <span className="lo-ct" title={dismissedNote}>
        <b>{o.dismissed}</b>Dismissed
      </span>
      {fixThreads[0] ? (
        <button type="button" className="lo-ct lo-ct-go l-focus" title={fixNote} onClick={() => goSecurity({ kind: "scan", threadId: (live[0] ?? fixThreads[0]).id })} aria-label={`Being fixed: ${beingFixed}${ready ? `, ${ready} ready to look at` : ""}. Open the fix session`}>
          <b>
            {beingFixed}
            {/* A fix at work says so with the working mark, as a row of a session that works does. */}
            {fix && fix.status === "running" && <StepMark state="working" size={12} live />}
          </b>
          Being fixed
        </button>
      ) : (
        <span className="lo-ct" title={fixNote}>
          <b>{beingFixed}</b>Being fixed
        </span>
      )}
    </>
  );
  return (
    <section className="ls-card lo-figs lo-wide" aria-label="Figures">
      {o.open > 0 && <i className="lc-ht lc-ht-corner lc-ht-bad lc-ht-soft lo-figs-ht" aria-hidden />}
      <div className="lo-figs-top">
        <b className="lo-big">{o.open}</b>
        <div className="lo-hero">
          <span>{o.open === 1 ? "open finding" : "open findings"}</span>
          <p>{`${trend}${inWhere}`}</p>
        </div>
        <span className="lo-grow" />
        <div className="lo-cts">{counts}</div>
      </div>
      {children}
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
      <Legend parts={parts} count={() => true} tight />
    </>
  );
}

/** Which projects the open findings are in, as a split: a colour per project (the first five, the rest as one part), its count in the key. */
const PROJECT_TONES = ["var(--lc-blue)", "var(--lc-merged)", "var(--l-ok)", "var(--lc-progress)", "var(--l-ink-3)"];
function ProjectSplit({ rows }: { rows: { projectId: string; name: string; open: number }[] }) {
  const open = rows.filter((r) => r.open > 0);
  const top = open.slice(0, 4);
  const rest = open.slice(4).reduce((n, r) => n + r.open, 0);
  const parts: Part[] = [...top.map((r, i): Part => ({ tone: `p${i}`, value: r.open, label: r.name, color: PROJECT_TONES[i] })), ...(rest ? [{ tone: "p4" as const, value: rest, label: `${open.length - 4} more`, color: PROJECT_TONES[4] }] : [])];
  return (
    <>
      <Parts parts={parts} label="Open findings by project" />
      <Legend parts={parts} count={() => true} tight />
    </>
  );
}

/** Where a finding stands after the second look, or where it came from when nobody looked again: a few words for its row's second line. */
function lookOf(f: SecurityFinding) {
  if (f.look.state === "confirmed") return "confirmed";
  if (f.look.state === "unconfirmed") return "couldn't confirm";
  if (f.source === "checks") return /package(-lock)?\.json$|npm-shrinkwrap/.test(f.file ?? "") || /^GHSA-/i.test(f.rule ?? "") ? "from npm audit" : "from the free checks";
  return f.source === "github" ? "from GitHub" : f.source === "sarif" ? "from a report" : "no second look yet";
}

/** An open finding in a row (board Security's Worst first): how bad as a tag, the title over its file in mono and what
    the second look said, then Fix, or how its fix stands. The row opens it in Findings. */
function Worst({ f }: { f: SecurityFinding }) {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
  const [busy, setBusy] = useState(false);
  const fix = () => {
    setBusy(true);
    act.fix(f.id).then((t) => (t ? goSecurity({ kind: "scan", threadId: t.id }) : MOCK && toast("Mock: the fix session would open here.")), (e) => toast.error(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  };
  return (
    <div className="lo-wr lo-wf">
      <button type="button" className="lo-wr-go l-focus" onClick={() => goSecurity({ kind: "findings", finding: f.id })} aria-label={`${SEVERITY_LABEL[f.severity]}: ${f.title}${where ? `, ${where}` : ""}`}>
        <SevMark severity={f.severity} />
        <span className="lo-tt">
          <b>{f.title}</b>
          <small>
            {where && <span className="lo-mono lo-ell" title={f.file}>{where}</span>}
            <span className="lo-ell">{where ? `· ${lookOf(f)}` : lookOf(f)}</span>
          </small>
        </span>
      </button>
      {f.fix?.state === "working" ? (
        <button type="button" className="lo-fixing l-focus" onClick={() => f.fix?.threadId && goSecurity({ kind: "scan", threadId: f.fix.threadId })}>
          <StepMark state="working" size={12} live />
          being fixed
        </button>
      ) : f.fix?.state === "ready" ? (
        <button type="button" className="lo-fixing l-focus" onClick={() => f.fix?.threadId && goSecurity({ kind: "scan", threadId: f.fix.threadId })}>
          <StepMark state="done" size={12} />
          fix ready
        </button>
      ) : (
        <button type="button" className="lc-btn l-focus" data-size="sm" disabled={busy} title="A session in its own worktree, with this as its brief" onClick={fix}>
          Fix
        </button>
      )}
    </div>
  );
}

/** A free check's mark: a tick when it found nothing, the amber box when it found something, a ring when it hasn't run or was skipped, a cross when it failed. */
function CheckMark({ r }: { r?: FreeCheckResult }) {
  if (r?.state === "found") return <StateMark state="needs" size={14} label="Found something" />;
  if (r?.state === "clean") return <StepMark state="done" size={14} />;
  if (r?.state === "failed") return <StepMark state="failed" size={14} />;
  return <StepMark state="waiting" size={14} label={r ? "Skipped" : "Not run"} />;
}

/** The scan that runs now, as one strip across the grid: its working mark, what it scans and how far it is, the dither of
    dots as its progress (the areas it has read of the project's threat model), Open and Stop. */
function Running({ s, projects }: { s: ScanRecord; projects: SecurityProject[] }) {
  const providers = useEngine((st) => st.providers);
  const p = projects.find((x) => x.projectId === s.projectId);
  const areas = p?.threatModel.areas.length ?? 0;
  const read = s.areasRead?.length ?? 0;
  const share = areas ? Math.min(1, Math.max(0.06, read / areas)) : 0;
  const ref = (s.reader ? (s.reader.kind === "own" ? (s.reader.model ?? s.reader.agent) : s.reader.model) : "").replace(/^@/, "");
  const who = ref ? `${providerLabel(ref, providers)}${s.reader?.kind === "own" && !s.reader.model ? "" : ` · ${shortName(modelLabel(ref, providers))}`} reads` : "";
  const line = [who, areas ? `${read} of ${plural(areas, "area")} read` : "", `${plural(s.counts.found, "finding")} so far`].filter(Boolean).join(". ");
  const [busy, setBusy] = useState(false);
  const stop = () => (setBusy(true), void rpc("security.scan.stop", { id: s.id }).catch((e) => toast.error(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)));
  return (
    <section className="ls-card lo-run" aria-label={`${s.title}, running`}>
      <StateMark state={s.state === "asking" ? "needs" : "working"} size={14} label={s.state === "asking" ? "Needs you" : "Working"} />
      <span className="lo-tt">
        <b>{s.state === "asking" ? `${s.title} asks you something` : `Scanning ${s.title}`}</b>
        <small>{line}</small>
      </span>
      {areas > 0 && (
        <span className="lo-run-track" role="img" aria-label={`${read} of ${areas} areas read`}>
          <span className="lc-ht lc-ht-fill lc-ht-prog" style={{ right: "auto", width: `${share * 100}%` }} />
        </span>
      )}
      {s.threadId && (
        <button type="button" className="lc-btn l-focus" data-size="sm" onClick={() => goSecurity({ kind: "scan", threadId: s.threadId! })}>
          Open
        </button>
      )}
      <button type="button" className="lc-btn l-focus" data-kind="outline" data-size="sm" disabled={busy} onClick={stop}>
        Stop
      </button>
    </section>
  );
}

/** One project's card: its tile and name with Scan, a thin bar of what is open by how bad, then its facts. */
function ProjectCard({ p }: { p: SecurityProject }) {
  const providers = useEngine((s) => s.providers);
  const reader = p.readers.find((r) => r !== "free checks");
  const ref = reader?.replace(/^@/, "") ?? "";
  const last = p.lastScan ? whenShort(p.lastScan.finishedAt ?? p.lastScan.startedAt) : "";
  return (
    <section className="ls-card lo-pc" aria-label={p.name}>
      <div className="ls-blkh lo-pc-h">
        <span className="lo-tile" aria-hidden>{p.name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "··"}</span>
        <button type="button" className="lo-pc-n l-focus" title={p.path} onClick={() => goSecurity({ kind: "projects", projectId: p.projectId })}>
          {p.name}
        </button>
        <span className="ls-blkh-end">
          <button type="button" className="lc-btn l-focus" data-size="sm" aria-label={`Scan ${p.name}`} onClick={() => goSecurity({ kind: "start", projectId: p.projectId })}>
            Scan
          </button>
        </span>
      </div>
      <SevBar counts={p.bySeverity} />
      <dl className="lo-kv">
        <div>
          <dt>Open</dt>
          <dd data-ink>{p.open}</dd>
        </div>
        <div>
          <dt>Last scan</dt>
          <dd>{last || "never"}</dd>
        </div>
        <div>
          <dt>Who scans it</dt>
          <dd>
            {ref ? (
              <>
                <ModelMark kind={toolMarkOf(ref.split(":")[0])} size={12} />
                <span className="lo-ell">{shortName(modelLabel(ref, providers)) || providerLabel(ref, providers)}</span>
              </>
            ) : p.readers.includes("free checks") ? (
              "free checks only"
            ) : (
              "nobody yet"
            )}
          </dd>
        </div>
        <div>
          <dt>Threat model</dt>
          <dd>{p.threatModel.exists ? plural(p.threatModel.areas.length, "area") : "not written yet"}</dd>
        </div>
      </dl>
    </section>
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
