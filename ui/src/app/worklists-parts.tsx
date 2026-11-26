/*
  What the Pull requests and Issues pages share (boards PullRequests, ScanDone and Issues, 2026-11-26): the page's head
  ("Pull requests · 6 open in 3 projects"), its toolbar (the search field, All projects, the state, the sort and filter
  menu, Look again), a group's label, a row's avatar and labels, the detail column with its head, facts and foot, the
  "Checked against the code" card, a project that couldn't be read, and how a session starts from either.
  Rows are a pick button (the words) beside the scan chip (security/ScanChip.tsx), so no button sits in another.
  Styles: worklists.css (class prefix lc-wl-).
*/
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { IssueItem, PrItem, ScanSummary, ScanTarget, SecurityFinding } from "@contracts";
import { targetKey } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "./bridge";
import { getState, onStream, rpc, subscribe, useEngine } from "./engine";
import { I, wt } from "./icons";
import { codeProjects, since } from "./model";
import { PanelHead, Pop, Row, Sep, ShowSidebar } from "./ui";
import { openSession } from "./Addon";
import { avatarOf, headShaOf, labelColor, prStart } from "./worklists-logic";
import "./worklists.css";

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/* ---------- Marks ---------- */

const PR_TINT: Record<PrItem["state"], string> = { open: "var(--l-ok-text)", draft: "var(--l-ink-4)", merged: "var(--lc-merged)", closed: "var(--l-danger-text)" };
export const PR_WORD: Record<PrItem["state"], string> = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };
/** A pull request's state as its mark: open green, a draft grey, merged purple, closed red. */
export function PrMark({ state, size = 16 }: { state: PrItem["state"]; size?: number }) {
  return state === "merged" ? <I.merge size={size} style={{ color: PR_TINT.merged }} /> : <I.pr size={size} style={{ color: PR_TINT[state] }} />;
}
/** An issue's mark, a ringed dot: open green, closed purple (GitHub's own). */
export function IssueMark({ state, size = 16 }: { state: IssueItem["state"]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={wt(size, 16)} aria-hidden style={{ color: state === "open" ? "var(--l-ok-text)" : "var(--lc-merged)", flex: "none" }}>
      <circle cx="8" cy="8" r="5.75" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}
/** Someone's initial on a soft disc of their own colour, then their name. */
export function Who({ name, small }: { name: string; small?: boolean }) {
  const a = avatarOf(name);
  return (
    <span className="lc-wl-who" data-small={small || undefined}>
      <span className="lc-wl-av" style={{ background: `oklch(0.82 0.09 ${a.hue})` }} aria-hidden>
        {a.letter}
      </span>
      <span>{name}</span>
    </span>
  );
}

/** A label on its ring, in GitHub's colour for it when it has one. */
export function Label({ name, color }: { name: string; color?: string }) {
  const c = labelColor(color);
  return (
    <span className="lc-wl-lbl" style={c ? ({ "--lbl": c } as React.CSSProperties) : undefined}>
      {name}
    </span>
  );
}

/* ---------- The page's head and toolbar ---------- */

/** The page's top row: Show the sidebar while it's hidden, the page's name and how many it shows. */
export function WorkHead({ title, count, sidebar, onSidebar }: { title: string; count?: string; sidebar: boolean; onSidebar: () => void }) {
  return (
    <header className="lc-top lc-wl-top" data-drag>
      {!sidebar && <ShowSidebar onShow={onSidebar} />}
      <h1 className="lc-wl-title">{title}</h1>
      {count && <span className="lc-wl-count">{count}</span>}
      <span className="lc-grow" data-drag />
    </header>
  );
}

export type Choice<T extends string> = { value: T; label: string };

/** A chip that opens a short menu of choices, its pick ticked: All projects, Open. */
export function ChoiceChip<T extends string>({ label, value, choices, onPick, width = 220 }: { label: string; value: T; choices: Choice<T>[]; onPick: (v: T) => void; width?: number }) {
  const now = choices.find((c) => c.value === value) ?? choices[0];
  return (
    <Pop label={`${label}: ${now.label}`} menu width={width} triggerClass="lc-wl-chip" trigger={<><span>{now.label}</span><I.chevD size={12} /></>}>
      {(close) => (
        <div className="lc-sb-menu">
          {choices.map((c) => (
            <Row key={c.value} title={c.label} keepIcon on={c.value === value} onPick={() => (close(), onPick(c.value))} />
          ))}
        </div>
      )}
    </Pop>
  );
}

/** The projects a list can be narrowed to: your code projects, by name. */
export function useProjectChoices(): Choice<string>[] {
  const projects = useEngine((s) => s.projects);
  return [{ value: "", label: "All projects" }, ...codeProjects(projects).map((p) => ({ value: p.id, label: p.name }))];
}

/**
  The toolbar under the head: the search field (/ or ⌘F puts the keyboard in it), the project, the state, the sort and
  quick filters, and Look again. `filters` are words the menu puts in the search or takes out (is:draft, is:mine).
*/
export function Toolbar<S extends string, O extends string>({ field, q, onQ, placeholder, project, onProject, state, states, onState, sort, sorts, onSort, filters, looking, onLook }: {
  field: RefObject<HTMLInputElement | null>;
  q: string;
  onQ: (q: string) => void;
  placeholder: string;
  project: string;
  onProject: (id: string) => void;
  state: S;
  states: Choice<S>[];
  onState: (s: S) => void;
  sort: O;
  sorts: Record<O, string>;
  onSort: (o: O) => void;
  filters: { word: string; label: string }[];
  looking: boolean;
  onLook: () => void;
}) {
  const projects = useProjectChoices();
  const has = (w: string) => q.split(/\s+/).includes(w);
  const toggle = (w: string) => onQ(has(w) ? q.split(/\s+/).filter((x) => x && x !== w).join(" ") : `${q.trim()} ${w}`.trim());
  return (
    <div className="lc-wl-tools">
      <label className="lc-wl-field">
        <I.search size={14} />
        <input
          ref={field}
          value={q}
          placeholder={placeholder}
          aria-label={placeholder}
          spellCheck={false}
          onChange={(e) => onQ(e.target.value)}
          onKeyDown={(e) => {
            // ↓ goes on into the list's first row.
            if (e.key === "ArrowDown") {
              const first = e.currentTarget.closest(".lc-wl-main")?.querySelector<HTMLElement>(".lc-wl-pick");
              if (first) {
                e.preventDefault();
                first.focus();
              }
              return;
            }
            // Escape empties the field first, then gives the keyboard back to the list.
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            if (q) onQ("");
            else e.currentTarget.blur();
          }}
        />
      </label>
      <ChoiceChip label="Which projects" value={project} choices={projects} onPick={onProject} width={240} />
      <ChoiceChip label="Which ones" value={state} choices={states} onPick={onState} width={180} />
      <Pop label="Sort and filter" menu align="end" width={230} triggerClass="lc-ib lc-wl-ib" trigger={<I.filter size={16} />}>
        {(close) => (
          <div className="lc-sb-menu">
            <PanelHead>Sort by</PanelHead>
            {(Object.keys(sorts) as O[]).map((o) => (
              <Row key={o} title={sorts[o]} keepIcon on={o === sort} onPick={() => (close(), onSort(o))} />
            ))}
            <Sep />
            <PanelHead>Show only</PanelHead>
            {filters.map((f) => (
              <Row key={f.word} title={f.label} end={<span className="lc-mono lc-quiet">{f.word}</span>} keepIcon on={has(f.word)} onPick={() => (close(), toggle(f.word))} />
            ))}
          </div>
        )}
      </Pop>
      <button type="button" className="lc-ib lc-wl-ib l-focus" aria-label={looking ? "Looking again" : "Look again"} title="Look again" disabled={looking} onClick={onLook}>
        <I.refresh size={16} className={looking ? "lc-wl-spin" : undefined} />
      </button>
    </div>
  );
}

/** A group's label over its rows: its name and how many. */
export const GroupHead = ({ name, count }: { name: string; count: number }) => (
  <div className="lc-wl-group" role="presentation">
    <span>{name}</span>
    <span className="lc-wl-group-n">{count}</span>
  </div>
);

/**
  ↑ and ↓ from row to row in the list (and from the search field into it); Enter opens the one with the keyboard (it is
  a button). A key a field or a menu took first is theirs. Escape, anywhere on the page, closes the detail (pageKeys).
*/
export function listKeys(e: React.KeyboardEvent<HTMLElement>) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(".lc-wl-pick")];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const to = rows[at < 0 ? (e.key === "ArrowDown" ? 0 : rows.length - 1) : at + (e.key === "ArrowDown" ? 1 : -1)];
  if (!to) return;
  e.preventDefault();
  to.focus();
  to.scrollIntoView({ block: "nearest" });
}

/** Escape on the page closes the open detail, unless a field, a menu or a dialog in it had a use for it first. */
export function pageKeys(e: React.KeyboardEvent<HTMLElement>, open: boolean, onClose: () => void) {
  if (e.key !== "Escape" || e.defaultPrevented || !open) return;
  e.preventDefault();
  onClose();
}

/** What the list says when it has nothing to show, or while it first reads. */
export function ListNote({ children, shimmer }: { children: ReactNode; shimmer?: boolean }) {
  return <p className={shimmer ? "lc-wl-note l-shimmer" : "lc-wl-note"}>{children}</p>;
}

/** Projects the list couldn't read, each with why and the way to Settings › Source control & issues. */
export function Unavailable({ list }: { list: { projectId: string; project: string; why: string }[] }) {
  if (!list.length) return null;
  return (
    <div className="lc-wl-unav" role="note">
      {list.map((u) => (
        <p key={u.projectId}>
          <I.info size={14} />
          <span>
            <b>{u.project}</b> {u.why}
          </span>
          <button type="button" className="lc-wl-link l-focus" onClick={() => window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "source" }))}>
            Settings › Source control
          </button>
        </p>
      ))}
    </div>
  );
}

/* ---------- The detail column ---------- */

/**
  The detail beside the list, 520 wide: its head (the mark, the number, its state, Open on GitHub, ··· and Close), the
  body that scrolls, and the foot with what you'd do next.
*/
export function Detail({ label, mark, num, state, tone, url, host, menu, onClose, children, foot }: {
  label: string;
  mark: ReactNode;
  num: string;
  state: string;
  tone: "ok" | "grey" | "merged" | "danger";
  url: string;
  host: string;
  menu: (close: () => void) => ReactNode;
  onClose: () => void;
  children: ReactNode;
  foot: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  // Another one opened in the same column starts at its top (in braces: scrollTo answers with a promise in newer Chromium, and an effect may only return its clean-up).
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [num, label]);
  return (
    <aside className="lc-wl-det" aria-label={label}>
      <header className="lc-wl-dhead">
        {mark}
        <span className="lc-wl-dnum">{num}</span>
        <span className="lc-wl-tag" data-tone={tone}>
          {state}
        </span>
        <span className="lc-grow" />
        <button type="button" className="lc-ib lc-wl-ib l-focus" aria-label={`Open on ${host}`} title={`Open on ${host}`} onClick={() => bridge.openExternal(url)}>
          <I.external size={16} />
        </button>
        <Pop label="More" menu align="end" width={260} triggerClass="lc-ib lc-wl-ib" trigger={<I.more size={16} />}>
          {(close) => <div className="lc-sb-menu">{menu(close)}</div>}
        </Pop>
        <button type="button" className="lc-ib lc-wl-ib l-focus" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose}>
          <I.close size={16} />
        </button>
      </header>
      <div ref={body} className="lc-wl-dbody">
        {children}
      </div>
      <footer className="lc-wl-dfoot">{foot}</footer>
    </aside>
  );
}

/** The detail's facts, a name and its value a line. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="lc-wl-kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The body as its author wrote it, as plain text (no Markdown is run), or a quiet line when there is none. */
export function Body({ text }: { text?: string }) {
  const t = text?.trim();
  return t ? <p className="lc-wl-prose">{t}</p> : <p className="lc-wl-prose lc-quiet">No description.</p>;
}

/** Copies a link, and says so. */
export const copyLink = (url: string) =>
  void navigator.clipboard.writeText(url).then(
    () => toast("Copied the link"),
    () => toast.error("Couldn't copy the link"),
  );

/* ---------- Security, from Liner Security's scans of a target ---------- */

/**
  A target's last scan (security.targetStatus), asked when it is opened and again whenever a scan of it moves. Null
  while it has none.
*/
export function useScanStatus(target: ScanTarget | null) {
  const [status, setStatus] = useState<ScanSummary | null>(null);
  const key = target ? targetKey(target) : "";
  useEffect(() => {
    setStatus(null);
    if (!target) return;
    let live = true;
    const ask = () =>
      void rpc("security.targetStatus", { targets: [target] }).then(
        (r) => live && setStatus(r[key] ?? null),
        () => {},
      );
    ask();
    const off = onStream((e) => {
      if (e.type === "security.scan" && e.scan.target && targetKey(e.scan.target) === key) ask();
    });
    return () => {
      live = false;
      off();
    };
  }, [key]);
  return status;
}

/** What a finished scan found open, said short: "1 high, 1 low", or "Nothing found". */
export function foundWords(s: ScanSummary) {
  const parts = [s.high && `${s.high} high`, s.medium && `${s.medium} medium`, s.low && `${s.low} low`].filter(Boolean);
  return parts.length ? parts.join(", ") : "Nothing found";
}

/** The detail's Security line: how its last scan stands, with the worst severity's square. */
export function SecurityLine({ s }: { s: ScanSummary }) {
  if (s.state === "running") return <span className="lc-quiet">Scanning now</span>;
  if (s.state !== "done") return <span className="lc-quiet">{s.state === "stopped" ? "The last scan was stopped" : "The last scan didn't finish"}</span>;
  const sev = s.high ? "h" : s.medium ? "m" : s.low ? "l" : "";
  return (
    <span className="lc-wl-secl">
      {sev && <span className="lc-wl-sev" data-s={sev} aria-hidden />}
      {foundWords(s)} · scanned {since(s.at)}
    </span>
  );
}

const SEV: Record<SecurityFinding["severity"], string> = { critical: "h", high: "h", medium: "m", low: "l" };
const SEV_WORD: Record<SecurityFinding["severity"], string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/** The findings a scan left open, for the issue's "Checked against the code" card. */
function useFindings(scanId: string | undefined) {
  const [list, setList] = useState<SecurityFinding[]>([]);
  useEffect(() => {
    setList([]);
    if (!scanId) return;
    let live = true;
    void rpc("security.findings.list", { scan: scanId }).then(
      (r) => live && setList(r.filter((f) => f.state !== "dismissed" && f.state !== "fixed")),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [scanId]);
  return list;
}

/** A finding as a row: its severity's square, its title, where it is and what the second look said. */
export function FindingRow({ f }: { f: SecurityFinding }) {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
  const note = f.look.words || f.explain?.lead;
  return (
    <div className="lc-wl-find">
      <span className="lc-wl-sev" data-s={SEV[f.severity]} aria-hidden />
      <b>{f.title}</b>
      <span className="lc-wl-find-s">{SEV_WORD[f.severity]}</span>
      {(where || note) && (
        <small>
          {where && <span className="lc-mono">{where}</span>}
          {where && note ? " · " : ""}
          {note}
        </small>
      )}
    </div>
  );
}

/**
  "Checked against the code" (board Issues): the closing sentence of the issue's last scan, the findings it left open,
  Show in Liner Security (the scan's own session there) and Ask about it (a question about its first finding, else the
  scan's session). While it runs it says so; with no scan it isn't there.
*/
export function CheckedCard({ s }: { s: ScanSummary }) {
  const finds = useFindings(s.state === "done" ? s.scanId : undefined);
  if (s.state === "running")
    return (
      <div className="lc-wl-chk" aria-live="polite">
        <div className="lc-wl-chk-h">
          <I.shield size={14} />
          <b>Checking it against the code</b>
        </div>
        <p className="lc-wl-prose lc-quiet l-shimmer">Reading where it happens</p>
      </div>
    );
  if (s.state !== "done") return null;
  const ask = () =>
    finds[0]
      ? void rpc("security.finding.ask", { id: finds[0].id }).then((t) => openSession(t.id), fail)
      : openSession(s.threadId);
  return (
    <div className="lc-wl-chk">
      <div className="lc-wl-chk-h">
        <I.shield size={14} />
        <b>Checked against the code</b>
        <span className="lc-grow" />
        <span className="lc-quiet">{since(s.at)}</span>
      </div>
      {s.lead && <p className="lc-wl-prose lc-wl-lead">{s.lead}</p>}
      {finds.map((f) => (
        <FindingRow key={f.id} f={f} />
      ))}
      <div className="lc-wl-chk-acts">
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => openSession(s.threadId)}>
          <I.external size={14} />
          Show in Liner Security
        </button>
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={ask}>
          Ask about it
        </button>
      </div>
    </div>
  );
}

/* ---------- Starting a session ---------- */

/**
  Opens a session just made once the app has heard of it: the engine's answer can come before its event, and a session
  view whose session isn't known yet goes back to Home (App.tsx, a session that went away). Five seconds at most.
*/
function openWhenKnown(id: string) {
  if (getState().threads.some((t) => t.id === id)) return openSession(id);
  let off = () => {};
  const timer = window.setTimeout(() => (off(), openSession(id)), 5000);
  off = subscribe(() => {
    if (!getState().threads.some((t) => t.id === id)) return;
    off();
    window.clearTimeout(timer);
    openSession(id);
  });
}

/**
  A session on a pull request's code: in the worktree already on its head commit when there is one, else a worktree of
  its own started from the local branch whose tip is that commit; else (a fork, a branch only named the same, no head
  SHA known) a worktree of its own whose brief begins by checking the pull request out with gh (worklists-logic.ts
  prStart). `headSha` comes with the pull request's detail when the engine reads it. `brief` unset is Check out: the
  session opens with nothing sent, ready for you.
*/
export async function sessionOnPr(pr: PrItem & { headSha?: string }, brief?: string) {
  const project = getState().projects.find((p) => p.id === pr.projectId);
  if (!project) throw new Error(`${pr.project} isn't one of your projects here.`);
  let inWorktree: string | undefined;
  let base: string | undefined;
  if (project.git) {
    // Pressed before the detail came, the press has no head commit: the detail is read here, so a worktree already at it is still found.
    const detail = pr.headSha ? null : ((await rpc("worklists.pr", { projectId: pr.projectId, number: pr.number }).catch(() => null)) as { headSha?: string } | null);
    const headSha = headShaOf(pr, detail);
    const b = headSha ? await rpc("git.branches", { projectId: project.id }).catch(() => null) : null;
    const at = prStart({ branch: pr.branch, headSha }, b);
    if ("inWorktree" in at) inWorktree = at.inWorktree;
    else if ("base" in at) base = at.base;
  }
  const t = await rpc("thread.create", { projectId: project.id, title: `#${pr.number} ${pr.title}`, ...(inWorktree ? { inWorktree } : project.git ? { worktree: true, ...(base ? { base } : {}) } : {}) });
  // Not on this Mac yet: the agent checks it out first, with gh, in the session's own worktree.
  const fetch = project.git && !inWorktree && !base ? `First check the pull request out here with \`gh pr checkout ${pr.number}\`.` : "";
  const words = brief ? [fetch, brief].filter(Boolean).join("\n\n") : "";
  if (words) await rpc("thread.send", { id: t.id, text: words });
  else if (fetch) toast(`${pr.branch} isn't on this Mac yet`, { description: `Run gh pr checkout ${pr.number} in the session's terminal to bring it in.` });
  openWhenKnown(t.id);
  return t;
}

/**
  A session in a project of yours, in a worktree of its own when you start sessions in one, with the issue as its brief.
  `projectId` is the issue's own project, or the one you picked for a Linear issue: never Linear's own list id.
*/
export async function sessionOnIssue(issue: IssueItem, brief: string, projectId: string) {
  const s = getState();
  const project = s.projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`${issue.project} isn't one of your projects here.`);
  const t = await rpc("thread.create", { projectId: project.id, title: issue.title, worktree: Boolean(s.settings.worktrees && project.git) });
  await rpc("thread.send", { id: t.id, text: brief });
  openWhenKnown(t.id);
  return t;
}
