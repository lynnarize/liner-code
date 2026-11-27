/*
  Pull requests, from the icon at the sidebar's foot or ⌘K (boards PullRequests and ScanDone, 2026-11-26): every open
  pull request in your projects, read with the tools you already have (worklists.prs: gh for GitHub), in three groups,
  Needs your review, Yours and Others. A row: its state's mark, the title and its labels, "#131 · foreshore · devon ·
  5h", its checks, what it adds and takes away, and Liner Security's scan chip (security/ScanChip.tsx). Picking one opens
  its detail beside the list: the branch, author, checks, your review, its changes and the last scan's findings, the
  body and the files, and at the foot the scan, Check out and Open a session on it. ↑ and ↓ move through the rows,
  Enter opens one, Esc closes the detail. A project that couldn't be read says why under the list.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { PrDetail, PrItem, PrState, WorklistResult } from "@contracts";
import { scmSettings } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { plural } from "./model";
import { ConfirmRow, Row, Sep } from "./ui";
import { openSession } from "./Addon";
import { ScanChip } from "./security/ScanChip";
import { age, checksSaid, groupPrs, headCount, parseSearch, prBrief, prKey, prMatches, PR_SORTS, reviewSaid, splitPath, type PrSort } from "./worklists-logic";
import { keepPrs, markPrsSeen } from "./worklists-store";
import { Body, copyLink, Detail, Facts, GroupHead, Label, ListNote, listKeys, pageKeys, PR_WORD, PrMark, SecurityLine, sessionOnPr, Toolbar, Unavailable, useScanStatus, WorkHead, Who, type Choice } from "./worklists-parts";

type Shown = "open" | "merged" | "closed" | "all";
const STATES: Choice<Shown>[] = [
  { value: "open", label: "Open" },
  { value: "merged", label: "Merged" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];
const FILTERS = [
  { word: "is:draft", label: "Drafts" },
  { word: "is:mine", label: "Yours" },
];
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const HOST_NAME: Record<PrItem["host"], string> = { github: "GitHub", gitlab: "GitLab", bitbucket: "Bitbucket", azure: "Azure DevOps", forgejo: "Forgejo", origin: "Cursor Origin" };
const TONE: Record<PrState, "ok" | "grey" | "merged" | "danger"> = { open: "ok", draft: "grey", merged: "merged", closed: "danger" };
/** Files the detail lists before "N more files". */
const FILES_SHOWN = 6;

/** `pick`: a pull request to open as the page comes up ("<projectId>#<number>", an issue's linked one). */
export function PullRequests({ sidebar, onSidebar, pick }: { sidebar: boolean; onSidebar: () => void; pick?: string }) {
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [shown, setShown] = useState<Shown>("open");
  const [sort, setSort] = useState<PrSort>("updated");
  const [data, setData] = useState<WorklistResult<PrItem> | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [again, setAgain] = useState(0);
  const lookFresh = useRef(false);
  const [open, setOpen] = useState<string | null>(pick ?? null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const every = useEngine((s) => scmSettings(s.settings).worklistRefresh);

  useEffect(() => {
    markPrsSeen();
  }, []);
  useEffect(() => {
    let live = true;
    const query = { state: shown, ...(project ? { projectId: project } : {}) };
    // Look again asks the hosts afresh; everything else may take the engine's last minute's list.
    const fresh = lookFresh.current;
    lookFresh.current = false;
    // Only Look again's own press turns its arrow: a list read again in the background, or for another filter, says nothing.
    setLooking(fresh);
    rpc("worklists.prs", { ...query, ...(fresh ? { fresh } : {}) })
      .then((r) => {
        if (!live) return;
        setData(r);
        setFailed(null);
        keepPrs(r.items, query);
      })
      .catch((e) => live && setFailed(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLooking(false));
    return () => {
      live = false;
    };
  }, [shown, project, again]);
  // While the page is open it reads the list again as often as Settings says (0: only when opened or Look again).
  useEffect(() => {
    if (!every) return;
    const t = window.setInterval(() => document.visibilityState === "visible" && setAgain((n) => n + 1), Math.max(30, every) * 1000);
    return () => window.clearInterval(t);
  }, [every]);
  // / or ⌘F puts the keyboard in the search field, unless something else that takes typing has it.
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
  const items = useMemo(() => (data?.items ?? []).filter((p) => prMatches(p, search)), [data, search]);
  const groups = useMemo(() => groupPrs(items, sort), [items, sort]);
  const picked = (data?.items ?? []).find((p) => prKey(p) === open) ?? null;
  // A row that no longer shows (another state, a search) closes its detail rather than showing one that isn't in the list.
  useEffect(() => {
    if (open && data && !picked) setOpen(null);
  }, [data, picked === null]);
  // Merged from here: shown merged at once, then the list is read again (the engine let go of its kept one), so on Open it goes.
  const merged = (p: PrItem) => {
    setData((d) => d && { ...d, items: d.items.map((x) => (prKey(x) === prKey(p) ? { ...x, state: "merged" as const } : x)) });
    setAgain((n) => n + 1);
  };
  const close = () => {
    const at = open;
    setOpen(null);
    // The keyboard goes back to the row it came from.
    if (at) window.setTimeout(() => list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(at)}"] .lc-wl-pick`)?.focus({ preventScroll: true }));
  };

  return (
    <div className="lc-apppage lc-wl" onKeyDown={(e) => pageKeys(e, Boolean(picked), close)}>
      <div className="lc-wl-main">
        <WorkHead title="Pull requests" count={data ? headCount(items, shown) : undefined} sidebar={sidebar} onSidebar={onSidebar} />
        <Toolbar field={field} q={q} onQ={setQ} placeholder="Search pull requests, or label:bug" project={project} onProject={setProject} state={shown} states={STATES} onState={setShown} sort={sort} sorts={PR_SORTS} onSort={setSort} filters={FILTERS} looking={looking} onLook={() => ((lookFresh.current = true), setAgain((n) => n + 1))} />
        <div ref={list} className="lc-wl-list" onKeyDown={listKeys}>
          {failed ? (
            <ListNote>{failed}</ListNote>
          ) : !data ? (
            <ListNote shimmer>Asking gh for your pull requests</ListNote>
          ) : groups.length === 0 ? (
            <ListNote>{q.trim() ? "No pull request matches that." : data.items.length || data.unavailable.length ? `No ${shown === "all" ? "" : `${shown} `}pull requests${project ? " in this project" : ""}.` : "No pull requests in your projects. Projects on GitHub show theirs here."}</ListNote>
          ) : (
            groups.map((g) => (
              <section key={g.id} className="lc-wl-sec" aria-label={g.name}>
                <GroupHead name={g.name} count={g.items.length} />
                {g.items.map((p) => (
                  <PrRow key={prKey(p)} pr={p} on={prKey(p) === open} onOpen={() => setOpen(prKey(p) === open ? null : prKey(p))} />
                ))}
              </section>
            ))
          )}
          {data && <Unavailable list={data.unavailable} />}
        </div>
      </div>
      {picked && <PrDetailColumn key={open!} pr={picked} onClose={close} onMerged={merged} />}
    </div>
  );
}

/** A row: the words are one button that opens the detail, the scan chip beside it. */
function PrRow({ pr, on, onOpen }: { pr: PrItem; on: boolean; onOpen: () => void }) {
  const checks = checksSaid(pr.checks);
  return (
    <div className="lc-wl-row" data-key={prKey(pr)} data-on={on || undefined}>
      <button type="button" className="lc-wl-pick l-focus" aria-expanded={on} onClick={onOpen}>
        <span className="lc-wl-mark">
          <PrMark state={pr.state} />
        </span>
        <span className="lc-wl-t">
          <span className="lc-wl-cut">{pr.title}</span>
          {pr.state === "draft" && <span className="lc-wl-tag" data-tone="grey">Draft</span>}
          {pr.labels.map((l) => (
            <Label key={l.name} name={l.name} color={l.color} />
          ))}
        </span>
        <span className="lc-wl-meta">
          <span className="lc-mono">#{pr.number}</span>
          <span>·</span>
          <span>{pr.project}</span>
          <span>·</span>
          {pr.threadId ? <span>from a session</span> : <Who name={pr.author} small />}
          <span>·</span>
          <span>{age(pr.updatedAt)}</span>
        </span>
        <span className="lc-wl-end">
          {checks && (
            <span className="lc-wl-checks" data-tone={checks.tone} title={checks.long}>
              {checks.tone === "ok" ? <I.check size={14} /> : checks.tone === "bad" ? <I.close size={14} /> : <I.clock size={14} />}
              {checks.short}
            </span>
          )}
          <span className="lc-wl-diff">
            <span data-s="add">+{pr.additions}</span> <span data-s="del">−{pr.deletions}</span>
          </span>
        </span>
      </button>
      <span className="lc-wl-chipat">
        <ScanChip target={{ kind: "pr", projectId: pr.projectId, number: pr.number }} />
      </span>
    </div>
  );
}

/** The detail beside the list: what it is, its body and files, and at its foot the scan, Check out and Open a session on it. */
function PrDetailColumn({ pr, onClose, onMerged }: { pr: PrItem; onClose: () => void; onMerged: (pr: PrItem) => void }) {
  const [full, setFull] = useState<PrDetail | null>(null);
  // Merging, or merged from here: Merge it can't be pressed twice, nor come back if gh's next list is a moment behind.
  const [merging, setMerging] = useState<"no" | "now" | "done">("no");
  const [allFiles, setAllFiles] = useState(false);
  const [starting, setStarting] = useState(false);
  const method = useEngine((s) => scmSettings(s.settings).mergeMethod);
  const target = useMemo(() => ({ kind: "pr" as const, projectId: pr.projectId, number: pr.number }), [pr.projectId, pr.number]);
  const scan = useScanStatus(target);
  useEffect(() => {
    let live = true;
    void rpc("worklists.pr", { projectId: pr.projectId, number: pr.number }).then(
      (d) => live && setFull(d),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [pr.projectId, pr.number, pr.updatedAt]);
  const checks = checksSaid(pr.checks);
  const files = full?.fileList ?? [];
  const host = HOST_NAME[pr.host] ?? "GitHub";
  const start = (brief?: string) => {
    setStarting(true);
    sessionOnPr(full ?? pr, brief)
      .catch(fail)
      .finally(() => setStarting(false));
  };
  const merge = () => {
    if (merging !== "no") return;
    setMerging("now");
    void rpc("pr.merge", { projectId: pr.projectId, number: pr.number }).then(
      () => {
        setMerging("done");
        toast(`Merged #${pr.number}`, { description: pr.title });
        onMerged(pr);
      },
      (e) => {
        setMerging("no");
        fail(e);
      },
    );
  };
  const methodWord = method === "squash" ? "squash" : method === "rebase" ? "rebase" : "a merge commit";
  return (
    <Detail
      label={`Pull request #${pr.number}`}
      mark={<PrMark state={pr.state} />}
      num={`#${pr.number}`}
      state={PR_WORD[pr.state]}
      tone={TONE[pr.state]}
      url={pr.url}
      host={host}
      onClose={onClose}
      menu={(close) => (
        <>
          <Row title="Copy the link" icon={<I.link size={14} />} onPick={() => (close(), copyLink(pr.url))} />
          <Row title="Check out the branch" note="In a worktree of its own, in a new session" icon={<I.branch size={14} />} onPick={() => (close(), start())} />
          {(pr.state === "open" || pr.state === "draft") && merging !== "done" && (
            <>
              <Sep />
              {merging === "now" ? (
                <Row title={`Merging #${pr.number}`} icon={<I.merge size={14} />} disabled />
              ) : (
                <ConfirmRow title="Merge it" note={`With ${methodWord}, as Settings › Source control says`} sure={`Merge #${pr.number} now`} icon={<I.merge size={14} />} onConfirm={() => (close(), merge())} />
              )}
            </>
          )}
        </>
      )}
      foot={
        <>
          <ScanChip target={target} />
          <span className="lc-grow" />
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={starting} title="A worktree of its own on the branch, in a new session" onClick={() => start()}>
            Check out
          </button>
          {pr.threadId ? (
            <button type="button" className="lc-btn" data-kind="ink" data-size="sm" onClick={() => openSession(pr.threadId!)}>
              Open its session
            </button>
          ) : (
            <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={starting} onClick={() => start(prBrief(full ?? pr))}>
              Open a session on it
            </button>
          )}
        </>
      }
    >
      <h2 className="lc-wl-h">{pr.title}</h2>
      <Facts
        rows={[
          ["Branch", <span className="lc-mono lc-wl-branch">{pr.branch} → {pr.base}</span>],
          ["Author", pr.threadId ? <span>{pr.author}, from a session</span> : <Who name={pr.author} />],
          ...(checks ? [["Checks", <span><span className="lc-wl-checks" data-tone={checks.tone}>{checks.long}</span>{checks.failing.length > 0 && <span className="lc-quiet"> · {checks.failing.join(", ")}</span>}</span>] as [string, React.ReactNode]] : []),
          ["Review", reviewSaid(pr)],
          ["Changes", <span>{plural(pr.files, "file")} · <span className="lc-wl-diff"><span data-s="add">+{pr.additions}</span> <span data-s="del">−{pr.deletions}</span></span></span>],
          ...(scan ? [["Security", <SecurityLine s={scan} />] as [string, React.ReactNode]] : []),
        ]}
      />
      <hr className="lc-wl-hr" />
      <Body text={full?.body ?? pr.body} />
      {pr.labels.length > 0 && (
        <div className="lc-wl-lbls">
          {pr.labels.map((l) => (
            <Label key={l.name} name={l.name} color={l.color} />
          ))}
        </div>
      )}
      <hr className="lc-wl-hr" />
      <div className="lc-wl-flab">Files</div>
      {!full ? (
        <p className="lc-wl-prose lc-quiet l-shimmer">Reading what it changes</p>
      ) : (
        <div className="lc-wl-files">
          {(allFiles ? files : files.slice(0, FILES_SHOWN)).map((f) => {
            const p = splitPath(f.path);
            return (
              <div key={f.path} className="lc-wl-file" title={f.path}>
                <span className="lc-wl-file-p">
                  <span className="lc-wl-file-d">{p.dir}</span>
                  {p.name}
                </span>
                <span className="lc-grow" />
                {f.additions > 0 && <span className="lc-wl-diff"><span data-s="add">+{f.additions}</span></span>}
                {f.deletions > 0 && <span className="lc-wl-diff"><span data-s="del">−{f.deletions}</span></span>}
              </div>
            );
          })}
          {!allFiles && files.length > FILES_SHOWN && (
            <button type="button" className="lc-wl-link l-focus" onClick={() => setAllFiles(true)}>
              {plural(files.length - FILES_SHOWN, "more file")}
            </button>
          )}
          {files.length === 0 && <p className="lc-wl-prose lc-quiet">No files listed.</p>}
        </div>
      )}
    </Detail>
  );
}
