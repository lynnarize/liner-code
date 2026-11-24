/*
  Liner Security: Findings (board B). The project picker in the top row; Open, Fixed and Dismissed as tabs with their
  counts; the row that narrows the list (Source, Severity, Second look, Fix, each a menu that takes several, the chip
  saying what it holds), sort (worst first, newest, by file) and search; the list, a row per finding with how bad it is,
  its sentence, and a line under (where, what the second look said, whether a fix is at work); and a footnote on where
  they came from. A finding opens in the panel beside the list (FindingPanel), and then the list's edge lines up with
  the title's; with the panel shut it is a column in the middle. ↑ and ↓ move through the list (and the open finding
  with them), Enter opens one, Esc shuts the panel. Builder U2.

  Findings come from the engine and are asked again whenever they change (findings-data.ts); the tabs are counted
  here from one list, so a dismissed finding moves tab without asking twice.
*/
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { DismissReason, FindingSource, FindingState, SecondLookState, SecurityFinding, Severity } from "@contracts";
import { DISMISS_LABEL, SEVERITIES, SEVERITY_LABEL, SOURCE_LABEL } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc } from "../engine";
import { ago } from "../model";
import { I } from "../icons";
import { Pop, Row } from "../ui";
import { FindingPanel } from "./FindingPanel";
import { act, MOCK, useFindings } from "./findings-data";
import { PageTop, SevMark } from "./parts";
import { goSecurity, setFindingsFilter, setSecurityScope, useFindingsFilter, useScan, useSecurity, useSecurityPage, useSecurityProjects, useSecurityScope } from "./store";
import { fixedAt, when } from "./when";
import "./findings.css";

/** Builds a SARIF 2.1.0 JSON report from the visible findings. */
function findingsToSarif(items: SecurityFinding[]): string {
  const level = (s: Severity) => (s === "critical" || s === "high" ? "error" : s === "medium" ? "warning" : "note");
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "Liner Security", informationUri: "https://github.com/lynnarize/liner-code" } },
        results: items.map((f) => ({
          ruleId: f.rule || f.id,
          level: level(f.severity),
          message: { text: [f.title, f.explain?.lead, f.explain?.wrong].filter(Boolean).join("\n\n") },
          ...(f.file
            ? {
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: f.file },
                      ...(f.line ? { region: { startLine: f.line, ...(f.endLine ? { endLine: f.endLine } : {}) } } : {}),
                    },
                  },
                ],
              }
            : {}),
          properties: { id: f.id, severity: f.severity, state: f.state, source: f.source, secondLook: f.look.state },
        })),
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

/** Builds a clean Markdown summary of the visible findings. */
function findingsToMarkdown(items: SecurityFinding[]): string {
  const lines = [`# Liner Security Findings (${items.length})`, ""];
  for (const f of items) {
    lines.push(`## [${SEVERITY_LABEL[f.severity]}] ${f.title}`);
    lines.push(`- State: ${f.state} · Source: ${SOURCE_LABEL[f.source]}${f.file ? ` · Where: \`${f.file}${f.line ? `:${f.line}` : ""}\`` : ""}`);
    if (f.explain?.lead) lines.push("", f.explain.lead);
    if (f.explain?.wrong) lines.push("", f.explain.wrong);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function downloadBlob(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Sort = "worst" | "newest" | "file";
type FixPick = "fixing" | "not";
const TABS: { value: FindingState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "fixed", label: "Fixed" },
  { value: "dismissed", label: "Dismissed" },
];
const SORTS: { value: Sort; label: string }[] = [
  { value: "worst", label: "Worst first" },
  { value: "newest", label: "Newest first" },
  { value: "file", label: "By file" },
];
const SOURCES = Object.keys(SOURCE_LABEL) as FindingSource[];
const LOOKS: { value: SecondLookState; label: string }[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "unconfirmed", label: "Couldn't confirm" },
  { value: "none", label: "No second look" },
];
const FIXES: { value: FixPick; label: string }[] = [
  { value: "fixing", label: "Being fixed" },
  { value: "not", label: "Not being fixed" },
];
const rank = (s: Severity) => SEVERITIES.indexOf(s);
const baseName = (file: string) => file.split("/").pop() || file;
const fixing = (f: SecurityFinding) => f.state === "open" && (f.fix?.state === "working" || f.fix?.state === "ready");
const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")}${xs.length > 2 ? "," : ""} and ${xs[xs.length - 1]}`);

/** Where a finding that no model looked at came from, for its line under: "from npm audit", "from GitHub". */
function fromNote(f: SecurityFinding) {
  if (f.source === "github") return "from GitHub";
  if (f.source === "sarif") return "from a report";
  if (f.source === "checks") return /^(GHSA|CVE)-/i.test(f.rule ?? "") || /(^|\/)package(-lock)?\.json$/.test(f.file ?? "") ? "from npm audit" : /^secret/i.test(f.rule ?? "") ? "a secret in a tracked file" : "from the free checks";
  return undefined;
}

/** The line under a finding's sentence: "station.js:41 · Confirmed · being fixed". */
function rowNote(f: SecurityFinding) {
  const at = f.file ? `${baseName(f.file)}${f.line ? `:${f.line}` : ""}` : undefined;
  const look = f.look.state === "confirmed" ? "Confirmed" : f.look.state === "unconfirmed" ? "Couldn't confirm" : fromNote(f);
  const state = f.state === "fixed" ? `fixed ${when(fixedAt(f))}` : f.state === "dismissed" ? `dismissed: ${f.dismissed ? DISMISS_LABEL[f.dismissed.reason].toLowerCase() : "no reason"}` : f.fix?.state === "ready" ? "its fix is ready" : fixing(f) ? "being fixed" : undefined;
  return [at, look, state].filter(Boolean).join(" · ");
}

/** The footnote: where the findings came from, in one sentence. */
function cameFrom(list: SecurityFinding[]) {
  const agent = list.filter((f) => f.sources.includes("agent"));
  const scans = new Set(agent.map((f) => f.scan).filter(Boolean));
  const last = Math.max(0, ...agent.map((f) => f.foundAt));
  const parts = [
    agent.length ? (scans.size > 1 ? `${scans.size} scans, the last ${when(last)}` : `the scan of ${when(last)}`) : "",
    list.some((f) => f.sources.includes("checks")) ? "the free checks" : "",
    list.some((f) => f.sources.includes("github")) ? "GitHub's alerts" : "",
    list.some((f) => f.sources.includes("sarif")) ? "a report file" : "",
  ].filter(Boolean);
  return parts.length ? `Found by ${and(parts)}. The same problem from two places shows once.` : "";
}

/** A filter that takes several: a chip that says what it holds ("Severity: High", "Source: 2"), a menu that stays open while you pick. */
function MultiChip<T extends string>({ label, value, options, onChange }: { label: string; value: T[]; options: { value: T; label: string }[]; onChange: (v: T[]) => void }) {
  const picked = options.filter((o) => value.includes(o.value));
  return (
    <Pop
      label={`${label}${picked.length ? `: ${picked.map((p) => p.label).join(", ")}` : ", any"}`}
      menu
      width={220}
      triggerClass="ls-chip l-focus"
      triggerAttrs={{ "data-on": picked.length ? "" : undefined }}
      trigger={
        <>
          {picked.length === 1 ? `${label}: ${picked[0].label}` : picked.length ? `${label}: ${picked.length}` : label}
          <I.chevD size={12} />
        </>
      }
    >
      {(close) => (
        <>
          <Row title="Any" on={!picked.length} onPick={() => (close(), onChange([]))} />
          {options.map((o) => (
            <Row key={o.value} title={o.label} on={value.includes(o.value)} onPick={() => onChange(value.includes(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value])} />
          ))}
        </>
      )}
    </Pop>
  );
}

/** Bring in, when the list is narrowed to GitHub's alerts or to report files: read them in now. */
function BringIn({ source, projectId, projects }: { source: "github" | "sarif"; projectId?: string; projects: { id: string; name: string }[] }) {
  const [busy, setBusy] = useState(false);
  const [localProject, setLocalProject] = useState<string | undefined>(projectId ?? projects[0]?.id);
  useEffect(() => {
    if (projectId) setLocalProject(projectId);
    else if (!localProject && projects[0]) setLocalProject(projects[0].id);
  }, [projectId, projects]);
  const targetId = projectId ?? localProject;
  const targetName = projects.find((p) => p.id === targetId)?.name;
  const file = useRef<HTMLInputElement>(null);
  const done = (r: { added: number; already: number; leftOut: number; note?: string }) => toast(r.note ?? `${r.added} new, ${r.already} already here${r.leftOut ? `, ${r.leftOut} you dismissed before left out` : ""}`);
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
  const go = (p: () => Promise<unknown>) => (setBusy(true), void p().catch(fail).finally(() => setBusy(false)));
  // gh on this Mac, as the sidebar reads it: with none, or not signed in, say so here rather than fail on the press.
  const reach = useSecurity("security.side", {}, ["projects"]).data?.github.reach;
  const noGh = source === "github" && reach && !(reach.installed && reach.signedIn);
  const off = !targetId || MOCK || Boolean(noGh);
  return (
    <div className="lf-bring">
      {source === "github" ? <I.branch size={16} /> : <I.file size={16} />}
      <span className="ls-tl2">
        <b>{source === "github" ? "GitHub alerts" : "A report file"}</b>
        <small>{!targetId ? "Add a project first to bring them in." : noGh ? (reach.installed ? "gh isn't signed in: run gh auth login in Terminal, then try again." : "Needs gh, GitHub's tool: brew install gh, then gh auth login.") : source === "github" ? "Dependabot and code scanning, read through gh" : "A SARIF file from another scanner"}</small>
      </span>
      {!projectId && projects.length > 0 && (
        <Pop
          label={`Target project: ${targetName ?? "Pick a project"}`}
          menu
          align="end"
          width={220}
          triggerClass="ls-chip l-focus"
          trigger={
            <>
              <span>{targetName ?? "Pick project"}</span>
              <I.chevD size={12} />
            </>
          }
        >
          {(close) => projects.map((p) => <Row key={p.id} title={p.name} on={p.id === targetId} onPick={() => (close(), setLocalProject(p.id))} />)}
        </Pop>
      )}
      {source === "github" ? (
        <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" disabled={off || busy} onClick={() => go(() => rpc("security.bringin.github", { projectId: targetId! }).then(done))}>
          Bring them in
        </button>
      ) : (
        <>
          <input
            ref={file}
            type="file"
            accept=".sarif,.json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) go(() => f.text().then((text) => rpc("security.bringin.sarif", { projectId: targetId!, text })).then(done));
            }}
          />
          <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" disabled={off || busy} onClick={() => file.current?.click()}>
            Pick a file
          </button>
        </>
      )}
    </div>
  );
}

export function Findings({ sidebar, onSidebar, finding, state, source }: { sidebar: boolean; onSidebar: () => void; /** The finding open in the panel. */ finding?: string; state?: FindingState; /** Bring in's rows open the list narrowed to their source. */ source?: FindingSource }) {
  const stored = useSecurityScope();
  // Never the Demo's Sample project (store.ts useSecurityProjects): not in the picker, not in the list, and a scope left on it reads as All projects.
  const { list: projects, hidden } = useSecurityProjects();
  const scope = hidden(stored.projectId) ? { ...stored, projectId: undefined } : stored;
  // One scan's findings (page.scan, from the scan's screen): what it found first, and what it raised again that was open
  // already. A scan is in one project, so the project picker doesn't narrow it further.
  const page = useSecurityPage();
  const scan = page.kind === "findings" ? page.scan : undefined;
  const scanRec = useScan(scan);
  // The dev mock (?ls-mock) puts its sample findings in the first project. When a single scan is selected, scope to its project rather than fetching every project.
  const { list: all, error } = useFindings(scan ? (scanRec?.projectId ?? undefined) : scope.projectId, projects[0]?.id ?? "mock-sample");
  const list = useMemo(() => {
    const mine = all?.filter((f) => !hidden(f.projectId)) ?? null;
    return scan && mine ? mine.filter((f) => f.scan === scan || f.activity.some((e) => e.kind === "raised-again" && e.scan === scan)) : mine;
  }, [all, scan, hidden]);
  const projectOf = (id: string) => projects.find((p) => p.id === id);

  const filt = useFindingsFilter();
  const { tab, sources, sevs, looks, fixes, sort, query } = filt;
  const setTab = (next: FindingState) => setFindingsFilter({ tab: next });
  const setSources = (next: FindingSource[]) => setFindingsFilter({ sources: next });
  const setSevs = (next: Severity[]) => setFindingsFilter({ sevs: next });
  const setLooks = (next: SecondLookState[]) => setFindingsFilter({ looks: next });
  const setFixes = (next: FixPick[]) => setFindingsFilter({ fixes: next });
  const setSort = (next: Sort) => setFindingsFilter({ sort: next });
  const setQuery = (next: string | null) => setFindingsFilter({ query: next });
  const [pickedIds, setPickedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  useEffect(() => void (state && setTab(state)), [state]);
  useEffect(() => {
    if (source) setSources([source]);
  }, [source]);
  useEffect(() => setPickedIds(new Set()), [tab, scope.projectId, scan]);

  const bulkAction = async (kind: "dismiss" | "reopen", reason?: DismissReason) => {
    const ids = [...pickedIds];
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      for (const id of ids) {
        if (kind === "dismiss" && reason) await act.dismiss(id, reason);
        else if (kind === "reopen") await act.reopen(id);
      }
      setPickedIds(new Set());
      toast.success(kind === "dismiss" ? `Dismissed ${ids.length} findings` : `Reopened ${ids.length} findings`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const counts = useMemo(() => {
    const c: Record<FindingState, number> = { open: 0, fixed: 0, dismissed: 0 };
    for (const f of list ?? []) c[f.state]++;
    return c;
  }, [list]);
  const q = query?.trim().toLowerCase() ?? "";
  const narrowed = Boolean(scan) || sources.length + sevs.length + looks.length + fixes.length > 0 || q !== "";
  const shown = useMemo(() => {
    const out = (list ?? []).filter(
      (f) =>
        f.state === tab &&
        (!sources.length || f.sources.some((s) => sources.includes(s))) &&
        (!sevs.length || sevs.includes(f.severity)) &&
        (!looks.length || looks.includes(f.look.state)) &&
        (!fixes.length || fixes.includes(fixing(f) ? "fixing" : "not")) &&
        (!q || `${f.title}\n${f.file ?? ""}\n${f.rule ?? ""}\n${f.area ?? ""}`.toLowerCase().includes(q)),
    );
    const newest = (a: SecurityFinding, b: SecurityFinding) => b.foundAt - a.foundAt;
    return out.sort(sort === "newest" ? newest : sort === "file" ? (a, b) => (a.file ?? "~").localeCompare(b.file ?? "~") || (a.line ?? 0) - (b.line ?? 0) : (a, b) => rank(a.severity) - rank(b.severity) || newest(a, b));
  }, [list, tab, sources, sevs, looks, fixes, q, sort]);

  const open = finding ? list?.find((f) => f.id === finding) : undefined;
  const at = open ? shown.findIndex((f) => f.id === open.id) : -1;
  const show = (id?: string) => goSecurity({ kind: "findings", finding: id, scan });
  const openId = useRef<string | undefined>(undefined);
  openId.current = open?.id;
  // A finding asked for by name (a link from the Overview or a scan) opens in the tab it is in.
  useEffect(() => {
    if (open && open.state !== tab) setTab(open.state);
  }, [finding, Boolean(list)]);

  // Esc shuts the panel, unless something else took it first (a menu, the search box).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open], .lc-pop-panel")) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable='true']")) return;
      shut();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [Boolean(open)]);

  const listRef = useRef<HTMLDivElement>(null);
  const focusRow = (id: string) => listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: false });
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || !shown.length) return;
    e.preventDefault();
    const here = (document.activeElement as HTMLElement | null)?.dataset.id;
    const i = shown.findIndex((f) => f.id === (here ?? open?.id));
    const to = e.key === "Home" ? 0 : e.key === "End" ? shown.length - 1 : Math.min(shown.length - 1, Math.max(0, i < 0 ? 0 : i + (e.key === "ArrowDown" ? 1 : -1)));
    focusRow(shown[to].id);
    if (open) show(shown[to].id);
  };
  // Shutting the panel puts the keyboard back on the finding's row.
  const shut = () => {
    const id = openId.current;
    show(undefined);
    if (id) requestAnimationFrame(() => focusRow(id));
  };
  const step = (by: number) => {
    const to = at < 0 ? shown[0] : shown[at + by];
    if (to) (show(to.id), requestAnimationFrame(() => focusRow(to.id)));
  };
  // After Dismiss or Reopen the finding leaves this tab: open the one after it (or before), else shut the panel.
  const moved = (f: SecurityFinding) => {
    if (f.state === tab) return;
    const i = shown.findIndex((x) => x.id === f.id);
    show((shown[i + 1] ?? shown[i - 1])?.id);
  };
  const clear = () => (setSources([]), setSevs([]), setLooks([]), setFixes([]), setQuery(null), scan && goSecurity({ kind: "findings", finding }));
  const bring = sources.length === 1 && (sources[0] === "github" || sources[0] === "sarif") ? sources[0] : undefined;
  const picked = scope.projectId ? projectOf(scope.projectId) : undefined;
  const note = list && tab === "open" && counts.open > 0 ? cameFrom(list.filter((f) => f.state === "open")) : "";

  return (
    <div className="lf" data-panel={open ? "open" : undefined}>
      <div className="ls-page lf-main">
        <PageTop title="Findings" sidebar={sidebar} onSidebar={onSidebar}>
          <Pop
            label={`Project: ${picked?.name ?? "All projects"}. Pick another`}
            menu
            align="end"
            width={240}
            triggerClass="lf-proj l-focus"
            trigger={
              <>
                <span className="lc-strip-cap">{picked?.name ?? "All projects"}</span>
                <I.chevD size={12} />
              </>
            }
          >
            {(close) => (
              <>
                <Row title="All projects" on={!scope.projectId} onPick={() => (close(), setSecurityScope({ projectId: undefined }))} />
                {projects.map((p) => (
                  <Row key={p.id} title={p.name} on={p.id === scope.projectId} onPick={() => (close(), setSecurityScope({ projectId: p.id }))} />
                ))}
              </>
            )}
          </Pop>
        </PageTop>

        <div className="ls-scroll">
          <div className="lf-col">
            <div className="ls-segs lf-tabs" role="tablist" aria-label="Findings by state">
              {TABS.map((t) => (
                <button key={t.value} type="button" role="tab" aria-selected={t.value === tab} className="ls-sg lf-tab l-focus" onClick={() => (setTab(t.value), open && open.state !== t.value && show(undefined))}>
                  {t.label}
                  <span className="ls-num">{counts[t.value]}</span>
                </button>
              ))}
            </div>

            <div className="lf-filt" role="toolbar" aria-label="Narrow the list">
              {scan && (
                <button type="button" className="ls-chip l-focus" data-on="" title={scanRec?.title} aria-label={`Only ${scanRec ? `the scan ${scanRec.title}` : "this scan"}. Show every finding`} onClick={() => goSecurity({ kind: "findings", finding })}>
                  This scan
                  <I.close size={12} />
                </button>
              )}
              <MultiChip label="Source" value={sources} options={SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))} onChange={setSources} />
              <MultiChip label="Severity" value={sevs} options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} onChange={setSevs} />
              <MultiChip label="Second look" value={looks} options={LOOKS} onChange={setLooks} />
              <MultiChip label="Fix" value={fixes} options={FIXES} onChange={setFixes} />
              {query !== null ? (
                <label className="lf-search">
                  <input
                    autoFocus
                    value={query}
                    placeholder="Search the findings"
                    aria-label="Search the findings"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") (e.preventDefault(), setQuery(null));
                      if (e.key === "ArrowDown" && shown[0]) (e.preventDefault(), focusRow(shown[0].id));
                    }}
                  />
                </label>
              ) : (
                <span className="lc-grow" />
              )}
              {/* Search and sort keep together at the row's end, and wrap together when the row is narrow. Search is one toggle, pressed
                  while its field shows, as in a scan's Found panel and on Projects: pressed again it stops searching. */}
              <span className="lf-tools">
                <button type="button" className="lc-tb lf-tb l-focus" aria-pressed={query !== null} aria-label={query === null ? "Search the findings" : "Stop searching"} title={query === null ? "Search the findings" : "Stop searching"} onClick={() => setQuery(query === null ? "" : null)}>
                  <I.search size={16} />
                </button>
                <Pop
                  label={`Sorted ${SORTS.find((s) => s.value === sort)!.label.toLowerCase()}. Change the order`}
                  menu
                  align="end"
                  width={200}
                  triggerClass="lc-tb lf-tb l-focus"
                  trigger={<I.sort size={16} />}
                >
                  {(close) => SORTS.map((s) => <Row key={s.value} title={s.label} on={s.value === sort} onPick={() => (close(), setSort(s.value))} />)}
                </Pop>
                <Pop
                  label="Export visible findings"
                  menu
                  align="end"
                  width={210}
                  triggerClass="lc-tb lf-tb l-focus"
                  triggerAttrs={{ title: "Export findings" }}
                  trigger={<I.download size={16} />}
                >
                  {(close) => (
                    <>
                      <Row
                        title="Export SARIF 2.1.0…"
                        disabled={!shown.length}
                        onPick={() => {
                          close();
                          downloadBlob("liner-security-findings.sarif.json", findingsToSarif(shown), "application/sarif+json;charset=utf-8");
                          toast.success(`Exported ${shown.length} findings as SARIF`);
                        }}
                      />
                      <Row
                        title="Export Markdown…"
                        disabled={!shown.length}
                        onPick={() => {
                          close();
                          downloadBlob("liner-security-findings.md", findingsToMarkdown(shown), "text/markdown;charset=utf-8");
                          toast.success(`Exported ${shown.length} findings as Markdown`);
                        }}
                      />
                    </>
                  )}
                </Pop>
              </span>
            </div>

            {pickedIds.size > 0 && (
              <div className="lf-filt" role="region" aria-label="Bulk actions" style={{ alignItems: "center", gap: 8 }}>
                <span className="lc-quiet">{pickedIds.size} selected</span>
                <span className="lc-grow" />
                {tab === "open" ? (
                  <Pop label="Dismiss selected findings" menu align="end" width={220} triggerClass="lc-btn l-focus" triggerAttrs={{ "data-kind": "plain", "data-size": "sm" }} trigger="Dismiss selected">
                    {(close) =>
                      (Object.keys(DISMISS_LABEL) as DismissReason[]).map((reason) => (
                        <Row
                          key={reason}
                          title={DISMISS_LABEL[reason]}
                          onPick={() => {
                            close();
                            void bulkAction("dismiss", reason);
                          }}
                        />
                      ))
                    }
                  </Pop>
                ) : (
                  <button type="button" className="lc-btn l-focus" data-kind="plain" data-size="sm" disabled={bulkBusy} onClick={() => void bulkAction("reopen")}>
                    Reopen selected
                  </button>
                )}
                <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" onClick={() => setPickedIds(new Set())}>
                  Clear
                </button>
              </div>
            )}

            {bring && <BringIn source={bring} projectId={scope.projectId} projects={projects} />}

            {!list ? (
              error ? (
                <div className="ls-none">
                  <b>The findings didn't load</b>
                  <span>{error}</span>
                </div>
              ) : (
                // Not yet answered: said so, so the empty tabs never read as nothing found.
                <div className="ls-none" aria-live="polite">
                  <span className="l-shimmer">Reading the findings</span>
                </div>
              )
            ) : shown.length ? (
              <div className="lf-list" role="list" aria-label={`${TABS.find((t) => t.value === tab)!.label} findings`} ref={listRef} onKeyDown={onListKey}>
                {shown.map((f) => (
                  <div role="listitem" key={f.id} className="lf-li" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="checkbox"
                      className="l-focus"
                      aria-label={`Select ${f.title}`}
                      checked={pickedIds.has(f.id)}
                      onChange={(e) =>
                        setPickedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(f.id);
                          else next.delete(f.id);
                          return next;
                        })
                      }
                    />
                    <button
                      type="button"
                      className="lf-rw l-focus"
                      style={{ flex: 1, minWidth: 0 }}
                      data-id={f.id}
                      data-on={f.id === open?.id || undefined}
                      aria-current={f.id === open?.id || undefined}
                      tabIndex={f.id === (at >= 0 ? open!.id : shown[0].id) ? 0 : -1}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey) {
                          setPickedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(f.id)) next.delete(f.id);
                            else next.add(f.id);
                            return next;
                          });
                          return;
                        }
                        show(f.id === open?.id ? undefined : f.id);
                      }}
                    >
                      <SevMark severity={f.severity} />
                      <span className="lf-tl2">
                        {/* The time it last changed at the title's end, as a row in the sidebar has it. */}
                        <span className="lf-l1">
                          <b>{f.title}</b>
                          <span className="lf-ago">{ago(f.updatedAt)}</span>
                        </span>
                        <small>{[!scope.projectId && projects.length > 1 ? projectOf(f.projectId)?.name : "", rowNote(f)].filter(Boolean).join(" · ")}</small>
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            ) : narrowed && counts[tab] ? (
              <div className="ls-none">
                <b>Nothing here matches</b>
                <span>{`${counts[tab]} ${tab} ${counts[tab] === 1 ? "finding is" : "findings are"} left out by what narrows the list.`}</span>
                <button type="button" className="lc-btn l-focus lf-none-b" data-kind="ghost" data-size="sm" onClick={clear}>
                  Show them all
                </button>
              </div>
            ) : tab === "open" ? (
              <div className="ls-none">
                <span className="ls-disc"><I.shield size={16} /></span>
                <b>Nothing open</b>
                <span>{scan ? (list.length ? "Everything this scan raised was fixed or dismissed." : "This scan raised nothing.") : list.length ? "Everything found here was fixed or dismissed." : !projects.length ? "No project to scan yet. Add a folder you work on, then scan it." : "No scan has found anything here yet."}</span>
                <button type="button" className="lc-btn l-focus lf-none-b" data-kind="ghost" data-size="sm" onClick={() => goSecurity({ kind: "start", projectId: scope.projectId })}>
                  Start a scan
                </button>
              </div>
            ) : tab === "fixed" ? (
              <div className="ls-none">
                <b>Nothing fixed yet</b>
                <span>A finding comes here when its fix is merged.</span>
              </div>
            ) : (
              <div className="ls-none">
                <b>Nothing dismissed</b>
                <span>What you dismiss stays here with why, and the next scan doesn't raise it again.</span>
              </div>
            )}

            {note && <p className="lf-sub">{note}</p>}
          </div>
        </div>
      </div>

      {open && (
        <FindingPanel
          finding={open}
          onClose={shut}
          onPrev={at > 0 ? () => step(-1) : undefined}
          onNext={at < shown.length - 1 ? () => step(1) : undefined}
          place={at >= 0 ? `${at + 1} of ${shown.length}` : undefined}
          projectName={projectOf(open.projectId)?.name ?? (MOCK ? "Sample project" : undefined)}
          projectPath={projectOf(open.projectId)?.path}
          onActed={moved}
        />
      )}
    </div>
  );
}

