/*
  The Files surface: the session's folder as a tree, with what the turns changed marked, and
  the file you pick beside it. Lines the latest turn touched carry a mark in the gutter:
  added, or changed. Show changes opens the diff at that file.
*/
import { useEffect, useMemo, useState } from "react";
import type { FileDiff, Item, Thread, TreeEntry } from "@contracts";
import { TreeView, type TreeNode } from "@liner/components/tree-view/tree-view";
import { Segmented } from "@liner/components/segmented/segmented";
import { bridge } from "./bridge";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { agentOf, checkpointsOf } from "./model";
import { baseOf, dirOf, langOf, linesOf, marksOf, tokensOf, Toks } from "./code";
import { SurfaceNote, useCwd } from "./Surfaces";

const LETTER = { added: "A", modified: "M", deleted: "D", renamed: "R" } as const;

export function FilesSurface({ thread, items, onShowChanges }: { thread: Thread; items: Item[]; onShowChanges: (checkpointId: string, path: string) => void }) {
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const cwd = useCwd(thread);
  const [tree, setTree] = useState<TreeEntry[] | null>(null);
  const [filter, setFilter] = useState<"all" | "changed">("all");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [file, setFile] = useState<{ path: string; text: string; binary: boolean; size: number } | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // What changed, newest turn first: the latest status of each path, and which turn it was.
  const cps = useMemo(() => checkpointsOf(items).filter((c) => !c.reverted), [items]);
  const changed = useMemo(() => {
    const m = new Map<string, { status: keyof typeof LETTER; cp: string; turn: number }>();
    for (const c of [...cps].reverse()) for (const f of c.files) if (!m.has(f.path)) m.set(f.path, { status: f.status, cp: c.id, turn: c.turn });
    return m;
  }, [cps]);

  useEffect(() => {
    let live = true;
    void rpc("fs.tree", { projectId: thread.projectId, threadId: thread.id })
      .then((t) => live && setTree(t))
      .catch((e) => live && (setTree([]), setErr(e instanceof Error ? e.message : String(e))));
    return () => {
      live = false;
    };
  }, [thread.id, cps.length]);

  // The first file to show: the one the last turn changed.
  useEffect(() => {
    if (sel || !changed.size) return;
    const first = [...changed.entries()].find(([, v]) => v.status !== "deleted");
    if (first) setSel(first[0]);
  }, [changed]);

  useEffect(() => {
    if (!sel) return setFile(null);
    let live = true;
    setFile(null);
    setDiff(null);
    void rpc("fs.read", { threadId: thread.id, path: sel })
      .then((f) => live && setFile({ path: sel, ...f }))
      .catch((e) => live && setFile({ path: sel, text: e instanceof Error ? e.message : String(e), binary: true, size: 0 }));
    const c = changed.get(sel);
    if (c)
      void rpc("checkpoint.diff", { threadId: thread.id, itemId: c.cp })
        .then((d) => live && setDiff(d.find((x) => x.path === sel) ?? null))
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [sel, thread.id, changed.get(sel ?? "")?.cp]);

  const nodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const keep = (e: TreeEntry): boolean => (e.dir ? (e.children ?? []).some(keep) : (filter === "all" || changed.has(e.path)) && (!q || e.path.toLowerCase().includes(q)));
    const toNode = (e: TreeEntry): TreeNode => {
      const c = changed.get(e.path);
      return { id: e.path, label: baseOf(e.path.replace(/\/$/, "")), meta: c ? LETTER[c.status] : undefined, children: e.dir ? (e.children ?? []).filter(keep).map(toNode) : undefined };
    };
    const list = (tree ?? []).filter(keep).map(toNode);
    // Deleted files aren't in the tree any more; they still show under Changed.
    if (filter === "changed") for (const [p, c] of changed) if (c.status === "deleted" && (!q || p.includes(q))) list.push({ id: p, label: p, meta: "D" });
    return list;
  }, [tree, filter, query, changed]);

  const openDirs = useMemo(() => {
    const out = new Set<string>();
    const want = query.trim() || filter === "changed" ? null : sel;
    const walk = (list: TreeNode[]) =>
      list.forEach((n) => {
        if (!n.children) return;
        if (!want || want.startsWith(`${n.id.replace(/\/$/, "")}/`) || query.trim() || filter === "changed") out.add(n.id);
        walk(n.children);
      });
    walk(nodes);
    return [...out];
  }, [nodes, sel, query, filter]);

  const lines = useMemo(() => (file && !file.binary ? linesOf(file.text) : []), [file]);
  const toks = useMemo(() => (file ? tokensOf(lines, langOf(file.path)) : []), [lines]);
  const marks = useMemo(() => (diff && file ? marksOf(diff.before, diff.after) : new Map<number, "added" | "changed">()), [diff, file]);
  const c = sel ? changed.get(sel) : undefined;
  const turnItem = c ? items.find((x): x is Extract<Item, { kind: "turn" }> => x.kind === "turn" && x.turn === c.turn && !x.planning) : undefined;
  const turnAgent = agentOf(turnItem?.agent ?? thread.agent, agents, providers).name;

  return (
    <div className="lc-fsv">
      <div className="lc-files-side">
        <div className="lc-files-find">
          <I.search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a file" aria-label="Find a file" onKeyDown={(e) => e.key === "Escape" && setQuery("")} />
        </div>
        <Segmented
          size="sm"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "changed", label: <>Changed {changed.size > 0 && <span className="lc-files-n">{changed.size}</span>}</> },
          ]}
          aria-label="Which files"
        />
        <div className="lc-files-tree">
          {tree === null ? (
            <span className="l-shimmer lc-files-wait">Reading the folder</span>
          ) : nodes.length ? (
            <TreeView key={`${filter}:${query ? "q" : ""}`} nodes={nodes} label="Files" defaultExpanded={openDirs} selected={sel} onSelect={(n) => !n.children && setSel(n.id)} />
          ) : (
            <p className="lc-quiet lc-files-none">{err ?? (filter === "changed" ? "No turn has changed a file yet." : query ? "No file matches that." : "This folder is empty.")}</p>
          )}
        </div>
      </div>
      <section className="lc-files-view" aria-label={sel ?? "No file"}>
        {!sel ? (
          <SurfaceNote icon={<I.file size={20} />} title="Pick a file">
            Files the turns changed are marked in the tree.
          </SurfaceNote>
        ) : (
          <>
            <div className="lc-files-head">
              <span className="lc-mono lc-files-path" title={sel}>
                <span className="lc-quiet">{dirOf(sel)}</span>
                {baseOf(sel)}
              </span>
              <span className="lc-grow" />
              {c && (
                <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => onShowChanges(c.cp, sel)}>
                  Show changes
                </button>
              )}
              <button type="button" className="lc-ib l-focus" aria-label="Open in your editor" title="Open in your editor" onClick={() => cwd && bridge.openIn(`${cwd}/${sel}`, "editor")}>
                <I.external size={14} />
              </button>
            </div>
            <div className="lc-files-code">
              {!file ? (
                <span className="l-shimmer lc-files-wait">Opening {baseOf(sel)}</span>
              ) : file.binary ? (
                <p className="lc-quiet lc-files-none">{file.size ? `A binary file, ${Math.round(file.size / 1024)} KB.` : file.text}</p>
              ) : (
                <pre className="lc-code-view" key={file.path}>
                  {lines.map((_, i) => (
                    <div key={i} className="lc-cl" data-mark={marks.get(i + 1)}>
                      <span className="lc-cl-n">{i + 1}</span>
                      <span className="lc-cl-t">
                        <Toks line={toks[i]} />
                        {"\n"}
                      </span>
                    </div>
                  ))}
                </pre>
              )}
            </div>
            {c && marks.size > 0 && (
              <div className="lc-files-foot">
                <span className="lc-cl-key" data-mark="added">
                  added
                </span>
                <span className="lc-cl-key" data-mark="changed">
                  changed
                </span>
                <span className="lc-grow" />
                <span className="lc-quiet">
                  {turnAgent}, turn {c.turn}
                </span>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
