/*
  Liner Security's sidebar body, in place of Code's sessions: Start a scan, Overview, Findings (how many are open),
  Projects, and Try the running app (dimmed: later, does nothing); then "Sessions" with its one menu, its scans, fixes
  and questions on the list parts every face shares (SideList.tsx): By folder (the default), each project a folder
  holding its own, those needing you first, then those working, then the newest; or By kind, under Scans, Fixes and
  Asked about. A row's second line says what its session is reading now, or how it ended; a fix ends in its pull
  request's mark, a question in a speech mark. Then Bring in: GitHub alerts through gh, a SARIF report file. None of
  these sessions shows in Code's list (Sidebar.tsx). Security's rule holds here: no line ends in "…", so titles wrap.
  Everything comes from the engine (security.side, and the threads and projects it already holds) and is asked again
  whenever Security changes.
*/
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ScanRecord, Thread } from "@contracts";
import { useEngine } from "../engine";
import { I, N, type MarkKind } from "../icons";
import { agentOf, clock, markOf, plural } from "../model";
import { SideFolder, SideHead, SideLabel, SideMark, SideRow, type SideState } from "../SideList";
import { Pop, Row } from "../ui";
import { goSecurity, useSecurity, useSecurityPage, useSecurityProjects, type SecurityPage } from "./store";
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
/** scanNote as a line of its own begins: "2 new findings · 2h", "Nothing new · yesterday", "Didn't finish · 2h". */
export const scanLine = (s: ScanRecord, now = Date.now()) => {
  const note = scanNote(s, now);
  return note.charAt(0).toUpperCase() + note.slice(1);
};

/** What the list shows: every project's scans, fixes and questions in its folder, or each kind under its label. */
type View = "folder" | "kind";
const VIEW_KEY = "ls:sb-list";
const SHUT_KEY = "ls:sb-shut";

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "kind" ? "kind" : "folder";
  } catch {
    return "folder";
  }
}
function readShut(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SHUT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
const keep = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private window: the choice lasts until the window closes
  }
};

const prState = (state: string) => (state.toUpperCase() === "MERGED" ? "merged" : state.toUpperCase() === "CLOSED" ? "closed" : "open");

/** Draws again once a minute while the window is shown (and at once when it is shown again), so "2m" and "yesterday" stay true. */
function useMinute() {
  const [, setTick] = useState(0);
  useEffect(() => {
    let t = 0;
    const run = () => {
      window.clearInterval(t);
      t = 0;
      if (document.visibilityState === "hidden") return;
      setTick((n) => n + 1);
      t = window.setInterval(() => setTick((n) => n + 1), 60_000);
    };
    run();
    document.addEventListener("visibilitychange", run);
    return () => (window.clearInterval(t), document.removeEventListener("visibilitychange", run));
  }, []);
}

/** One row of the list, with what By folder sorts and folds it by: its project, how pressing it is (needs you, works, rests) and when it began. */
type Item = { key: string; projectId: string; rank: 0 | 1 | 2; at: number; state: SideState; brand?: MarkKind; row: ReactNode };

export function SecuritySide() {
  const page = useSecurityPage();
  // Asked again for what it shows: its scans, the open findings (GitHub's and reports' among them) and projects (gh's reach).
  const { data, error, loading } = useSecurity("security.side", {}, ["findings", "scans", "projects"]);
  const threads = useEngine((s) => s.threads);
  // Never the Demo's Sample project (store.ts useSecurityProjects): its scans, fixes and questions stay out of the list.
  const { list: projects, hidden } = useSecurityProjects();
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const [view, setView] = useState<View>(readView);
  const [shut, setShut] = useState<string[]>(readShut);
  useMinute();
  const now = Date.now();
  const on = (kind: SecurityPage["kind"]) => (page.kind === kind ? "page" : undefined);
  // Archived since the engine's answer (security.side leaves archived ones out, but isn't asked again when one is archived): left out here too.
  const fixes = (data?.fixes ?? []).map((id) => threads.find((t) => t.id === id)).filter((t): t is Thread => Boolean(t) && !t!.archived && !hidden(t!.projectId));
  // Sessions that ask about a finding, and a scan's fork (tagged as a scan but not one: it has no record of its own), so it
  // stays reachable: newest first, a few, quiet under their own label. Never a side chat, never an archived session.
  const asks = threads.filter((t) => !t.sideOf && !t.archived && !hidden(t.projectId) && (t.security?.kind === "ask" || (t.security?.kind === "scan" && (Boolean(t.forkOf) || !t.security.scan)))).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  // A session's spinner in its model's colour, as Code's rows have it.
  const brandOf = (t: Thread) => markOf(t.model ?? agentOf(t.agent, agents, providers).model);
  const opened = (threadId?: string) => Boolean(threadId) && page.kind === "scan" && page.threadId === threadId;

  const pickView = (v: View) => {
    setView(v);
    keep(VIEW_KEY, v);
  };
  const toggle = (id: string) =>
    setShut((list) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      keep(SHUT_KEY, JSON.stringify(next));
      return next;
    });

  /** A row that opens something: its words are one control, Enter and Space as a click. */
  const opener = (go: () => void) => ({
    role: "button",
    tabIndex: 0,
    className: "l-focus",
    onClick: go,
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if ((e.key !== "Enter" && e.key !== " ") || e.target !== e.currentTarget) return;
      e.preventDefault();
      go();
    },
  });

  /** A session's mark, from how it stands. */
  const standing = (t: Thread): SideState => (t.status === "running" ? "working" : t.status === "waiting" ? "needs" : t.status === "error" ? "error" : t.status === "limited" ? "limited" : "done");
  /** A fix's or a question's second line while it works, waits or stopped; null when it has ended well. Worded as Code's rows word it. */
  const live = (t: Thread, working: string): { text: string; tone?: "warn" | "danger" } | null =>
    t.status === "running" ? { text: t.doing?.text || working } : t.status === "waiting" ? { text: "Waits for your answer", tone: "warn" } : t.status === "limited" ? { text: `Hit its plan's limit${t.limit?.until ? `, back at ${clock(t.limit.until, now)}` : ""}`, tone: "warn" } : t.status === "error" ? { text: "Ran into a problem", tone: "danger" } : null;

  const scanItem = (s: ScanRecord): Item => {
    const t = s.threadId ? threads.find((x) => x.id === s.threadId) : undefined;
    const state: SideState = s.state === "running" ? "working" : s.state === "asking" ? "needs" : s.state === "stopped" || s.state === "failed" ? "error" : "done";
    // A free checks run has no session: nothing to say it's reading but the word.
    const sub = s.state === "running" ? t?.doing?.text || "Reading" : s.state === "asking" ? "Asking you" : scanLine(s, now);
    const brand = t ? brandOf(t) : undefined;
    const current = opened(s.threadId);
    return {
      key: `scan:${s.id}`,
      projectId: s.projectId,
      rank: state === "needs" ? 0 : state === "working" ? 1 : 2,
      at: s.startedAt,
      state,
      brand,
      row: (
        <SideRow
          key={`scan:${s.id}`}
          wrap
          current={current}
          quiet={state === "done"}
          aria-current={current ? "page" : undefined}
          mark={<SideMark state={state} brand={brand} label={state === "error" ? (s.state === "stopped" ? "Stopped" : "Didn't finish") : undefined} />}
          title={s.title}
          sub={sub}
          tone={s.state === "asking" ? "warn" : undefined}
          pick={opener(() => (s.threadId ? goSecurity({ kind: "scan", threadId: s.threadId }) : goSecurity({ kind: "projects", projectId: s.projectId })))}
        />
      ),
    };
  };

  const fixItem = (t: Thread): Item => {
    const state = standing(t);
    const pr = t.pr ? prState(t.pr.state) : undefined;
    const said = live(t, "Working") ?? (pr ? { text: `PR ${pr}` } : { text: `Ready to look at · ${whenShort(t.updatedAt, now)}` });
    const current = opened(t.id);
    return {
      key: `fix:${t.id}`,
      projectId: t.projectId,
      rank: state === "needs" ? 0 : state === "working" ? 1 : 2,
      at: t.createdAt,
      state,
      brand: brandOf(t),
      row: (
        <SideRow
          key={`fix:${t.id}`}
          wrap
          current={current}
          quiet={state === "done"}
          aria-current={current ? "page" : undefined}
          mark={<SideMark state={state} brand={brandOf(t)} />}
          title={t.title}
          sub={said.text}
          tone={said.tone}
          end={
            t.pr && (
              <span className="lc-sl-pr" data-pr={pr} role="img" aria-label={`A fix, its pull request #${t.pr.number} ${pr}`}>
                <I.pr size={14} />
              </span>
            )
          }
          pick={opener(() => goSecurity({ kind: "scan", threadId: t.id }))}
        />
      ),
    };
  };

  const askItem = (t: Thread): Item => {
    const state = standing(t);
    const said = live(t, "Working") ?? { text: `Answered · ${whenShort(t.updatedAt, now)}` };
    const current = opened(t.id);
    return {
      key: `ask:${t.id}`,
      projectId: t.projectId,
      rank: state === "needs" ? 0 : state === "working" ? 1 : 2,
      at: t.createdAt,
      state,
      brand: brandOf(t),
      row: (
        <SideRow
          key={`ask:${t.id}`}
          wrap
          current={current}
          quiet={state === "done"}
          aria-current={current ? "page" : undefined}
          mark={<SideMark state={state} brand={brandOf(t)} />}
          title={t.title}
          sub={said.text}
          tone={said.tone}
          end={
            t.security?.kind === "ask" ? (
              <span className="lc-sl-chg" role="img" aria-label="A question about a finding">
                <I.comment size={14} />
              </span>
            ) : undefined
          }
          pick={opener(() => goSecurity({ kind: "scan", threadId: t.id }))}
        />
      ),
    };
  };

  const scanItems = (data?.scans ?? []).filter((s) => !hidden(s.projectId)).map(scanItem);
  const fixItems = fixes.map(fixItem);
  const askItems = asks.map(askItem);
  const all = [...scanItems, ...fixItems, ...askItems];

  // By folder: the projects in the engine's order, each holding its own; one whose project has gone is kept under its own name.
  const folders = [...projects.map((p) => ({ id: p.id, name: p.name })), ...[...new Set(all.map((x) => x.projectId))].filter((id) => !projects.some((p) => p.id === id)).map((id) => ({ id, name: "A removed project" }))]
    .map((p) => ({ ...p, items: all.filter((x) => x.projectId === p.id).sort((a, b) => a.rank - b.rank || b.at - a.at) }))
    .filter((p) => p.items.length > 0);

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
        {/* The engine leaves the Sample project out of the count itself (Security.projects) unless the Demo is shown. */}
        <FindingsNav current={on("findings")} open={data?.open ?? 0} />
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

      <SideHead title="Sessions" note={view === "kind" ? "By kind" : undefined} menuLabel="What the list shows">
        {(close) => (
          <>
            <Row title="By folder" icon={<I.folder size={14} />} keepIcon on={view === "folder"} onPick={() => (close(), pickView("folder"))} />
            <Row title="By kind" icon={<I.list size={14} />} keepIcon on={view === "kind"} onPick={() => (close(), pickView("kind"))} />
          </>
        )}
      </SideHead>

      <div className="ls-side-list lc-sl-list">
        {/* Not answered yet, or not at all: said in the list's place, never a blank list. */}
        {!data && error && (
          <p className="ls-side-none" role="alert">
            Couldn't read Security: {error}
          </p>
        )}
        {!data && !error && loading && (
          <p className="ls-side-none">
            <span className="l-shimmer">Reading Security</span>
          </p>
        )}
        {view === "folder" && data && !all.length && <p className="ls-side-none">No scans yet</p>}
        {view === "folder" &&
          folders.map((p) => {
            const working = p.items.find((x) => x.state === "working");
            return (
              <SideFolder key={p.id} name={p.name} count={p.items.length} open={!shut.includes(p.id)} onToggle={() => toggle(p.id)} needs={p.items.some((x) => x.state === "needs")} working={Boolean(working)} brand={working?.brand}>
                {p.items.map((x) => x.row)}
              </SideFolder>
            );
          })}
        {view === "kind" && (
          <>
            {(scanItems.length > 0 || data) && (
              <section aria-label="Scans">
                <SideLabel name="Scans" count={scanItems.length || undefined} />
                {scanItems.length ? scanItems.map((x) => x.row) : <p className="ls-side-none">No scans yet</p>}
              </section>
            )}
            {fixItems.length > 0 && (
              <section aria-label="Fixes">
                <SideLabel name="Fixes" count={fixItems.length} />
                {fixItems.map((x) => x.row)}
              </section>
            )}
            {askItems.length > 0 && (
              <section aria-label="Asked about">
                <SideLabel name="Asked about" count={askItems.length} />
                {askItems.map((x) => x.row)}
              </section>
            )}
          </>
        )}
      </div>

      <section className="ls-side-bring" aria-label="Bring in">
        <SideLabel
          name="Bring in"
          end={
            <Pop label="Bring findings in from another tool" menu width={240} align="end" triggerClass="lc-ib ls-side-add l-focus" trigger={<I.plus size={14} />}>
              {(close) => (
                <>
                  <Row title="GitHub alerts" note="Dependabot and code scanning, through gh" icon={<I.branch size={14} />} onPick={() => (close(), goSecurity({ kind: "findings", source: "github" }))} />
                  <Row title="A report file" note="A SARIF file from another scanner" icon={<I.file size={14} />} onPick={() => (close(), goSecurity({ kind: "findings", source: "sarif" }))} />
                </>
              )}
            </Pop>
          }
        />
        <SideRow
          wrap
          quiet
          mark={<I.branch size={14} />}
          title="GitHub alerts"
          sub={!data ? undefined : data.github.reach.installed ? (data.github.reach.signedIn ? `${data.github.open} open, read through gh` : "Not signed in to gh") : "Needs gh, GitHub's tool"}
          pick={opener(() => goSecurity({ kind: "findings", source: "github" }))}
        />
        <SideRow wrap quiet mark={<I.file size={14} />} title="A report file" sub={data?.sarif.open ? `${data.sarif.open} open from reports` : "Pick a SARIF file to bring in"} pick={opener(() => goSecurity({ kind: "findings", source: "sarif" }))} />
      </section>
    </div>
  );
}

/** Findings in the sidebar's top, with how many are open. */
function FindingsNav({ current, open }: { current?: "page"; open: number }) {
  return (
    <button type="button" className="lc-sb-nav l-focus" aria-current={current} aria-label={`Findings, ${open} open`} onClick={() => goSecurity({ kind: "findings" })}>
      <N.findings />
      <span>Findings</span>
      {open > 0 && <span className="ls-num">{open}</span>}
    </button>
  );
}
/** FindingsNav while Liner Code holds the Demo's Sample project: security.side counts its open findings too, so they are taken off here. */
