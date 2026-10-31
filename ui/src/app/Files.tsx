/*
  The Files surface: the session's folder as a tree, with what the turns changed marked, and
  the file you pick beside it. Lines the latest turn touched carry a mark in the gutter:
  added, or changed. Show changes opens the diff at that file. Images show as images, Markdown
  rendered (or as its source), and an HTML page as source with a way to open it in the Browser
  (T3 Code: files/FilePreviewPanel.tsx).

  A link to a file elsewhere in the app (an answer's Markdown, the Terminal) opens it here, at its
  line: dispatch `lc:open-file` with { path, line }, or call openInFiles. Files takes it now if it's
  on screen, or as it mounts (the session brings the Files tab up), for a few seconds.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff, Item, Thread, TreeEntry } from "@contracts";
import { TreeView, type TreeNode } from "@liner/components/tree-view/tree-view";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { StreamedMarkdown } from "@liner/pro/ai-kit/streamed";
import { bridge } from "./bridge";
import { browseTo } from "./agentBrowser";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { agentOf, checkpointsOf } from "./model";
import { baseOf, dirOf, langOf, linesOf, marksOf, tokensOf, Toks } from "./code";
import { SurfaceNote, useCwd } from "./Surfaces";

const LETTER = { added: "A", modified: "M", deleted: "D", renamed: "R" } as const;

/** What a file shows as, by its name. */
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;
const MARKDOWN = /\.(md|mdx|markdown)$/i;
const HTML = /\.html?$/i;

/* ---------- Opening a file at a line, from elsewhere in the app ---------- */

type Reveal = { path: string; line?: number; at: number };
let waiting: Reveal | null = null;
const takers = new Set<(r: Reveal) => void>();
/** Open a file in the Files surface, scrolled to a line. The path is the session folder's, or absolute inside it. */
export function openInFiles(path: string, line?: number) {
  window.dispatchEvent(new CustomEvent("lc:open-file", { detail: { path, line } }));
}
window.addEventListener("lc:open-file", (e) => {
  const d = (e as CustomEvent<{ path?: unknown; line?: unknown }>).detail;
  if (!d || typeof d.path !== "string" || !d.path.trim()) return;
  const line = typeof d.line === "number" && d.line > 0 ? Math.floor(d.line) : typeof d.line === "string" && /^\d+$/.test(d.line) ? Number(d.line) : undefined;
  const r: Reveal = { path: d.path.trim(), line, at: Date.now() };
  // On screen, it's taken now; else it waits for the Files surface the session is bringing up.
  if (takers.size) for (const f of takers) f(r);
  else waiting = r;
});
function takeWaiting() {
  const r = waiting;
  waiting = null;
  return r && Date.now() - r.at < 10_000 ? r : null;
}

/** The session folder's path for a link's: ./a, /Users/…/project/a and a all read as "a". */
function inFolder(path: string, cwd: string) {
  let p = path.replace(/^file:\/\//, "");
  try {
    p = decodeURI(p);
  } catch {
    // Not encoded after all.
  }
  if (cwd && (p === cwd || p.startsWith(`${cwd}/`))) p = p.slice(cwd.length + 1);
  return p.replace(/^\.\//, "");
}

/** Rendered or source, for Markdown and SVG: your last pick, remembered (T3 Code keeps it the same way). */
function useRendered() {
  const [rendered, set] = useState(() => {
    try {
      return localStorage.getItem("lc:files:rendered") !== "0";
    } catch {
      return true;
    }
  });
  const setRendered = (v: boolean) => {
    set(v);
    try {
      localStorage.setItem("lc:files:rendered", v ? "1" : "0");
    } catch {
      // Shut storage: the pick lasts until the window closes.
    }
  };
  return [rendered, setRendered] as const;
}

export function FilesSurface({ thread, items, onShowChanges, reveal }: { thread: Thread; items: Item[]; onShowChanges: (checkpointId: string, path: string) => void; reveal?: { path: string; line?: number } }) {
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const cwd = useCwd(thread);
  const [tree, setTree] = useState<TreeEntry[] | null>(null);
  const [filter, setFilter] = useState<"all" | "changed">("all");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [file, setFile] = useState<{ path: string; text: string; binary: boolean; size: number } | null>(null);
  const [image, setImage] = useState<{ path: string; src?: string; error?: string } | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rendered, setRendered] = useRendered();
  // The line a link asked for: scrolled to and lit once the file is open.
  const [goto, setGoto] = useState<{ path: string; line: number; n: number } | null>(null);
  const code = useRef<HTMLPreElement>(null);

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

  // A file asked for from elsewhere: picked, with its line to go to. A line shows in the source,
  // without changing how you like Markdown shown.
  const open = (r: { path: string; line?: number }) => {
    const p = inFolder(r.path, cwd);
    if (!p) return;
    setQuery("");
    setFilter("all");
    setSel(p);
    setGoto((g) => (r.line ? { path: p, line: r.line, n: (g?.n ?? 0) + 1 } : null));
  };
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const take = (r: Reveal) => openRef.current(r);
    takers.add(take);
    const w = takeWaiting();
    if (w) take(w);
    return () => void takers.delete(take);
  }, []);
  useEffect(() => {
    if (reveal?.path) open(reveal);
  }, [reveal?.path, reveal?.line]);

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
    setImage(null);
    void rpc("fs.read", { threadId: thread.id, path: sel })
      .then((f) => live && setFile({ path: sel, ...f }))
      .catch((e) => live && setFile({ path: sel, text: e instanceof Error ? e.message : String(e), binary: true, size: 0 }));
    // An image's bytes come apart, at most 10 MB of them.
    if (IMAGE.test(sel))
      void rpc("files.raw", { threadId: thread.id, path: sel })
        .then((r) => live && setImage({ path: sel, src: `data:${r.mime};base64,${r.data}` }))
        .catch((e) => live && setImage({ path: sel, error: e instanceof Error ? e.message : String(e) }));
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

  // How the picked file shows: an image, Markdown rendered, or its source (an HTML page's too).
  const kind = !sel ? null : IMAGE.test(sel) ? "image" : MARKDOWN.test(sel) ? "markdown" : HTML.test(sel) ? "html" : "text";
  const twoWays = (kind === "markdown" || (kind === "image" && /\.svg$/i.test(sel ?? ""))) && file && !file.binary;
  const hl = goto && goto.path === sel ? goto.line : undefined;
  const showRendered = rendered && !hl;
  const asSource = kind === "text" || kind === "html" || (twoWays && !showRendered);

  // The asked-for line scrolls to the middle once its file's lines are there.
  useEffect(() => {
    if (!hl || !asSource || !lines.length) return;
    const row = code.current?.children[Math.min(hl, lines.length) - 1] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "center" });
  }, [hl, goto?.n, asSource, lines.length]);

  const openInBrowser = () => {
    if (!sel) return;
    browseTo(thread.id, sel).catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));
  };

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
            <TreeView key={`${filter}:${query ? "q" : ""}`} nodes={nodes} label="Files" defaultExpanded={openDirs} selected={sel} onSelect={(n) => !n.children && (setSel(n.id), setGoto(null))} />
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
              {twoWays && (
                <Segmented
                  size="sm"
                  value={showRendered ? "preview" : "source"}
                  onValueChange={(v) => {
                    setRendered(v === "preview");
                    if (v === "preview") setGoto(null);
                  }}
                  options={[
                    { value: "preview", label: "Preview" },
                    { value: "source", label: "Source" },
                  ]}
                  aria-label="Show it as"
                />
              )}
              {kind === "html" && (
                <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={openInBrowser}>
                  <I.globe size={13} />
                  Open in Browser
                </button>
              )}
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
              {kind === "image" && !asSource ? (
                // An image, on a checkerboard so a transparent one still reads (T3 Code: files/PreviewImage.tsx).
                !image ? (
                  <span className="l-shimmer lc-files-wait">Opening {baseOf(sel)}</span>
                ) : image.error ? (
                  <p className="lc-quiet lc-files-none">{image.error}</p>
                ) : (
                  <div className="lc-files-img">
                    <img src={image.src} alt={baseOf(sel)} draggable={false} />
                    {file && <span className="lc-quiet">{file.size < 1024 ? `${file.size} B` : `${Math.round(file.size / 1024)} KB`}</span>}
                  </div>
                )
              ) : !file ? (
                <span className="l-shimmer lc-files-wait">Opening {baseOf(sel)}</span>
              ) : file.binary ? (
                <p className="lc-quiet lc-files-none">{file.size ? `A binary file, ${Math.round(file.size / 1024)} KB.` : file.text}</p>
              ) : kind === "markdown" && !asSource ? (
                // Rendered with the app's own Markdown (T3 Code: files/FileMarkdownPreview.tsx).
                <div className="lc-files-md">
                  <StreamedMarkdown className="lc-md" text={file.text} streaming={false} animate={false} />
                </div>
              ) : (
                <pre ref={code} className="lc-code-view" key={file.path}>
                  {lines.map((_, i) => (
                    <div key={i} className="lc-cl" data-mark={marks.get(i + 1)} data-hl={hl === i + 1 || undefined}>
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
            {c && marks.size > 0 && asSource && (
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
