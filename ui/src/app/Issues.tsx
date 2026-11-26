/*
  Issues, from the icon at the sidebar's foot or ⌘K (board Issues, 2026-11-26): the open issues in your projects, from
  GitHub through gh and from Linear with the key you added (worklists.issues), in two groups, Assigned to you and
  Everyone else. A row: its mark, the title and its labels, "#42 · foreshore · kai · 4 comments · 1d", and Liner
  Security's Check (security/ScanChip.tsx), which reads the code to say whether the issue is real, where and how bad.
  Picking one opens its detail: who opened it, its labels, whether it's yours, the pull requests linked to it, its body,
  and "Checked against the code" when a check has run; at the foot Check again, Comment (on GitHub, for now) and Start a
  session from it. The same keys as Pull requests: ↑ and ↓, Enter, Esc.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { IssueItem, WorklistResult } from "@contracts";
import { scmSettings } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "./bridge";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { listedProjects, plural, since } from "./model";
import { Pop, Row } from "./ui";
import { ScanChip } from "./security/ScanChip";
import { age, canCheckIssue, groupIssues, issueProject, headCount, issueBrief, issueKey, issueMatches, ISSUE_SORTS, parseSearch, type IssueSort } from "./worklists-logic";
import { knownPrTitle } from "./worklists-store";
import { Body, CheckedCard, copyLink, Detail, Facts, GroupHead, IssueMark, Label, ListNote, listKeys, pageKeys, sessionOnIssue, Toolbar, Unavailable, useScanStatus, WorkHead, Who, type Choice } from "./worklists-parts";

type Shown = "open" | "closed" | "all";
const STATES: Choice<Shown>[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];
const FILTERS = [{ word: "is:mine", label: "Assigned to you" }];
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/** `onPr`: a linked pull request pressed, to open on the Pull requests page. */
export function Issues({ sidebar, onSidebar, onPr }: { sidebar: boolean; onSidebar: () => void; onPr?: (projectId: string, number: number) => void }) {
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [shown, setShown] = useState<Shown>("open");
  const [sort, setSort] = useState<IssueSort>("updated");
  const [data, setData] = useState<WorklistResult<IssueItem> | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [again, setAgain] = useState(0);
  const lookFresh = useRef(false);
  const [open, setOpen] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const every = useEngine((s) => scmSettings(s.settings).worklistRefresh);

  useEffect(() => {
    let live = true;
    // Look again asks the hosts afresh; everything else may take the engine's last minute's list.
    const fresh = lookFresh.current;
    lookFresh.current = false;
    setLooking(true);
    rpc("worklists.issues", { state: shown, ...(project ? { projectId: project } : {}), ...(fresh ? { fresh } : {}) })
      .then((r) => {
        if (!live) return;
        setData(r);
        setFailed(null);
      })
      .catch((e) => live && setFailed(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLooking(false));
    return () => {
      live = false;
    };
  }, [shown, project, again]);
  useEffect(() => {
    if (!every) return;
    const t = window.setInterval(() => document.visibilityState === "visible" && setAgain((n) => n + 1), Math.max(30, every) * 1000);
    return () => window.clearInterval(t);
  }, [every]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, [contenteditable='true'], .xterm");
      if ((e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && !e.shiftKey)) {
        e.preventDefault();
        field.current?.focus();
        field.current?.select();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const search = useMemo(() => parseSearch(q), [q]);
  const items = useMemo(() => (data?.items ?? []).filter((i) => issueMatches(i, search)), [data, search]);
  const groups = useMemo(() => groupIssues(items, sort), [items, sort]);
  const picked = (data?.items ?? []).find((i) => issueKey(i) === open) ?? null;
  useEffect(() => {
    if (open && data && !picked) setOpen(null);
  }, [data, picked === null]);
  const close = () => {
    const at = open;
    setOpen(null);
    if (at) window.setTimeout(() => list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(at)}"] .lc-wl-pick`)?.focus({ preventScroll: true }));
  };

  return (
    <div className="lc-apppage lc-wl" onKeyDown={(e) => pageKeys(e, Boolean(picked), close)}>
      <div className="lc-wl-main">
        <WorkHead title="Issues" count={data ? headCount(items, shown) : undefined} sidebar={sidebar} onSidebar={onSidebar} />
        <Toolbar field={field} q={q} onQ={setQ} placeholder="Search issues, or label:bug" project={project} onProject={setProject} state={shown} states={STATES} onState={setShown} sort={sort} sorts={ISSUE_SORTS} onSort={setSort} filters={FILTERS} looking={looking} onLook={() => ((lookFresh.current = true), setAgain((n) => n + 1))} />
        <div ref={list} className="lc-wl-list" onKeyDown={listKeys}>
          {failed ? (
            <ListNote>{failed}</ListNote>
          ) : !data ? (
            <ListNote shimmer>Asking for your issues</ListNote>
          ) : groups.length === 0 ? (
            <ListNote>{q.trim() ? "No issue matches that." : data.items.length || data.unavailable.length ? `No ${shown === "all" ? "" : `${shown} `}issues${project ? " in this project" : ""}.` : "No issues in your projects. GitHub's show here, and Linear's once you add its key in Settings › Source control."}</ListNote>
          ) : (
            groups.map((g) => (
              <section key={g.id} className="lc-wl-sec" aria-label={g.name}>
                <GroupHead name={g.name} count={g.items.length} />
                {g.items.map((i) => (
                  <IssueRow key={issueKey(i)} issue={i} on={issueKey(i) === open} onOpen={() => setOpen(issueKey(i) === open ? null : issueKey(i))} />
                ))}
              </section>
            ))
          )}
          {data && <Unavailable list={data.unavailable} />}
        </div>
      </div>
      {picked && <IssueDetail key={open!} issue={picked} onClose={close} onPr={onPr} />}
    </div>
  );
}

/** Your code projects' ids: where an issue can be checked, and where a session from one can start. */
function useProjectIds() {
  const projects = useEngine((s) => s.projects);
  return useMemo(() => listedProjects(projects).map((p) => p.id), [projects]);
}

function IssueRow({ issue, on, onOpen }: { issue: IssueItem; on: boolean; onOpen: () => void }) {
  // A Linear issue belongs to no project here, so there is no code to check it against.
  const checkable = canCheckIssue(issue, useProjectIds());
  return (
    <div className="lc-wl-row" data-key={issueKey(issue)} data-on={on || undefined}>
      <button type="button" className="lc-wl-pick l-focus" aria-expanded={on} onClick={onOpen}>
        <span className="lc-wl-mark">
          <IssueMark state={issue.state} />
        </span>
        <span className="lc-wl-t">
          <span className="lc-wl-cut">{issue.title}</span>
          {issue.labels.map((l) => (
            <Label key={l.name} name={l.name} color={l.color} />
          ))}
        </span>
        <span className="lc-wl-meta">
          <span className="lc-mono">{issue.key}</span>
          <span>·</span>
          <span>{issue.project}</span>
          <span>·</span>
          <Who name={issue.author} small />
          {issue.comments > 0 && (
            <>
              <span>·</span>
              <span>{plural(issue.comments, "comment")}</span>
            </>
          )}
          <span>·</span>
          <span>{age(issue.updatedAt)}</span>
        </span>
      </button>
      {checkable && (
        <span className="lc-wl-chipat">
          <ScanChip verb="Check" target={{ kind: "issue", projectId: issue.projectId, key: issue.key }} />
        </span>
      )}
    </div>
  );
}

function IssueDetail({ issue, onClose, onPr }: { issue: IssueItem; onClose: () => void; onPr?: (projectId: string, number: number) => void }) {
  const [full, setFull] = useState<IssueItem | null>(null);
  const [starting, setStarting] = useState(false);
  const target = useMemo(() => ({ kind: "issue" as const, projectId: issue.projectId, key: issue.key }), [issue.projectId, issue.key]);
  const allProjects = useEngine((s) => s.projects);
  const projects = useMemo(() => listedProjects(allProjects), [allProjects]);
  const ids = projects.map((p) => p.id);
  const checkable = canCheckIssue(issue, ids);
  // Its own project, or none (a Linear issue): then Start a session from it asks which of yours.
  const own = issueProject(issue, ids);
  const scan = useScanStatus(checkable ? target : null);
  useEffect(() => {
    let live = true;
    void rpc("worklists.issue", { projectId: issue.projectId, key: issue.key }).then(
      (d) => live && setFull(d),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [issue.projectId, issue.key, issue.updatedAt]);
  const it = full ?? issue;
  // The linked pull requests' titles: from the open list the Pull requests page last read, else read once here (every state, this project).
  const [titles, setTitles] = useState<Map<number, string>>(new Map());
  const linked = (it.linkedPrs ?? []).join(",");
  useEffect(() => {
    const ns = (it.linkedPrs ?? []).filter((n) => !knownPrTitle(issue.projectId, n));
    if (!ns.length) return;
    let live = true;
    void rpc("worklists.prs", { projectId: issue.projectId, state: "all" }).then(
      (r) => live && setTitles(new Map(r.items.filter((p) => ns.includes(p.number)).map((p) => [p.number, p.title] as const))),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [issue.projectId, linked]);
  const prTitle = (n: number) => knownPrTitle(issue.projectId, n) ?? titles.get(n);
  const host = issue.tracker === "linear" ? "Linear" : "GitHub";
  const start = (projectId: string) => {
    setStarting(true);
    sessionOnIssue(it, issueBrief(it), projectId)
      .catch(fail)
      .finally(() => setStarting(false));
  };
  const checkAgain = () => void rpc("security.scanTarget", { target }).catch(fail);
  return (
    <Detail
      label={`Issue ${issue.key}`}
      mark={<IssueMark state={issue.state} />}
      num={issue.key}
      state={issue.state === "open" ? "Open" : "Closed"}
      tone={issue.state === "open" ? "ok" : "merged"}
      url={issue.url}
      host={host}
      onClose={onClose}
      menu={(close) => (
        <>
          <Row title="Copy the link" icon={<I.link size={14} />} onPick={() => (close(), copyLink(issue.url))} />
          <Row title={`Open on ${host}`} note="Labels, who it's assigned to and closing it are there" icon={<I.external size={14} />} onPick={() => (close(), bridge.openExternal(issue.url))} />
        </>
      )}
      foot={
        <>
          {!checkable ? null : scan && scan.state !== "running" ? (
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={checkAgain}>
              <I.refresh size={14} />
              Check again
            </button>
          ) : (
            <ScanChip verb="Check" target={target} />
          )}
          <span className="lc-grow" />
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" title={`Comment on ${host}`} onClick={() => bridge.openExternal(issue.url)}>
            Comment
          </button>
          {own ? (
            <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={starting} onClick={() => start(own)}>
              Start a session from it
            </button>
          ) : (
            projects.length > 0 && (
              <Pop label="Start a session from it: which project" menu side="top" align="end" width={240} disabled={starting} triggerClass="lc-btn" triggerAttrs={{ "data-kind": "ink", "data-size": "sm" }} trigger={<>Start a session from it<I.chevD size={12} /></>}>
                {(close) => (
                  <div className="lc-sb-menu">
                    {projects.map((p) => (
                      <Row key={p.id} title={p.name} icon={<I.folder size={14} />} onPick={() => (close(), start(p.id))} />
                    ))}
                  </div>
                )}
              </Pop>
            )
          )}
        </>
      }
    >
      <h2 className="lc-wl-h">{issue.title}</h2>
      <Facts
        rows={[
          ["Opened by", <span className="lc-wl-who-line"><Who name={issue.author} /><span className="lc-quiet">· updated {since(issue.updatedAt)}</span></span>],
          ...(issue.labels.length ? [["Labels", <span className="lc-wl-lbls">{issue.labels.map((l) => <Label key={l.name} name={l.name} color={l.color} />)}</span>] as [string, React.ReactNode]] : []),
          ["Assigned", issue.assignedToMe ? "You" : "Not you"],
          ...((it.linkedPrs ?? []).length
            ? [
                [
                  "Linked",
                  <span className="lc-wl-linked">
                    {(it.linkedPrs ?? []).map((n) => (
                      <button key={n} type="button" className="lc-wl-link l-focus" disabled={!onPr} title={`Open #${n} on the Pull requests page`} onClick={() => onPr?.(issue.projectId, n)}>
                        <I.pr size={14} />#{n}
                        {prTitle(n) && <span className="lc-wl-linked-t">{prTitle(n)}</span>}
                      </button>
                    ))}
                  </span>,
                ] as [string, React.ReactNode],
              ]
            : []),
          ...(issue.comments ? [["Comments", plural(issue.comments, "comment")] as [string, React.ReactNode]] : []),
        ]}
      />
      <hr className="lc-wl-hr" />
      <Body text={it.body} />
      {scan && <CheckedCard s={scan} />}
    </Detail>
  );
}
