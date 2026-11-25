/*
  Liner Security: what a scan has found, in a panel beside its chat (boards D, E and F), in the panel's own frame (Pane.tsx):
  its head with the name, a find field and one menu of two filters (second look, severity); the open ones by severity as a
  thin bar with its counts; the list under a picker of Open, Fixed and Dismissed, or "Nothing found yet"; what was already
  open and not raised again; the areas of SECURITY.md with how far it has read each; and at its foot the status line
  ("1 finding so far · scanning, about 2 min left"). Live: it asks again whenever the
  engine says a finding or the scan changed (security.changed, security.scan). A row opens the finding on Findings.

  Beside a fix or a question about a finding (no scan), it shows that one finding instead.
*/
import { useMemo, useState } from "react";
import type { FindingState, ScanRecord, SecondLookState, SecurityFinding, Severity, ThreatModel } from "@contracts";
import { noSeverities, SEVERITIES, SEVERITY_LABEL } from "@contracts";
import { I, StepMark } from "../icons";
import { PaneBody, PaneButton, PaneField, PaneFoot, PaneHead, PaneNote, PaneRow, PaneSection, PANE_PICK, PANE_TOOL } from "../Pane";
import { Pop, Row, Sep, SubMenu } from "../ui";
import { duration, plural } from "../model";
import { Legend, SevBar, SevSquare, sevParts } from "./parts";
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
  /** Hides the panel: the head's Close, as every pane's head has it. */
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
  const [search, setSearch] = useState("");

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
  const row = (f: SecurityFinding) => {
    // Where it is at the row's right end, so the title keeps its room; the second look and where it came from in its tooltip.
    const note = noteOf(f, scan, waiting);
    return (
      <PaneRow key={f.id} icon={<SevSquare severity={f.severity} />} value={placeOf(f) || undefined} quiet title={[f.title, note].filter(Boolean).join(" · ")} onClick={() => goSecurity({ kind: "findings", finding: f.id, state: f.state })}>
        {f.title}
      </PaneRow>
    );
  };

  // A fix or a question: the one finding it is about.
  if (!id) {
    const f = mine[0];
    return (
      <aside className="lsc-found" aria-label="The finding">
        <PaneHead name="Finding" canvas={false} onClose={onClose} />
        <PaneBody>
          {f ? (
            <PaneSection label="Summary">
              {row(f)}
              {(f.explain?.lead || (f.look.state !== "none" && f.look.words)) && (
                <div className="lsc-found-txt">
                  {f.explain?.lead && <p className="lsc-found-lead">{f.explain.lead}</p>}
                  {f.look.state !== "none" && f.look.words && (
                    <p className="lsc-found-look">
                      <span data-tone={f.look.state === "confirmed" ? "ok" : undefined}>{LOOK_WORDS[f.look.state]}.</span> {f.look.words}
                    </p>
                  )}
                </div>
              )}
            </PaneSection>
          ) : asked.loading ? null : (
            <PaneNote icon={<I.search size={16} />} title="This finding is no longer there" />
          )}
        </PaneBody>
        {f && (
          <PaneFoot>
            <PaneButton ink onClick={() => goSecurity({ kind: "findings", finding: f.id, state: f.state })}>
              Open it in Findings
            </PaneButton>
          </PaneFoot>
        )}
      </aside>
    );
  }

  const filtered = Boolean(look || sev);
  const STATES: { value: FindingState; label: string }[] = [
    { value: "open", label: "Open" },
    { value: "fixed", label: "Fixed" },
    { value: "dismissed", label: "Dismissed" },
  ];
  const LOOKS: { value: SecondLookState; label: string }[] = [
    { value: "confirmed", label: "Confirmed" },
    { value: "unconfirmed", label: "Couldn't confirm" },
    { value: "none", label: "Not looked at" },
  ];
  return (
    <aside className="lsc-found" aria-label={done ? "What the scan found" : "What the scan has found so far"}>
      <PaneHead
        name="Found"
        canvas={false}
        onClose={onClose}
        shows={
          <PaneField icon={<I.search size={14} />}>
            <input value={search} placeholder="Find a finding" aria-label="Find a finding" onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Escape" && search && (e.preventDefault(), e.stopPropagation(), setSearch(""))} />
          </PaneField>
        }
        tools={
          // The view's two filters in one menu, each "Label  Value ›" (rule 8), where two chips stood loose in the body.
          <Pop label={filtered ? "Narrow the list: some filters on" : "Narrow the list"} menu align="end" width={240} triggerClass={PANE_TOOL} triggerAttrs={{ "aria-pressed": filtered || undefined, title: "Narrow the list" }} trigger={<I.filter size={16} />}>
            {(close) => (
              <>
                <SubMenu title="Second look" value={LOOKS.find((o) => o.value === look)?.label ?? "Any"} label="Second look">
                  {(done) => (
                    <>
                      <Row title="Any" on={!look} onPick={() => (done(), close(), setLook(undefined))} />
                      {LOOKS.map((o) => <Row key={o.value} title={o.label} on={o.value === look} onPick={() => (done(), close(), setLook(o.value))} />)}
                    </>
                  )}
                </SubMenu>
                <SubMenu title="Severity" value={sev ? SEVERITY_LABEL[sev] : "Any"} label="Severity">
                  {(done) => (
                    <>
                      <Row title="Any" on={!sev} onPick={() => (done(), close(), setSev(undefined))} />
                      {SEVERITIES.map((s) => <Row key={s} title={SEVERITY_LABEL[s]} on={s === sev} onPick={() => (done(), close(), setSev(s))} />)}
                    </>
                  )}
                </SubMenu>
                {filtered && (
                  <>
                    <Sep />
                    <Row title="Clear the filters" icon={<I.close size={14} />} onPick={() => (close(), setLook(undefined), setSev(undefined))} />
                  </>
                )}
              </>
            )}
          </Pop>
        }
      />
      <PaneBody>
        <PaneSection label="Open, by severity" note={plural(open.length, "open finding")}>
          <div className="lsc-found-txt">
            <SevBar counts={bySev} />
            <span className="l-sr-only">{SEVERITIES.map((s) => `${bySev[s]} ${SEVERITY_LABEL[s].toLowerCase()}`).join(", ")}</span>
            <Legend parts={sevParts(bySev)} count={() => true} tight />
          </div>
        </PaneSection>

        <PaneSection
          label="Findings"
          note={
            // Open, Fixed or Dismissed: one picker with its count, where a segmented control stood in the body.
            <Pop label={`Showing ${STATES.find((t) => t.value === tab)!.label.toLowerCase()} findings. Show others`} menu align="end" width={200} triggerClass={PANE_PICK} trigger={<>{STATES.find((t) => t.value === tab)!.label} {count(tab)}<I.chevD size={12} /></>}>
              {(close) => STATES.map((t) => <Row key={t.value} title={t.label} end={String(count(t.value))} on={t.value === tab} onPick={() => (close(), setTab(t.value))} />)}
            </Pop>
          }
        >
          {shown.length ? (
            shown.map(row)
          ) : mine.length === 0 && tab === "open" && !look && !sev && !words ? (
            <PaneNote icon={<I.search size={16} />} title={done ? "Nothing found" : "Nothing found yet"}>
              {done ? "The scan read what it could and found nothing to raise." : "Findings show here as soon as the scan finds them."}
            </PaneNote>
          ) : (
            <PaneNote title={words ? "No finding here matches that" : "None here"} />
          )}
        </PaneSection>

        {already.length > 0 && (
          <PaneSection label="Already open, not raised again" note={already.length}>
            {already.map(row)}
          </PaneSection>
        )}

        {model && model.areas.length > 0 && (
          <PaneSection label={`Areas in ${model.file}`}>
            {model.areas.map((a) => {
              const reading = scan?.areasReading?.some((x) => x.toLowerCase() === a.name.toLowerCase());
              const read = scan?.areasRead?.some((x) => x.toLowerCase() === a.name.toLowerCase());
              const untouched = scan?.areasUntouched?.some((x) => x.toLowerCase() === a.name.toLowerCase());
              const step = reading ? "working" : read ? "done" : untouched ? "skipped" : "waiting";
              return (
                <PaneRow key={a.name} icon={<StepMark state={step} size={14} />} value={reading ? "Reading now" : read ? "Read" : untouched ? "This branch did not touch it" : done ? "Not read" : "Not read yet"} quiet={!reading && !read}>
                  {a.name}
                </PaneRow>
              );
            })}
          </PaneSection>
        )}
      </PaneBody>
      {status && (
        <PaneFoot
          say={
            <span role="status">
              {status.filter(Boolean).join(" · ")}
            </span>
          }
        />
      )}
    </aside>
  );
}
