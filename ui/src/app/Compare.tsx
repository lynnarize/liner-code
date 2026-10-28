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
import { loadItems, rpc, useEngine } from "./engine";
import { I } from "./icons";
import { agentOf, checkpointsOf, compact, duration, markOf, modelLabel, money, plural, sumLines, threadModel } from "./model";
import { Badge, Lines, ModelTag } from "./ui";

export function Compare({ id, sidebar, onSidebar, onOpen, onDone }: { id: string; sidebar: boolean; onSidebar: () => void; onOpen: (threadId: string) => void; onDone: (threadId: string) => void }) {
  const all = useEngine((s) => s.threads);
  const threads = useMemo(() => all.filter((t) => t.compare?.id === id && !t.archived), [all, id]);
  const [kept, setKept] = useState<string | null>(null);
  const [diffs, setDiffs] = useState(false);
  useEffect(() => {
    for (const t of threads) void loadItems(t.id);
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
          <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" onClick={onSidebar}>
            <I.sidebar size={16} />
          </button>
        )}
        <h1 className="lc-title">{title}</h1>
        <span className="lc-quiet">{running ? `${running} of ${threads.length} still working` : `${threads.length} answers, pick one`}</span>
        <span className="lc-grow" data-drag />
        <button type="button" className="lc-btn" data-kind="plain" data-size="sm" aria-pressed={diffs} onClick={() => setDiffs((d) => !d)}>
          {diffs ? "Hide the diffs" : "Show the diffs"}
        </button>
      </header>
      {threads.length === 0 ? (
        <div className="lc-panel-empty">
          <b>This comparison is over</b>
          <p>You kept one; the others are in the archive.</p>
        </div>
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
  const items = useEngine((s) => s.items[t.id]);
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
  const [diff, setDiff] = useState<FileDiff[] | null>(null);
  useEffect(() => {
    if (!diffs || t.status === "running" || !cps.length) return;
    let live = true;
    void rpc("checkpoint.diff", { threadId: t.id, itemId: "all" })
      .then((d) => live && setDiff(d))
      .catch(() => live && setDiff([]));
    return () => {
      live = false;
    };
  }, [diffs, t.status, cps.length]);
  const u = t.usage;
  return (
    <section className="lc-cmp-col" style={{ animationDelay: `${i * 60}ms` }} aria-label={modelLabel(model, providers)}>
      <header className="lc-cmp-h">
        <ModelTag kind={markOf(model)} label={modelLabel(model, providers)} size={13} />
        <span className="lc-quiet">{a.name !== modelLabel(model, providers) ? a.name : ""}</span>
        <span className="lc-grow" />
        {t.status === "running" ? <span className="l-shimmer lc-cmp-s">Working</span> : t.status === "waiting" ? <Badge tone="warn">Waits for you</Badge> : t.status === "error" ? <Badge tone="danger">A problem</Badge> : <Badge tone="ok">Done</Badge>}
      </header>
      <dl className="lc-cmp-stats">
        <div>
          <dt>Changed</dt>
          <dd>{files.length ? <>{plural(files.length, "file")} <Lines {...lines} /></> : "Nothing yet"}</dd>
        </div>
        <div>
          <dt>Took</dt>
          <dd>{turn?.kind === "turn" && turn.seconds ? duration(turn.seconds) : "–"}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{u.costUsd ? money(u.costUsd) : `${compact(u.inputTokens + u.outputTokens + u.cacheReadTokens)} tokens`}</dd>
        </div>
      </dl>
      <div className="lc-cmp-body">
        {diffs && diff ? (
          diff.length ? <CodeDiff files={diff} view="unified" maxHeight={100000} /> : <p className="lc-quiet">No changes.</p>
        ) : last?.kind === "text" ? (
          <StreamedMarkdown className="lc-md" text={last.text} streaming={last.streaming} animate={false} />
        ) : (
          <p className="lc-quiet">{t.status === "running" ? "Reading the project" : "It hasn't answered."}</p>
        )}
      </div>
      <footer className="lc-cmp-f">
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={onOpen}>
          Open the session
        </button>
        <span className="lc-grow" />
        <button type="button" className="lc-btn" data-kind="accent" data-size="sm" disabled={busy || t.status === "running" || !files.length} onClick={onKeep}>
          Keep this one
        </button>
      </footer>
    </section>
  );
}
