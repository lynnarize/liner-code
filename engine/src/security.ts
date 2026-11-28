/*
  Liner Security's engine half: the findings store and the security.* RPC. Findings, scans and the free checks' last run
  are kept per project under the engine's home (security/<folder hash>.json), written whole or not at all, read back
  shape-checked, never inside the repository: the agent writes the repository (and .liner/) freely, and a list of what
  you dismissed that it could edit would let a scan hide what it found (design-prefs.ts says the same of consent).

  The same problem from two places shows once (findingKey: project, file, a normalised rule or title); one you dismissed
  is remembered by its key without the project, so the next scan, the free checks or an import never raise it again.

  The parts other modules own are reached through small functions with their final signatures: the free checks
  (security-checks.ts), GitHub and SARIF (security-bringin.ts), the scan, its tools, second look, fix and ask
  (security-scan.ts, security-tools.ts), and the Demo's sample (security-demo.ts). This file does the store work and
  answers what is only store work: lists, a finding, dismiss and reopen, the Overview and its day-by-day line, Projects,
  the threat model's areas, the scans.
*/
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { EngineEvent, Project, ProviderInfo, RpcMethod, RpcParams, RpcResult, Settings } from "../../contracts/src/index.ts";
import { findingKey, noSeverities, sealable, SEVERITIES, SPECIALIST_MODELS } from "../../contracts/src/index.ts";
import type { DismissReason, SecurityFinding, SecurityFindingAdded, FindingEvent, FindingState, FreeCheckRun, NewFinding, ScanRecord, SecurityChange, SecurityOverview, SecurityProject, Severity, SeverityCounts, SecondLookState, SpecialistSource, ThreatArea, ThreatModel } from "../../contracts/src/index.ts";
import type { Runtime } from "./runtime.ts";
import { uid, writeAtomic, type Store } from "./store.ts";
import { bringGitHub, bringSarif, githubReach } from "./security-bringin.ts";
import { askAbout, fixFinding, lookFinding, scanOptions, startScan, stopScan } from "./security-scan.ts";
import { targetRpc } from "./security-targets.ts";
import { outside } from "./exec.ts";
import { maskFinding, maskText } from "./security-checks.ts";

export type SecurityMethod = Extract<RpcMethod, `security.${string}`>;
type SecurityRpc = { [K in SecurityMethod]: (p: RpcParams<K>) => Promise<RpcResult<K>> | RpcResult<K> };

/** The threat model's file when a project names none. */
export const MODEL_FILE = "SECURITY.md";
/** The heading answers to a scan's questions go under in the threat model (security-scan.ts appends there); never an area. */
export const ANSWERS_HEADING = "Answers to the scan's questions";
/** The most scans kept per project; older ones go (their findings stay). */
const SCANS_KEPT = 200;
const DAY = 86_400_000;

/**
  What the engine lends Liner Security, set by api.ts once its handlers exist: any RPC by name (thread.create, thread.send,
  project.add…, through the same waits the app's calls go through), the runtime (askLiner, quiet for a second look, stop,
  readOnly), and the tools found on this Mac.
*/
export type SecurityHost = {
  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>;
  runtime: Runtime;
  providers(): ProviderInfo[];
  /** Asks every tool for its models again (Look again), and answers with the list. */
  refreshProviders(): Promise<ProviderInfo[]>;
};

/** One project's file under security/: its findings, what you dismissed (by bare key), its scans, the free checks' last run. */
type ProjectData = {
  v: 1;
  path: string;
  /** The threat model's file, relative to the folder, when a scan was told another than SECURITY.md. */
  modelFile?: string;
  findings: SecurityFinding[];
  dismissed: { key: string; reason: DismissReason; note?: string; at: number }[];
  scans: ScanRecord[];
  checks?: FreeCheckRun;
};

const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** The Demo's Sample project (added as the Demo's own, agent "demo"), which Security leaves out unless the Demo is shown. */
const sample = (p: Project, settings: Settings) => p.agent === "demo" && !p.demoFor && settings.showDemo !== true;
const STATES: FindingState[] = ["open", "fixed", "dismissed"];
const SOURCES = ["agent", "checks", "github", "sarif"];
const isFinding = (f: unknown): f is SecurityFinding => {
  const x = f as SecurityFinding;
  return Boolean(x) && typeof x === "object" && str(x.id) && str(x.title) && SEVERITIES.includes(x.severity) && STATES.includes(x.state) && SOURCES.includes(x.source) && Array.isArray(x.activity) && num(x.foundAt);
};
const isScan = (s: unknown): s is ScanRecord => {
  const x = s as ScanRecord;
  return Boolean(x) && typeof x === "object" && str(x.id) && str(x.title) && ["checks", "branch", "project", "pr", "issue"].includes(x.depth) && ["running", "asking", "done", "stopped", "failed"].includes(x.state) && num(x.startedAt) && Boolean(x.counts) && typeof x.counts === "object";
};
/** A scan's own words (what it said it read, and missed), masked as a finding's are: stored by an earlier build, they may not be. */
const maskScan = (s: ScanRecord): ScanRecord => ({ ...s, ...(str(s.summary) ? { summary: maskText(s.summary) } : {}), ...(Array.isArray(s.read) ? { read: s.read.map((x) => maskText(String(x))) } : {}), ...(Array.isArray(s.missed) ? { missed: s.missed.map((x) => maskText(String(x))) } : {}) });
/** A finding's dedupe key without its project: what the dismissed list remembers, so it holds if the folder comes back under another id. */
export const bareKey = (f: { file?: string; rule?: string; instance?: string; title: string }) => findingKey("", f).slice(1);

/**
  Whether `abs` is inside the folder `root` by real path: a link anywhere on the way (a symlinked folder, a symlinked
  SECURITY.md) is followed, and only what lands inside the project counts. False when either isn't there.
*/
export function insideReal(root: string, abs: string): boolean {
  try {
    const r = realpathSync(root);
    const a = realpathSync(abs);
    return a === r || a.startsWith(r.endsWith(sep) ? r : r + sep);
  } catch {
    return false;
  }
}

/**
  A finding as stored before keys knew instances: a SARIF or code-scanning rule with ":<line>" on its end loses the line,
  and a code-scanning alert takes its number from its address ("gh:12"), so what was stored keeps deduping with what
  comes in now.
*/
function migrated(f: SecurityFinding): SecurityFinding {
  if (f.instance || !f.rule || !f.sources.some((s) => s === "github" || s === "sarif")) return f;
  const m = /^(.+):(\d+)$/.exec(f.rule);
  if (!m) return f;
  const alert = /\/security\/code-scanning\/(\d+)/.exec(f.url ?? "")?.[1];
  return { ...f, rule: m[1], ...(alert ? { instance: `gh:${alert}` } : {}) };
}
const rank = (s: Severity) => SEVERITIES.indexOf(s);
/**
  Findings that share a key made one, where the first of them stood: two of one problem, stored by a build that made an
  instance of a title's raw words beside a report of it made of the masked ones. The one you dismissed leads (what you
  dismissed holds), else the one changed last; the others' sources and activity are folded in, and the worst severity kept.
*/
function mergedByKey(list: SecurityFinding[]): SecurityFinding[] {
  const by = new Map<string, SecurityFinding[]>();
  for (const f of list) by.set(f.key, [...(by.get(f.key) ?? []), f]);
  if (by.size === list.length) return list;
  const out: SecurityFinding[] = [];
  for (const group of by.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const lead = group.find((f) => f.state === "dismissed") ?? group.reduce((a, b) => ((b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a));
    const rest = group.filter((f) => f !== lead);
    out.push({
      ...lead,
      sources: [...new Set(group.flatMap((f) => f.sources))],
      severity: group.reduce((s, f) => (rank(f.severity) < rank(s) ? f.severity : s), lead.severity),
      line: lead.line ?? rest.find((f) => f.line)?.line,
      explain: lead.explain ?? rest.find((f) => f.explain)?.explain,
      activity: group.flatMap((f) => f.activity).sort((a, b) => a.at - b.at),
      foundAt: Math.min(...group.map((f) => f.foundAt)),
      updatedAt: Math.max(...group.map((f) => f.updatedAt ?? f.foundAt)),
    });
  }
  // Where the first of each stood in the record.
  const first = new Map<string, number>();
  list.forEach((f, i) => first.has(f.key) || first.set(f.key, i));
  return out.sort((a, b) => first.get(a.key)! - first.get(b.key)!);
}
/** A scan's counts with what adding these findings did folded in. */
function counted(was: ScanRecord["counts"], added: SecurityFindingAdded[]): ScanRecord["counts"] {
  const c = { ...was, bySeverity: { ...was.bySeverity } };
  for (const a of added) {
    c.found++;
    if (a.outcome === "new" || a.outcome === "reopened") c.fresh++;
    else if (a.outcome === "already-open") c.already++;
    else c.leftOut++;
    if (a.outcome !== "dismissed-before") c.bySeverity[a.finding.severity]++;
  }
  return c;
}
/** Worst first, then newest. */
export const worstFirst = (a: SecurityFinding, b: SecurityFinding) => rank(a.severity) - rank(b.severity) || b.foundAt - a.foundAt;
/** Local midnight of a time. */
const dayStart = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const dayName = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
  A finding's state at a moment, replayed from its activity: open from when it was found (or reopened, or raised again
  after a fix), dismissed or fixed from those events; null before it was found.
*/
export function stateAt(f: SecurityFinding, t: number): FindingState | null {
  let s: FindingState | null = null;
  for (const e of [...f.activity].sort((a, b) => a.at - b.at)) {
    if (e.at > t) break;
    s = stepState(s, e);
  }
  return s;
}
/** A finding's state after one more event of its activity (stateAt, one step). */
function stepState(s: FindingState | null, e: FindingEvent): FindingState | null {
  if (e.kind === "found" || e.kind === "reopened") return "open";
  if (e.kind === "raised-again" && s === "fixed") return "open";
  if (e.kind === "dismissed") return "dismissed";
  if (e.kind === "fixed") return "fixed";
  return s;
}

/**
  The threat model's areas, from its text: each heading (## or ###) and the first line of words under it. The title (#)
  and the scan's answers (ANSWERS_HEADING) aren't areas.
*/
export function parseAreas(text: string): { name: string; line: string }[] {
  const out: { name: string; line: string }[] = [];
  let open: { name: string; line: string } | null = null;
  let fence = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) fence = !fence;
    if (fence) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (h) {
      open = null;
      const name = h[2].trim();
      if (h[1].length < 2 || h[1].length > 3 || name.toLowerCase() === ANSWERS_HEADING.toLowerCase()) continue;
      open = { name, line: "" };
      out.push(open);
      continue;
    }
    const words = raw.replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+/, "").trim();
    if (open && !open.line && words) open.line = words;
  }
  return out;
}

/** The security models a signed-in CLI lists (SPECIALIST_MODELS), and the endpoints you marked as one; only those a sealed session can run. */
export function specialists(providers: ProviderInfo[], settings: Pick<Settings, "endpoints" | "securityEndpoints">): SpecialistSource[] {
  const out: SpecialistSource[] = [];
  for (const p of providers) {
    if (!p.available || !p.adapter || p.signedIn === false || p.endpoint || p.id === "demo") continue;
    const family = p.id.split(".")[0];
    for (const want of SPECIALIST_MODELS) {
      if (want.family !== family) continue;
      for (const m of p.models) {
        if (!`${m.id} ${m.label}`.toLowerCase().includes(want.match)) continue;
        out.push({ id: `cli:${p.id}:${m.id}`, kind: "cli", provider: p.id, model: m.id, label: m.label || want.label, via: `through ${p.label}`, ref: `@${p.id}:${m.id}`, sealable: sealable(p.id) });
      }
    }
  }
  const marked = new Set(settings.securityEndpoints ?? []);
  for (const e of settings.endpoints ?? []) {
    if (!marked.has(e.id)) continue;
    const p = providers.find((x) => x.endpoint === e.id || x.id.endsWith(`.${e.id}`));
    if (!p) continue;
    const model = e.models[0] ?? p.models[0]?.id;
    if (!model) continue;
    out.push({ id: `endpoint:${e.id}`, kind: "endpoint", provider: p.id, model, label: model, via: e.label || "an API endpoint", ref: `@${p.id}:${model}`, sealable: sealable(p.id) });
  }
  return out.filter((s) => s.sealable);
}

/** What put() looks a new finding up by (Security.indexOf). */
type FindingIndex = { byKey: Map<string, SecurityFinding>; byBare: Map<string, SecurityFinding[]>; at: Map<SecurityFinding, number>; dismissed: Map<string, { x: ProjectData["dismissed"][number]; i: number }> };

export class Security {
  readonly store: Store;
  readonly env: NodeJS.ProcessEnv;
  /** Set by api.ts (bind); a method that needs it before then says so. */
  private lent?: SecurityHost;
  private data = new Map<string, ProjectData>();
  /** Which project file holds a finding (and a scan), by id. */
  private where = new Map<string, string>();
  /** Which project id each cached folder was read for. */
  private owner = new Map<string, string>();

  constructor(store: Store, env: NodeJS.ProcessEnv) {
    this.store = store;
    this.env = env;
  }

  bind(host: SecurityHost) {
    this.lent = host;
  }
  get host(): SecurityHost {
    if (!this.lent) throw new Error("Liner Security isn't ready yet.");
    return this.lent;
  }

  emit(e: EngineEvent) {
    this.store.emit(e);
  }
  /** Tells the face what changed, so it asks again. */
  changed(what: SecurityChange[], projectId?: string) {
    this.emit({ type: "security.changed", what, ...(projectId ? { projectId } : {}), at: Date.now() });
  }

  /** The projects Security looks at: every folder Liner Code knows, not the designs on their own, not the Demo's Sample project, and the Demo's stand-ins (Project.demoFor) only while the Demo is shown. */
  projects(): Project[] {
    return this.store.projects.filter((p) => p.kind !== "design" && !sample(p, this.store.settings) && (!p.demoFor || this.store.settings.showDemo === true));
  }
  project(projectId: string): Project {
    const p = this.store.project(projectId);
    if (p.kind === "design") throw new Error("A design on its own isn't a project Security reads.");
    if (sample(p, this.store.settings)) throw new Error("The Sample project isn't one Security reads.");
    return p;
  }

  private fileOf(path: string) {
    return join(this.store.home, "security", `${createHash("sha256").update(resolve(path)).digest("hex").slice(0, 16)}.json`);
  }

  /** A project's data, read once and shape-checked: entries that don't hold up are dropped, keys made again for this project's id. */
  private load(projectId: string): ProjectData {
    const p = this.project(projectId);
    const path = resolve(p.path);
    const had = this.data.get(path);
    // The folder removed and added again comes back under a new id: what is cached is stamped with it.
    if (had && this.owner.get(path) !== projectId) this.restamp(had, projectId, path);
    if (had) return had;
    let d: ProjectData = { v: 1, path, findings: [], dismissed: [], scans: [] };
    // Whether what was read changed as it was read (masked, its keys made again, two of one finding made one): written back at once, so no secret stays on disk.
    let dirty = false;
    try {
      const v = JSON.parse(readFileSync(this.fileOf(path), "utf8")) as Partial<ProjectData>;
      if (v && typeof v === "object") {
        // Masked as they're read, too: what an earlier build stored is never shown raw. Masking can change a finding's bare
        // key (its rule, or an instance made of its title's words): what you dismissed under the key it had follows it.
        const renamed = new Map<string, string>();
        const findings = (Array.isArray(v.findings) ? v.findings : []).filter(isFinding).map((raw) => {
          const f = { ...raw, projectId, sources: Array.isArray(raw.sources) && raw.sources.length ? raw.sources : [raw.source], look: raw.look && typeof raw.look === "object" ? raw.look : { state: "none" as const } };
          const m = migrated(maskFinding(f));
          const now = bareKey(m);
          for (const was of [bareKey(f), bareKey(migrated(f))]) if (was !== now && !renamed.has(was)) renamed.set(was, now);
          if (JSON.stringify(maskFinding(f)) !== JSON.stringify(f)) dirty = true;
          return { ...m, key: findingKey(projectId, m) };
        });
        const kept = (Array.isArray(v.dismissed) ? v.dismissed : []).filter((x) => x && str(x.key) && str(x.reason) && num(x.at)).map((x) => {
          const to = renamed.get(x.key);
          if (!to) return x;
          dirty = true;
          return { ...x, key: to };
        });
        const merged = mergedByKey(findings);
        if (merged.length !== findings.length) dirty = true;
        const scans = (Array.isArray(v.scans) ? v.scans : []).filter(isScan).map((s) => {
          const m = maskScan({ ...s, projectId });
          if (JSON.stringify(m) !== JSON.stringify({ ...s, projectId })) dirty = true;
          return m;
        });
        d = {
          v: 1,
          path,
          modelFile: str(v.modelFile) && !isAbsolute(v.modelFile) && !v.modelFile.split(/[\\/]/).includes("..") ? v.modelFile : undefined,
          findings: merged,
          // One entry a key, the first the record holds (as put() reads them), once keys made again meet.
          dismissed: kept.filter((x, i) => kept.findIndex((y) => y.key === x.key) === i),
          scans,
          checks: v.checks && typeof v.checks === "object" && Array.isArray(v.checks.results) ? { ...v.checks, projectId } : undefined,
        };
      }
    } catch {
      // none yet, or unreadable: an empty record, written over at the first change
    }
    // What you dismissed is remembered by the key as it is made now (keys made by an older rule, or another normalKey, still held).
    const known = new Set(d.dismissed.map((x) => x.key));
    for (const f of d.findings) if (f.state === "dismissed" && f.dismissed && !known.has(bareKey(f))) d.dismissed.push({ key: bareKey(f), reason: f.dismissed.reason, note: f.dismissed.note, at: f.dismissed.at });
    this.data.set(path, d);
    this.owner.set(path, projectId);
    for (const f of d.findings) this.where.set(f.id, projectId);
    for (const s of d.scans) this.where.set(s.id, projectId);
    if (dirty) {
      try {
        this.save(projectId);
      } catch {
        // can't be written now: written masked at the next change
      }
    }
    return d;
  }
  /** A project's cached data, given to the id its folder has now. */
  private restamp(d: ProjectData, projectId: string, path: string) {
    d.findings = d.findings.map((f) => ({ ...f, projectId, key: findingKey(projectId, f) }));
    d.scans = d.scans.map((x) => ({ ...x, projectId }));
    if (d.checks) d.checks = { ...d.checks, projectId };
    this.owner.set(path, projectId);
    for (const f of d.findings) this.where.set(f.id, projectId);
    for (const x of d.scans) this.where.set(x.id, projectId);
  }
  private save(projectId: string) {
    const d = this.load(projectId);
    const file = this.fileOf(d.path);
    mkdirSync(join(this.store.home, "security"), { recursive: true });
    writeAtomic(file, JSON.stringify(d));
  }
  /** Which project holds this id (a finding's, a scan's), looking through them all once. */
  private ownerOf(id: string): string {
    const known = this.where.get(id);
    if (known && this.store.projects.some((p) => p.id === known)) return known;
    for (const p of this.projects()) this.load(p.id);
    const now = this.where.get(id);
    if (!now) throw new Error("There's no finding or scan by that id.");
    return now;
  }

  // Findings.

  findings(projectId?: string): SecurityFinding[] {
    const ids = projectId ? [this.project(projectId).id] : this.projects().map((p) => p.id);
    return ids.flatMap((id) => this.load(id).findings);
  }
  finding(id: string): SecurityFinding {
    const f = this.load(this.ownerOf(id)).findings.find((x) => x.id === id);
    if (!f) throw new Error("There's no finding by that id.");
    return f;
  }
  /** Changes a finding and saves; tells the face unless `quiet`. */
  update(id: string, fn: (f: SecurityFinding) => SecurityFinding, quiet = false): SecurityFinding {
    const projectId = this.ownerOf(id);
    const d = this.load(projectId);
    const i = d.findings.findIndex((x) => x.id === id);
    if (i < 0) throw new Error("There's no finding by that id.");
    // Whatever changed it (a scan's words, a second look's), it is stored masked.
    const changed = maskFinding(fn(d.findings[i]));
    // The key follows what it is made of (a retitle), as load would make it after a restart; unless another finding has
    // that key already, when it keeps its own, so no two findings ever share one.
    const next = { ...changed, id, projectId, key: this.keyFree(d, id, findingKey(projectId, changed), d.findings[i].key), updatedAt: Date.now() };
    d.findings[i] = next;
    this.save(projectId);
    if (!quiet) this.changed(["findings"], projectId);
    return next;
  }
  /** Puts an event on a finding's activity. */
  note(id: string, e: Omit<FindingEvent, "at"> & { at?: number }) {
    return this.update(id, (f) => ({ ...f, activity: [...f.activity, { ...e, at: e.at ?? Date.now() }] }));
  }

  /**
    Adds a finding, or not: one already there by key (open, or dismissed) is the same problem. Open: its sources and the
    new facts merge in ("already-open"). Dismissed before, by you: left out, and it stays dismissed ("dismissed-before").
    Fixed, then found again: open again ("reopened"). Doesn't tell the face (`changed` once after a batch).
  */
  add(projectId: string, n: NewFinding, by?: string, scanId?: string): SecurityFindingAdded {
    const d = this.load(projectId);
    const out = this.put(d, projectId, n, by, this.indexOf(d, projectId));
    // Counted on its scan in the same write (an agent's report): one write of the record, not one for the finding and one for the count.
    const i = scanId ? d.scans.findIndex((x) => x.id === scanId) : -1;
    if (i >= 0) d.scans[i] = { ...d.scans[i], counts: counted(d.scans[i].counts, [out]) };
    if (out.outcome !== "dismissed-before" || i >= 0) this.save(projectId);
    if (i >= 0) this.emit({ type: "security.scan", scan: d.scans[i] });
    else if (scanId) {
      try {
        this.countOn(scanId, out);
      } catch {
        // the scan's record went between: the finding stays, uncounted
      }
    }
    return out;
  }
  /** Adds a batch as add() does each, saving once (an import, a run of the free checks). Doesn't tell the face either. */
  addMany(projectId: string, list: NewFinding[], by?: string): SecurityFindingAdded[] {
    const d = this.load(projectId);
    // The stored findings indexed once for the batch, not looked through (keys made again) for every result that comes in.
    const ix = this.indexOf(d, projectId);
    const out = list.map((n) => this.put(d, projectId, n, by, ix));
    if (out.some((a) => a.outcome !== "dismissed-before")) this.save(projectId);
    return out;
  }
  /** Changes many findings (each through `fn`, null: left as it is) and saves once; doesn't tell the face. */
  updateMany(projectId: string, fn: (f: SecurityFinding) => SecurityFinding | null): number {
    const d = this.load(projectId);
    let n = 0;
    d.findings = d.findings.map((f) => {
      const raw = fn(f);
      if (!raw) return f;
      const next = maskFinding(raw);
      n++;
      return { ...next, id: f.id, projectId, key: this.keyFree(d, f.id, findingKey(projectId, next), f.key), updatedAt: Date.now() };
    });
    if (n) this.save(projectId);
    return n;
  }
  /** `want` when no other finding holds it, else `had`: two findings never share a key. */
  private keyFree(d: ProjectData, id: string, want: string, had: string) {
    return d.findings.some((x) => x.id !== id && x.key === want) ? had : want;
  }
  /** A project's findings and dismissals by the keys put() looks them up by, each in the order the record holds them (first one wins). */
  private indexOf(d: ProjectData, projectId: string): FindingIndex {
    const ix: FindingIndex = { byKey: new Map(), byBare: new Map(), at: new Map(), dismissed: new Map() };
    d.findings.forEach((f, i) => {
      ix.at.set(f, i);
      if (!ix.byKey.has(f.key)) ix.byKey.set(f.key, f);
      if (f.instance) {
        const b = findingKey(projectId, { ...f, instance: undefined });
        ix.byBare.set(b, [...(ix.byBare.get(b) ?? []), f]);
      }
    });
    d.dismissed.forEach((x, i) => {
      if (!ix.dismissed.has(x.key)) ix.dismissed.set(x.key, { x, i });
    });
    return ix;
  }
  private put(d: ProjectData, projectId: string, raw: NewFinding, by: string | undefined, ix: FindingIndex): SecurityFindingAdded {
    // Every text it brings is masked before anything is made of it, its key too: a scan's, a report's, GitHub's words.
    const n = maskFinding(raw);
    const key = findingKey(projectId, n);
    const now = Date.now();
    // Keys from before instances (and sources that give none) still meet: one with an instance matches a record of the same
    // key without one, and one without matches the single record of its key that has one.
    const bare = n.instance ? findingKey(projectId, { ...n, instance: undefined }) : undefined;
    const instanced = n.instance ? [] : (ix.byBare.get(key) ?? []);
    const had = ix.byKey.get(key) ?? (bare ? ix.byKey.get(bare) : undefined) ?? (instanced.length === 1 ? instanced[0] : undefined);
    // The first dismissal in the record under either key, as a look through it in order would find.
    const one = ix.dismissed.get(bareKey(n));
    const two = n.instance !== undefined ? ix.dismissed.get(bareKey({ ...n, instance: undefined })) : undefined;
    const remembered = (one && two ? (one.i <= two.i ? one : two) : (one ?? two))?.x;
    if (had?.state === "dismissed" || (!had && remembered)) return { finding: had ?? this.ghost(projectId, n, key, remembered!, now), outcome: "dismissed-before" };
    if (had) {
      const reopen = had.state === "fixed";
      const next: SecurityFinding = {
        ...had,
        sources: had.sources.includes(n.source) ? had.sources : [...had.sources, n.source],
        severity: rank(n.severity) < rank(had.severity) ? n.severity : had.severity,
        explain: had.explain ?? n.explain,
        line: had.line ?? n.line,
        area: had.area ?? n.area,
        url: had.url ?? n.url,
        state: "open",
        fix: reopen ? undefined : had.fix,
        // A line when it says something: found again after a fix, raised by another source, or met by a scan (once a scan, for
        // its "already open" list). The same source finding it again on its next run adds nothing, or the list would grow for good.
        activity: reopen || !had.sources.includes(n.source) || (n.scan && !had.activity.some((e) => e.scan === n.scan)) ? [...had.activity, { at: now, kind: "raised-again", text: reopen ? "Found again after it was fixed" : `Raised again by ${n.source === "agent" ? "a scan" : n.source === "checks" ? "the free checks" : n.source === "github" ? "GitHub" : "a SARIF report"}`, ...(by ? { by } : {}), ...(n.scan ? { scan: n.scan } : {}) }] : had.activity,
        updatedAt: now,
      };
      const i = ix.at.get(had)!;
      d.findings[i] = next;
      ix.at.delete(had);
      ix.at.set(next, i);
      if (ix.byKey.get(had.key) === had) ix.byKey.set(had.key, next);
      const list = had.instance ? ix.byBare.get(findingKey(projectId, { ...had, instance: undefined })) : undefined;
      if (list?.includes(had)) list[list.indexOf(had)] = next;
      return { finding: next, outcome: reopen ? "reopened" : "already-open" };
    }
    const f: SecurityFinding = {
      id: uid("sf"),
      projectId,
      title: n.title.trim().slice(0, 300),
      severity: n.severity,
      file: n.file?.replace(/^\.\//, ""),
      line: n.line,
      endLine: n.endLine,
      source: n.source,
      sources: [n.source],
      rule: n.rule,
      ...(n.instance ? { instance: n.instance } : {}),
      key,
      state: "open",
      explain: n.explain,
      look: n.look ?? { state: "none" },
      activity: [{ at: now, kind: "found", text: n.source === "agent" ? "Found by a scan" : n.source === "checks" ? "Found by the free checks" : n.source === "github" ? "Brought in from GitHub" : "Brought in from a SARIF report", ...(by ? { by } : {}), ...(n.scan ? { scan: n.scan } : {}) }],
      area: n.area,
      scan: n.scan,
      url: n.url,
      ...(n.target ? { target: n.target } : {}),
      foundAt: now,
      updatedAt: now,
    };
    d.findings.push(f);
    ix.at.set(f, d.findings.length - 1);
    if (!ix.byKey.has(f.key)) ix.byKey.set(f.key, f);
    if (f.instance) {
      const b = findingKey(projectId, { ...f, instance: undefined });
      ix.byBare.set(b, [...(ix.byBare.get(b) ?? []), f]);
    }
    this.where.set(f.id, projectId);
    return { finding: f, outcome: "new" };
  }
  /** What a finding left out because you dismissed it would have been: never stored. */
  private ghost(projectId: string, n: NewFinding, key: string, was: ProjectData["dismissed"][number], now: number): SecurityFinding {
    return { id: "", projectId, title: n.title, severity: n.severity, file: n.file, line: n.line, source: n.source, sources: [n.source], rule: n.rule, ...(n.instance ? { instance: n.instance } : {}), key, state: "dismissed", dismissed: { reason: was.reason, note: was.note, at: was.at }, look: { state: "none" }, activity: [], foundAt: now, updatedAt: now };
  }

  /** Dismissed, with why: remembered by its key, so nothing raises it again. */
  dismiss(id: string, reason: DismissReason, note?: string): SecurityFinding {
    if (!["duplicate", "false-positive", "not-actionable", "accepted-risk", "mitigated", "other"].includes(reason)) throw new Error("That isn't a reason Security knows.");
    const at = Date.now();
    const words = note?.trim().slice(0, 500) || undefined;
    const f = this.update(id, (x) => ({ ...x, state: "dismissed", dismissed: { reason, note: words, at }, activity: [...x.activity, { at, kind: "dismissed", text: words ? `Dismissed: ${words}` : "Dismissed", by: "you" }] }), true);
    const d = this.load(f.projectId);
    d.dismissed = [...d.dismissed.filter((x) => x.key !== bareKey(f)), { key: bareKey(f), reason, note: words, at }];
    this.save(f.projectId);
    this.changed(["findings"], f.projectId);
    return f;
  }
  /** Open again: what you dismissed is forgotten, so a scan may raise it. */
  reopen(id: string): SecurityFinding {
    const at = Date.now();
    const f = this.update(id, (x) => ({ ...x, state: "open", dismissed: undefined, activity: [...x.activity, { at, kind: "reopened", text: "Opened again", by: "you" }] }), true);
    const d = this.load(f.projectId);
    d.dismissed = d.dismissed.filter((x) => x.key !== bareKey(f));
    this.save(f.projectId);
    this.changed(["findings"], f.projectId);
    return f;
  }
  /** Fixed: its fix was merged. */
  fixed(id: string, text = "Fixed: the fix was merged"): SecurityFinding {
    const at = Date.now();
    return this.update(id, (x) => ({ ...x, state: "fixed", fix: x.fix ? { ...x.fix, state: "merged", at } : x.fix, activity: [...x.activity, { at, kind: "fixed", text }] }));
  }

  // Scans.

  scans(projectId?: string): ScanRecord[] {
    const ids = projectId ? [this.project(projectId).id] : this.projects().map((p) => p.id);
    return ids.flatMap((id) => this.load(id).scans).sort((a, b) => b.startedAt - a.startedAt);
  }
  scan(id: string): ScanRecord {
    const s = this.load(this.ownerOf(id)).scans.find((x) => x.id === id);
    if (!s) throw new Error("There's no scan by that id.");
    return s;
  }
  /** A new scan's record, saved (state running unless said); tells the face. */
  newScan(r: Omit<ScanRecord, "id" | "counts" | "startedAt" | "state"> & Partial<Pick<ScanRecord, "state" | "startedAt">>): ScanRecord {
    const d = this.load(r.projectId);
    const s: ScanRecord = { ...r, id: uid("sc"), state: r.state ?? "running", startedAt: r.startedAt ?? Date.now(), counts: { found: 0, fresh: 0, already: 0, leftOut: 0, bySeverity: noSeverities() } };
    d.scans = [s, ...d.scans].slice(0, SCANS_KEPT);
    this.where.set(s.id, r.projectId);
    this.save(r.projectId);
    this.emit({ type: "security.scan", scan: s });
    this.changed(["scans"], r.projectId);
    return s;
  }
  /** Changes a scan's record and saves; sends it as security.scan. */
  patchScan(id: string, patch: Partial<Omit<ScanRecord, "id" | "projectId">>): ScanRecord {
    const projectId = this.ownerOf(id);
    const d = this.load(projectId);
    const i = d.scans.findIndex((x) => x.id === id);
    if (i < 0) throw new Error("There's no scan by that id.");
    const next = maskScan({ ...d.scans[i], ...patch, id, projectId });
    d.scans[i] = next;
    this.save(projectId);
    this.emit({ type: "security.scan", scan: next });
    if (patch.state && patch.state !== "running" && patch.state !== "asking") this.changed(["scans"], projectId);
    return next;
  }
  /** Counts what adding a finding did on its scan. */
  countOn(scanId: string, added: SecurityFindingAdded): ScanRecord {
    return this.countMany(scanId, [added]);
  }
  /** Counts what adding a batch did on its scan, in one write and one security.scan (a run of the free checks). */
  countMany(scanId: string, added: SecurityFindingAdded[]): ScanRecord {
    const s = this.scan(scanId);
    return added.length ? this.patchScan(scanId, { counts: counted(s.counts, added) }) : s;
  }

  // The free checks' last run.

  checks(projectId: string): FreeCheckRun | undefined {
    return this.load(projectId).checks;
  }
  setChecks(run: FreeCheckRun) {
    this.load(run.projectId).checks = run;
    this.save(run.projectId);
    this.changed(["checks"], run.projectId);
  }

  // The threat model.

  /** The threat model's file for a project, relative to its folder. */
  modelFile(projectId: string): string {
    return this.load(projectId).modelFile ?? MODEL_FILE;
  }
  setModelFile(projectId: string, file: string) {
    const root = resolve(this.project(projectId).path);
    const abs = resolve(root, file);
    const rel = relative(root, abs);
    if (!rel || outside(rel)) throw new Error("The threat model is a file inside the project's folder.");
    this.load(projectId).modelFile = rel === MODEL_FILE ? undefined : rel;
    this.save(projectId);
  }
  /** Reads the raw SECURITY.md text for inline viewing/editing. */
  modelText(projectId: string): { file: string; exists: boolean; text: string } {
    const p = this.project(projectId);
    const file = this.modelFile(projectId);
    const abs = join(p.path, file);
    try {
      if (!insideReal(p.path, abs)) return { file, exists: false, text: "" };
      const st = statSync(abs);
      if (st.isFile() && st.size < 1_000_000) return { file, exists: true, text: readFileSync(abs, "utf8") };
    } catch {
      // not written yet
    }
    return { file, exists: false, text: "" };
  }
  /** Writes the project's SECURITY.md safely inside the project folder and returns the updated ThreatModel. */
  writeModel(projectId: string, text: string): ThreatModel {
    const p = this.project(projectId);
    const file = this.modelFile(projectId);
    const abs = join(p.path, file);
    const rel = relative(p.path, abs);
    if (!rel || outside(rel)) throw new Error("The threat model must live inside the project folder.");
    const dir = resolve(abs, "..");
    let up = dir;
    while (!lstatSync(up, { throwIfNoEntry: false }) && up !== dirname(up)) up = dirname(up);
    if (!insideReal(p.path, up)) throw new Error("The threat model folder points outside the project.");
    mkdirSync(dir, { recursive: true });
    if (!insideReal(p.path, dir)) throw new Error("The threat model folder points outside the project.");
    writeAtomic(abs, `${text.replace(/\r\n/g, "\n").trimEnd()}\n`);
    const next = this.model(projectId);
    this.changed(["projects"], projectId);
    return next;
  }
  /** The threat model as it is on disk now, its areas with what is open in each. */
  model(projectId: string): ThreatModel {
    const p = this.project(projectId);
    const file = this.modelFile(projectId);
    const abs = join(p.path, file);
    let text = "";
    let written: number | undefined;
    try {
      // Only a file inside the project by real path: a SECURITY.md (or a folder on its way) linked elsewhere isn't read.
      if (!insideReal(p.path, abs)) throw new Error("outside");
      const st = statSync(abs);
      if (st.isFile() && st.size < 1_000_000) {
        text = readFileSync(abs, "utf8");
        written = st.mtimeMs;
      }
    } catch {
      // not written yet
    }
    const open = this.findings(projectId).filter((f) => f.state === "open");
    const areas: ThreatArea[] = parseAreas(text).map((a) => ({ ...a, open: open.filter((f) => f.area && f.area.toLowerCase() === a.name.toLowerCase()).length }));
    return { file, exists: written !== undefined, areas, ...(written !== undefined ? { written } : {}) };
  }

  // What the face reads.

  overview(days = 30, projectId?: string, now = Date.now()): SecurityOverview {
    const span = Math.max(1, Math.min(365, Math.round(days)));
    const all = this.findings(projectId);
    const scans = this.scans(projectId);
    const first = dayStart(now) - (span - 1) * DAY;
    const open = all.filter((f) => f.state === "open");
    const weekAgo = now - 7 * DAY;
    const inPeriod = (t: number) => t >= first && t <= now;
    const events = all.flatMap((f) => f.activity.map((e) => ({ f, e })));
    const fixedEvents = events.filter(({ e }) => e.kind === "fixed" && inPeriod(e.at));
    // Dismissed in the period: findings dismissed now, the last time in the period (one opened again isn't; one dismissed six times is one).
    const dismissedNow = all.filter((f) => f.state === "dismissed" && f.dismissed && inPeriod(f.dismissed.at));
    const dismissReasons: SecurityOverview["dismissReasons"] = {};
    for (const f of dismissedNow) dismissReasons[f.dismissed!.reason] = (dismissReasons[f.dismissed!.reason] ?? 0) + 1;
    // Each day of the period once, in order: each finding's activity sorted once and replayed forward as the days go (stateAt,
    // swept), and what happened bucketed by its day, so a year of thousands of findings isn't days × findings × sorts.
    const dayOf = (t: number) => {
      const i = Math.floor((t - first) / DAY);
      return i >= 0 && i < span && t <= Math.min(first + i * DAY + DAY - 1, now) ? i : -1;
    };
    const tally = () => new Array<number>(span).fill(0);
    const [foundBy, fixedBy, dismissedBy, openBy] = [tally(), tally(), tally(), tally()];
    const scansBy = Array.from({ length: span }, (): string[] => []);
    for (const s of scans) if (dayOf(s.startedAt) >= 0) scansBy[dayOf(s.startedAt)].push(s.id);
    for (const f of all) if (dayOf(f.foundAt) >= 0) foundBy[dayOf(f.foundAt)]++;
    for (const { e } of events) if ((e.kind === "fixed" || e.kind === "dismissed") && dayOf(e.at) >= 0) (e.kind === "fixed" ? fixedBy : dismissedBy)[dayOf(e.at)]++;
    for (const f of all) {
      const sorted = [...f.activity].sort((a, b) => a.at - b.at);
      let k = 0;
      let st: FindingState | null = null;
      for (let i = 0; i < span; i++) {
        const end = Math.min(first + i * DAY + DAY - 1, now);
        for (; k < sorted.length && sorted[k].at <= end; k++) st = stepState(st, sorted[k]);
        if (st === "open") openBy[i]++;
      }
    }
    const series = Array.from({ length: span }, (_, i) => {
      const at = first + i * DAY;
      return { day: dayName(at), at, open: openBy[i], scans: scansBy[i], found: foundBy[i], fixed: fixedBy[i], dismissed: dismissedBy[i] };
    });
    const bySeverity = (list: SecurityFinding[]): SeverityCounts => {
      const c = noSeverities();
      for (const f of list) c[f.severity]++;
      return c;
    };
    const byLook: Record<SecondLookState, number> = { confirmed: 0, unconfirmed: 0, none: 0 };
    for (const f of open) byLook[f.look?.state ?? "none"]++;
    // Being fixed: a fix session still at work. One finished and waiting for you is fixesReady.
    const fixing = open.filter((f) => f.fix?.state === "working");
    const ready = open.filter((f) => f.fix?.state === "ready");
    const latest = new Map<string, FreeCheckRun["results"][number]>();
    for (const p of projectId ? [this.project(projectId)] : this.projects()) for (const r of this.load(p.id).checks?.results ?? []) {
      const had = latest.get(r.check);
      // Across projects, one that found something says more than one that found nothing.
      if (!had || (r.state === "found" && had.state !== "found") || (r.state === had.state && r.at > had.at)) latest.set(r.check, had && r.state === "found" && had.state === "found" ? { ...r, count: had.count + r.count } : r);
    }
    return {
      days: span,
      ...(projectId ? { projectId } : {}),
      open: open.length,
      openWeekAgo: all.filter((f) => stateAt(f, weekAgo) === "open").length,
      found: all.filter((f) => inPeriod(f.foundAt)).length,
      scans: scans.filter((s) => inPeriod(s.startedAt)).length,
      fixed: fixedEvents.length,
      ...(fixedEvents.length ? { lastFixedAt: Math.max(...fixedEvents.map(({ e }) => e.at)) } : {}),
      dismissed: dismissedNow.length,
      dismissReasons,
      beingFixed: fixing.length,
      fixThreads: fixing.map((f) => f.fix!.threadId),
      fixesReady: ready.length,
      series,
      bySeverity: bySeverity(open),
      byLook,
      byProject: (projectId ? [this.project(projectId)] : this.projects()).map((p) => {
        const mine = open.filter((f) => f.projectId === p.id);
        return { projectId: p.id, name: p.name, open: mine.length, bySeverity: bySeverity(mine) };
      }).sort((a, b) => b.open - a.open),
      worst: [...open].sort(worstFirst).slice(0, 8),
      checks: [...latest.values()],
    };
  }

  projectSummary(projectId: string): SecurityProject {
    const p = this.project(projectId);
    const d = this.load(projectId);
    const open = d.findings.filter((f) => f.state === "open");
    const bySeverity = noSeverities();
    for (const f of open) bySeverity[f.severity]++;
    const scans = [...d.scans].sort((a, b) => b.startedAt - a.startedAt);
    const readers = [...new Set(scans.map((s) => (s.reader ? (s.reader.kind === "own" ? s.reader.model ?? s.reader.agent : s.reader.model) : "free checks")))];
    return { projectId, name: p.name, path: p.path, open: open.length, bySeverity, ...(scans[0] ? { lastScan: scans[0] } : {}), threatModel: this.model(projectId), ...(d.checks ? { checks: d.checks } : {}), scans: scans.slice(0, 8), readers };
  }
}

/** The security.* handlers, for api.ts. The parts other modules own are called through as they are. */
export function rpc(x: () => Security): SecurityRpc {
  return {
    "security.overview": ({ days, projectId }) => x().overview(days ?? 30, projectId),
    "security.side": async () => {
      const s = x();
      const open = s.findings().filter((f) => f.state === "open");
      const fixes = s.store.threads.filter((t) => t.security?.kind === "fix" && !t.archived).sort((a, b) => b.createdAt - a.createdAt).map((t) => t.id);
      return { open: open.length, github: { open: open.filter((f) => f.sources.includes("github")).length, reach: await githubReach(s) }, sarif: { open: open.filter((f) => f.sources.includes("sarif")).length }, scans: s.scans().slice(0, 20), fixes };
    },
    "security.projects": () => {
      const s = x();
      return s.projects().map((p) => s.projectSummary(p.id));
    },
    "security.project.add": async ({ path }) => {
      const s = x();
      if (!str(path) || !path.trim()) throw new Error("Pick a folder.");
      const p = await s.host.call("project.add", { path });
      s.changed(["projects"], p.id);
      return s.projectSummary(p.id);
    },
    "security.findings.list": ({ projectId, state, scan }) => {
      const all = x().findings(projectId);
      return all.filter((f) => (!state || f.state === state) && (!scan || f.scan === scan || f.activity.some((e) => e.scan === scan))).sort(worstFirst);
    },
    "security.finding.dismiss": ({ id, reason, note }) => x().dismiss(id, reason, note),
    "security.finding.reopen": ({ id }) => x().reopen(id),
    "security.finding.note": ({ id, text }) => {
      const clean = str(text) ? text.trim().slice(0, 2000) : "";
      if (!clean) throw new Error("Write a note first.");
      return x().note(id, { kind: "note", text: clean, by: "you" });
    },
    "security.finding.look": ({ id, model }) => lookFinding(x(), id, model),
    "security.finding.fix": (p) => fixFinding(x(), p),
    "security.finding.ask": (p) => askAbout(x(), p),
    "security.bringin.github": ({ projectId }) => bringGitHub(x(), projectId),
    "security.bringin.sarif": (p) => bringSarif(x(), p),
    "security.model.read": ({ projectId }) => x().model(projectId),
    "security.model.text": ({ projectId }) => x().modelText(projectId),
    "security.model.write": ({ projectId, text }) => x().writeModel(projectId, text),
    "security.scan.options": ({ projectId }) => scanOptions(x(), projectId),
    "security.scan.start": (p) => startScan(x(), p),
    "security.scan.stop": ({ id }) => stopScan(x(), id),
    "security.scans.list": ({ projectId }) => x().scans(projectId),
    "security.specialist.look": async () => {
      const s = x();
      return specialists(await s.host.refreshProviders(), s.store.settings);
    },
    // A pull request's or an issue's scan, its status for the lists, who can read one, and what follows it (security-targets.ts).
    ...targetRpc(x),
  };
}
