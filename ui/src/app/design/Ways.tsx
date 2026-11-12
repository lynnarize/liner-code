/*
  Three ways: one ask, three takes of a frame, side by side. "3 more like this" on the say bar
  opens a small menu: three takes by this session's agent, asked in one message, or one each by
  the other tools set up here, each in a session of its own in this folder (no worktree: a design
  file belongs to the folder, so every take lands on this canvas). Each take is a new frame beside
  the original, a copy of it to start from, marked with who draws it and the way it belongs to
  (`by.way`, "<original's id>~<when>"), so the canvas groups them after a reload too.

  Each take's name says who drew it and, once that session's turn is done and its tool said so,
  what it cost and how long it took (a take by this session's agent shares one turn with the
  others, so only the total is known: it shows in the dock's row). Under it: whether its colours
  keep to the lean, and how many checks it fails. Keep this one puts its page into the original
  (which keeps its place, name, file and build link) and drops the takes; Mix two picks two and
  starts the ask in the dock; Drop the others keeps the picked take beside the original.
*/
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { DesignFrame, FrameBy, LeanTokens, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { getState, loadItems, rpc, useEngine } from "../engine";
import { I, ModelMark } from "../icons";
import { duration, markOf, modelLabel, money, plural } from "../model";
import { ContextMenu, Row } from "../ui";
import { countFor, fixerName, leanSeen } from "./checks";
import { sayBar, useInCanvas } from "./SayBar";
import { design, getDesign, onCanvasEvent, selectionOf, useDesign } from "./store";
import "./ways.css";

// ---------- Which frames are takes, and of what

/** A take's who-and-way: the frame's own `by`, or (the sample canvas, which can't write one) the one kept here. */
const local: Record<string, FrameBy> = {};
/** The session that draws a take by another tool, by the take's frame: for its cost and time. */
const KEY = "liner.ld.ways";
const sessions: Record<string, string> = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
})();
const keepSessions = () => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    // kept for this window only
  }
};
const byOf = (f: DesignFrame): FrameBy | undefined => (f.by?.way ? f.by : local[f.id]);
/** The session drawing a take by another tool: the frame's own by.thread (it survives a closed window), else this window's note of it. */
const sessionOf = (f: DesignFrame) => f.by?.thread ?? sessions[f.id];
const origOf = (way: string) => way.split("~")[0];

export type Way = { id: string; orig?: DesignFrame; takes: DesignFrame[]; total?: number };
/** The ways on the canvas: each with its original (when it's still there) and its takes, left to right. */
export function waysOf(frames: DesignFrame[]): Way[] {
  const by = new Map<string, DesignFrame[]>();
  for (const f of frames) {
    const w = byOf(f)?.way;
    if (w) by.set(w, [...(by.get(w) ?? []), f]);
  }
  return [...by].map(([id, takes]) => ({ id, orig: frames.find((f) => f.id === origOf(id)), takes: takes.sort((a, b) => a.x - b.x) }));
}

// What a take by another tool cost and took: its session's usage, once its first turn is done.
/** A cost said plainly: "under 1¢" for one above nothing that would round to $0.00. */
const costText = (n: number) => (n > 0 && n < 0.005 ? "under 1¢" : money(n));
function costOf(thread: Thread | undefined, items: ReturnType<typeof getState>["items"]) {
  if (!thread || thread.status === "running") return undefined;
  // Its turns' time, added up (the take is usually one turn).
  const turns = (items[thread.id] ?? []).filter((x) => x.kind === "turn");
  const seconds = turns.length ? turns.reduce((a, x) => a + (x.kind === "turn" ? (x.seconds ?? 0) : 0), 0) || undefined : undefined;
  const cost = thread.usage?.costUsd;
  return { cost: cost && cost > 0 ? cost : undefined, seconds };
}

// ---------- On the lean: the frame's colours, each one of the lean's, a shade of one, or a grey

const hexes = (html: string) => {
  const out = new Set<string>();
  for (const m of html.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) out.add((m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]).toUpperCase());
  for (const m of html.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/gi)) out.add([m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("").toUpperCase());
  return [...out];
};
const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
const grey = (h: string) => {
  const c = rgb(h);
  return Math.max(...c) - Math.min(...c) < 14;
};
/** How many of a frame's colours keep off the lean; undefined with no lean to hold it to. */
export function offLean(html: string | undefined, t: LeanTokens | undefined) {
  if (!html || !t?.colours.length) return undefined;
  const lean = t.colours.flatMap((c) => (/^#[0-9a-f]{6}$/i.test(c.value.trim()) ? [c.value.trim().slice(1).toUpperCase()] : []));
  if (!lean.length) return undefined;
  // The page's own styles only: the frame agent and the picture data are not the design's colours.
  const style = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|\sstyle="([^"]*)"|\s(?:fill|stroke|color)="([^"]*)"/gi)].map((m) => m[1] ?? m[2] ?? m[3] ?? "").join("\n");
  const near = (h: string) => lean.some((l) => Math.hypot(...rgb(l).map((v, i) => v - rgb(h)[i])) < 10);
  return hexes(style).filter((h) => !grey(h) && !near(h)).length;
}

// ---------- Making the takes

const threadNow = () => {
  const s = getDesign();
  return s.threadId ? getState().threads.find((t) => t.id === s.threadId) : undefined;
};

/** An old turn is shown (Versions): takes, Keep and Drop wait until you go back to now. */
const shownOld = () => {
  if (getDesign().scrub === undefined) return false;
  toast("An old turn is shown", { description: "Go back to now to change the design." });
  return true;
};

/** Where a row of takes goes: right of whatever sits level with the original, on its page. */
function placeFor(f: DesignFrame) {
  const s = getDesign();
  const level = (s.file?.frames ?? []).filter((g) => g.page === f.page && g.y < f.y + f.h && g.y + g.h > f.y);
  return Math.max(...level.map((g) => g.x + g.w)) + 120;
}

/** The new frames for the takes, each a copy of the original; their ids, left to right. */
async function makeTakes(f: DesignFrame, who: { agent: string; name: string; thread?: string }[], way: string): Promise<string[]> {
  const s = getDesign();
  if (shownOld()) return [];
  const html = s.html[f.id] ?? "";
  const x0 = placeFor(f);
  if (s.mock || !s.cwd || !s.file) {
    const before = new Set(s.file?.frames.map((g) => g.id));
    for (let i = 0; i < who.length; i++) await design.copyFrames([f.id]);
    const made = (getDesign().file?.frames ?? []).filter((g) => !before.has(g.id));
    made.forEach((g, i) => {
      local[g.id] = { ...who[i], way };
      design.rename(g.id, f.name);
    });
    design.place(made.map((g, i) => ({ id: g.id, x: x0 + i * (f.w + 80), y: f.y })));
    return made.map((g) => g.id);
  }
  const ids: string[] = [];
  let known = new Set(s.file.frames.map((g) => g.id));
  for (const [i, w] of who.entries()) {
    const next = await rpc("canvas.frame.add", { cwd: s.cwd, file: s.file.id, frame: { name: f.name, w: f.w, h: f.h, x: x0 + i * (f.w + 80), y: f.y, page: f.page, by: { ...w, way } }, html });
    const added = next.frames.find((g) => !known.has(g.id));
    if (added) ids.push(added.id);
    known = new Set(next.frames.map((g) => g.id));
  }
  // The canvas reads the file again, as it does when an agent adds frames.
  onCanvasEvent({ type: "canvas.changed", cwd: s.cwd, file: s.file.id, by: "agent", at: Date.now() });
  return ids;
}

const RULES = "Make each one a different take: change the layout, what leads, or how the numbers are drawn, not only the colours. Keep each to the lean (DESIGN.md), keep the data-l ids of what you keep, and leave the original as it is.";

/** Three takes by this session's agent, asked in one message. */
async function threeHere(frame: string, node?: string) {
  const s = getDesign();
  const f = s.file?.frames.find((x) => x.id === frame);
  const t = threadNow();
  if (!f) return;
  const name = fixerName();
  const way = `${f.id}~${Date.now().toString(36)}`;
  const ids = await makeTakes(f, [0, 1, 2].map(() => ({ agent: t?.agent ?? "agent", name })), way);
  if (!ids.length) return;
  design.select(ids.map((id) => ({ frame: id })));
  if (s.mock || !t || !s.file) return void toast("Three frames for the takes", { description: "The sample canvas has no agent to draw them." });
  const paths = ids.map((id) => `frames/${id}.html`).join(", ");
  const about = node ? ` Start from ${getDesign().node?.id === node ? `“${getDesign().node!.name}”` : "the element"} (data-l ${node}) in it.` : "";
  const text = `Draw 3 more ways of “${f.name}” (frames/${f.id}.html), one into each of these new frames, which start as copies of it: ${paths}.${about} ${RULES}`;
  const sel = selectionOf({ ...getDesign(), sel: [{ frame: f.id }, ...ids.map((id) => ({ frame: id }))], node: undefined });
  await rpc("thread.send", { id: t.id, text, mode: "queue", design: { file: s.file.id, ...(sel ? { sel } : {}) } }).catch((e: Error) => toast.error(e.message));
}

/** One take each by other tools: a session each, in this folder, on the same design file. */
/**
  Why a take by another tool failed, or undefined when it drew: its turn ended in an error (it
  couldn't sign in, a key was missing, its process died), or it ended without the take's frame
  having changed at all (an untouched copy is not a take).
*/
async function failure(session: string, frame: string, startRev: string | undefined): Promise<string | undefined> {
  await loadItems(session, true).catch(() => undefined);
  const st = getState();
  const t = st.threads.find((x) => x.id === session);
  const items = st.items[session] ?? [];
  const turns = items.filter((x) => x.kind === "turn");
  const last = turns[turns.length - 1];
  const said = [...items].reverse().find((x) => x.kind === "error");
  const words = (m?: string) => (m ? m.replace(/\s+/g, " ").trim().slice(0, 160) : undefined);
  if (t?.status === "error" || t?.status === "limited" || (last && last.kind === "turn" && (last.status === "error" || last.status === "stopped")))
    return words(said && said.kind === "error" ? said.message : undefined) ?? words(t?.limit?.message) ?? "its turn ended in an error.";
  const s = getDesign();
  if (!s.cwd || !s.file) return undefined;
  const now = await rpc("canvas.frame.read", { cwd: s.cwd, file: s.file.id, frame }).catch(() => undefined);
  if (!now) return "its frame is no longer there.";
  if (startRev !== undefined && now.rev === startRev) return "its turn ended without changing the frame.";
  return undefined;
}

/** Waits until a session's turn and what it queued are done (or a long while has passed). */
async function settled(threadId: string, ms = 30 * 60_000) {
  const end = Date.now() + ms;
  await new Promise((r) => setTimeout(r, 1500));
  for (;;) {
    const t = getState().threads.find((x) => x.id === threadId);
    if (!t || (t.status !== "running" && !t.queue?.length) || Date.now() > end) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/**
  One take each by other tools: a session each, in this folder, on the same design file, started
  one after another (the next once the last has finished), each at "ask before edits" at most,
  never the lead's own higher level. The session is made first, so its take's frame carries it
  (by.thread) for its cost and time; a tool that fails to start leaves no take, and says why.
  Never run against the real tools yet.
*/
async function onePerTool(frame: string, tools: { ref: string; name: string }[]) {
  const s = getDesign();
  const f = s.file?.frames.find((x) => x.id === frame);
  const t = threadNow();
  if (!f || !t || !s.file || s.mock) return;
  const file = s.file.id;
  const way = `${f.id}~${Date.now().toString(36)}`;
  const access = t.access === "read" ? "read" : "ask";
  const made: string[] = [];
  for (const tool of tools) {
    if (shownOld() || getDesign().file?.id !== file) return;
    let session: string;
    try {
      session = (await rpc("thread.create", { projectId: t.projectId, agent: tool.ref, access, worktree: false, title: `${f.name}, a take by ${tool.name}` })).id;
    } catch (e) {
      toast.error(`${tool.name} couldn't start`, { description: (e as Error).message });
      continue;
    }
    const [id] = await makeTakes(f, [{ agent: tool.ref, name: tool.name, thread: session }], way);
    if (!id) {
      toast.error(`${tool.name}'s take couldn't be made`, { description: "Its frame wasn't added, so nothing was asked." });
      continue;
    }
    sessions[id] = session;
    keepSessions();
    made.push(id);
    design.select(made.map((x) => ({ frame: x })));
    // The take's page as it starts (a copy of the original): a turn that leaves it so drew nothing.
    const startRev = (await rpc("canvas.frame.read", { cwd: s.cwd!, file, frame: id }).catch(() => undefined))?.rev;
    try {
      const sel = selectionOf({ ...getDesign(), sel: [{ frame: f.id }, { frame: id }], node: undefined });
      const text = `Draw another way of “${f.name}” (frames/${f.id}.html) into frames/${id}.html, which starts as a copy of it. Change only that one file. ${RULES}`;
      await rpc("thread.send", { id: session, text, mode: "queue", design: { file, ...(sel ? { sel } : {}) } });
    } catch (e) {
      await design.removeFrames([id]);
      made.pop();
      toast.error(`${tool.name} couldn't start`, { description: `${(e as Error).message} Its take is taken away.` });
      continue;
    }
    await settled(session);
    const failed = await failure(session, id, startRev);
    if (failed) {
      await design.removeFrames([id]);
      made.pop();
      toast.error(`${tool.name}'s take is gone: ${failed}`);
    }
  }
}

// ---------- The menu "3 more like this" opens

type Menu = { at: { x: number; y: number }; frame: string; node?: string } | null;
let menu: Menu = null;
const menuFns = new Set<() => void>();
const setMenu = (m: Menu) => ((menu = m), menuFns.forEach((f) => f()));
const useMenu = () => useSyncExternalStore((f) => (menuFns.add(f), () => void menuFns.delete(f)), () => menu);

// A take (or its original) picked on its own: the keep bar stands where the say bar would.
sayBar.hidden = () => {
  const s = getDesign();
  return s.sel.length === 1 && !s.sel[0].node && waysOf(s.file?.frames ?? []).some((w) => [...w.takes, ...(w.orig ? [w.orig] : [])].some((f) => f.id === s.sel[0].frame));
};
sayBar.more = (sel) => {
  const first = getDesign().sel[0];
  if (!sel || !first) return;
  const r = document.querySelector(".ld-say [data-strong]")?.getBoundingClientRect();
  setMenu({ at: { x: r ? r.left : innerWidth / 2, y: r ? r.bottom + 6 : innerHeight / 2 }, frame: first.frame, node: first.node });
};

/** The other tools set up here, one model each (its first): for "one each". */
/** A tool's CLI under any route: "claude.fake" (an endpoint through Claude Code) is Claude Code. */
const cliOf = (providerId?: string) => providerId?.split(".")[0];
/** The key that stands in for a tool's own sign-in, as Setup reads it. */
const KEY_OF: Partial<Record<string, string>> = { claude: "anthropic", codex: "openai" };

/**
  The other tools, ready to use as Setup and the picker say it (installed, driven by Liner, with
  models, and not asking you to sign in unless a key stands in), in the picker's own order, one
  take per CLI, never the lead's own CLI by any route; and the ones that would need setting up.
*/
function useTools() {
  const providers = useEngine((s) => s.providers);
  const agents = useEngine((s) => s.agents);
  const keys = useEngine((s) => s.keys);
  const lead = useEngine((s) => s.threads.find((t) => t.id === getDesign().threadId));
  return useMemo(() => {
    const ref = lead ? (lead.model ?? (lead.agent.startsWith("@") ? lead.agent.slice(1) : agents.find((a) => a.id === lead.agent)?.model)) : undefined;
    const leadCli = cliOf(ref?.split(":")[0]);
    const others = providers.filter((p) => p.available && p.adapter && p.models.length && p.id !== "demo" && cliOf(p.id) !== leadCli);
    const ready = (p: (typeof providers)[number]) => !(p.signedIn === false && !keys.includes(KEY_OF[cliOf(p.id) ?? ""] ?? ""));
    const seen = new Set<string>();
    const tools = others
      .filter(ready)
      .filter((p) => (seen.has(cliOf(p.id)!) ? false : (seen.add(cliOf(p.id)!), true)))
      .slice(0, 3)
      .map((p) => ({ ref: `@${p.id}:${p.models[0].id}`, name: p.label, mark: markOf(`${p.id}:`) }));
    const unready = [...new Set(others.filter((p) => !ready(p) && !seen.has(cliOf(p.id)!)).map((p) => p.label))];
    return Object.assign(tools, { unready });
  }, [providers, lead, agents, keys]);
}

function MoreMenu() {
  const m = useMenu();
  const tools = useTools();
  const mock = useDesign((s) => s.mock);
  const who = fixerName();
  const go = (fn: () => Promise<unknown>) => {
    setMenu(null);
    void fn().catch((e: Error) => toast.error(e.message));
  };
  return (
    <ContextMenu at={m?.at ?? null} label="3 more like this" width={300} onClose={() => setMenu(null)}>
      {() =>
        m && (
          <>
            <div className="ld-way-mh">3 more like this, each in its own frame beside it</div>
            <Row title={`Three takes by ${who}`} note="One message, three new frames" icon={<I.copy size={14} />} onPick={() => go(() => threeHere(m.frame, m.node))} />
            <Row
              title={tools.length ? `One each by ${tools.map((t) => t.name).join(", ")}` : "One each by your other tools"}
              note={mock ? "Not on the sample canvas" : tools.length ? "One after another, each in a session here that asks before edits" : tools.unready.length ? `Sign in to ${tools.unready.slice(0, 3).join(" or ")} in Settings › Models` : "Set up another tool in Settings › Models"}
              icon={<I.fanout size={14} />}
              disabled={mock || !tools.length}
              onPick={() => go(() => onePerTool(m.frame, tools))}
            />
          </>
        )
      }
    </ContextMenu>
  );
}

// ---------- On the canvas

/** After a take's name: who drew it, and its cost and time once known. */
export function WayLabel({ frame }: { frame: DesignFrame }) {
  const by = byOf(frame);
  const own = sessionOf(frame);
  const thread = useEngine((s) => (own ? s.threads.find((t) => t.id === own) : undefined));
  const items = useEngine((s) => (own ? s.items : undefined));
  const providers = useEngine((s) => s.providers);
  if (!by?.way) return null;
  // The session's own turns, for the time: loaded here, since its session isn't open in this window.
  const done = thread && thread.status !== "running";
  useEffect(() => {
    if (own && done) void loadItems(own).catch(() => undefined);
  }, [own, done]);
  const known = thread && items ? costOf(thread, items) : undefined;
  const cost = by.cost ?? known?.cost;
  const secs = by.ms !== undefined ? by.ms / 1000 : known?.seconds;
  const ref = by.agent.startsWith("@") ? by.agent.slice(1) : undefined;
  return (
    <>
      <span className="ld-way-tag" title={ref ? modelLabel(ref, providers) : by.name}>
        {ref && <ModelMark kind={markOf(ref)} size={11} />}
        {by.name}
      </span>
      {thread?.status === "running" && <span className="l-shimmer">drawing</span>}
      {(cost !== undefined || secs !== undefined) && <span className="ld-num">{[cost !== undefined ? costText(cost) : "", secs !== undefined ? duration(secs) : ""].filter(Boolean).join(" · ")}</span>}
    </>
  );
}

type BoxOf = (f: DesignFrame, r?: { x: number; y: number; w: number; h: number }) => { left: number; top: number; width: number; height: number };

/** Under each take: the lean and the checks; under the picked one, what to do with it. And the menu. */
export function WaysOver({ frames, boxOf }: { frames: DesignFrame[]; boxOf: BoxOf }) {
  const html = useDesign((s) => s.html);
  const sel = useDesign((s) => s.sel);
  useDesign((s) => s.file);
  const ways = useMemo(() => waysOf(frames), [frames]);
  const t = leanSeen();
  return (
    <>
      <MoreMenu />
      {ways.map((w) => {
        // The keep bar shows for one frame of the way picked on its own (as the say bar would).
        const one = sel.length === 1 && !sel[0].node ? sel[0].frame : undefined;
        const picked = one ? [...w.takes, ...(w.orig ? [w.orig] : [])].find((f) => f.id === one) : undefined;
        return (
          <div key={w.id}>
            {w.takes.map((f) => {
              const b = boxOf(f);
              const off = offLean(html[f.id], t);
              const n = countFor(f.id);
              return (
                <div key={f.id} className="ld-way-under" style={{ left: b.left, top: b.top + b.height + 8, maxWidth: b.width }}>
                  {off !== undefined && (off === 0 ? (
                    <span data-ok>
                      <I.check size={12} />
                      On the lean
                    </span>
                  ) : (
                    <span>{plural(off, "colour")} off the lean</span>
                  ))}
                  <span>{n ? `${plural(n, "check")} to fix` : "Checks passed"}</span>
                </div>
              );
            })}
            {picked && <KeepBar way={w} picked={picked} box={boxOf(picked)} />}
          </div>
        );
      })}
    </>
  );
}

function KeepBar({ way, picked, box }: { way: Way; picked: DesignFrame; box: { left: number; top: number; width: number; height: number } }) {
  const [mixing, setMixing] = useState<{ x: number; y: number } | null>(null);
  const others = [...way.takes, ...(way.orig ? [way.orig] : [])].filter((f) => f.id !== picked.id);
  // Kept inside what of the canvas can be seen, as the say bar is: above the takes when the dock is in the way.
  const { ref, style } = useInCanvas(box.left, box.top + box.height + 34, box.top - 30, "start");
  return (
    <div ref={ref} className="ld-way-keep" data-ld-ui style={style} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="ld-say-b l-focus" data-strong onClick={() => void keep(way, picked)}>
        <I.check size={14} />
        Keep this one
      </button>
      <span className="ld-say-v" aria-hidden />
      <button type="button" className="ld-say-b l-focus" onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setMixing({ x: r.left, y: r.bottom + 6 });
      }}>
        Mix two
      </button>
      <button type="button" className="ld-say-b l-focus" onClick={() => void dropOthers(way, picked)}>
        Drop the others
      </button>
      <ContextMenu at={mixing} label="Mix with" width={260} onClose={() => setMixing(null)}>
        {(close) => (
          <>
            <div className="ld-way-mh">Mix this one with</div>
            {others.map((o) => (
              <Row key={o.id} title={o.id === way.orig?.id ? "The original" : `${byOf(o)?.name ?? "A take"}'s`} note={o.name} onPick={() => (close(), mix(way, picked, o))} />
            ))}
          </>
        )}
      </ContextMenu>
    </div>
  );
}

/**
  Keep: the take's page goes into the original, which keeps its place, name and file; the takes go.
  One step to undo: the original's earlier page comes back by a write checked against the revision
  Keep wrote (so never over an agent's later change), and the takes come back from the trash.
*/
async function keep(way: Way, picked: DesignFrame) {
  const s = getDesign();
  if (shownOld()) return;
  const takes = way.takes.map((f) => f.id);
  const undoable = (step: { undo: () => void } | undefined, text: string, description?: string) => toast(text, { description, duration: 5000, ...(step ? { action: { label: "Undo", onClick: () => step.undo() } } : {}) });
  // The original picked: the takes go. No original any more: the others go, and this one stays where it is.
  if (!way.orig || picked.id === way.orig.id) return undoable(await design.removeFrames(takes.filter((id) => id !== picked.id)), "Kept the original", "The other takes are gone.");
  const orig = way.orig;
  if (s.mock || !s.cwd || !s.file) {
    const step = await design.removeFrames([orig.id, ...takes.filter((id) => id !== picked.id)]);
    design.place([{ id: picked.id, x: orig.x, y: orig.y }]);
    delete local[picked.id];
    design.select([{ frame: picked.id }]);
    return undoable(step, `Kept ${byOf(picked)?.name ?? "that"}'s take`);
  }
  const cwd = s.cwd;
  const file = s.file.id;
  // Both pages from their files, never from what the browser shows.
  const [take, before] = await Promise.all([rpc("canvas.frame.read", { cwd, file, frame: picked.id }), rpc("canvas.frame.read", { cwd, file, frame: orig.id })]);
  const kept = await design.writeWhole(orig.id, take.html, { base: before.rev });
  if (!kept) return;
  await design.removeFrames(takes, { record: false });
  design.select([{ frame: orig.id }]);
  // Each write is checked against the revision the one before it left, so neither lands on an agent's later change.
  let at = kept.rev;
  const step = design.record({
    label: "Keep a take",
    undo: async () => {
      const back = await design.writeWhole(orig.id, before.html, { quietly: true, base: at });
      if (!back) throw new Error(`${orig.name} changed since Keep, so it stays as it is now.`);
      at = back.rev;
      await design.unremoveFrames(takes);
    },
    redo: async () => {
      const again = await design.writeWhole(orig.id, take.html, { quietly: true, base: at });
      if (!again) throw new Error(`${orig.name} changed since.`);
      at = again.rev;
      await design.removeFrames(takes, { record: false });
    },
  });
  undoable(step, `Kept ${byOf(picked)?.name ?? "that"}'s take`, `It is ${orig.name} now; the other takes are gone.`);
}

async function dropOthers(way: Way, picked: DesignFrame) {
  if (shownOld()) return;
  const step = await design.removeFrames(way.takes.filter((f) => f.id !== picked.id).map((f) => f.id));
  design.select([{ frame: picked.id }]);
  toast("Dropped the other takes", { duration: 5000, ...(step ? { action: { label: "Undo", onClick: () => step.undo() } } : {}) });
}

/** Mix two: both picked, and the ask started in the dock, for you to say what to take from each. */
function mix(way: Way, a: DesignFrame, b: DesignFrame) {
  if (shownOld()) return;
  design.select([{ frame: a.id }, { frame: b.id }]);
  const into = way.orig?.name ?? a.name;
  const text = `Mix these two takes into ${into}${way.orig ? ` (frames/${way.orig.id}.html)` : ""}: take `;
  requestAnimationFrame(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(".ld-dock textarea");
    if (!ta) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(text.length, text.length);
  });
}

/** The dock's row while a way is picked: how many takes, their cost in all when known, and Keep. */
export function WaysRow() {
  const file = useDesign((s) => s.file);
  const sel = useDesign((s) => s.sel);
  const threads = useEngine((s) => s.threads);
  const items = useEngine((s) => s.items);
  const ways = useMemo(() => waysOf(file?.frames ?? []), [file]);
  const w = ways.find((x) => [...x.takes, ...(x.orig ? [x.orig] : [])].some((f) => sel.some((y) => y.frame === f.id)));
  if (!w) return null;
  const picked = w.takes.find((f) => sel.some((x) => x.frame === f.id));
  const costs = w.takes.map((f) => costOf(threads.find((t) => t.id === sessionOf(f)), items)?.cost);
  const total = costs.every((c) => c !== undefined) ? costs.reduce((a, b) => a! + b!, 0) : undefined;
  const names = new Set(w.takes.map((f) => byOf(f)?.name));
  return (
    <div className="lc-trow ld-way-row" role="status">
      <I.copy size={13} />
      <span className="lc-trow-t">
        One ask, drawn {w.takes.length} {w.takes.length === 1 ? "way" : "ways"}
        {names.size === 1 ? ` by ${[...names][0]}` : ""}
        {total !== undefined && <span className="ld-q"> {costText(total)} in all</span>}
      </span>
      <span className="lc-grow" />
      {picked && (
        <button type="button" className="lc-trow-lk l-focus" onClick={() => void keep(w, picked)}>
          Keep {names.size > 1 ? `${byOf(picked)?.name}'s` : "this one"}
        </button>
      )}
    </div>
  );
}
