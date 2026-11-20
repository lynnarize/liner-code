/*
  Choosing a project, the way GitHub Desktop adds one: the projects already here, the Git
  repositories found on this Mac, or your repositories on GitHub (through the GitHub CLI,
  signed in as you), which clone with one press. Picking one that isn't here yet adds it.
  Home's quick pick is the small one, as Devin's folder picker: your projects on one line each,
  the last used first, with the folder's path after the name, and the ways to add one under them;
  From GitHub and Find on this Mac open the full chooser in its place.
*/
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ROUTINES_ON, type FoundRepo, type GitHubRepo, type Project } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { bridge, ghInstall } from "./bridge";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { listedProjects, since } from "./model";
import { Row, Sep } from "./ui";
import * as os from "./os";
import "./models.css";

type Tab = "here" | "mac" | "github";
type GitHub = { gh: "ready" | "missing" | "signed-out"; detail?: string; login?: string; repos: GitHubRepo[] };

// Scanning and asking GitHub take a moment, so the answers are kept while the app is open.
let found: Promise<{ repos: FoundRepo[]; detail?: string }> | null = null;
let github: Promise<GitHub> | null = null;
const tilde = os.tilde;

/** How many projects the quick pick shows before it offers a find field. */
const QUICK = 8;

/** One line in the quick pick: an icon, a name, then something grey after it, and a check at the end. `hl`: what Enter in the find field picks. */
function QuickRow({ icon, title, note, on, hl, onPick }: { icon: ReactNode; title: string; note?: string; on?: boolean; hl?: boolean; onPick: () => void }) {
  return (
    <button type="button" className="lc-qp-row l-focus" data-on={on || undefined} data-hl={hl || undefined} aria-pressed={on === undefined ? undefined : on} title={note ? `${title} · ${note}` : undefined} onClick={onPick}>
      <span className="lc-qp-icon">{icon}</span>
      <span className="lc-qp-name">{title}</span>
      {/* The path ends where the folder is: a long one gives way at its start, so its end stays. */}
      {note ? <span className="lc-qp-path">{`\u200e${note}\u200e`}</span> : <span className="lc-grow" />}
      {on && <I.check size={14} />}
    </button>
  );
}

/**
  Home's project picker, compact: Recent, your projects one line each (the last used first, the
  rest by name, eight at most; with more, a find field over them that looks through all), then
  Add folder, From GitHub and Find on this Mac, and `more` (Home's own rows) at the end. The two
  that look further open the full chooser on that tab, in the same panel, with Recent over it to
  come back and `more` under it.
*/
export function ProjectQuickPick({ value, onPick, more = [] }: { value?: string; onPick: (p: Project) => void; more?: { title: string; icon: ReactNode; onPick: () => void }[] }) {
  const all = useEngine((s) => s.projects);
  const threads = useEngine((s) => s.threads);
  const [full, setFull] = useState<Tab | null>(null);
  const [query, setQuery] = useState("");
  // The find field has the keyboard: Enter there picks the first project shown, marked so.
  const [finding, setFinding] = useState(false);
  // When you last worked in each project: its newest session's last activity.
  const used = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of threads) if (!t.archived) m.set(t.projectId, Math.max(m.get(t.projectId) ?? 0, t.updatedAt));
    return m;
  }, [threads]);
  const projects = useMemo(() => listedProjects(all).sort((a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0) || a.name.localeCompare(b.name)), [all, used]);
  const many = projects.length > QUICK;
  const q = query.trim().toLowerCase();
  const shown = q ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)) : projects.slice(0, QUICK);
  const add = (path: string | null) => {
    if (!path) return;
    void rpc("project.add", { path }).then(onPick, (e: Error) => toast.error(e.message));
  };
  const extras = more.map((m) => <QuickRow key={m.title} icon={m.icon} title={m.title} onPick={m.onPick} />);
  // The full chooser in its place, with the way back to the short list over it and Home's own rows under it.
  if (full)
    return (
      <div className="lc-qp">
        <QuickRow icon={<I.chevL size={14} />} title="Recent" onPick={() => setFull(null)} />
        <ProjectChooser value={value} onPick={onPick} initialTab={full} extra={extras.length ? (<><Sep />{extras}</>) : undefined} />
      </div>
    );
  // The arrow keys go over the rows (and up from the first, back to the find field); Escape is the panel's.
  const arrows = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || e.altKey || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return;
    const field = e.currentTarget.querySelector<HTMLInputElement>(".lc-qp-find input");
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(".lc-qp-row:not(:disabled)")];
    if (!rows.length) return;
    e.preventDefault();
    const down = e.key === "ArrowDown";
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const to = i < 0 ? (down ? rows[0] : rows[rows.length - 1]) : down ? (rows[i + 1] ?? field ?? rows[0]) : (rows[i - 1] ?? field ?? rows[rows.length - 1]);
    to.focus();
    to.scrollIntoView({ block: "nearest" });
  };
  return (
    <div className="lc-qp" onKeyDown={arrows}>
      {many && (
        <div className="lc-mp-find lc-qp-find">
          <I.search size={14} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFinding(true)}
            onBlur={() => setFinding(false)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing || !shown[0]) return;
              e.preventDefault();
              onPick(shown[0]);
            }}
            placeholder="Find a project"
            aria-label="Find a project"
            spellCheck={false}
          />
        </div>
      )}
      {projects.length > 0 && <div className="lc-qp-head">{q ? "Projects" : "Recent"}</div>}
      <div className="lc-qp-list">
        {shown.map((p, i) => (
          <QuickRow key={p.id} icon={<I.folder size={16} />} title={p.name} note={tilde(p.path)} on={p.id === value} hl={finding && i === 0} onPick={() => onPick(p)} />
        ))}
        {q && shown.length === 0 && <p className="lc-quiet lc-qp-none">No project matches that.</p>}
      </div>
      {projects.length > 0 && <Sep />}
      <QuickRow icon={<I.folderPlus size={16} />} title="Add folder…" onPick={() => void bridge.pickFolder().then(add)} />
      <QuickRow icon={<I.pr size={16} />} title="From GitHub…" onPick={() => setFull("github")} />
      <QuickRow icon={<I.laptop size={16} />} title={`Find on ${os.here}…`} onPick={() => setFull("mac")} />
      {extras}
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
      <div className="lc-mp-find lc-pc-find">
        <I.search size={14} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === "github" ? "Find a repository" : "Find a project"} aria-label="Find" spellCheck={false} />
      </div>
      <div className="lc-pc-list">
        {tab === "here" && (
          <>
            {here.map((p) => (
              <Row key={p.id} title={p.name} note={[p.remote ?? tilde(p.path), noRemote(p.remote) ? "no GitHub remote" : ""].filter(Boolean).join(" · ")} on={p.id === value} icon={<I.folder size={14} />} onPick={() => onPick(p)} />
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
                      note={[tilde(r.path), r.branch, r.lastCommitAt ? since(r.lastCommitAt) : "", noRemote(r.remote) ? "no GitHub remote" : ""].filter(Boolean).join(" · ")}
                      on={p?.id === value}
                      icon={<I.folder size={14} />}
                      end={busy === r.path ? <span className="l-shimmer">Adding</span> : p ? <span className="lc-quiet">Added</span> : undefined}
                      disabled={busy !== null}
                      onPick={() => (p ? onPick(p) : void add(r.path, () => rpc("project.add", { path: r.path })))}
                    />
                  );
                })}
              {mac.repos.length === 0 ? !mac.detail && <p className="lc-quiet lc-mp-none">No Git repositories in the usual folders.</p> : !mac.repos.some((r) => match(r.name, r.path, r.remote)) && <p className="lc-quiet lc-mp-none">No repository here matches that.</p>}
              <Sep />
              <Row title="Choose a folder…" note={`Any folder on ${os.here}`} icon={<I.plus size={14} />} disabled={busy !== null} onPick={() =>
                  void bridge.pickFolder().then((path) => {
                    if (path) void add(path, () => rpc("project.add", { path }));
                  })
                } />
              <Row title="Look again" icon={<I.refresh size={14} />} onPick={() => loadMac(true)} />
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
                      icon={<I.pr size={14} />}
                      end={busy === r.fullName ? <span className="l-shimmer">Cloning</span> : p ? <span className="lc-quiet">Here</span> : <span className="lc-pc-clone">Clone</span>}
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
