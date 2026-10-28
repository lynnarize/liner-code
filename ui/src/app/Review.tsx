/*
  Review, with the whole window: the files on the left with what you've looked at, what the
  subagents checked, and the diff beside them. Press a line number (shift for a range) to ask
  the agent about those lines; its answer stays on those lines. The Reviewer's findings sit on
  the lines they name. Step through the changes with the arrows, or J and K.
*/
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff, Finding, Item, Thread } from "@contracts";
import { CodeDiff } from "@liner/pro/code-diff/code-diff";
import { diffRows, segment, type Row } from "@liner/pro/code-diff/diff";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { CommitButton } from "./Commit";
import { is } from "./keymap";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { agentOf, ago, checkpointsOf, markOf, modelLabel, plural, sumLines } from "./model";
import { baseOf, dirOf, langOf, linesOf, tokensOf, Toks } from "./code";
import { Lines, ModelTag, Pop, Row as PickRow, Sep } from "./ui";
import { StreamedMarkdown } from "@liner/pro/ai-kit/streamed";
import { FindBar } from "./Find";

type Checkpoint = Extract<Item, { kind: "checkpoint" }>;

/** Which turn's changes to show: one turn, all of them, or the branch against main. */
export function TurnPicker({ cps, pick, turns, onPick }: { cps: Checkpoint[]; pick: string; turns: number; onPick: (id: string) => void }) {
  const cp = cps.find((c) => c.id === pick);
  return (
    <Pop
      label="Pick a turn"
      width={320}
      triggerClass="lc-turnpick"
      trigger={
        <>
          {pick === "all" ? "All turns" : pick === "branch" ? "This branch" : `Turn ${cp?.turn ?? ""}`}
          {pick !== "all" && pick !== "branch" && <span className="lc-quiet">of {turns}</span>}
          <I.chevD size={12} />
        </>
      }
    >
      {(close) => (
        <>
          <PickRow title="All turns in this session" note="Everything since the first change, as the tree is now" on={pick === "all"} onPick={() => (onPick("all"), close())} />
          <PickRow title="This branch against main" note="What a pull request from here would carry" on={pick === "branch"} onPick={() => (onPick("branch"), close())} />
          <Sep />
          {[...cps].reverse().map((c) => (
            <PickRow
              key={c.id}
              title={`Turn ${c.turn}`}
              note={`${ago(c.at)} · ${plural(c.files.length, "file")}${c.reverted ? " · undone" : c.committed ? ` · committed ${c.committed}` : ""}`}
              on={pick === c.id}
              end={<Lines {...sumLines(c.files)} />}
              onPick={() => (onPick(c.id), close())}
            />
          ))}
        </>
      )}
    </Pop>
  );
}

type Anchor = { file: string; line: number; endLine?: number };
type Thread_ = { id: string; anchor: Anchor; question: string; answer: string; who: string; model: string; at: number; streaming: boolean };


export function Review({ thread, items, focus, onFocus, onBack }: { thread: Thread; items: Item[]; focus: { id: string; path?: string } | null; onFocus: (f: { id: string; path?: string } | null) => void; onBack: () => void }) {
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const project = useEngine((s) => s.projects.find((p) => p.id === thread.projectId));
  const cps = useMemo(() => checkpointsOf(items), [items]);
  const pick = focus?.id && (focus.id === "all" || focus.id === "branch" || cps.some((c) => c.id === focus.id)) ? focus.id : (cps[cps.length - 1]?.id ?? "all");
  const cp = cps.find((c) => c.id === pick);
  const [diff, setDiff] = useState<FileDiff[] | null>(null);
  const [view, setView] = useState<"unified" | "split">("unified");
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Anchor | null>(null);
  const [ask, setAsk] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState<"undo" | null>(null);
  const [finding, setFinding] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const coder = agentOf(thread.agent, agents, providers);

  const key = `${pick}:${cp?.reverted}:${cp?.committed}:${cps.length}`;
  useEffect(() => {
    let live = true;
    setDiff(null);
    void rpc("checkpoint.diff", { threadId: thread.id, itemId: pick })
      .then((d) => live && setDiff(d))
      .catch(() => live && setDiff([]));
    return () => {
      live = false;
    };
  }, [thread.id, key]);

  // Line questions and their answers, and the Reviewer's findings, by file.
  const asked = useMemo(() => {
    const out: Thread_[] = [];
    for (const it of items) {
      if (it.kind !== "user" || !it.anchor) continue;
      const turn = items.find((x) => x.kind === "turn" && x.turn === it.turn);
      const text = items.filter((x): x is Extract<Item, { kind: "text" }> => x.kind === "text" && x.turn === it.turn);
      const who = turn?.kind === "turn" ? turn.agent : thread.agent;
      out.push({ id: it.id, anchor: it.anchor, question: it.text, answer: text.map((x) => x.text).join("\n\n"), who: agentOf(who, agents, providers).name, model: turn?.kind === "turn" ? turn.model : coder.model, at: it.at, streaming: text.some((x) => x.streaming) || (turn?.kind === "turn" && turn.status === "running") });
    }
    return out;
  }, [items, agents, providers]);
  const findings = useMemo(() => {
    const reviews = items.filter((x): x is Extract<Item, { kind: "review" }> => x.kind === "review");
    const last = reviews[reviews.length - 1];
    return { list: last?.findings ?? [], reviewer: last?.reviewer, status: last?.status };
  }, [items]);

  const prepared = useMemo(
    () =>
      (diff ?? []).map((f) => {
        const before = linesOf(f.before);
        const after = linesOf(f.after);
        const lang = langOf(f.path);
        const rows = diffRows(before, after);
        return { file: f, rows, segs: segment(rows, 3), tb: tokensOf(before, lang), ta: tokensOf(after, lang), added: rows.filter((r) => r.kind === "add").length, removed: rows.filter((r) => r.kind === "del").length, isNew: f.before === undefined, gone: f.after === undefined };
      }),
    [diff],
  );
  const changes = prepared.flatMap((p) => [...new Set(p.rows.flatMap((r) => (r.change === undefined ? [] : [r.change])))].map((c) => ({ path: p.file.path, change: c })));

  // The file pressed elsewhere scrolls into view.
  useEffect(() => {
    if (!diff || !focus?.path) return;
    box.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(focus.path)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    setViewed((v) => new Set(v).add(focus.path!));
  }, [diff, focus?.path]);

  const goChange = (i: number) => {
    if (!changes.length) return;
    const n = (i + changes.length) % changes.length;
    setAt(n);
    const c = changes[n];
    box.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(c.path)}"] [data-change="${c.change}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (is(e, "find")) {
        e.preventDefault();
        setFinding(true);
        return;
      }
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
      if (e.key === "j") goChange(at + 1);
      else if (e.key === "k") goChange(at - 1);
      else if (e.key === "Escape" && sel) setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, changes.length, sel]);

  const send = async () => {
    if (!sel || !ask.trim()) return;
    try {
      await rpc("thread.send", { id: thread.id, text: ask.trim(), anchor: sel, mode: thread.status === "running" ? "queue" : undefined });
      setAsk("");
      setSel(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const undo = async () => {
    if (!cp) return;
    setBusy("undo");
    try {
      await rpc("checkpoint.revert", { threadId: thread.id, itemId: cp.id });
      toast(`Undid turn ${cp.turn}`, { description: `${plural(cp.files.length, "file")} back as they were` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const openCps = cps.filter((c) => !c.reverted && !c.committed);
  const openFiles = new Set(openCps.flatMap((c) => c.files.map((f) => f.path))).size;
  const files = prepared.map((p) => p.file.path);
  const seen = files.filter((f) => viewed.has(f)).length;
  const lines = prepared.reduce((s, p) => ({ added: s.added + p.added, removed: s.removed + p.removed }), { added: 0, removed: 0 });
  // What the subagents checked: the turn's Task calls and the Reviewer.
  const turnNo = cp?.turn;
  const subs = items.filter((x): x is Extract<Item, { kind: "tool" }> => x.kind === "tool" && x.toolKind === "task" && (turnNo === undefined || x.turn === turnNo));

  const lineRow = (p: (typeof prepared)[number], r: Row, k: number) => {
    const tok = r.kind === "del" ? p.tb[(r.old ?? 1) - 1] : p.ta[(r.new ?? 1) - 1];
    const inSel = sel && sel.file === p.file.path && r.new !== undefined && r.new >= sel.line && r.new <= (sel.endLine ?? sel.line);
    const here = r.new !== undefined ? asked.filter((t) => t.anchor.file === p.file.path && (t.anchor.endLine ?? t.anchor.line) === r.new) : [];
    const notes = r.new !== undefined ? findings.list.filter((f) => f.file === p.file.path && (f.endLine ?? f.line) === r.new) : [];
    const endsSel = sel && sel.file === p.file.path && (sel.endLine ?? sel.line) === r.new;
    return (
      <Fragment key={k}>
        <div className="lc-rv-l" data-kind={r.kind} data-sel={inSel || undefined} data-change={r.kind !== "same" && (k === 0 || p.rows[k - 1]?.change !== r.change) ? r.change : undefined}>
          <span className="lc-rv-n">{r.old ?? ""}</span>
          {r.new !== undefined ? (
            <button
              type="button"
              className="lc-rv-n lc-rv-pick"
              aria-label={`Ask about line ${r.new}`}
              onClick={(e) => {
                const line = r.new!;
                setSel((s) => (e.shiftKey && s && s.file === p.file.path ? { file: s.file, line: Math.min(s.line, line), endLine: Math.max(s.endLine ?? s.line, line) } : { file: p.file.path, line }));
                setAsk("");
              }}
            >
              {r.new}
            </button>
          ) : (
            <span className="lc-rv-n" />
          )}
          <span className="lc-rv-s" aria-hidden>
            {r.kind === "add" ? "+" : r.kind === "del" ? "−" : ""}
          </span>
          <span className="lc-rv-t">
            <Toks line={tok} />
          </span>
        </div>
        {notes.map((f, j) => (
          <Note key={`f${j}`} f={f} reviewer={findings.reviewer ? modelLabel(findings.reviewer, providers) : "The Reviewer"} />
        ))}
        {here.map((t) => (
          <div key={t.id} className="lc-rv-thread">
            <div className="lc-rv-q">
              <span className="lc-rv-lines">{t.anchor.endLine && t.anchor.endLine !== t.anchor.line ? `Lines ${t.anchor.line}–${t.anchor.endLine}` : `Line ${t.anchor.line}`}</span>
              <span className="lc-quiet">You · {ago(t.at)}</span>
              <p>{t.question}</p>
            </div>
            <div className="lc-rv-a">
              <b>
                {t.who} <ModelTag kind={markOf(t.model)} label={modelLabel(t.model, providers)} />
              </b>
              {t.answer ? <StreamedMarkdown className="lc-md" text={t.answer} streaming={t.streaming} animate={false} /> : <span className="l-shimmer">{t.streaming ? "Answering" : "Waiting for its turn"}</span>}
            </div>
          </div>
        ))}
        {endsSel && (
          <div className="lc-rv-ask">
            <span className="lc-rv-lines">{sel!.endLine && sel!.endLine !== sel!.line ? `Lines ${sel!.line}–${sel!.endLine}` : `Line ${sel!.line}`}</span>
            <input
              className="lc-input"
              autoFocus
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder={`Ask ${coder.name} about ${sel!.endLine && sel!.endLine !== sel!.line ? "these lines" : "this line"}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
                if (e.key === "Escape") setSel(null);
              }}
            />
            <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={!ask.trim()} onClick={() => void send()}>
              Ask
            </button>
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <div className="lc-rv">
      <header className="lc-rv-top">
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={onBack}>
          <I.chevL size={13} />
          Session
        </button>
        <b className="lc-rv-title">{thread.title}</b>
        <span className="lc-quiet lc-rv-sub">
          {coder.name}'s changes{openFiles ? ", ready for you" : ""}
        </span>
        <span className="lc-grow" />
        {(thread.worktree?.branch ?? project?.branch) && (
          <span className="lc-branch lc-mono">
            <I.branch size={12} />
            {thread.worktree?.branch ?? project?.branch}
          </span>
        )}
      </header>
      <div className="lc-rv-body">
        <nav className="lc-rv-nav" aria-label="Files in this turn">
          <div className="lc-rv-navh">
            Files
            <span>
              {seen} of {files.length} viewed
            </span>
          </div>
          {prepared.map((p) => (
            <label key={p.file.path} className="lc-rv-f" data-on={viewed.has(p.file.path) || undefined}>
              <input type="checkbox" checked={viewed.has(p.file.path)} onChange={(e) => setViewed((v) => (e.target.checked ? new Set(v).add(p.file.path) : new Set([...v].filter((x) => x !== p.file.path))))} />
              <button type="button" className="lc-rv-fb lc-mono" title={p.file.path} onClick={() => onFocus({ id: pick, path: p.file.path })}>
                {baseOf(p.file.path)}
              </button>
              <Lines added={p.added} removed={p.removed} />
            </label>
          ))}
          {(subs.length > 0 || findings.reviewer) && (
            <div className="lc-rv-checked">
              <span className="lc-rv-navh">{coder.name}'s subagents checked</span>
              {subs.map((s) => (
                <div key={s.id} className="lc-rv-sub-a">
                  <span className="lc-tile">
                    <I.agents size={11} />
                  </span>
                  <span>
                    <b>{s.title.split(":")[0]}</b> <small className="lc-quiet">{s.status === "running" ? "working" : (s.title.split(":").slice(1).join(":").trim() || s.status)}</small>
                  </span>
                </div>
              ))}
              {findings.reviewer && (
                <div className="lc-rv-sub-a">
                  <span className="lc-tile">
                    <I.shield size={11} />
                  </span>
                  <span>
                    <b>Reviewer</b> <small className="lc-quiet">{findings.status === "running" ? "reading" : findings.list.length ? plural(findings.list.length, "note") : "nothing to note"}</small>
                    <ModelTag kind={markOf(findings.reviewer)} label={modelLabel(findings.reviewer, providers)} />
                  </span>
                </div>
              )}
            </div>
          )}
        </nav>
        <section className="lc-rv-main" aria-label="Changes">
          <div className="lc-rv-strip">
            <TurnPicker cps={cps} pick={pick} turns={thread.turns} onPick={(id) => onFocus({ id })} />
            <Lines {...lines} />
            <span className="lc-grow" />
            {changes.length > 0 && view === "unified" && (
              <>
                <span className="lc-quiet lc-rv-count">
                  Change {Math.min(at + 1, changes.length)} of {changes.length}
                </span>
                <button type="button" className="lc-ib l-focus" aria-label="Previous change (K)" title="Previous change (K)" onClick={() => goChange(at - 1)}>
                  <I.chevU size={14} />
                </button>
                <button type="button" className="lc-ib l-focus" aria-label="Next change (J)" title="Next change (J)" onClick={() => goChange(at + 1)}>
                  <I.chevD size={14} />
                </button>
              </>
            )}
            <Segmented
              size="sm"
              value={view}
              onValueChange={setView}
              options={[
                { value: "unified", label: "Unified" },
                { value: "split", label: "Split" },
              ]}
              aria-label="Diff view"
            />
          </div>
          {finding && (
            <FindBar
              root={box}
              label="Find in the diff"
              onClose={() => setFinding(false)}
              // Folded lines are searched too: finding opens every fold.
              onQuery={(q) => q.trim() && setOpen(new Set(prepared.flatMap((p) => p.segs.flatMap((sg) => (sg.kind === "fold" ? [`${p.file.path}:${sg.id}`] : [])))))}
            />
          )}
          <div ref={box} className="lc-rv-files">
            {diff === null ? (
              <div className="lc-diff-wait">
                <span className="l-shimmer">Reading the changes</span>
              </div>
            ) : !diff.length ? (
              <div className="lc-panel-empty">
                <b>{pick === "branch" ? "This branch matches main" : "Nothing changed here"}</b>
              </div>
            ) : view === "split" ? (
              <CodeDiff files={diff} view="split" maxHeight={100000} />
            ) : (
              prepared.map((p) => (
                <article key={p.file.path} className="lc-rv-file" data-file={p.file.path}>
                  <header className="lc-rv-fh">
                    <span className="lc-mono">
                      <span className="lc-quiet">{dirOf(p.file.path)}</span>
                      {baseOf(p.file.path)}
                    </span>
                    {p.isNew && <span className="lc-pill" data-tone="ok">New</span>}
                    {p.gone && <span className="lc-pill" data-tone="danger">Deleted</span>}
                    <span className="lc-grow" />
                    <Lines added={p.added} removed={p.removed} />
                  </header>
                  <div className="lc-rv-code lc-mono">
                    {p.segs.map((s, si) =>
                      s.kind === "fold" && !open.has(`${p.file.path}:${s.id}`) ? (
                        <button key={si} type="button" className="lc-rv-fold" onClick={() => setOpen((o) => new Set(o).add(`${p.file.path}:${s.id}`))}>
                          <I.chevD size={11} />
                          {plural(s.rows.length, "unchanged line")}
                        </button>
                      ) : (
                        <Fragment key={si}>{s.rows.map((r) => lineRow(p, r, p.rows.indexOf(r)))}</Fragment>
                      ),
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
          <div className="lc-panel-foot">
            <span className="lc-viewed">
              <span className="lc-viewed-bar" aria-hidden>
                <i style={{ width: `${files.length ? (seen / files.length) * 100 : 0}%` }} />
              </span>
              {seen} of {plural(files.length, "file")} viewed
            </span>
            <span className="lc-quiet lc-rv-hint">Press a line number to ask about it; shift for a range</span>
            <span className="lc-grow" />
            {cp && !cp.reverted && !cp.committed && (
              <button type="button" className="lc-btn" data-kind="ghost" disabled={busy !== null || thread.status === "running"} onClick={() => void undo()}>
                <I.undo size={14} />
                Undo turn {cp.turn}
              </button>
            )}
            {openFiles > 0 && <CommitButton thread={thread} files={openFiles} disabled={busy !== null || thread.status === "running"} />}
          </div>
        </section>
      </div>
    </div>
  );
}

function Note({ f, reviewer }: { f: Finding; reviewer: string }) {
  return (
    <div className="lc-rv-note" data-sev={f.severity}>
      <I.shield size={12} />
      <span>
        <b>{f.severity === "blocking" ? `${reviewer} blocks this` : reviewer}</b> {f.note}
      </span>
    </div>
  );
}
