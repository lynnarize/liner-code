/*
  Choosing a project, the way GitHub Desktop adds one: the projects already here, the Git
  repositories found on this Mac, or your repositories on GitHub (through the GitHub CLI,
  signed in as you), which clone with one press. Picking one that isn't here yet adds it.
*/
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FoundRepo, GitHubRepo, Project } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "./bridge";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { since } from "./model";
import { Row, Sep } from "./ui";
import "./models.css";

type Tab = "here" | "mac" | "github";
type GitHub = { gh: "ready" | "missing" | "signed-out"; detail?: string; login?: string; repos: GitHubRepo[] };

// Scanning and asking GitHub take a moment, so the answers are kept while the app is open.
let found: Promise<FoundRepo[]> | null = null;
let github: Promise<GitHub> | null = null;
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

export function ProjectChooser({ value, onPick, need, extra }: { value?: string; onPick: (p: Project) => void; need?: "github"; extra?: ReactNode }) {
  const projects = useEngine((s) => s.projects);
  const root = useEngine((s) => s.settings.projectsRoot);
  const [tab, setTab] = useState<Tab>("here");
  const [query, setQuery] = useState("");
  const [mac, setMac] = useState<FoundRepo[] | null>(null);
  const [gh, setGh] = useState<GitHub | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadMac = (again = false) => {
    if (again || !found) found = rpc("projects.scan", {}).catch(() => []);
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
          { value: "mac", label: "On this Mac" },
          { value: "github", label: "GitHub" },
        ]}
        aria-label="Where to choose from"
      />
      <div className="lc-mp-find lc-pc-find">
        <I.search size={13} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === "github" ? "Find a repository" : "Find a project"} aria-label="Find" spellCheck={false} />
      </div>
      <div className="lc-pc-list">
        {tab === "here" && (
          <>
            {here.map((p) => (
              <Row key={p.id} title={p.name} note={[p.remote ?? tilde(p.path), noRemote(p.remote) ? "no GitHub remote" : ""].filter(Boolean).join(" · ")} on={p.id === value} icon={<I.folder size={13} />} onPick={() => onPick(p)} />
            ))}
            {here.length === 0 && <p className="lc-quiet lc-mp-none">{q ? "No project matches that." : "No projects yet. Find one on this Mac or on GitHub."}</p>}
          </>
        )}
        {tab === "mac" &&
          (mac === null ? (
            <p className="l-shimmer lc-mp-none">Looking through your code folders</p>
          ) : (
            <>
              {mac
                .filter((r) => match(r.name, r.path, r.remote))
                .map((r) => {
                  const p = projects.find((x) => x.path === r.path);
                  return (
                    <Row
                      key={r.path}
                      title={r.name}
                      note={[tilde(r.path), r.branch, r.lastCommitAt ? since(r.lastCommitAt) : "", noRemote(r.remote) ? "no GitHub remote" : ""].filter(Boolean).join(" · ")}
                      on={p?.id === value}
                      icon={<I.folder size={13} />}
                      end={busy === r.path ? <span className="l-shimmer">Adding</span> : p ? <span className="lc-quiet">Added</span> : undefined}
                      disabled={busy !== null}
                      onPick={() => (p ? onPick(p) : void add(r.path, () => rpc("project.add", { path: r.path })))}
                    />
                  );
                })}
              {mac.length === 0 && <p className="lc-quiet lc-mp-none">No Git repositories in the usual folders.</p>}
              <Sep />
              <Row title="Choose a folder…" note="Any folder on this Mac" icon={<I.plus size={13} />} disabled={busy !== null} onPick={() =>
                  void bridge.pickFolder().then((path) => {
                    if (path) void add(path, () => rpc("project.add", { path }));
                  })
                } />
              <Row title="Look again" icon={<I.refresh size={13} />} onPick={() => loadMac(true)} />
            </>
          ))}
        {tab === "github" &&
          (gh === null ? (
            <p className="l-shimmer lc-mp-none">Asking GitHub</p>
          ) : gh.gh === "missing" ? (
            <div className="lc-pc-note">
              <b>Connecting GitHub needs the GitHub CLI</b>
              <p>Liner Code reads your repositories through it, signed in as you, and keeps no token of its own.</p>
              <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => bridge.runInTerminal("brew install gh && gh auth login")}>
                Install it in Terminal
              </button>
            </div>
          ) : gh.gh === "signed-out" ? (
            <div className="lc-pc-note">
              <b>Connect GitHub</b>
              <p>Sign the GitHub CLI in once; your repositories show here, and routines can watch their pull requests.</p>
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
                          {r.private && <I.lock size={11} />}
                        </>
                      }
                      note={[r.description, r.pushedAt ? `pushed ${since(r.pushedAt)}` : ""].filter(Boolean).join(" · ")}
                      on={Boolean(p && p.id === value)}
                      icon={<I.pr size={13} />}
                      end={busy === r.fullName ? <span className="l-shimmer">Cloning</span> : p ? <span className="lc-quiet">Here</span> : <span className="lc-pc-clone">Clone</span>}
                      disabled={busy !== null}
                      onPick={() => (p ? onPick(p) : void add(r.fullName, () => rpc("project.clone", { url: r.fullName })))}
                    />
                  );
                })}
              {gh.repos.length === 0 && !gh.detail && <p className="lc-quiet lc-mp-none">No repositories on this account yet.</p>}
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
