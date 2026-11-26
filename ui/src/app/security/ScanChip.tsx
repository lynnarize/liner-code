/*
  A pull request's or an issue's Liner Security chip, in the Pull requests and Issues lists and their detail (board
  PullRequests). Never scanned: a split chip, "Scan" (or "Check" for an issue) on the left runs with the reader shown, and
  the right half, that reader's tool mark and a ⌄, opens "Who scans #128": your default first, the other models, a
  Specialist scan where a tool can run one sealed, and whether a second look follows. Scanning: the nine-dot working mark.
  Done: what it found open ("1 high · 1 low", amber), "Clean", or for an issue what it decided ("Real · medium"). A press
  on a scan's state opens its card in the dock (ScanDock.tsx). Every scan only reads.
*/
import type { ScanReaderChoice, ScanSummary, ScanTarget } from "@contracts";
import { targetName } from "@contracts";
import { I, ModelMark, StateMark } from "../icons";
import { toolMarkOf } from "../model";
import { MenuFoot, Pop, Row, Sep } from "../ui";
import { dockScan, lookOn, pickedReader, setLookOn, startTargetScan, useReaders, useScanSummary } from "./target-store";
import "./scans.css";

export { startTargetScan, useScanSummary } from "./target-store";

/** What a finished scan found, in a few words: "1 high · 1 low", "Clean", "Real · medium", "Not real". */
export function summaryWords(s: ScanSummary, kind: ScanTarget["kind"]): { words: string; found: boolean; worst?: "high" | "medium" | "low" } {
  if (kind === "issue" && s.verdict) {
    if (s.verdict === "real") return { words: `Real${s.severity ? ` · ${s.severity === "critical" ? "critical" : s.severity}` : ""}`, found: true, worst: s.severity === "low" ? "low" : s.severity === "medium" ? "medium" : "high" };
    return { words: s.verdict === "not-real" ? "Not real" : "Couldn't tell", found: false };
  }
  const parts = [s.high && `${s.high} high`, s.medium && `${s.medium} medium`, s.low && `${s.low} low`].filter(Boolean) as string[];
  if (!parts.length) return { words: "Clean", found: false };
  return { words: parts.join(" · "), found: true, worst: s.high ? "high" : s.medium ? "medium" : "low" };
}

/** The mark of a reader's tool (brands.ts through model.ts), a cube when nobody's list knows it. */
const markOf = (r?: ScanReaderChoice) => (r ? (r.brand === "other" ? "other" : r.brand === "demo" ? "demo" : toolMarkOf(r.brand)) : "other");

export function ScanChip(p: { target: ScanTarget; verb?: "Scan" | "Check" }) {
  const verb = p.verb ?? (p.target.kind === "issue" ? "Check" : "Scan");
  const s = useScanSummary(p.target);
  const readers = useReaders(p.target.projectId);
  const name = targetName(p.target);
  const ing = verb === "Check" ? "Checking" : "Scanning";
  if (s && s.state === "running")
    return (
      <button type="button" className="lst-chip l-focus" data-state="running" onClick={() => dockScan(s.scanId)} aria-label={`${ing} ${name}: open its card`}>
        <StateMark state="working" size={12} />
        {ing}
      </button>
    );
  if (s && s.state === "done") {
    const w = summaryWords(s, p.target.kind);
    return (
      <button type="button" className="lst-chip l-focus" data-state={w.found ? "found" : "clean"} data-worst={w.worst} onClick={() => dockScan(s.scanId)} title={s.lead} aria-label={`${name}: ${w.words}. Open the scan`}>
        {w.found ? <i className="lst-sq" data-sev={w.worst} aria-hidden /> : <I.check size={14} />}
        {w.words}
      </button>
    );
  }
  const shownId = pickedReader(p.target.projectId);
  const reader = readers?.find((r) => r.id === shownId) ?? readers?.find((r) => r.default) ?? readers?.find((r) => !r.look);
  const again = s && (s.state === "failed" || s.state === "stopped");
  return (
    <span className="lst-split" data-again={again || undefined} title={again ? (s!.state === "failed" ? "The last scan didn't finish" : "The last scan was stopped") : undefined}>
      <button type="button" className="lst-run l-focus" disabled={readers !== null && !reader} onClick={() => void startTargetScan(p.target, reader && !reader.default ? reader.id : undefined)} aria-label={`${verb} ${name}${reader ? ` with ${reader.label}` : ""}`}>
        <I.shield size={14} />
        {verb}
      </button>
      <Pop
        menu
        label={`Who scans ${name}`}
        align="end"
        width={316}
        triggerClass="lst-who"
        trigger={
          <>
            <ModelMark kind={markOf(reader)} size={12} />
            <I.chevD size={12} />
          </>
        }
      >
        {(close) => <WhoScans name={name} readers={readers} shown={reader?.id} onPick={(id) => (close(), void startTargetScan(p.target, id))} />}
      </Pop>
    </span>
  );
}

/** The "Who scans #128" menu: your tools' models, the Specialist scans that can run sealed, and the second look. */
function WhoScans({ name, readers, shown, onPick }: { name: string; readers: ScanReaderChoice[] | null; shown?: string; onPick: (id: string) => void }) {
  const own = readers?.filter((r) => !r.specialist && !r.look) ?? [];
  const special = readers?.filter((r) => r.specialist) ?? [];
  const look = readers?.find((r) => r.look);
  return (
    <>
      <div className="lst-mlab">Who scans {name}</div>
      {!readers && <div className="lst-mlab">Looking for your tools…</div>}
      {readers && !own.length && !special.length && <div className="lst-mlab">No tool is signed in. Sign in to one in Settings.</div>}
      {own.map((r) => (
        <Row key={r.id} icon={<ModelMark kind={markOf(r)} size={14} />} title={r.label} on={r.id === shown || undefined} end={r.default ? "Default" : r.note} onPick={() => onPick(r.id)} />
      ))}
      {special.length > 0 && (
        <>
          <Sep />
          <div className="lst-mlab">
            Specialist scan<span className="lst-tag">Professional</span>
          </div>
          {special.map((r) => (
            <Row key={r.id} icon={<ModelMark kind={markOf(r)} size={14} />} title={r.label} on={r.id === shown || undefined} end={r.note} note="Sealed: none of your skills, plugins or add-ons load into it." onPick={() => onPick(r.id)} />
          ))}
        </>
      )}
      {look && (
        <>
          <Sep />
          <LookRow look={look} />
        </>
      )}
      <MenuFoot>It only reads. Change the default in Settings.</MenuFoot>
    </>
  );
}

/** Whether the scan ends with another maker's model reading what it found: on unless you turn it off here. */
function LookRow({ look }: { look: ScanReaderChoice }) {
  const on = lookOn();
  return <Row icon={<I.eye size={14} />} title="A second look" on={on} end={look.note} note={on ? "Another maker's model reads what it finds. Press to scan without it." : "Off for scans from this window. Press to turn it on."} onPick={() => setLookOn(!on)} />;
}
