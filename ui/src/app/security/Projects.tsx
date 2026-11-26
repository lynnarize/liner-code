/*
  Liner Security: Projects (board G), Devin's Repositories page in Liner's shape. One bordered card per folder Liner Code
  knows, so a project's facts read as one thing, each named above its value: open findings as a thin bar, the last scan,
  the threat model, the free checks, and Scan (Start a scan for that folder). The open card holds two tiles: the areas
  its SECURITY.md names with a square per open finding in each ("Open in your editor" opens the file), and its scans with who
  runs them. Tabs narrow the list (All, With open findings, Never scanned); Add a project is the app's own folder picker,
  added through security.project.add (the same words as the Code sidebar's). Start a scan is the sidebar's, and each
  row's Scan, so the top row doesn't repeat it. Builder U1.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { ScanRecord, SecurityFinding, SecurityProject } from "@contracts";
import { SEVERITIES } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "../bridge";
import { rpc, useEngine } from "../engine";
import { I, MARK_WORD, ModelMark, StepMark, type StepState } from "../icons";
import { PaneField, PaneNote, PaneTool } from "../Pane";
import { modelLabel, plural, providerLabel, shortName, toolMarkOf } from "../model";
import { useSec } from "./data";
import { CountTabs, PageTop, SevBar } from "./parts";
import { addSecurityFolder, goSecurity, useSecurityProjects } from "./store";
import { shortPath, when, whenShort } from "./when";
import "./overview.css";

type Tab = "all" | "open" | "never";
const neverScanned = (p: SecurityProject) => !p.lastScan && !p.checks;
/** A scan's kind as a project's facts say it. */
const DEPTH_SHORT = { project: "The whole project", branch: "This branch", checks: "Free checks", pr: "A pull request", issue: "An issue" } as const;
const LAST_SHORT = { project: "Whole project", branch: "This branch", checks: "Free checks", pr: "A pull request", issue: "An issue" } as const;

export function Projects({ sidebar, onSidebar, projectId }: { sidebar: boolean; onSidebar: () => void; /** The card open, when one is. */ projectId?: string }) {
  const { data: everyOne, error, reload } = useSec("security.projects", {});
  // Never the Demo's Sample project (store.ts useSecurityProjects).
  const { hidden } = useSecurityProjects();
  const data = useMemo(() => everyOne?.filter((p) => !hidden(p.projectId)) ?? null, [everyOne, hidden]);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null | undefined>(projectId);
  const find = useRef<HTMLInputElement>(null);
  const list = data ?? [];
  // With nothing asked for, the first project with something open starts open, as on board G.
  const shown = open === undefined ? (list.find((p) => p.open > 0)?.projectId ?? null) : open;
  useEffect(() => setOpen(projectId), [projectId]);

  const counts = { all: list.length, open: list.filter((p) => p.open > 0).length, never: list.filter(neverScanned).length };
  const q = (query ?? "").trim().toLowerCase();
  const rows = list.filter((p) => (tab === "all" || (tab === "open" ? p.open > 0 : neverScanned(p))) && (!q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)));

  const add = async () => {
    const id = await addSecurityFolder(hidden);
    if (!id) return;
    reload();
    setTab("all");
    setOpen(id);
  };

  return (
    <div className="ls-page">
      <PageTop title="Projects" sidebar={sidebar} onSidebar={onSidebar}>
        {/* The find field is always there, the panel's own (PaneField), as on Findings and in a scan's Found panel: no toggle
            to get out of step with it. Escape empties it. */}
        <PaneField className="lo-find" icon={<I.search size={14} />}>
          <input ref={find} value={query ?? ""} placeholder="Find a project" aria-label="Find a project" onChange={(e) => setQuery(e.target.value || null)} onKeyDown={(e) => e.key === "Escape" && query && (e.preventDefault(), setQuery(null))} />
        </PaneField>
        <button type="button" className="lc-btn l-focus" data-kind="ink" data-size="sm" onClick={() => void add()}>
          Add a project
        </button>
      </PageTop>
      <div className="ls-scroll">
        <div className="lo-col lo-col-g" data-loading={data === null || undefined}>
          <h2 className="lo-h1">{data ? plural(list.length, "project") : "Projects"}</h2>
          <p className="lo-sub">The folders you work on in Liner Code. Open one to see what its scans found.</p>
          <div className="lo-tabs">
            <CountTabs<Tab>
              value={tab}
              onChange={setTab}
              label="Which projects"
              tabs={[
                { value: "all", label: "All", count: counts.all },
                { value: "open", label: "With open findings", count: counts.open },
                { value: "never", label: "Never scanned", count: counts.never },
              ]}
            />
          </div>
          {error && !data ? (
            <PaneNote icon={<I.folder size={16} />} title="The projects didn't load">{error}</PaneNote>
          ) : data && !list.length ? (
            <PaneNote icon={<I.folder size={16} />} title="No folders yet">Add a folder you work on, then scan it. Add a project is at the top.</PaneNote>
          ) : data && !rows.length ? (
            <PaneNote icon={<I.search size={16} />} title={q ? `No project matches “${query?.trim()}”` : tab === "open" ? "No project has anything open" : "Every project has been scanned"} />
          ) : (
            <div className="ls-card lo-ptable" role="table" aria-label="Projects">
              <div className="lo-tr lo-th" role="row">
                <span className="lo-td" role="columnheader">Project</span>
                <span className="lo-td" role="columnheader">Open findings</span>
                <span className="lo-td" role="columnheader">Last scan</span>
                <span className="lo-td lo-td-tm" role="columnheader">Threat model</span>
                <span className="lo-td lo-td-fc" role="columnheader">Free checks</span>
                <span className="lo-td lo-td-act" role="columnheader"><span className="l-sr-only">Actions</span></span>
              </div>
              {rows.map((p) => <ProjectRow key={p.projectId} p={p} open={p.projectId === shown} onToggle={() => setOpen(p.projectId === shown ? null : p.projectId)} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One folder's card: its facts in a row, and when open, its areas and its scans. */
/**
  One folder as a row of the table (after Devin's Repositories, in Liner's look): its name, open findings as a thin bar
  and a count, the last scan, the threat model and the free checks, each short enough for its column; Scan and the open
  chevron at the end, shown on hover, on keyboard focus and on the open row. A click anywhere on it opens it in place,
  with its areas and its scans under it in the same box.
*/
function ProjectRow({ p, open, onToggle }: { p: SecurityProject; open: boolean; onToggle: () => void }) {
  const never = neverScanned(p);
  const found = p.checks?.results.reduce((n, r) => n + (r.state === "found" ? r.count : 0), 0) ?? 0;
  const checked = p.checks?.results.some((r) => r.state === "clean" || r.state === "found");
  const last = p.lastScan ? `${LAST_SHORT[p.lastScan.depth]} · ${whenShort(p.lastScan.finishedAt ?? p.lastScan.startedAt)}` : "";
  const model = p.threatModel.exists ? `${p.threatModel.file} · ${plural(p.threatModel.areas.length, "area")}` : "";
  return (
    <div className="lo-tr-wrap" data-open={open || undefined} role="rowgroup">
      <div className="lo-tr" role="row" onClick={(e) => !(e.target as HTMLElement).closest(".lo-scan") && onToggle()}>
        <span className="lo-td lo-td-name" role="cell">
          <button type="button" className="lo-pname l-focus" aria-expanded={open} aria-label={`${p.name}, ${open ? "shut" : "open"} it`} title={`${p.name}\n${p.path}`} onClick={(e) => (e.stopPropagation(), onToggle())}>
            <I.folder size={14} />
            <span className="lo-tl1">
              <b className="lo-ell">{p.name}</b>
              {open && <small className="lo-mono lo-ell">{shortPath(p.path, 40)}</small>}
            </span>
          </button>
        </span>
        <span className="lo-td" role="cell">
          {never ? (
            <span className="lo-q">Not scanned</span>
          ) : (
            <span className="lo-pf" data-quiet={!p.open || undefined}>
              <SevBar counts={p.bySeverity} width={64} />
              <b>{p.open}</b>
            </span>
          )}
        </span>
        <span className="lo-td lo-ell" role="cell" title={last || undefined}>{last || <span className="lo-q">Never</span>}</span>
        <span className="lo-td lo-td-tm lo-ell" role="cell" title={model || undefined}>
          {p.threatModel.exists ? (
            <>
              <span className="lo-mono">{p.threatModel.file}</span> · {plural(p.threatModel.areas.length, "area")}
            </>
          ) : (
            <span className="lo-q">None yet</span>
          )}
        </span>
        <span className="lo-td lo-td-fc lo-ell" role="cell">{!p.checks || !checked ? <span className="lo-q">Not run</span> : found ? `${found} found` : <span className="lo-stt" data-tone="ok">Clean</span>}</span>
        <span className="lo-td lo-td-act" role="cell">
          <button type="button" className="lc-btn lo-scan l-focus" data-kind="ghost" data-size="sm" aria-label={`Scan ${p.name}`} onClick={() => goSecurity({ kind: "start", projectId: p.projectId })}>
            Scan
          </button>
          <span className="lo-chev" aria-hidden>{open ? <I.chevU size={14} /> : <I.chevD size={14} />}</span>
        </span>
      </div>
      {open && (
        <div className="lo-tr-in" role="row">
          <Inside p={p} />
        </div>
      )}
    </div>
  );
}

/** The open card's two tiles: the threat model's areas with what is open in each, and the scans with who runs them. */
function Inside({ p }: { p: SecurityProject }) {
  const { data: findings } = useSec("security.findings.list", { projectId: p.projectId }, ["findings"]);
  const providers = useEngine((s) => s.providers);
  const all = findings ?? [];
  const open = all.filter((f) => f.state === "open");
  const areas = p.threatModel.areas;
  const inArea = (name: string) => open.filter((f) => f.area?.trim().toLowerCase() === name.trim().toLowerCase());
  const outside = open.filter((f) => !areas.some((a) => a.name.trim().toLowerCase() === f.area?.trim().toLowerCase()));
  const readFile = () => bridge.openIn(`${p.path.replace(/\/$/, "")}/${p.threatModel.file}`, "editor");

  // Who runs its scans: each reader once ("scans"), then the second looks ("second look").
  const who = useMemo(() => {
    const rows: { ref: string; what: string }[] = [];
    for (const r of p.readers) if (r !== "free checks" && !rows.some((x) => x.ref === r)) rows.push({ ref: r, what: "scans" });
    for (const s of p.scans) if (s.secondLook && !rows.some((x) => x.ref === s.secondLook)) rows.push({ ref: s.secondLook, what: "second look" });
    return rows;
  }, [p.readers, p.scans]);

  const [editingMd, setEditingMd] = useState(false);
  const [mdText, setMdText] = useState("");
  const [mdSaving, setMdSaving] = useState(false);
  const openInlineEditor = async () => {
    try {
      const r = await rpc("security.model.text", { projectId: p.projectId });
      setMdText(r.text || `# Security threat model — ${p.name}\n\n## Areas\n\n### Authentication & Sessions\n- Key entry points, tokens, and session boundaries.\n\n### Data & Storage\n- Sensitive data handling and access controls.\n`);
      setEditingMd(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const saveInlineEditor = async () => {
    setMdSaving(true);
    try {
      await rpc("security.model.write", { projectId: p.projectId, text: mdText });
      toast.success(`Saved ${p.threatModel.file}`);
      setEditingMd(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMdSaving(false);
    }
  };

  return (
    <div className="lo-ptiles">
      <div className="lo-ptile">
        <div className="ls-blkh">
          Areas in the threat model
          <button type="button" className="lo-lk l-focus" onClick={() => (editingMd ? setEditingMd(false) : void openInlineEditor())}>
            {editingMd ? "Close editor" : p.threatModel.exists ? `Edit ${p.threatModel.file}` : `Draft ${p.threatModel.file}`}
          </button>
          {/* Open in your editor is the open-elsewhere icon, as at the end of a file's row in Changes. */}
          {p.threatModel.exists && <PaneTool label={`Open ${p.threatModel.file} in your editor`} icon={<I.external size={14} />} onClick={readFile} />}
        </div>
        {editingMd ? (
          <div className="lo-md">
            <textarea
              className="lc-input lc-mono"
              rows={10}
              aria-label={`Edit ${p.threatModel.file}`}
              value={mdText}
              onChange={(e) => setMdText(e.target.value)}
            />
            <div className="lo-md-acts">
              <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" disabled={mdSaving} onClick={() => setEditingMd(false)}>
                Cancel
              </button>
              <button type="button" className="lc-btn l-focus" data-kind="ink" data-size="sm" disabled={mdSaving} onClick={() => void saveInlineEditor()}>
                {mdSaving ? "Saving…" : `Save ${p.threatModel.file}`}
              </button>
            </div>
          </div>
        ) : !p.threatModel.exists ? (
          <p className="lo-q lo-tilep">No {p.threatModel.file} yet. Draft one inline above, or let the first full-project scan write one.</p>
        ) : (
          <>
            {areas.map((a) => (
              <AreaRow key={a.name} name={a.name} line={a.line} found={findings ? inArea(a.name) : null} count={a.open} />
            ))}
            {outside.length > 0 && <AreaRow name="Outside the areas" found={outside} count={outside.length} />}
          </>
        )}
      </div>
      <div className="lo-ptile">
        <div className="ls-blkh">Scans</div>
        {p.scans.length ? p.scans.map((s) => <ScanRow key={s.id} s={s} found={all.filter((f) => f.scan === s.id)} />) : <p className="lo-q lo-tilep">Not scanned yet.</p>}
        <div className="ls-blkh lo-sp2">Who scans it</div>
        {who.length ? (
          who.map((w) => {
            const ref = w.ref.replace(/^@/, "");
            const model = shortName(modelLabel(ref, providers));
            const tool = providerLabel(ref, providers);
            return (
              <div key={w.ref} className="lo-prow">
                <span className="lo-grow lo-wm">
                  <ModelMark kind={toolMarkOf(ref.split(":")[0])} size={14} />
                  <span className="lo-ell">{model && model !== tool ? `${tool} · ${model}` : tool}</span>
                </span>
                <span className="lo-q">{w.what}</span>
              </div>
            );
          })
        ) : (
          <p className="lo-q lo-tilep">{p.readers.includes("free checks") ? "Only the free checks so far, no agent." : "Nobody yet. Start a scan picks who reads it."}</p>
        )}
      </div>
    </div>
  );
}

/** An area and what is open in it: a square per open finding in its severity's colour, worst first, and the count. */
function AreaRow({ name, line, found, count }: { name: string; line?: string; found: SecurityFinding[] | null; count: number }) {
  const n = found?.length ?? count;
  const squares = (found ?? []).slice().sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)).slice(0, 8);
  return (
    <div className="lo-prow" title={line || undefined}>
      <span className="lo-grow lo-ell">{name}</span>
      {n > 0 ? (
        <>
          <span className="lo-dots" aria-hidden>
            {squares.map((f) => (
              <i key={f.id} data-tone={f.severity} />
            ))}
          </span>
          <span>{n} open</span>
        </>
      ) : (
        <span className="lo-q">Nothing open</span>
      )}
    </div>
  );
}

/** A scan's mark in the list of its scans, as every list of steps draws it (StepMark): working, a ring while it waits on you, a cross when it stopped or failed, else the tick. */
const scanStep = (s: ScanRecord): StepState => (s.state === "running" ? "working" : s.state === "asking" ? "waiting" : s.state === "stopped" || s.state === "failed" ? "failed" : "done");

/** One of its scans: its state mark, what it read, when, and what came of it ("4 found", "1 found, dismissed"). Opens its session. */
function ScanRow({ s, found }: { s: ScanRecord; found: SecurityFinding[] }) {
  const at = s.finishedAt ?? s.startedAt;
  const ago = when(at);
  const fate = found.length && found.length === s.counts.found ? (found.every((f) => f.state === "dismissed") ? ", dismissed" : found.every((f) => f.state === "fixed") ? ", fixed" : "") : "";
  // Worded as the sidebar's rows word a scan: Working, Needs you, Stopped, Ran into a problem, else what it found.
  const res = s.state === "running" ? MARK_WORD.working : s.state === "asking" ? MARK_WORD.needs : s.state === "stopped" ? "Stopped" : s.state === "failed" ? MARK_WORD.problem : s.counts.found ? `${s.counts.found} found${fate}` : "Nothing found";
  const body = (
    <>
      <StepMark state={scanStep(s)} size={14} label={s.state === "stopped" ? "Stopped" : res} />
      <span className="lo-grow lo-ell">{DEPTH_SHORT[s.depth]}</span>
      <span className="lo-q lo-when">{ago}</span>
      <span className="lo-res">{res}</span>
    </>
  );
  return s.threadId ? (
    <button type="button" className="lo-prow lo-prow-go l-focus" onClick={() => goSecurity({ kind: "scan", threadId: s.threadId! })} aria-label={`${DEPTH_SHORT[s.depth]}, ${ago}: ${res}. Open the scan`}>
      {body}
    </button>
  ) : (
    <div className="lo-prow">{body}</div>
  );
}
