/*
  Liner Security: what a scan has found, in a panel beside its chat (boards D, E and F): its name and a search, its
  status line ("1 finding so far · scanning, about 2 min left"), Open, Fixed and Dismissed, the open ones by severity as a
  thin bar with its counts, two filters (second look, severity), the list or "Nothing found yet", what was already open
  and not raised again, and the areas of SECURITY.md with how far it has read each. Live: it asks again whenever the
  engine says a finding or the scan changed (security.changed, security.scan). A row opens the finding on Findings.

  Beside a fix or a question about a finding (no scan), it shows that one finding instead.
*/
import { useMemo, useState } from "react";
import type { FindingState, ScanRecord, SecondLookState, SecurityFinding, Severity, ThreatModel } from "@contracts";
import { noSeverities, SEVERITIES, SEVERITY_LABEL } from "@contracts";
import { I } from "../icons";
import { duration, plural } from "../model";
import { CountTabs, FilterChip, Legend, SevBar, SevMark, Tag, TwoLines, sevParts } from "./parts";
import { goSecurity, useScan, useSecurity } from "./store";
import "./scan.css";

/** What a scan's own data is, when it doesn't come from the engine (the dev mock). */
export type FoundData = { scan: ScanRecord; findings: SecurityFinding[]; model: ThreatModel };

const LOOK_WORDS: Record<SecondLookState, string> = { none: "", confirmed: "Confirmed", unconfirmed: "Couldn't confirm" };
/** Where a finding is: "alerts.js:27", the file's name alone. */
export const placeOf = (f: Pick<SecurityFinding, "file" | "line">) => (f.file ? `${f.file.split("/").pop()}${f.line ? `:${f.line}` : ""}` : "");
/** What its row says under its title: where, and the second look or where it came from (how bad is its mark's word, as on Findings). */
function noteOf(f: SecurityFinding, scan: ScanRecord | null, waiting: boolean) {
  const look = f.look.state !== "none" ? LOOK_WORDS[f.look.state] : f.scan === scan?.id && scan?.secondLook && waiting ? "waiting for the second look" : f.source === "checks" ? (f.rule?.startsWith("GHSA") || f.file === "package.json" ? "from npm audit" : "from the free checks") : f.source === "github" ? "from GitHub" : f.source === "sarif" ? "from a report" : "";
  return [placeOf(f), look].filter(Boolean).join(" · ");
}

export function FoundPanel({ scanId, threadId, projectId, finding, paused, left, data, onClose }: {
  /** The scan's record (ScanRecord.id); unset for a fix or a question. */
  scanId?: string;
  threadId: string;
  /** The project the scan reads. */
  projectId?: string;
  /** A fix's or a question's finding, when there's no scan. */
  finding?: string;
  /** The scan waits on a question. */
  paused?: boolean;
  /** "about 2 min left", from the scan's plan. */
  left?: string;
  /** The scan's data, given rather than asked for (the dev mock). */
  data?: FoundData;
  /** Only while the panel lies over the chat (a narrow window), where it covers the top row's lit panel icon that otherwise hides it. */
  onClose?: () => void;
}) {
  void threadId;
  const live = useScan(data ? undefined : scanId);
  const scan = data?.scan ?? live;
  const project = projectId ?? scan?.projectId;
  const asked = useSecurity("security.findings.list", { projectId: project }, ["findings"]);
  const asked2 = useSecurity("security.model.read", { projectId: project ?? "" }, ["model"]);
  const all = data?.findings ?? asked.data ?? [];
  const model = data?.model ?? (project ? asked2.data : null);
  const [tab, setTab] = useState<FindingState>("open");
  const [look, setLook] = useState<SecondLookState | undefined>();
  const [sev, setSev] = useState<Severity | undefined>();
  const [search, setSearch] = useState<string | null>(null);

  const id = scan?.id ?? scanId;
  const mine = useMemo(() => all.filter((f) => (id ? f.scan === id : f.id === finding)), [all, id, finding]);
  const already = useMemo(() => (id ? all.filter((f) => f.scan !== id && f.state === "open" && f.activity.some((e) => e.kind === "raised-again" && e.scan === id)) : []), [all, id]);
  const count = (s: FindingState) => mine.filter((f) => f.state === s).length;
  const open = mine.filter((f) => f.state === "open");
  const bySev = noSeverities();
  for (const f of open) bySev[f.severity]++;
  const words = search?.trim().toLowerCase();
  const shown = mine.filter((f) => f.state === tab && (!look || f.look.state === look) && (!sev || f.severity === sev) && (!words || `${f.title} ${f.file ?? ""}`.toLowerCase().includes(words)));
  const done = scan && (scan.state === "done" || scan.state === "stopped" || scan.state === "failed");
  // Still to have its second look: the scan is reading on, or the second look is.
  const waiting = Boolean(scan && (!done || scan.looking));
  const n = mine.length;
  const took = scan?.finishedAt ? duration((scan.finishedAt - scan.startedAt) / 1000) : "";
  const status = !scan
    ? null
    : scan.state === "done"
      ? [plural(n, "finding"), took && `finished in ${took}`]
      : scan.error
        ? // The engine's own words for why it ended ("Stopped: it waited too long for your answers.").
          [plural(n, "finding"), scan.error.replace(/\.$/, "")]
        : scan.state === "stopped"
        ? [plural(n, "finding"), `stopped${took ? ` after ${took}` : ""}`]
        : scan.state === "failed"
          ? [plural(n, "finding"), "it didn't finish"]
          : [n ? `${plural(n, "finding")} so far` : "Nothing yet", paused || scan.state === "asking" ? "paused until you answer or skip" : scan.looking ? "taking the second look" : left ? `scanning, ${left}` : "scanning"];
  const row = (f: SecurityFinding) => (
    <button key={f.id} type="button" className="lsc-rw l-focus" onClick={() => goSecurity({ kind: "findings", finding: f.id, state: f.state })}>
      <SevMark severity={f.severity} />
      <TwoLines title={f.title} note={noteOf(f, scan, waiting)} />
    </button>
  );

  // A fix or a question: the one finding it is about.
  if (!id) {
    const f = mine[0];
    return (
      <aside className="lsc-found" aria-label="The finding">
        <header className="lsc-found-top">
          <span className="lsc-found-t">The finding</span>
          <span className="lc-grow" />
          {onClose && (
            <button type="button" className="lc-tb l-focus" aria-label="Close" title="Close" onClick={onClose}>
              <I.close size={16} />
            </button>
          )}
        </header>
        <div className="lsc-found-b">
          {f ? (
            <>
              {row(f)}
              {f.explain?.lead && <p className="lsc-found-lead">{f.explain.lead}</p>}
              {f.look.state !== "none" && f.look.words && (
                <p className="lsc-found-look">
                  <Tag tone={f.look.state === "confirmed" ? "ok" : undefined}>{LOOK_WORDS[f.look.state]}</Tag> {f.look.words}
                </p>
              )}
              <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => goSecurity({ kind: "findings", finding: f.id, state: f.state })}>
                Open it in Findings
              </button>
            </>
          ) : (
            <div className="ls-none">{asked.loading ? "" : "This finding is no longer there."}</div>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="lsc-found" aria-label={done ? "What the scan found" : "What the scan has found so far"}>
      <header className="lsc-found-top">
        {search === null ? (
          <span className="lsc-found-t">{done ? "Found" : "Found so far"}</span>
        ) : (
          <input className="lsc-found-q" autoFocus value={search} placeholder="Search these findings" aria-label="Search these findings" onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setSearch(null)} />
        )}
        <span className="lc-grow" />
        <button type="button" className="lc-tb l-focus" aria-label={search === null ? "Search these findings" : "Stop searching"} title={search === null ? "Search these findings" : "Stop searching"} aria-pressed={search !== null} onClick={() => setSearch(search === null ? "" : null)}>
          <I.search size={16} />
        </button>
        {onClose && (
          <button type="button" className="lc-tb l-focus" aria-label="Close" title="Close" onClick={onClose}>
            <I.close size={16} />
          </button>
        )}
      </header>
      <div className="lsc-found-b">
        {status && (
          <div className="lsc-fmeta" role="status">
            {status.filter(Boolean).map((s, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden>·</span>}
                {s}
              </span>
            ))}
          </div>
        )}
        <div className="lsc-found-tabs">
          <CountTabs
            label="Which findings"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "open", label: "Open", count: count("open") },
              { value: "fixed", label: "Fixed", count: count("fixed") },
              { value: "dismissed", label: "Dismissed", count: count("dismissed") },
            ]}
          />
        </div>

        <div className="ls-blkh lsc-sp">Open findings by severity</div>
        <SevBar counts={bySev} />
        <span className="l-sr-only">{SEVERITIES.map((s) => `${bySev[s]} ${SEVERITY_LABEL[s].toLowerCase()}`).join(", ")}</span>
        <Legend parts={sevParts(bySev)} count={() => true} tight />

        <div className="lsc-filt">
          <FilterChip label="Second look" value={look} onChange={setLook} options={[{ value: "confirmed", label: "Confirmed" }, { value: "unconfirmed", label: "Couldn't confirm" }, { value: "none", label: "Not looked at" }]} />
          <FilterChip label="Severity" value={sev} onChange={setSev} options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))} />
        </div>
        {shown.length ? (
          <div className="lsc-rws">{shown.map(row)}</div>
        ) : mine.length === 0 && tab === "open" && !look && !sev && !words ? (
          <div className="ls-none">
            <span className="ls-disc">
              <I.search size={16} />
            </span>
            <b>{done ? "Nothing found" : "Nothing found yet"}</b>
            <span>{done ? "The scan read what it could and found nothing to raise." : "Findings show here as soon as the scan finds them."}</span>
          </div>
        ) : (
          <div className="ls-none">
            <span>{words ? "No finding here matches that." : "None here."}</span>
          </div>
        )}

        {already.length > 0 && (
          <>
            <div className="ls-blkh lsc-sp">
              Already open, not raised again<span className="ls-num lsc-found-n">{already.length}</span>
            </div>
            <div className="lsc-rws">{already.map(row)}</div>
          </>
        )}

        {model && model.areas.length > 0 && (
          <>
            <div className="ls-blkh lsc-sp">Areas in {model.file}</div>
            {model.areas.map((a) => {
              const reading = scan?.areasReading?.some((x) => x.toLowerCase() === a.name.toLowerCase());
              const read = scan?.areasRead?.some((x) => x.toLowerCase() === a.name.toLowerCase());
              const untouched = scan?.areasUntouched?.some((x) => x.toLowerCase() === a.name.toLowerCase());
              return (
                <div key={a.name} className="lsc-kvr">
                  <span className="lsc-k">{a.name}</span>
                  <span className="lsc-v" data-on={reading || read || undefined}>
                    {reading ? "Reading now" : read ? "Read" : untouched ? "This branch did not touch it" : done ? "Not read" : "Not read yet"}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}
