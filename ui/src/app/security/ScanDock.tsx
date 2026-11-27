/*
  The scans of pull requests and issues running in the background (board PullRequests' pop-up, ScanDone, Issues' pill),
  mounted once in App.tsx at the window's bottom right, lifted above the message box when one is there. One scan shows as a
  card: its head (Scanning #131, the title, fold, close), who reads it (Read only), its steps with the live line, a box to
  tell it where to look or ask (sent to the scan's own session, queued or steering as any message is), and Show in Liner
  Security and Stop. Finished: its sentence, what it found, your questions and its answers, then Show in Liner Security,
  Comment on #131 (asks first) and Fix them. The others fold into pills above it. Scan new PRs' scans come in as pills.

  Its height is written as --lc-scan-dock on the root, so another card at the bottom right (an app asking first, AppAsk)
  can stand above it.
*/
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Item, ScanRecord, SecurityFinding } from "@contracts";
import { SEVERITY_LABEL, targetName } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { loadItems, rpc, useEngine, useItems } from "../engine";
import { setFace, useFace } from "../face";
import { I, ModelMark, StateMark, StepMark, type StepState } from "../icons";
import { duration, plural, toolMarkOf } from "../model";
import { confirmPress } from "../confirm";
import { goSecurity, useScan, useSecurity, useSecurityPage } from "./store";
import { closeScan, foldScan, useDock, watchScans } from "./target-store";
import "./scans.css";

const GAP = 16;

export function ScanDock() {
  const list = useDock();
  useEffect(() => watchScans(), []);
  const box = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState(GAP);
  // Above what sits at the foot under the dock's column: the message box, or a Pull requests or Issues detail's foot with its
  // buttons (as the boards place it, about 78px up). Looked at as the window moves, and once a second.
  useEffect(() => {
    if (!list.length) return;
    const place = () => {
      let up = GAP;
      for (const el of document.querySelectorAll<HTMLElement>(".lc-composer, .lc-wl-dfoot")) {
        const r = el.getBoundingClientRect();
        // Only one at the window's foot: Home's message box, in the middle of the page, leaves the dock where it is.
        if (r.width > 0 && r.right > window.innerWidth - 420 - GAP && r.top < window.innerHeight && r.bottom > window.innerHeight - 140) up = Math.max(up, Math.round(window.innerHeight - r.top + 10));
      }
      setLift(up);
    };
    place();
    window.addEventListener("resize", place);
    const t = window.setInterval(place, 1000);
    return () => (window.removeEventListener("resize", place), clearInterval(t));
  }, [list.length]);
  useLayoutEffect(() => {
    const el = box.current;
    const root = document.documentElement;
    if (!el || !list.length) {
      root.style.removeProperty("--lc-scan-dock");
      return;
    }
    const say = () => root.style.setProperty("--lc-scan-dock", `${Math.round(el.getBoundingClientRect().height + lift)}px`);
    say();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(say);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty("--lc-scan-dock");
    };
  }, [list.length, lift]);
  if (!list.length) return null;
  const open = [...list].reverse().find((d) => !d.folded);
  const pills = list.filter((d) => d !== open);
  return (
    <div ref={box} className="lst-dock" style={{ bottom: lift }} aria-label="Scans in the background">
      {pills.map((d) => (
        <Pill key={d.scanId} scanId={d.scanId} />
      ))}
      {open && <Card key={open.scanId} scanId={open.scanId} />}
    </div>
  );
}

/** "Scanning #131", "#131 scanned", "Checking #35", "#42 checked". */
function headWords(r: ScanRecord) {
  const name = r.target ? targetName(r.target) : r.title;
  const issue = r.target?.kind === "issue";
  const running = r.state === "running" || r.state === "asking";
  if (running) return `${issue ? "Checking" : "Scanning"} ${name}`;
  if (r.state === "done") return `${name} ${issue ? "checked" : "scanned"}`;
  return `${name} ${r.state === "failed" ? "didn't finish" : "stopped"}`;
}
/** Seconds since it started (or how long it took). */
const took = (r: ScanRecord, now: number) => Math.max(0, Math.round(((r.finishedAt ?? now) - r.startedAt) / 1000));
/** A scan session's timeline, fetched once and kept up by the stream while the card or pill shows. */
function useScanItems(threadId: string | undefined) {
  useEffect(() => {
    if (threadId) void loadItems(threadId).catch(() => {});
  }, [threadId]);
  return useItems(threadId);
}
/** Ticks once a second while a scan runs, for its clock. */
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}
/** What it is doing now: its last tool row, in words ("Read src/alerts/store.ts"), or its file alone. */
function liveOf(items: Item[]): { file?: string; words?: string } {
  const last = items.findLast((x): x is Extract<Item, { kind: "tool" }> => x.kind === "tool");
  if (!last) return {};
  return { ...(last.path ? { file: last.path } : {}), words: last.title.replace(/^mcp__liner__/, "") };
}
const showIn = (r: ScanRecord) => {
  if (!r.threadId) return;
  // Its card would cover the scan's own page (and its Found panel): it folds to a pill there.
  foldScan(r.id, true);
  setFace("security");
  goSecurity({ kind: "scan", threadId: r.threadId });
};

function Pill({ scanId }: { scanId: string }) {
  const r = useScan(scanId);
  const items = useScanItems(r?.threadId);
  const running = r ? r.state === "running" || r.state === "asking" : false;
  const now = useNow(running);
  const { data: found } = useSecurity("security.findings.list", { ...(r ? { projectId: r.projectId } : {}), scan: scanId }, ["findings"]);
  if (!r) return null;
  const open = (found ?? []).filter((f) => f.state === "open");
  const live = liveOf(items).words;
  const what = running ? `${live ? `${live.charAt(0).toLowerCase()}${live.slice(1)} · ` : ""}${duration(took(r, now))}` : r.target?.kind === "issue" && r.verdict ? (r.verdict === "real" ? "real" : r.verdict === "not-real" ? "not real" : "couldn't tell") : open.length ? plural(open.length, "finding") : r.state === "done" ? "clean" : "";
  return (
    <div className="lst-pill" data-running={running || undefined}>
      {running ? <StateMark state="working" size={12} /> : <I.shield size={14} />}
      <b>{headWords(r)}</b>
      {what && <span className="lst-pill-what">{what}</span>}
      <button type="button" className="lst-link l-focus" onClick={() => foldScan(scanId, false)}>
        Open
      </button>
      {!running && (
        <button type="button" className="lst-ib l-focus" aria-label="Close" onClick={() => closeScan(scanId)}>
          <I.close size={12} />
        </button>
      )}
    </div>
  );
}

function Card({ scanId }: { scanId: string }) {
  const r = useScan(scanId);
  const face = useFace();
  const page = useSecurityPage();
  const here = Boolean(r?.threadId) && face === "security" && page.kind === "scan" && page.threadId === r?.threadId;
  return here ? <Pill scanId={scanId} /> : <CardBody scanId={scanId} />;
}

function CardBody({ scanId }: { scanId: string }) {
  const r = useScan(scanId);
  const items = useScanItems(r?.threadId);
  const providers = useEngine((s) => s.providers);
  const running = r ? r.state === "running" || r.state === "asking" : false;
  const now = useNow(running);
  const { data: found } = useSecurity("security.findings.list", { ...(r ? { projectId: r.projectId } : {}), scan: scanId }, ["findings"]);
  if (!r) return null;
  const open = (found ?? []).filter((f) => f.state === "open");
  const issue = r.target?.kind === "issue";
  // Who reads it: the scan's lead, as its tool and model name it.
  const ref = r.reader ? (r.reader.kind === "own" ? r.reader.agent : r.reader.model) : "";
  const [pid, ...rest] = ref.replace(/^@/, "").split(":");
  const tool = providers.find((p) => p.id === pid);
  const model = tool?.models.find((m) => m.id === rest.join(":"))?.label ?? rest.join(":");
  const lookBy = r.secondLook ? (providers.find((p) => p.id === r.secondLook!.split(":")[0])?.label ?? r.secondLook) : undefined;
  return (
    // A region, not a dialog: the card floats beside your work, and a dialog would hold every shortcut while it shows (hasOpenModal).
    <div className="lst-card" role="region" aria-label={`Liner Security scan of ${r.target ? targetName(r.target) : r.title}`}>
      <div className="lst-head">
        <I.shield size={14} />
        <b>{headWords(r)}</b>
        <span className="lst-head-sub">{running ? r.targetTitle : r.state === "done" ? `${issue && r.verdict ? "" : `${plural(open.length, "finding")} · `}${duration(took(r, now))}` : r.error}</span>
        <button type="button" className="lst-ib l-focus" aria-label="Fold into a pill" onClick={() => foldScan(scanId, true)}>
          <I.chevD size={14} />
        </button>
        <button type="button" className="lst-ib l-focus" aria-label={running ? "Close (it keeps scanning)" : "Close"} onClick={() => closeScan(scanId)}>
          <I.close size={14} />
        </button>
      </div>
      <div className="lst-body">
        {running ? (
          <>
            <div className="lst-who">
              <ModelMark kind={tool ? toolMarkOf(tool.id) : "other"} size={12} />
              {tool ? `${tool.label} · ${model}` : ref || "A scan"}
              {r.reader?.kind === "specialist" && <span className="lst-tag">Sealed</span>}
              <span className="lst-dot">·</span>
              <I.lock size={12} />
              Read only
            </div>
            <Steps r={r} found={open.length} lookBy={lookBy} />
            <Live items={items} seconds={took(r, now)} />
          </>
        ) : (
          <Done r={r} open={open} items={items} />
        )}
      </div>
      {r.threadId && <Ask threadId={r.threadId} running={running} />}
      <div className="lst-foot">
        <button type="button" className="lst-btn l-focus" onClick={() => showIn(r)} disabled={!r.threadId}>
          <I.external size={14} />
          Show in Liner Security
        </button>
        <span className="lst-grow" />
        {running ? (
          <button type="button" className="lst-btn lst-ghost l-focus" data-danger onClick={() => void rpc("security.scan.stop", { id: r.id }).catch((e: Error) => toast.error(e.message))}>
            Stop
          </button>
        ) : (
          <>
            {r.target && r.state === "done" && <Comment r={r} />}
            {open.length > 0 && <FixThem r={r} />}
          </>
        )}
      </div>
    </div>
  );
}

/** The steps a scan of a target goes through, from its record: what it read, the free checks, its own look, the second look. */
function Steps({ r, found, lookBy }: { r: ScanRecord; found: number; lookBy?: string }) {
  const issue = r.target?.kind === "issue";
  const reading: StepState = r.looking ? "done" : "working";
  const rows: { state: StepState; words: string; num?: string }[] = issue
    ? [
        { state: "done", words: "Read the issue" },
        { state: reading, words: "Check it against the code", num: found ? `${found} so far` : undefined },
      ]
    : [
        { state: "done", words: "Read what it changes", ...(r.targetFiles !== undefined ? { num: plural(r.targetFiles, "file") } : {}) },
        { state: r.changedChecks ? "done" : "working", words: "Free checks: secrets in what it adds", ...(r.changedChecks ? { num: r.changedChecks.state === "found" ? `${r.changedChecks.count} found` : r.changedChecks.state } : {}) },
        { state: r.changedChecks ? reading : "waiting", words: "Look for injection, access and escaping", ...(r.changedChecks ? { num: `${found} so far` } : {}) },
      ];
  if (lookBy) rows.push({ state: r.looking ? "working" : "waiting", words: `A second look, by ${lookBy}` });
  return (
    <div className="lst-steps">
      {rows.map((s) => (
        <div key={s.words} className="lst-step" data-step={s.state}>
          <StepMark state={s.state} size={14} />
          {s.words}
          {s.num && <span className="lst-num">{s.num}</span>}
        </div>
      ))}
    </div>
  );
}

function Live({ items, seconds }: { items: Item[]; seconds: number }) {
  const l = liveOf(items);
  return (
    <div className="lst-live">
      {l.file ? <span className="lst-mono">{l.file}</span> : <span>{l.words ?? "Starting"}</span>}
      <span className="lst-q">· {duration(seconds)}</span>
    </div>
  );
}

/** A finished scan: its sentence, its open findings, and the questions you asked it with its answers. */
function Done({ r, open, items }: { r: ScanRecord; open: SecurityFinding[]; items: Item[] }) {
  // Your messages after its first one, and what it said after the last of them.
  const asks = items.filter((x): x is Extract<Item, { kind: "user" }> => x.kind === "user").slice(1);
  const last = asks.at(-1);
  const answer = last ? items.filter((x): x is Extract<Item, { kind: "text" }> => x.kind === "text" && x.turn >= last.turn && x.at >= last.at).map((x) => x.text).join("").trim() : "";
  const lead = r.summary ?? (r.state === "done" ? (open.length ? undefined : "It found nothing worth acting on.") : r.error);
  return (
    <>
      {lead && <p className="lst-lead">{lead}</p>}
      {open.map((f) => (
        <button type="button" key={f.id} className="lst-find l-focus" onClick={() => (setFace("security"), goSecurity({ kind: "findings", finding: f.id }))}>
          <i className="lst-sq" data-sev={f.severity === "critical" ? "high" : f.severity} aria-hidden />
          <b>{f.title}</b>
          <span className="lst-sev">{SEVERITY_LABEL[f.severity]}</span>
          <small>
            {/* The whole path, as the board writes it; a long one is cut from its left, so the file and line stay. */}
            {f.file && (
              <span className="lst-mono lst-path" title={`${f.file}${f.line ? `:${f.line}` : ""}`}>
                <bdi>{`${f.file}${f.line ? `:${f.line}` : ""}`}</bdi>
              </span>
            )}
            {f.look.state !== "none" && <span>{f.look.state === "confirmed" ? " · a second look agrees" : " · a second look couldn't confirm it"}</span>}
          </small>
        </button>
      ))}
      {last && (
        <div className="lst-chat">
          <div className="lst-bubble">{last.shown?.text ?? last.text}</div>
          {answer ? <p className="lst-ans">{answer}</p> : <p className="lst-ans lst-q">Reading…</p>}
        </div>
      )}
    </>
  );
}

/** "Tell it where to look, or ask": sent to the scan's own session, as a message there is (queued while it works). */
function Ask({ threadId, running }: { threadId: string; running: boolean }) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    void rpc("thread.send", { id: threadId, text: t, ...(running ? { mode: "queue" as const } : {}) }).catch((e: Error) => (setText(t), toast.error(e.message)));
  };
  return (
    <form className="lst-mini" onSubmit={(e) => (e.preventDefault(), send())}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={running ? "Tell it where to look, or ask" : "Ask about this scan"} aria-label={running ? "Tell it where to look, or ask" : "Ask about this scan"} />
      <button type="submit" className="lst-send l-focus" disabled={!text.trim()} aria-label="Send">
        <I.send size={14} />
      </button>
    </form>
  );
}

/** Comment on #131: posts the scan's sentence and its findings on GitHub with gh, after a second press. */
function Comment({ r }: { r: ScanRecord }) {
  const [asked, setAsked] = useState<number | null>(null);
  const [posting, setPosting] = useState(false);
  const name = targetName(r.target!);
  const press = () => {
    const now = Date.now();
    const d = confirmPress(asked, now);
    if (d === "ask") return setAsked(now);
    if (d === "wait") return;
    setAsked(null);
    setPosting(true);
    rpc("security.targetComment", { scanId: r.id }).then(
      (x) => (setPosting(false), toast(x.url ? `Posted on ${name}` : `Not posted: ${name} is the Demo's sample`)),
      (e: Error) => (setPosting(false), toast.error(e.message)),
    );
  };
  return (
    <button type="button" className="lst-btn lst-ghost l-focus" data-asking={asked !== null || undefined} disabled={posting} onClick={press} title="Posts the scan's sentence and its findings, a line each, as a comment" onBlur={() => setAsked(null)}>
      {posting ? "Posting" : asked !== null ? `Post it on ${name}?` : `Comment on ${name}`}
    </button>
  );
}

/** Fix them: a session in a worktree of its own, at the pull request's head, with what the scan found as its brief. */
function FixThem({ r }: { r: ScanRecord }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="lst-btn lst-ink l-focus"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        rpc("security.targetFix", { scanId: r.id }).then(
          // Opened where Liner Security opens a fix: its session, in the Security face.
          (t) => (setBusy(false), setFace("security"), goSecurity({ kind: "scan", threadId: t.id })),
          (e: Error) => (setBusy(false), toast.error(e.message)),
        );
      }}
    >
      {busy ? "Starting" : "Fix them"}
    </button>
  );
}
