/*
  Liner Security's sidebar body, in place of Code's sessions: Start a scan, Overview, Findings (how many are open) and
  Projects; then "Sessions" with its one menu, its scans, fixes and questions on the list parts every face shares
  (SideList.tsx): By folder (the default), each project a folder holding its own, those needing you first, then those
  working, then the newest; or By kind, under Scans, Fixes and Asked about. A row is Code's row (Rows.dc.html): the mark,
  the title and the time since it last did something; under it what its session is doing now, what it asks you in its own
  words, or how it ended, and at the line's end its facts (a question's speech mark, a fix's own worktree, the model, a
  fix's pull request's number in its state's colour). A row that waits on you is amber until you open it, then grey, as in
  Code's list (seenAsk), and only those not opened yet light a folded folder's dot. A fix or a question has one action,
  Archive, as its one button. Then Bring in: GitHub alerts through gh, a SARIF report file. None of these sessions shows in
  Code's list (Sidebar.tsx). Security's rule holds here: no line ends in "…", so titles wrap.
  Everything comes from the engine (security.side, and the threads and projects it already holds) and is asked again
  whenever Security changes.
*/
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ScanRecord, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "../engine";
import { I, N, type MarkKind } from "../icons";
import { agentOf, ago, clock, markOf, modelLabel, plural } from "../model";
import { SideFacts, SideFolder, SideHead, SideLabel, SideMark, SideRow, useWindowFocused, type SideState } from "../SideList";
import { askWords, markLabelOf, markStateOf, prSaid, reviewHeld, seenAsk, sideStateOf, type MarkState } from "../session-state";
import { PaneField } from "../Pane";
import { Row } from "../ui";
import { goSecurity, useSecurity, useSecurityPage, useSecurityProjects, type SecurityPage } from "./store";
import "./security.css";
import "./side.css";

/**
  How a scan that ended went, in a few words: "2 new findings", "Nothing new", "Stopped", "Ran into a problem". It counts what
  was new (counts.fresh), as the scan's own screen does; what was already open isn't news. The time is the row's own.
*/
const scanEnd = (s: ScanRecord) => (s.state === "stopped" ? "Stopped" : s.state === "failed" ? "Ran into a problem" : s.counts.fresh ? plural(s.counts.fresh, "new finding") : "Nothing new");

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
/** `seen`: it waits on you and you've opened it since, or are looking at it now, so it's no longer news (seenAsk). */
type Item = { key: string; projectId: string; rank: 0 | 1 | 2; at: number; state: SideState; seen?: boolean; brand?: MarkKind; row: ReactNode };

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
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  useMinute();
  const now = Date.now();
  const on = (kind: SecurityPage["kind"]) => (page.kind === kind ? "page" : undefined);
  // Archived fixes/asks are hidden by default unless the user toggles Show archived in the Sessions menu.
  const fixes = showArchived
    ? threads.filter((t) => !t.sideOf && t.archived && !hidden(t.projectId) && t.security?.kind === "fix").sort((a, b) => b.updatedAt - a.updatedAt)
    : (data?.fixes ?? []).map((id) => threads.find((t) => t.id === id)).filter((t): t is Thread => Boolean(t) && !t!.archived && !hidden(t!.projectId));
  // Sessions that ask about a finding, and a scan's fork (tagged as a scan but not one: it has no record of its own), so it
  // stays reachable: newest first, a few, quiet under their own label. Never a side chat.
  const asks = threads
    .filter((t) => !t.sideOf && Boolean(t.archived) === showArchived && !hidden(t.projectId) && (t.security?.kind === "ask" || (t.security?.kind === "scan" && (Boolean(t.forkOf) || !t.security.scan))))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, showArchived ? 20 : 8);
  // A session's model: its working light in the model's colour, and its mark among the row's facts, as Code's rows have them.
  const refOf = (t: Thread) => t.model ?? agentOf(t.agent, agents, providers).model;
  const brandOf = (t: Thread) => markOf(refOf(t));
  const opened = (threadId?: string) => Boolean(threadId) && page.kind === "scan" && page.threadId === threadId;
  // The open session in a focused window is being looked at: never amber, in its row or its folder (seenAsk).
  const focused = useWindowFocused();
  const looking = (threadId?: string) => focused && opened(threadId);

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
  const standing = (t: Thread): SideState => { const mark = sideStateOf(t); return mark === "new" ? "done" : mark; };
  /** A session's state mark, as Code's rows draw it (session-state.ts markStateOf): fresh until you open what finished while you were elsewhere, its pull request after. */
  const markFor = (t: Thread): MarkState => { const mark = markStateOf(t, { looking: looking(t.id) }); return mark === "new" ? "done" : mark; };
  /** The mark a row shows: a question you've opened and left is grey, its words grey too (seenAsk). */
  // No brand: a working mark is never tinted by its model (rule 7); the model is among the row's facts.
  const markOn = (state: SideState | MarkState, seen: boolean | undefined, _brand?: MarkKind, label?: string) => <SideMark state={seen ? "done" : state} label={seen ? "Waits for your answer" : label} />;
  /** A fix's or a question's second line while it works, waits or stopped; null when it has ended well. Worded as Code's rows word it (rowWords): a question in its own words. */
  const live = (t: Thread): { text: string; tone?: "warn" | "danger" } | null =>
    t.status === "running" ? { text: t.doing?.text || "Working" } : t.status === "waiting" && !reviewHeld(t) ? { text: askWords(t), tone: seenAsk(t, looking(t.id)) ? undefined : "warn" } : t.status === "limited" ? { text: `Hit its plan's limit${t.limit?.until ? `, back at ${clock(t.limit.until, now)}` : ""}`, tone: "warn" } : t.status === "error" ? { text: "Ran into a problem", tone: "danger" } : null;
  /** A session's facts, in the shared order: its own worktree, its model, its pull request's number. */
  const factsOf = (t: Thread, lead?: ReactNode) => (
    <>
      {lead}
      <SideFacts branch={t.worktree?.branch} model={brandOf(t)} modelName={modelLabel(refOf(t), providers)} pr={t.pr && { number: t.pr.number, tone: prSaid(t.pr).num, said: prSaid(t.pr).text }} />
    </>
  );
  /** A fix's or a question's one action: put away for good, with Undo, and a way back in Settings › Archive (Code's list leaves Security's sessions out). */
  const archive = (t: Thread) =>
    void rpc("thread.update", { id: t.id, archived: true }).then(
      () => toast(`Archived ${t.title}`, { action: { label: "Undo", onClick: () => void rpc("thread.update", { id: t.id, archived: false }) } }),
      (e: Error) => toast.error(e.message),
    );
  const archiveButton = (t: Thread) => (
    <button type="button" className="lc-sb-a l-focus" aria-label={`Archive ${t.title}`} title="Archive" onClick={() => archive(t)}>
      <I.box size={14} />
    </button>
  );

  const scanItem = (s: ScanRecord): Item => {
    const t = s.threadId ? threads.find((x) => x.id === s.threadId) : undefined;
    // A scan that ended is an ordinary chat: while you talk with it, its row says what its session does, not how the scan ended.
    const chat = s.state !== "running" && s.state !== "asking" && t && (t.status === "running" || (t.status === "waiting" && !reviewHeld(t))) ? t.status : undefined;
    const state: SideState = s.state === "running" || chat === "running" ? "working" : s.state === "asking" || chat === "waiting" ? "needs" : s.state === "stopped" || s.state === "failed" ? "error" : "done";
    // A free checks run has no session: nothing to say it's doing but the word.
    const sub = s.state === "running" || chat === "running" ? t?.doing?.text || "Working" : s.state === "asking" || chat === "waiting" ? (t ? askWords(t) : "Needs you") : scanEnd(s);
    const brand = t ? brandOf(t) : undefined;
    const current = opened(s.threadId);
    const seen = (s.state === "asking" || chat === "waiting") && Boolean(t && seenAsk(t, looking(t.id)));
    return {
      key: `scan:${s.id}`,
      projectId: s.projectId,
      rank: state === "needs" ? 0 : state === "working" ? 1 : 2,
      at: s.startedAt,
      state,
      seen,
      brand,
      row: (
        <SideRow
          key={`scan:${s.id}`}
          data-row={s.threadId}
          compact
          // One that waits on you and is not seen yet: its title in full ink, as Code's rows.
          loud={state === "needs" && !seen}
          current={current}
          quiet={state === "done"}
          aria-current={current ? "page" : undefined}
          mark={markOn(state === "done" && t?.unread && !looking(t.id) ? "fresh" : state, seen, brand, state === "error" ? (s.state === "stopped" ? "Stopped" : "Ran into a problem") : undefined)}
          title={s.title}
          ago={ago(t?.updatedAt ?? s.finishedAt ?? s.startedAt, now)}
          sub={sub}
          tone={state === "needs" && !seen ? "warn" : state === "error" && s.state === "failed" ? "danger" : undefined}
          facts={t && factsOf(t)}
          pick={opener(() => (s.threadId ? goSecurity({ kind: "scan", threadId: s.threadId }) : goSecurity({ kind: "findings", scan: s.id })))}
        />
      ),
    };
  };

  const fixItem = (t: Thread): Item => {
    const state = standing(t);
    const said = live(t) ?? (t.pr ? prSaid(t.pr) : { text: "Ready to look at" });
    const current = opened(t.id);
    const seen = state === "needs" && seenAsk(t, looking(t.id));
    return {
      key: `fix:${t.id}`,
      projectId: t.projectId,
      rank: state === "needs" ? 0 : state === "working" ? 1 : 2,
      at: t.createdAt,
      state,
      seen,
      brand: brandOf(t),
      row: (
        <SideRow
          key={`fix:${t.id}`}
          data-row={t.id}
          compact
          // One that waits on you and is not seen yet: its title in full ink, as Code's rows.
          loud={state === "needs" && !seen}
          current={current}
          quiet={state === "done"}
          aria-current={current ? "page" : undefined}
          mark={markOn(markFor(t), seen, brandOf(t), markLabelOf(t, markFor(t)))}
          title={t.title}
          ago={ago(t.updatedAt, now)}
          sub={said.text}
          tone={said.tone}
          facts={factsOf(t)}
          acts={archiveButton(t)}
          pick={opener(() => goSecurity({ kind: "scan", threadId: t.id }))}
        />
      ),
    };
  };

  const askItem = (t: Thread): Item => {
    const state = standing(t);
    const said = live(t) ?? { text: "Answered" };
    const current = opened(t.id);
    const seen = state === "needs" && seenAsk(t, looking(t.id));
    return {
      key: `ask:${t.id}`,
      projectId: t.projectId,
      rank: state === "needs" ? 0 : state === "working" ? 1 : 2,
      at: t.createdAt,
      state,
      seen,
      brand: brandOf(t),
      row: (
        <SideRow
          key={`ask:${t.id}`}
          data-row={t.id}
          compact
          // One that waits on you and is not seen yet: its title in full ink, as Code's rows.
          loud={state === "needs" && !seen}
          current={current}
          quiet={state === "done"}
          aria-current={current ? "page" : undefined}
          mark={markOn(markFor(t), seen, brandOf(t))}
          title={t.title}
          ago={ago(t.updatedAt, now)}
          sub={said.text}
          tone={said.tone}
          facts={factsOf(
            t,
            t.security?.kind === "ask" ? (
              <span className="lc-sl-fact" role="img" aria-label="A question about a finding">
                <I.comment size={14} />
              </span>
            ) : undefined,
          )}
          acts={archiveButton(t)}
          pick={opener(() => goSecurity({ kind: "scan", threadId: t.id }))}
        />
      ),
    };
  };

  const sq = search?.trim().toLowerCase() ?? "";
  const matchQ = (text: string, projectId: string) => {
    if (!sq) return true;
    const pname = projects.find((p) => p.id === projectId)?.name ?? "";
    return `${text}\n${pname}`.toLowerCase().includes(sq);
  };
  const scanItems = showArchived ? [] : (data?.scans ?? []).filter((s) => !hidden(s.projectId) && matchQ(s.title, s.projectId)).map(scanItem);
  const fixItems = fixes.filter((t) => matchQ(t.title, t.projectId)).map(fixItem);
  const askItems = asks.filter((t) => matchQ(t.title, t.projectId)).map(askItem);
  const all = [...scanItems, ...fixItems, ...askItems];

  // By folder: the projects in the engine's order, each holding its own; one whose project has gone is kept under its own name.
  const folders = [...projects.map((p) => ({ id: p.id, name: p.name })), ...[...new Set(all.map((x) => x.projectId))].filter((id) => !projects.some((p) => p.id === id)).map((id) => ({ id, name: "A removed project" }))]
    .map((p) => ({ ...p, items: all.filter((x) => x.projectId === p.id).sort((a, b) => a.rank - b.rank || b.at - a.at) }))
    .filter((p) => p.items.length > 0);

  return (
    <div className="ls-side">
      <div className="lc-sb-top">
        <button type="button" className="lc-sb-nav l-focus" aria-current={on("start")} onClick={() => goSecurity({ kind: "start" })}>
          <N.plus size={14} />
          <span>Start a scan</span>
        </button>
        <button type="button" className="lc-sb-nav l-focus" aria-current={on("overview")} onClick={() => goSecurity({ kind: "overview" })}>
          <N.shield size={14} />
          <span>Overview</span>
        </button>
        {/* The engine leaves the Sample project out of the count itself (Security.projects) unless the Demo is shown. */}
        <FindingsNav current={on("findings")} open={data?.open ?? 0} />
        <button type="button" className="lc-sb-nav l-focus" aria-current={on("projects")} onClick={() => goSecurity({ kind: "projects" })}>
          <N.folder size={14} />
          <span>Projects</span>
        </button>
      </div>

      <SideHead title="Sessions" note={showArchived ? "Archived" : view === "kind" ? "By kind" : undefined} menuLabel="What the list shows" filtering={search !== null} onFilter={() => setSearch((s) => (s === null ? "" : null))}>
        {(close) => (
          <>
            <Row title="By folder" icon={<I.folder size={16} />} keepIcon on={view === "folder"} onPick={() => (close(), pickView("folder"))} />
            <Row title="By kind" icon={<I.list size={16} />} keepIcon on={view === "kind"} onPick={() => (close(), pickView("kind"))} />
            <Row title="Show archived" icon={<I.box size={16} />} keepIcon on={showArchived} onPick={() => (close(), setShowArchived((a) => !a))} />
          </>
        )}
      </SideHead>
      {/* The app's one find field (PaneField), as the panel's and the Findings page's. */}
      {search !== null && (
        <PaneField className="lc-sb-filter" icon={<N.search size={14} />}>
          <input value={search} placeholder="Filter by title or project" aria-label="Filter the sessions by title or project" autoFocus onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), setSearch(null))} onBlur={(e) => !e.target.value.trim() && setSearch(null)} />
        </PaneField>
      )}

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
              <SideFolder key={p.id} compact name={p.name} count={p.items.length} open={!shut.includes(p.id)} onToggle={() => toggle(p.id)} needs={p.items.some((x) => x.state === "needs" && !x.seen)} working={Boolean(working)}>
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
        {/* Its two rows are the way in: a + offering the same two again would be a second control for one purpose. */}
        <SideLabel name="Bring in" />
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
      <N.findings size={14} />
      <span>Findings</span>
      {open > 0 && <span className="ls-num">{open}</span>}
    </button>
  );
}
/** FindingsNav while Liner Code holds the Demo's Sample project: security.side counts its open findings too, so they are taken off here. */
