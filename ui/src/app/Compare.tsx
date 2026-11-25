/*
  One ask, several models, side by side. Each works in a worktree of its own from the same
  commit; when they finish, read what each said and changed, then keep one: its changes come
  into your checkout and the others are put away.
*/
import { useEffect, useMemo, useState } from "react";
import type { FileDiff, Thread } from "@contracts";
import { CodeDiff } from "@liner/pro/code-diff/code-diff";
import { StreamedMarkdown } from "@liner/pro/ai-kit/streamed";
import { toast } from "@liner/components/toast/toast";
import { loadItems, rpc, useEngine, useItems } from "./engine";
import { I, MARK_WORD, N, StateMark, type MarkState } from "./icons";
import { agentOf, checkpointsOf, compact, duration, markOf, modelLabel, money, plural, sumLines, threadModel } from "./model";
import { reviewHeld } from "./session-state";
import { Lines, ModelTag, ShowSidebar } from "./ui";
import { PaneButton, PaneFoot, PaneHead, PaneNote, PaneRow, PaneWords } from "./Pane";

export function Compare({ id, sidebar, onSidebar, onOpen, onDone }: { id: string; sidebar: boolean; onSidebar: () => void; onOpen: (threadId: string) => void; onDone: (threadId: string) => void }) {
  const all = useEngine((s) => s.threads);
  const threads = useMemo(() => all.filter((t) => t.compare?.id === id && !t.archived), [all, id]);
  const [kept, setKept] = useState<string | null>(null);
  const [diffs, setDiffs] = useState(false);
  useEffect(() => {
    for (const t of threads) void loadItems(t.id).catch(() => {});
  }, [threads.length]);

  const keep = async (t: Thread) => {
    setKept(t.id);
    try {
      const r = await rpc("compare.keep", { threadId: t.id });
      toast.success(`Kept ${t.title.split(" · ").pop()}`, { description: `${plural(r.files, "file")} came into your checkout; the others are put away.` });
      onDone(t.id);
    } catch (e) {
      setKept(null);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const title = threads[0]?.title.split(" · ").slice(0, -1).join(" · ") || "Comparing";
  const running = threads.filter((t) => t.status === "running").length;
  return (
    <div className="lc-usage lc-cmp">
      <header className="lc-top" data-drag>
        {!sidebar && (
          <ShowSidebar onShow={onSidebar} />
        )}
        <h1 className="lc-title">{title}</h1>
        <span className="lc-quiet lc-cmp-n">{running ? `${running} of ${threads.length} still working` : `${plural(threads.length, "answer")}, pick one`}</span>
        <span className="lc-grow" data-drag />
        {/* A view toggle is a pressed icon, as Files' "only changed files" is: the Changes icon, lit while the changes show. */}
        {threads.length > 0 && (
          <button type="button" className="lc-sw-b l-focus" aria-label="Show the changes" title={diffs ? "Show the answers" : "Show the changes"} aria-pressed={diffs} onClick={() => setDiffs((d) => !d)}>
            <N.changes />
          </button>
        )}
      </header>
      {threads.length === 0 ? (
        <PaneNote icon={<I.check size={16} />} title="This comparison is over">
          You kept one; the others are in the archive.
        </PaneNote>
      ) : (
        <div className="lc-cmp-cols" style={{ gridTemplateColumns: `repeat(${threads.length}, minmax(300px, 1fr))` }}>
          {threads.map((t, i) => (
            <Column key={t.id} t={t} i={i} diffs={diffs} busy={kept !== null} onKeep={() => void keep(t)} onOpen={() => onOpen(t.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Column({ t, i, diffs, busy, onKeep, onOpen }: { t: Thread; i: number; diffs: boolean; busy: boolean; onKeep: () => void; onOpen: () => void }) {
  // Held while the column shows, so the window keeps this timeline (engine.ts, letGoOld).
  const items = useItems(t.id);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const model = threadModel(t, agents, providers);
  const a = agentOf(t.agent, agents, providers);
  const texts = (items ?? []).filter((x) => x.kind === "text");
  const last = texts[texts.length - 1];
  const cps = checkpointsOf(items ?? []);
  const files = [...new Map(cps.flatMap((c) => c.files).map((f) => [f.path, f])).values()];
  const lines = sumLines(files);
  const turn = (items ?? []).filter((x) => x.kind === "turn").pop();
  const state: MarkState = t.status === "running" ? "working" : t.status === "waiting" && !reviewHeld(t) ? "needs" : t.status === "limited" ? "limit" : t.status === "error" ? "problem" : "done";
  const [diff, setDiff] = useState<FileDiff[] | null>(null);
  useEffect(() => {
    if (!diffs || t.status === "running" || !cps.length) return;
    let live = true;
    void rpc("checkpoint.diff", { threadId: t.id, itemId: "all" })
      .then((d) => live && setDiff(d.files))
      .catch(() => live && setDiff([]));
    return () => {
      live = false;
    };
  }, [diffs, t.status, cps.length]);
  const u = t.usage;
  // A column that changed nothing has no diff to ask for: it says so, rather than show its answer under "Hide the changes".
  const shown = diffs ? (diff ?? (t.status !== "running" && !cps.length ? [] : null)) : null;
  const name = modelLabel(model, providers);
  // Each column is the pane frame (a 44px head, rows, a 56px foot), flush beside the next, a hairline between them.
  return (
    <section className="lc-cmp-col" style={{ animationDelay: `${i * 60}ms` }} aria-label={name}>
      <PaneHead
        canvas={false}
        name={<ModelTag kind={markOf(model)} label={name} size={14} />}
        shows={a.name !== name ? <PaneWords>{a.name}</PaneWords> : undefined}
        tools={
          // How each one stands, as a session's row says it: the mark stays mounted so a change plays, and the words are the mark's.
          <span className="lc-cmp-s">
            <StateMark state={state} size={12} />
            {MARK_WORD[state]}
          </span>
        }
      />
      <div className="lc-cmp-stats">
        <PaneRow value={files.length ? <>{plural(files.length, "file")} <Lines {...lines} /></> : "Nothing yet"} quiet={!files.length}>
          Changed
        </PaneRow>
        <PaneRow value={turn?.kind === "turn" && turn.seconds ? duration(turn.seconds) : "–"}>Took</PaneRow>
        <PaneRow value={u.costUsd ? money(u.costUsd) : `${compact(u.inputTokens + u.outputTokens + u.cacheReadTokens)} tokens`}>Cost</PaneRow>
      </div>
      <div className="lc-cmp-body">
        {shown ? (
          shown.length ? <CodeDiff files={shown} view="unified" maxHeight={100000} defaultWrap /> : <PaneNote title="No changes">This one changed no file.</PaneNote>
        ) : last?.kind === "text" ? (
          <StreamedMarkdown className="lc-md" text={last.text} streaming={last.streaming} animate={false} />
        ) : t.status === "running" ? (
          <PaneNote icon={<StateMark state="working" size={16} />} title="Reading the project" />
        ) : (
          <PaneNote title="It hasn't answered" />
        )}
      </div>
      <PaneFoot>
        <PaneButton onClick={onOpen}>Open the session</PaneButton>
        <PaneButton ink disabled={busy || t.status === "running" || !files.length} onClick={onKeep}>
          Keep this one
        </PaneButton>
      </PaneFoot>
    </section>
  );
}
