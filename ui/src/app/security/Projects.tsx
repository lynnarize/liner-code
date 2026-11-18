/*
  Liner Security: Projects (board G), Devin's Repositories page in Liner's shape. One bordered card per folder Liner Code
  knows, so a project's facts read as one thing, each named above its value: open findings as a thin bar, the last scan,
  the threat model, the free checks, and Scan (Start a scan for that folder). The open card holds two tiles: the areas
  its SECURITY.md names with a square per open finding in each ("Read or edit" opens the file), and its scans with who
  runs them. Tabs narrow the list (All, With open findings, Never scanned); Add a folder is the app's own folder picker,
  added through security.project.add. Builder U1.
*/
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ScanRecord, SecurityFinding, SecurityProject } from "@contracts";
import { SEVERITIES } from "@contracts";
import { bridge } from "../bridge";
import { rpc, useEngine } from "../engine";
import { I, ModelMark } from "../icons";
import { modelLabel, plural, providerLabel, shortName, toolMarkOf } from "../model";
import { toast } from "@liner/components/toast/toast";
import { useSec } from "./data";
import { CountTabs, PageTop, SevBar } from "./parts";
import { goSecurity } from "./store";
import { shortPath, when } from "./when";
import "./overview.css";

type Tab = "all" | "open" | "never";
const neverScanned = (p: SecurityProject) => !p.lastScan && !p.checks;
/** A scan's kind as a project's facts say it. */
const DEPTH_SHORT = { project: "The whole project", branch: "This branch", checks: "Free checks" } as const;
const LAST_SHORT = { project: "Whole project", branch: "This branch", checks: "Free checks" } as const;

export function Projects({ sidebar, onSidebar, projectId }: { sidebar: boolean; onSidebar: () => void; /** The card open, when one is. */ projectId?: string }) {
  const { data, error, reload } = useSec("security.projects", {});
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null | undefined>(projectId);
  const find = useRef<HTMLInputElement>(null);
  const list = data ?? [];
  // With nothing asked for, the first project with something open starts open, as on board G.
  const shown = open === undefined ? (list.find((p) => p.open > 0)?.projectId ?? null) : open;
  useEffect(() => setOpen(projectId), [projectId]);
  useEffect(() => {
    if (query !== null) find.current?.focus();
  }, [query !== null]);

  const counts = { all: list.length, open: list.filter((p) => p.open > 0).length, never: list.filter(neverScanned).length };
  const q = (query ?? "").trim().toLowerCase();
  const rows = list.filter((p) => (tab === "all" || (tab === "open" ? p.open > 0 : neverScanned(p))) && (!q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)));

  const add = async () => {
    const path = await bridge.pickFolder();
    if (!path) return;
    try {
      const p = await rpc("security.project.add", { path });
      reload();
      setTab("all");
      setOpen(p.projectId);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="ls-page">
      <PageTop title="Projects" sidebar={sidebar} onSidebar={onSidebar}>
        {query !== null ? (
          <span className="lo-find">
            <I.search size={14} />
            <input ref={find} value={query} placeholder="Find a project" aria-label="Find a project" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery(null)} onBlur={() => !query && setQuery(null)} />
          </span>
        ) : (
          <button type="button" className="lc-tb l-focus" aria-label="Search the projects" onClick={() => setQuery("")}>
            <I.search size={16} />
          </button>
        )}
        <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" onClick={() => void add()}>
          Add a folder
        </button>
        <button type="button" className="lc-btn lo-go l-focus" data-kind="ink" data-size="sm" onClick={() => goSecurity({ kind: "start" })}>
          Start a scan
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
            <div className="ls-none">
              <b>The projects didn't load</b>
              <span>{error}</span>
            </div>
          ) : data && !list.length ? (
            <div className="ls-card lo-empty">
              <span className="ls-disc"><I.folder size={16} /></span>
              <b>No folders yet</b>
              <span>Add a folder you work on, then scan it.</span>
              <button type="button" className="lc-btn l-focus" data-kind="ink" data-size="sm" onClick={() => void add()}>
                Add a folder
              </button>
            </div>
          ) : data && !rows.length ? (
            <p className="lo-q lo-pad">{q ? `No project matches “${query?.trim()}”.` : tab === "open" ? "No project has anything open." : "Every project has been scanned."}</p>
          ) : (
            rows.map((p) => <ProjectCard key={p.projectId} p={p} open={p.projectId === shown} onToggle={() => setOpen(p.projectId === shown ? null : p.projectId)} />)
          )}
        </div>
      </div>
    </div>
  );
}

/** One folder's card: its facts in a row, and when open, its areas and its scans. */
function ProjectCard({ p, open, onToggle }: { p: SecurityProject; open: boolean; onToggle: () => void }) {
  const never = neverScanned(p);
  const found = p.checks?.results.reduce((n, r) => n + (r.state === "found" ? r.count : 0), 0) ?? 0;
  const checked = p.checks?.results.some((r) => r.state === "clean" || r.state === "found");
  return (
    <section className="lo-pcard" data-open={open || undefined} aria-label={p.name}>
      <div className="lo-phead">
        <button type="button" className="lo-pname l-focus" aria-expanded={open} onClick={onToggle}>
          {open ? <I.chevD size={14} /> : <I.chevR size={14} />}
          <span className="ls-tl2">
            <b>{p.name}</b>
            <small className="lo-mono" title={p.path}>{shortPath(p.path)}</small>
          </span>
        </button>
        <Fact name="Open findings">
          {never ? (
            <span className="lo-q">Not scanned</span>
          ) : (
            <span className="lo-pf" data-quiet={!p.open || undefined}>
              <SevBar counts={p.bySeverity} width={96} />
              <b>{p.open}</b>
            </span>
          )}
        </Fact>
        <Fact name="Last scan">{p.lastScan ? `${LAST_SHORT[p.lastScan.depth]}, ${when(p.lastScan.finishedAt ?? p.lastScan.startedAt)}` : <span className="lo-q">Never</span>}</Fact>
        <Fact name="Threat model">
          {p.threatModel.exists ? (
            <span className="lo-ell">
              <span className="lo-mono">{p.threatModel.file}</span>, {plural(p.threatModel.areas.length, "area")}
            </span>
          ) : (
            <span className="lo-q">None yet</span>
          )}
        </Fact>
        <Fact name="Free checks">{!p.checks || !checked ? <span className="lo-q">Not run</span> : found ? `${found} found` : <span className="lo-stt" data-tone="ok">Clean</span>}</Fact>
        <button type="button" className="lc-btn lo-scan l-focus" data-size="sm" aria-label={`Scan ${p.name}`} onClick={() => goSecurity({ kind: "start", projectId: p.projectId })}>
          Scan
        </button>
      </div>
      {open && <Inside p={p} />}
    </section>
  );
}

function Fact({ name, children }: { name: string; children: ReactNode }) {
  return (
    <span className="lo-st2">
      <small>{name}</small>
      {children}
    </span>
  );
}

/** The open card's two tiles: the threat model's areas with what is open in each, and the scans with who runs them. */
function Inside({ p }: { p: SecurityProject }) {
  const { data: findings } = useSec("security.findings.list", { projectId: p.projectId });
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

  return (
    <div className="lo-ptiles">
      <div className="lo-ptile">
        <div className="ls-blkh">
          Areas in the threat model
          {p.threatModel.exists && (
            <button type="button" className="lo-lk l-focus" onClick={readFile} title={`Open ${p.threatModel.file} in your editor`}>
              Read or edit
            </button>
          )}
        </div>
        {!p.threatModel.exists ? (
          <p className="lo-q lo-tilep">No {p.threatModel.file} yet. The first scan of the whole project writes one, when you say yes.</p>
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

/** One of its scans: what it read, when, and what came of it ("4 found", "1 found, dismissed"). Opens its session. */
function ScanRow({ s, found }: { s: ScanRecord; found: SecurityFinding[] }) {
  const at = s.finishedAt ?? s.startedAt;
  const ago = when(at);
  const fate = found.length && found.length === s.counts.found ? (found.every((f) => f.state === "dismissed") ? ", dismissed" : found.every((f) => f.state === "fixed") ? ", fixed" : "") : "";
  const res = s.state === "running" ? "Reading" : s.state === "asking" ? "Asking you" : s.state === "stopped" ? "Stopped" : s.state === "failed" ? "Didn't finish" : s.counts.found ? `${s.counts.found} found${fate}` : "Nothing found";
  const body = (
    <>
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
