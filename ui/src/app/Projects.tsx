/*
  Choosing a project, the way GitHub Desktop adds one: the projects already here, the Git
  repositories found on this Mac, or your repositories on GitHub (through the GitHub CLI,
  signed in as you), which clone with one press. Picking one that isn't here yet adds it.
  Home's quick pick is the small one: a find line, your projects on one line each, the last used
  first, with the folder's path at the row's end, then Add a project and Manage projects; From
  GitHub and Find on this Mac open the full chooser in its place.
*/
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ROUTINES_ON, type FoundRepo, type GitHubRepo, type Project } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { bridge, ghInstall } from "./bridge";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { listedProjects, since } from "./model";
import { BackRow, FindField, rove } from "./Models";
import { Row, Sep } from "./ui";
import * as os from "./os";
import "./models.css";

type Tab = "here" | "mac" | "github";
type GitHub = { gh: "ready" | "missing" | "signed-out"; detail?: string; login?: string; repos: GitHubRepo[] };

// Scanning and asking GitHub take a moment, so the answers are kept while the app is open.
let found: Promise<{ repos: FoundRepo[]; detail?: string }> | null = null;
let github: Promise<GitHub> | null = null;
const tilde = os.tilde;

/**
  Home's project picker, a small card: the find line the model picker has (no box, a hairline under it), your projects one
  30px row each (the last used first, the rest by name; past six the list scrolls inside the card), each with its path at
  its end and a tick on the one picked; then, under a hairline, two rows: Add a project, which opens in place the ways to
  add one (a folder on this Mac, from GitHub, found on this Mac) and `more` (Home's own: a scratch folder, the sample), and
  Manage projects, which is Settings › Projects. From GitHub and Find on this Mac open the full chooser in the same place.
  Only the list scrolls: the card is never taller than its room (--lc-pop-room, ui.tsx Pop) and the foot stays put.
*/
export function ProjectQuickPick({ value, onPick, more = [], close }: { value?: string; onPick: (p: Project) => void; more?: { title: string; icon: ReactNode; onPick: () => void }[]; close?: () => void }) {
  const all = useEngine((s) => s.projects);
  const threads = useEngine((s) => s.threads);
  const [view, setView] = useState<"" | "add" | Tab>("");
  const [query, setQuery] = useState("");
  const find = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // When you last worked in each project: its newest session's last activity.
  const used = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of threads) if (!t.archived) m.set(t.projectId, Math.max(m.get(t.projectId) ?? 0, t.updatedAt));
    return m;
  }, [threads]);
  const projects = useMemo(() => listedProjects(all).sort((a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0) || a.name.localeCompare(b.name)), [all, used]);
  const q = query.trim().toLowerCase();
  const shown = q ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)) : projects;
  const add = (path: string | null) => {
    if (!path) return;
    void rpc("project.add", { path }).then(onPick, (e: Error) => toast.error(e.message));
  };
  // Into a list in place and back out, the keyboard following: to its first row going in, to the row that opened it coming back.
  const go = (v: "" | "add" | Tab) => {
    const was = view;
    setView(v);
    requestAnimationFrame(() => (v === "add" && was !== "" ? card.current?.querySelector<HTMLElement>(`[data-opens="${was}"]`) : v ? card.current?.querySelector<HTMLElement>("[data-rove]:not(:disabled), input") : card.current?.querySelector<HTMLElement>('[data-opens="add"]'))?.focus({ preventScroll: true }));
  };
  // Up and Down walk the rows and the foot (Models.tsx rove); a letter typed on a row goes to Find; Escape steps back out of a list in place before the panel closes.
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && view && !e.defaultPrevented) return void (e.preventDefault(), go(view === "add" ? "" : "add"));
    if (e.key === "Enter" && e.target === find.current && !e.nativeEvent.isComposing && shown[0]) return void (e.preventDefault(), onPick(shown[0]));
    const typing = e.target instanceof HTMLInputElement;
    if (!view && !typing && e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) return void find.current?.focus();
    rove(e, card.current);
  };
  let body: ReactNode;
  if (view === "mac" || view === "github")
    body = (
      <>
        <BackRow name={view === "github" ? "From GitHub" : `Find on ${os.here}`} label="Back to the ways to add a project" onBack={() => go("add")} />
        <ProjectChooser value={value} onPick={onPick} initialTab={view} />
      </>
    );
  else if (view === "add")
    body = (
      <>
        <BackRow name="Add a project" label="Back to your projects" onBack={() => go("")} />
        <Row rove title={`A folder on ${os.here}`} end="Choose it" icon={<I.folderPlus size={16} />} onPick={() => void bridge.pickFolder().then(add)} />
        <Row rove title="From GitHub" end="Clone one" icon={<I.pr size={16} />} opens="github" onPick={() => go("github")} />
        <Row rove title={`Find on ${os.here}`} end="Repositories" icon={<I.laptop size={16} />} opens="mac" onPick={() => go("mac")} />
        {more.length > 0 && <Sep />}
        {more.map((m) => (
          <Row key={m.title} rove title={m.title} icon={m.icon} onPick={m.onPick} />
        ))}
      </>
    );
  else
    body = (
      <>
        <div className="lc-pk-top">
          <FindField value={query} onChange={setQuery} field={find} label="Find a project" autoFocus />
        </div>
        {/* No label over it: the list is only your projects, the last used first, found or not. */}
        <div className="lc-qp-list" role="group" aria-label="Your projects">
          {shown.map((p) => (
            <Row key={p.id} rove keepIcon title={p.name} which={tilde(p.path)} whichPath on={p.id === value} icon={<I.folder size={16} />} onPick={() => onPick(p)} />
          ))}
          {q && shown.length === 0 && <p className="lc-quiet lc-qp-none">No project matches that.</p>}
          {!q && projects.length === 0 && <p className="lc-quiet lc-qp-none">No projects yet.</p>}
        </div>
        <div className="lc-qp-foot">
          <Row rove title="Add a project" icon={<I.plus size={16} />} opens="add" onPick={() => go("add")} />
          <Row rove title="Manage projects" icon={<I.settings size={16} />} onPick={() => (close?.(), window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "projects" })))} />
        </div>
      </>
    );
  return (
    <div ref={card} className="lc-qp" data-view={view || undefined} onKeyDown={keys}>
      {body}
    </div>
  );
}

export function ProjectChooser({ value, onPick, need, extra, initialTab = "here" }: { value?: string; onPick: (p: Project) => void; need?: "github"; extra?: ReactNode; initialTab?: Tab }) {
  // A design on its own is Liner Design's, never one of the projects to choose here.
  const all = useEngine((s) => s.projects);
  const projects = useMemo(() => listedProjects(all), [all]);
  const root = useEngine((s) => s.settings.projectsRoot);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [mac, setMac] = useState<{ repos: FoundRepo[]; detail?: string } | null>(null);
  const [gh, setGh] = useState<GitHub | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadMac = (again = false) => {
    // A failed scan keeps its words, as the GitHub tab does: an empty list alone would read as no repositories.
    if (again || !found) found = rpc("projects.scan", {}).then((repos) => ({ repos })).catch((e) => ({ repos: [] as FoundRepo[], detail: e instanceof Error ? e.message : String(e) }));
    setMac(null);
    void found.then(setMac);
  };
  const loadGh = (again = false) => {
    if (again || !github) github = rpc("github.repos", {}).catch((e) => ({ gh: "ready" as const, detail: e instanceof Error ? e.message : String(e), repos: [] }));
    setGh(null);
    void github.then(setGh);
  };
  useEffect(() => {
    if (tab === "mac" && !mac) loadMac();
    if (tab === "github" && !gh) loadGh();
  }, [tab]);

  const q = query.trim().toLowerCase();
  const match = (...s: (string | undefined)[]) => !q || s.some((x) => x?.toLowerCase().includes(q));
  const here = useMemo(() => [...projects].filter((p) => match(p.name, p.path, p.remote)).sort((a, b) => a.name.localeCompare(b.name)), [projects, q]);

  const add = async (key: string, run: () => Promise<Project>) => {
    setBusy(key);
    try {
      const p = await run();
      found = null;
      github = null;
      onPick(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const noRemote = (remote?: string) => need === "github" && !remote;

  return (
    <div className="lc-pc">
      <Segmented
        size="sm"
        full
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "here", label: "Projects" },
          { value: "mac", label: `On ${os.here}` },
          { value: "github", label: "GitHub" },
        ]}
        aria-label="Where to choose from"
      />
      {/* The one find line every picker has (the model picker's): no box, a hairline under it. */}
      <div className="lc-pk-top lc-pc-find">
        <label className="lc-mp-find">
          <I.search size={16} />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === "github" ? "Find a repository" : "Find a project"} aria-label="Find" spellCheck={false} />
        </label>
      </div>
      <div className="lc-pc-list">
        {tab === "here" && (
          <>
            {here.map((p) => (
              <Row key={p.id} title={p.name} which={p.remote ?? tilde(p.path)} whichPath={!p.remote} note={[p.remote ?? tilde(p.path), noRemote(p.remote) ? "no GitHub remote" : ""].filter(Boolean).join(" · ")} on={p.id === value} icon={<I.folder size={16} />} onPick={() => onPick(p)} />
            ))}
            {here.length === 0 && <p className="lc-quiet lc-mp-none">{q ? "No project matches that." : `No projects yet. Find one on ${os.here} or on GitHub.`}</p>}
          </>
        )}
        {tab === "mac" &&
          (mac === null ? (
            <p className="l-shimmer lc-mp-none">Looking through your code folders</p>
          ) : (
            <>
              {mac.detail && <p className="lc-pr-warn lc-pc-warn">{mac.detail}</p>}
              {mac.repos
                .filter((r) => match(r.name, r.path, r.remote))
                .map((r) => {
                  const p = projects.find((x) => x.path === r.path);
                  return (
                    <Row
                      key={r.path}
                      title={r.name}
                      which={tilde(r.path)}
                      whichPath
                      note={[tilde(r.path), r.branch, r.lastCommitAt ? since(r.lastCommitAt) : "", noRemote(r.remote) ? "no GitHub remote" : ""].filter(Boolean).join(" · ")}
                      on={p?.id === value}
                      icon={<I.folder size={16} />}
                      end={busy === r.path ? <span className="l-shimmer">Adding</span> : p ? <span className="lc-quiet">Added</span> : undefined}
                      disabled={busy !== null}
                      onPick={() => (p ? onPick(p) : void add(r.path, () => rpc("project.add", { path: r.path })))}
                    />
                  );
                })}
              {mac.repos.length === 0 ? !mac.detail && <p className="lc-quiet lc-mp-none">No Git repositories in the usual folders.</p> : !mac.repos.some((r) => match(r.name, r.path, r.remote)) && <p className="lc-quiet lc-mp-none">No repository here matches that.</p>}
              <Sep />
              <Row title="Choose a folder…" note={`Any folder on ${os.here}`} icon={<I.plus size={16} />} disabled={busy !== null} onPick={() =>
                  void bridge.pickFolder().then((path) => {
                    if (path) void add(path, () => rpc("project.add", { path }));
                  })
                } />
              <Row title="Look again" icon={<I.refresh size={16} />} onPick={() => loadMac(true)} />
            </>
          ))}
        {tab === "github" &&
          (gh === null ? (
            <p className="l-shimmer lc-mp-none">Asking GitHub</p>
          ) : gh.gh === "missing" ? (
            <div className="lc-pc-note">
              <b>Connecting GitHub needs the GitHub CLI</b>
              <p>Liner Code reads your repositories through it, signed in as you, and keeps no token of its own.</p>
              <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => bridge.runInTerminal(ghInstall())}>
                Install it in Terminal
              </button>
            </div>
          ) : gh.gh === "signed-out" ? (
            <div className="lc-pc-note">
              <b>Connect GitHub</b>
              <p>Sign the GitHub CLI in once; your repositories show here{ROUTINES_ON ? ", and routines can watch their pull requests" : ""}.</p>
              <span className="lc-noproj-acts">
                <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => bridge.runInTerminal("gh auth login")}>
                  Sign in in Terminal
                </button>
                <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => loadGh(true)}>
                  I've signed in
                </button>
              </span>
            </div>
          ) : (
            <>
              {gh.detail && <p className="lc-pr-warn lc-pc-warn">{gh.detail}</p>}
              {gh.repos
                .filter((r) => match(r.fullName, r.description))
                .map((r) => {
                  const p = r.projectId ? projects.find((x) => x.id === r.projectId) : undefined;
                  return (
                    <Row
                      key={r.fullName}
                      title={
                        <>
                          {r.fullName}
                          {r.private && <I.lock size={12} />}
                        </>
                      }
                      note={[r.description, r.pushedAt ? `pushed ${since(r.pushedAt)}` : ""].filter(Boolean).join(" · ")}
                      on={Boolean(p && p.id === value)}
                      icon={<I.pr size={16} />}
                      end={busy === r.fullName ? <span className="l-shimmer">Cloning</span> : p ? <span className="lc-quiet">Added</span> : <span className="lc-pc-clone">Clone</span>}
                      disabled={busy !== null}
                      onPick={() => (p ? onPick(p) : void add(r.fullName, () => rpc("project.clone", { url: r.fullName })))}
                    />
                  );
                })}
              {gh.repos.length === 0 ? !gh.detail && <p className="lc-quiet lc-mp-none">No repositories on this account yet.</p> : !gh.repos.some((r) => match(r.fullName, r.description)) && <p className="lc-quiet lc-mp-none">No repository matches that.</p>}
              <p className="lc-pc-foot lc-quiet">
                {gh.login ? `Signed in as ${gh.login}. ` : ""}Clones go to {tilde(root ?? "~/Code")}.{" "}
                <button type="button" className="lc-link l-focus" onClick={() => loadGh(true)}>
                  Look again
                </button>
              </p>
            </>
          ))}
      </div>
      {extra}
    </div>
  );
}
