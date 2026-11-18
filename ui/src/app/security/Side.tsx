/*
  Liner Security's sidebar body (board A), in place of Code's sessions: Start a scan, Overview, Findings (how many are open),
  Projects, and Try the running app (dimmed: later, does nothing); then Bring in (GitHub alerts through gh, a SARIF report
  file), Scans (newest first, with how each went), Fixes (the sessions fixing a finding) and Asked about (the sessions
  that ask about one, Read only). None of these sessions shows in Code's list (Sidebar.tsx). The rows are the app's own
  nav rows; the two-line rows are the mockup's, on the app's tokens. Everything comes from the engine (security.side) and
  is asked again whenever Security changes.
*/
import type { ScanRecord, Thread } from "@contracts";
import { useEngine } from "../engine";
import { I, N, Spinner } from "../icons";
import { plural } from "../model";
import { Pop, Row } from "../ui";
import { goSecurity, useSecurity, useSecurityPage, type SecurityPage } from "./store";
import { whenShort } from "./when";
import "./security.css";
import "./side.css";

/**
  How a scan went, in a few words: "2 new findings · 2h", "nothing new · yesterday", "asking you · now". It counts what was
  new (counts.fresh), as the scan's own screen does; what was already open isn't news. Kept short enough for the sidebar.
*/
export function scanNote(s: ScanRecord, now = Date.now()) {
  const when = whenShort(s.finishedAt ?? s.startedAt, now);
  const what = s.state === "running" ? "reading" : s.state === "asking" ? "asking you" : s.state === "stopped" ? "stopped" : s.state === "failed" ? "didn't finish" : s.counts.fresh ? plural(s.counts.fresh, "new finding") : "nothing new";
  return `${what} · ${when}`;
}

export function SecuritySide() {
  const page = useSecurityPage();
  const { data } = useSecurity("security.side", {});
  const threads = useEngine((s) => s.threads);
  const now = Date.now();
  const on = (kind: SecurityPage["kind"]) => (page.kind === kind ? "page" : undefined);
  const fixes = (data?.fixes ?? []).map((id) => threads.find((t) => t.id === id)).filter((t): t is Thread => Boolean(t));
  // Sessions that ask about a finding, and a scan's fork (tagged as a scan but not one: it has no record of its own), so it
  // stays reachable: newest first, a few, quiet under their own label. Never a side chat, never an archived session.
  const asks = threads.filter((t) => !t.sideOf && !t.archived && (t.security?.kind === "ask" || (t.security?.kind === "scan" && (Boolean(t.forkOf) || !t.security.scan)))).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  const state = (t: Thread) => (t.status === "running" ? "working" : t.status === "waiting" ? "waiting on you" : t.status === "error" ? "stopped" : null);
  return (
    <div className="ls-side">
      <div className="lc-sb-top">
        <button type="button" className="lc-sb-nav l-focus" aria-current={on("start")} onClick={() => goSecurity({ kind: "start" })}>
          <N.plus />
          <span>Start a scan</span>
        </button>
        <button type="button" className="lc-sb-nav l-focus" aria-current={on("overview")} onClick={() => goSecurity({ kind: "overview" })}>
          <N.shield />
          <span>Overview</span>
        </button>
        <button type="button" className="lc-sb-nav l-focus" aria-current={on("findings")} aria-label={`Findings, ${data?.open ?? 0} open`} onClick={() => goSecurity({ kind: "findings" })}>
          <N.findings />
          <span>Findings</span>
          {(data?.open ?? 0) > 0 && <span className="ls-num">{data!.open}</span>}
        </button>
        <button type="button" className="lc-sb-nav l-focus" aria-current={on("projects")} onClick={() => goSecurity({ kind: "projects" })}>
          <N.folder />
          <span>Projects</span>
        </button>
        {/* Later, and only against your own dev server on this Mac: shown so you know it's coming, does nothing. */}
        <button type="button" className="lc-sb-nav" data-later aria-disabled title="Later: trying the app you run on this Mac">
          <N.target />
          <span>Try the running app</span>
          <small>later</small>
        </button>
      </div>

      <div className="ls-lab">
        <span>Bring in</span>
        <Pop label="Bring findings in from another tool" menu width={240} align="end" triggerClass="lc-ib l-focus" trigger={<I.plus size={14} />}>
          {(close) => (
            <>
              <Row title="GitHub alerts" note="Dependabot and code scanning, through gh" icon={<I.branch size={14} />} onPick={() => (close(), goSecurity({ kind: "findings", source: "github" }))} />
              <Row title="A report file" note="A SARIF file from another scanner" icon={<I.file size={14} />} onPick={() => (close(), goSecurity({ kind: "findings", source: "sarif" }))} />
            </>
          )}
        </Pop>
      </div>
      <button type="button" className="ls-srow l-focus" onClick={() => goSecurity({ kind: "findings", source: "github" })}>
        <I.branch size={16} />
        <span className="ls-tl2">
          <b>GitHub alerts</b>
          <small>{!data ? "" : data.github.reach.installed ? (data.github.reach.signedIn ? `${data.github.open} open, read through gh` : "gh isn't signed in") : "needs gh, GitHub's tool"}</small>
        </span>
      </button>
      <button type="button" className="ls-srow l-focus" onClick={() => goSecurity({ kind: "findings", source: "sarif" })}>
        <I.file size={16} />
        <span className="ls-tl2">
          <b>A report file</b>
          <small>{data?.sarif.open ? `${data.sarif.open} open from reports` : "drop a SARIF file here"}</small>
        </span>
      </button>

      <div className="ls-lab">
        <span>Scans</span>
      </div>
      {data && !data.scans.length && <div className="ls-srow-none">No scans yet</div>}
      {(data?.scans ?? []).map((s) => (
        <button key={s.id} type="button" className="ls-srow l-focus" aria-current={page.kind === "scan" && page.threadId === s.threadId ? "page" : undefined} onClick={() => (s.threadId ? goSecurity({ kind: "scan", threadId: s.threadId }) : goSecurity({ kind: "projects", projectId: s.projectId }))}>
          {s.state === "running" || s.state === "asking" ? <span className="ls-ico"><Spinner size={16} /></span> : <I.settle size={16} />}
          <span className="ls-tl2">
            <b>{s.title}</b>
            <small>{scanNote(s, now)}</small>
          </span>
        </button>
      ))}

      {fixes.length > 0 && (
        <>
          <div className="ls-lab">
            <span>Fixes</span>
            <span className="ls-num">{fixes.length}</span>
          </div>
          {fixes.map((t) => (
            <button key={t.id} type="button" className="ls-srow lsd-two l-focus" aria-current={page.kind === "scan" && page.threadId === t.id ? "page" : undefined} onClick={() => goSecurity({ kind: "scan", threadId: t.id })}>
              {t.status === "running" ? <span className="ls-ico"><Spinner size={16} /></span> : <I.settle size={16} />}
              <span className="ls-tl2">
                <b>{t.title}</b>
                <small>{state(t) ?? `ready to look at · ${whenShort(t.updatedAt, now)}`}</small>
              </span>
            </button>
          ))}
        </>
      )}

      {asks.length > 0 && (
        <>
          <div className="ls-lab">
            <span>Asked about</span>
          </div>
          {asks.map((t) => (
            <button key={t.id} type="button" className="ls-srow lsd-two l-focus" aria-current={page.kind === "scan" && page.threadId === t.id ? "page" : undefined} onClick={() => goSecurity({ kind: "scan", threadId: t.id })}>
              {t.status === "running" ? <span className="ls-ico"><Spinner size={16} /></span> : <I.comment size={16} />}
              <span className="ls-tl2">
                <b>{t.title}</b>
                <small>{state(t) ?? whenShort(t.updatedAt, now)}</small>
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
