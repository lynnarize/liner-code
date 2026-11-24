/*
  The Wall: every session at once, as tiles. A tile is a session that works, waits on you, or has
  finished and isn't settled yet. Its head is the sidebar's row (SideList.tsx): the state mark, the
  title and the time since it last did something; under it the project, what it does or wants in
  the row's words, and the row's facts (its own worktree, its model, its pull request's number);
  then, while it works, the session's own live line (its mark, steps, newest step and clock). What one press settles is done on
  the tile (allow it or say no, pick an answer, try again, settle it); anything longer opens the
  session. Tiles draw text only, no live pictures, so a wall of them costs about what one session does.
  The order and the filter are By status's (statusKind): what needs you, then what works, then what's finished, each
  newest first and steady while it works; while the pointer is over the tiles they don't move at
  all, so a tile that changes doesn't slide out from under a click.
  While it's up: 1 to 9 open the tile with that number, the arrows pick a tile, Enter opens the one
  picked, typing writes to it, and Esc goes back to where you were. The pick is a session, not a
  place: it stays with its tile as the tiles reorder, so words you're writing never change session.
*/
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as PressEvent } from "react";
import { PR_TEST_TOOL, type FileChange, type Item, type Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { addToDraft, SendBox } from "./Composer";
import { getState, loadItems, rpc, useEngine, useItems } from "./engine";
import { I, MARK_WORD } from "./icons";
import { agentOf, ago, clock, isModelAgent, markOf, mergeFiles, modelLabel, onTheWall, plural, providerLabel, sumLines, threadModel, turnsOf, wallShown } from "./model";
import { markLabelOf, markStateOf, prSaid, reviewHeld, seenAsk, statusKind, wallKind, type WallKind } from "./session-state";
import { isStep, LiveLine, trailSteps } from "./Timeline";
import { pairOf } from "./Crew";
import { rowWords, SideFacts, SideMark } from "./SideList";
import { Lines, ShowSidebar } from "./ui";
import * as os from "./os";
import { wordRead, wordWrite } from "./kept";
import "./wall.css";

type Tool = Extract<Item, { kind: "tool" }>;
type Ask = Extract<Item, { kind: "approval" }>;
type Asked = Extract<Item, { kind: "question" }>;
type Plan = Extract<Item, { kind: "proposal" }>;
type Limit = Extract<Item, { kind: "limit" }>;
type Checkpoint = Extract<Item, { kind: "checkpoint" }>;
type Mark = Extract<Item, { kind: "turn" }>;

export type { WallKind };
type Filter = "all" | WallKind | "review";

export { wallKind };
const RANK: Record<WallKind, number> = { needs: 0, working: 1, done: 2 };

/** Sessions waiting for review: Reviewer-blocked, finished with unreviewed files, or with an open pull request. */
export const needsReview = (t: Thread) => !t.archived && !t.routine && !t.security && !t.done && (reviewHeld(t) || (t.toReview ?? 0) > 0 || t.pr?.state === "open");

/** The sessions on the Wall, in its order: By status's three (statusKind), each newest first, unread answers ahead of read ones. */
export function wallOrder(threads: Thread[], now = Date.now()) {
  return threads.filter((t) => onTheWall(t, now)).sort((a, b) => RANK[statusKind(a, now)] - RANK[statusKind(b, now)] || Number(Boolean(b.unread)) - Number(Boolean(a.unread)) || b.createdAt - a.createdAt);
}

/** The Wall's filter and its counts: By status's own test (statusKind) plus the centralized Review queue. */
export const wallFilter = (all: Thread[], filter: Filter, now = Date.now()) => (filter === "all" ? all : filter === "review" ? all.filter(needsReview) : all.filter((t) => statusKind(t, now) === filter));

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
/** What Retry says to a session that stopped with a problem. */
const RETRY = "Try again from where you stopped.";
/** A tile's least height, and the most it grows to when the window has room to spare. */
const ROW_MIN = 264;
const ROW_MAX = 420;
/** From this row height a done tile has room for three points and three files; below it, two of each. */
const ROOMY = 320;
const GAP = 12;
/** The grid's padding, top and bottom (wall.css). */
const PAD = 20;

const firstLine = (s: string) => s.split("\n").map((l) => l.trim()).find(Boolean) ?? "";

/*
  What you've written to each tile, while the app runs: a tile's field comes and goes with the pick
  and with how its session stands, its words don't. Opening the session takes them to its composer,
  and so does a session that leaves the Wall with words waiting for it.
*/
const drafts = new Map<string, string>();
const toComposer = (id: string) => {
  const text = drafts.get(id);
  drafts.delete(id);
  if (text?.trim()) addToDraft(id, text);
  return Boolean(text?.trim());
};

/*
  A done tile reads as a brief, not the answer's paragraphs run together: its first sentence, then
  up to three points (the answer's own list items, each with its bold lead; with no list, the
  sentences after the first), then the files it changed. The rest is a click away, in the session.
*/
type Point = { head?: string; rest: string };
type Brief = { lead: string; points: Point[]; more: number };
const POINTS = 3;
// Inline marks out, `code` kept for the tile to set in mono.
const inlineOf = (s: string) =>
  s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,:;!?]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
const sentencesOf = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(`*])/).map((x) => x.trim()).filter(Boolean);
const pointOf = (raw: string): Point => {
  const bold = /^(?:\*\*|__)(.+?)(?:\*\*|__)\s*[:—–-]?\s*(.*)$/.exec(raw);
  if (bold) return { head: inlineOf(bold[1]).replace(/[:.]$/, ""), rest: inlineOf(bold[2]) };
  const text = inlineOf(raw);
  const colon = /^([^.:`]{2,48}):\s+(.+)$/.exec(text);
  return colon ? { head: colon[1], rest: colon[2] } : { rest: text };
};
function briefOf(md: string): Brief | undefined {
  const paras: string[] = [];
  const items: string[] = [];
  let para: string[] = [];
  let item: string[] | null = null;
  const end = () => {
    if (para.length) paras.push(para.join(" "));
    if (item?.length) items.push(item.join(" "));
    para = [];
    item = null;
  };
  for (const line of md.replace(/```[\s\S]*?(?:```|$)/g, "\n").split("\n")) {
    const indent = /^\s*/.exec(line)![0].replace(/\t/g, "    ").length;
    const s = line.trim();
    const mark = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(s);
    if (!s || /^#{1,6}\s/.test(s) || /^\|/.test(s) || /^(?:-{3,}|\*{3,})$/.test(s)) end();
    else if (mark && indent < 2) (end(), (item = [mark[1]]));
    else if (mark) continue; // a nested point: the tile keeps to the top ones
    else if (item) item.push(s);
    else para.push(s.replace(/^>\s?/, ""));
  }
  end();
  const first = sentencesOf(paras[0] ?? "");
  const lead = inlineOf(first[0] ?? "");
  const all: Point[] = items.length ? items.map(pointOf) : [...first.slice(1), ...paras.slice(1).flatMap(sentencesOf)].map(pointOf);
  const points = all.filter((p) => p.rest || p.head);
  if (!lead && !points.length) return undefined;
  return { lead, points: points.slice(0, POINTS), more: Math.max(0, points.length - POINTS) };
}

/** A done tile's body: the brief, then what it changed file by file (the foot keeps the totals). */
function Done({ info, roomy }: { info: Info; roomy: boolean }) {
  const { brief, changed } = info;
  // A short tile keeps to two points, with no line for the rest, and two rows of files.
  const points = brief?.points.slice(0, roomy ? POINTS : 2) ?? [];
  const more = roomy ? (brief?.more ?? 0) : 0;
  if (!brief && !changed.length) return <p className="lc-wt-lead-line lc-quiet">It finished without a word.</p>;
  const room = roomy ? 3 : 2;
  const shown = changed.length > room ? changed.slice(0, room - 1) : changed;
  return (
    <div className="lc-wt-brief">
      {brief?.lead && (
        <p className="lc-wt-lead-line">
          <Words s={brief.lead} />
        </p>
      )}
      {points.length > 0 && (
        <ul className="lc-wt-points">
          {points.map((p, i) => (
            <li key={i}>
              {p.head && (
                <b>
                  <Words s={p.head} />
                </b>
              )}
              {p.head && p.rest && " "}
              {p.rest && (
                <span>
                  <Words s={p.rest} />
                </span>
              )}
            </li>
          ))}
          {more > 0 && <li className="lc-wt-more">{plural(more, "more point")}</li>}
        </ul>
      )}
      {changed.length > 0 && (
        <ul className="lc-wt-files" aria-label="What it changed">
          {shown.map((f) => {
            const cut = f.path.lastIndexOf("/");
            return (
              <li key={f.path} data-status={f.status}>
                <I.file size={14} />
                <span className="lc-wt-fname">{f.path.slice(cut + 1)}</span>
                {cut > 0 && <span className="lc-wt-fdir">{f.path.slice(0, cut)}</span>}
                <span className="lc-grow" />
                {f.status === "deleted" ? <span className="lc-wt-fdel">Deleted</span> : f.status === "added" && !f.removed ? <span className="lc-wt-fnew">New</span> : null}
                <Lines added={f.added} removed={f.removed} />
              </li>
            );
          })}
          {changed.length > shown.length && <li className="lc-wt-more">{plural(changed.length - shown.length, "more file")}</li>}
        </ul>
      )}
    </div>
  );
}

/** Words with their `code` in mono, as the tile sets them. */
const Words = ({ s }: { s: string }) => (
  <>
    {s.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}
  </>
);

/** A session's last turn as a tile shows it: its steps, what it waits on, and how it ended. */
type Info = {
  /** How many steps its last turn took. */
  count: number;
  /** Its last turn is at work, so the tile shows its live line (LiveLine), which counts the steps itself. */
  live: boolean;
  ask?: Ask;
  question?: Asked;
  plan?: Plan;
  limit?: Limit;
  error?: string;
  brief?: Brief;
  /** What the turn changed, the most lines first. */
  changed: FileChange[];
  files: number;
  lines: { added: number; removed: number };
  /** Since when it stands as it does: the turn's start while it works, the ask while it waits, else the last change. */
  since: number;
  agent: string;
  model?: string;
};

/*
  The last turn as turnsOf groups it (the turns that carried it on joined to it), without grouping
  the whole timeline: a streaming tile reads this once a frame. It finds where the last group
  starts, the newest turn whose first mark isn't a part, and groups only what's from there on.
*/
function lastTurnOf(items: Item[]): Item[] {
  if (!items.length) return [];
  const first = new Map<number, Mark | null>();
  for (const it of items) {
    const had = first.get(it.turn);
    if (had === undefined) first.set(it.turn, it.kind === "turn" ? it : null);
    else if (had === null && it.kind === "turn") first.set(it.turn, it);
  }
  const turns = [...first.keys()].sort((a, b) => b - a);
  const start = turns.find((n) => !first.get(n)?.part) ?? turns[turns.length - 1];
  return turnsOf(items.filter((x) => x.turn >= start)).at(-1)?.items ?? [];
}

/** A working or waiting tile shows no brief, so its reply's words aren't read for one on every frame. */
function infoOf(t: Thread, items: Item[], brief: boolean): Info {
  const last = lastTurnOf(items);
  const marks = last.filter((x): x is Mark => x.kind === "turn");
  const mark = marks.at(-1);
  const cps = last.filter((x): x is Checkpoint => x.kind === "checkpoint" && !x.reverted);
  const lastCp = cps.at(-1);
  const cp = lastCp && cps.length > 1 ? { ...lastCp, files: mergeFiles(cps.flatMap((c) => c.files)) } : lastCp;
  const steps = trailSteps(last.filter((x): x is Tool => x.kind === "tool" && isStep(x)), cp);
  const ask = last.findLast((x): x is Ask => x.kind === "approval" && x.state === "asking");
  const question = last.findLast((x): x is Asked => x.kind === "question" && x.state === "asking");
  const plan = last.findLast((x): x is Plan => x.kind === "proposal" && x.state === "asking");
  const text = last.findLast((x): x is Extract<Item, { kind: "text" }> => x.kind === "text" && Boolean(x.text.trim()));
  const files = cp?.files ?? [];
  const waiting = [ask, question, plan].filter((x) => x !== undefined).map((x) => x.at);
  return {
    count: steps.length,
    live: marks.some((m) => m.status === "running"),
    ask,
    question,
    plan,
    limit: last.findLast((x): x is Limit => x.kind === "limit"),
    error: last.findLast((x): x is Extract<Item, { kind: "error" }> => x.kind === "error")?.message,
    brief: brief && text ? briefOf(text.text) : undefined,
    changed: [...files].sort((a, b) => b.added + b.removed - (a.added + a.removed)),
    files: files.length,
    lines: sumLines(files),
    since: t.status === "running" ? (marks[0]?.at ?? t.updatedAt) : waiting.length ? Math.max(...waiting) : t.updatedAt,
    agent: mark?.agent ?? t.turnBy ?? t.agent,
    model: mark?.model,
  };
}

type Props = { sidebar: boolean; onSidebar: () => void; onOpen: (id: string) => void; onBack: () => void; onNew: () => void };

export function Wall({ sidebar, onSidebar, onOpen, onBack, onNew }: Props) {
  const threads = useEngine((s) => s.threads);
  const projects = useEngine((s) => s.projects);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  // Kept for the window through kept.ts, so a window whose storage throws still opens the Wall, on All.
  const [filter, setFilter] = useState<Filter>(() => wordRead(sessionStorage, "lc:wall-filter", ["all", "needs", "working", "review", "done"], "all") as Filter);
  useEffect(() => wordWrite(sessionStorage, "lc:wall-filter", filter), [filter]);
  // While the pointer is over the tiles they hold their places: one that finishes or starts to wait
  // doesn't move from under a click. They take their order when it leaves; a new one joins at the end.
  const held = useRef<string[] | null>(null);
  const [holding, setHolding] = useState(false);
  const all = useMemo(() => {
    const order = wallOrder(threads, now);
    const was = holding ? held.current : null;
    if (!was) return order;
    const at = (id: string) => (was.includes(id) ? was.indexOf(id) : was.length);
    return [...order].sort((a, b) => at(a.id) - at(b.id));
  }, [threads, now, holding]);
  const hold = (on: boolean) => {
    held.current = on ? all.map((t) => t.id) : null;
    setHolding(on);
  };
  const shown = useMemo(() => wallFilter(all, filter, now), [all, filter, now]);
  const ids = shown.map((t) => t.id);
  const key = ids.join(",");
  useEffect(() => void (wallShown.ids = key ? key.split(",") : []), [key]);
  const count = (k: WallKind | "review") => wallFilter(all, k, now).length;
  const working = count("working");

  // Each tile reads its session's timeline: fetched once, then kept up by the event stream as an open session's is.
  const every = all.map((t) => t.id).join(",");
  useEffect(() => {
    const have = getState().items;
    for (const t of all) if (!have[t.id]) void loadItems(t.id).catch(() => {});
  }, [every]);

  /*
    The pick is a session's id. With none picked yet it's the first tile, held by its id from then on;
    one hidden by the filter gives way to the first shown, and comes back with the filter. One that
    leaves the Wall hands the pick to the tile that takes its place, unless you were writing to it:
    then nothing is picked until you pick, so what you type next goes to no one you didn't choose.
  */
  const [picked, setPicked] = useState<string | null>(() => wallShown.picked);
  const [adrift, setAdrift] = useState(false);
  const lastAt = useRef(0);
  const onWall = (id: string) => all.some((t) => t.id === id);
  // Gone with words written to it: no pick from the render it goes, not a frame later.
  const lost = picked !== null && !onWall(picked) && Boolean(drafts.get(picked)?.trim());
  const pick = adrift || lost ? null : picked && ids.includes(picked) ? picked : picked && onWall(picked) ? (ids[0] ?? null) : (ids[Math.min(lastAt.current, ids.length - 1)] ?? null);
  // The same function for every render, so a tile redraws for its own session's changes only.
  const opener = useRef(onOpen);
  opener.current = onOpen;
  const open = useCallback((id: string) => {
    wallShown.picked = id;
    // Words started on its tile go on in its composer.
    toComposer(id);
    opener.current(id);
  }, []);
  const choose = useCallback((id: string) => {
    wallShown.picked = id;
    setPicked(id);
    setAdrift(false);
  }, []);
  useEffect(() => {
    if (pick) lastAt.current = ids.indexOf(pick);
    if (pick && pick !== picked && !(picked && onWall(picked))) choose(pick);
  });
  // A session that leaves the Wall (settled, archived, snoozed from the sidebar) with words written to it takes them to its composer, and says so.
  useEffect(() => {
    if (!threads.length) return;
    for (const id of [...drafts.keys()]) {
      if (onWall(id) || !toComposer(id)) continue;
      if (id === picked) setAdrift(true);
      toast(`Kept what you wrote to ${threads.find((t) => t.id === id)?.title ?? "a session"}`, { description: "It left the Wall. Your words wait in its composer." });
    }
  }, [every]);

  // The grid's shape: how many columns fit, and a row height that fills the window when the tiles fit in it.
  const grid = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState({ cols: 3, h: 0 });
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const read = () => {
      const cols = getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
      setShape((s) => (s.cols === cols && s.h === el.clientHeight ? s : { cols, h: el.clientHeight }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rows = Math.max(1, Math.ceil(shown.length / shape.cols));
  const fit = Math.floor((shape.h - PAD - GAP * (rows - 1)) / rows);
  const rowH = fit >= ROW_MIN ? Math.min(fit, ROW_MAX) : ROW_MIN;

  // Each picked tile's field, for typing into it from anywhere on the Wall.
  const fields = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());
  const field = useCallback((id: string, el: HTMLInputElement | HTMLTextAreaElement | null) => void (el ? fields.current.set(id, el) : fields.current.delete(id)), []);

  const live = useRef({ ids, pick, cols: shape.cols, open, onBack });
  live.current = { ids, pick, cols: shape.cols, open, onBack };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || document.querySelector("dialog[open]")) return;
      const { ids, pick, cols, open, onBack } = live.current;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], .xterm")) {
        // Esc in a tile's field lets go of it first; a second goes back.
        if (e.key === "Escape" && t.closest(".lc-wall")) (e.preventDefault(), t.blur());
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") return void (e.preventDefault(), onBack());
      if (/^[1-9]$/.test(e.key)) {
        const id = ids[Number(e.key) - 1];
        if (id) (e.preventDefault(), open(id));
        return;
      }
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
      if (step !== undefined) {
        if (!ids.length) return;
        e.preventDefault();
        const at = pick ? ids.indexOf(pick) : -1;
        const next = ids[Math.max(0, Math.min(ids.length - 1, at < 0 ? 0 : at + step))];
        choose(next);
        document.querySelector(`.lc-wall [data-tile="${CSS.escape(next)}"]`)?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter") {
        if (t?.closest("button, a, [role='button']") || !pick) return;
        e.preventDefault();
        return open(pick);
      }
      // A letter starts a message to the picked tile: its field takes the key as it comes, and the pick
      // is held to that session from here. So does an input method's first key, Process or 229 (the
      // test T3 Code knows an input method's keys by: ComposerPromptEditorTiptap.tsx), and an accent's
      // (Dead): with the field focused now, what it composes lands there.
      if (((e.key.length === 1 && e.key !== " ") || e.key === "Process" || e.keyCode === 229 || e.key === "Dead") && pick) {
        const f = fields.current.get(pick);
        if (!f) return;
        choose(pick);
        f.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose, open]);

  const projectOf = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const empty = all.length === 0;
  const none = { needs: "Nothing waits on you", working: "Nothing is working right now", review: "Nothing awaits review right now", done: "Nothing finished waits to be settled" } as const;

  return (
    <div className="lc-wall">
      <header className="lc-top" data-drag>
        {!sidebar && (
          <ShowSidebar onShow={onSidebar} />
        )}
        {/* How many there are, and how many work, is the filter's to say: no count beside it to say it twice. Its keys are in its tooltip, and Esc is the way back, as on every page with no Back of its own. */}
        <h1 className="lc-title" title="1 to 9 opens a tile. Esc goes back to where you were">
          The Wall
        </h1>
        {!empty && (
          // Tabs with their counts, drawn as Liner Security's are (security.css .ls-sg): 28 high, the picked one on a wash, its count grey after its name.
          <div className="lc-wall-tabs" role="tablist" aria-label="Show">
            {(
              [
                { value: "all", label: "All", count: all.length },
                { value: "needs", label: "Needs you", count: count("needs") },
                { value: "working", label: "Working", count: working },
                { value: "review", label: "Review queue", count: count("review") },
                { value: "done", label: "Finished", count: count("done") },
              ] as const
            ).map((o) => (
              <button key={o.value} type="button" role="tab" aria-selected={filter === o.value} className="lc-wall-tab l-focus" onClick={() => setFilter(o.value)}>
                {o.label}
                <span className="l-num">{o.count}</span>
              </button>
            ))}
          </div>
        )}
        <span className="lc-grow" data-drag />
      </header>
      <div ref={grid} className="lc-wall-grid" style={{ "--lc-wall-row": `${rowH}px` } as CSSProperties} onPointerEnter={(e) => e.pointerType === "mouse" && hold(true)} onPointerLeave={() => hold(false)}>
        {empty ? (
          <div className="lc-wall-empty">
            <I.wall size={20} />
            <b>Nothing on the Wall yet</b>
            <span>Sessions come here while they work, wait on you, or wait for you to settle them.</span>
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={onNew}>
              New session
            </button>
          </div>
        ) : !shown.length ? (
          <div className="lc-wall-empty">
            <I.wall size={20} />
            <b>{filter === "all" ? "Nothing here" : none[filter]}</b>
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setFilter("all")}>
              Show them all
            </button>
          </div>
        ) : (
          shown.map((t, i) => <Tile key={t.id} t={t} n={i + 1} picked={t.id === pick} now={now} project={projectOf.get(t.projectId) ?? ""} roomy={rowH >= ROOMY} onPick={choose} onOpen={open} field={field} />)
        )}
      </div>
    </div>
  );
}

type TileProps = { t: Thread; n: number; picked: boolean; now: number; project: string; roomy: boolean; onPick: (id: string) => void; onOpen: (id: string) => void; field: (id: string, el: HTMLInputElement | HTMLTextAreaElement | null) => void };

const Tile = memo(function Tile({ t, n, picked, now, project, roomy, onPick, onOpen, field }: TileProps) {
  const items = useItems(t.id);
  const loaded = useEngine((s) => s.items[t.id] !== undefined);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const kind = wallKind(t);
  const info = useMemo(() => infoOf(t, items, kind === "done"), [t, items, kind]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraftState] = useState(() => drafts.get(t.id) ?? "");
  // Its reply field, handed to the Wall while it shows, so typing anywhere on the Wall lands in the picked tile's field.
  const box = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const setDraft = (v: string) => {
    setDraftState(v);
    if (v) drafts.set(t.id, v);
    else drafts.delete(t.id);
  };
  const act = (run: () => Promise<unknown>) => {
    setBusy(true);
    void run()
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const ref = info.model || threadModel(t, agents, providers);
  const model = ref ? modelLabel(ref, providers) : "";
  // A pair as one ("Opus 5.5 + Sol"); a model on its own by its tool and name; your agent by its name and model. Said by the model's mark among the facts.
  const pair = pairOf(t, agents, providers);
  const who = (pair ? [pair.name] : isModelAgent(info.agent) ? [ref && providerLabel(ref, providers), model] : [agentOf(info.agent, agents, providers).name, model])
    // A named agent on a model of the same name (Demo on Demo) says it once.
    .filter((x, i, all) => x && x !== all[i - 1])
    .join(" · ");
  // The head and the line under it are a sidebar row's (SideList.tsx): the mark, the title and the time since it last did something; then
  // the project, what it does or wants in the row's words (a question in its own words, amber until you open it), and the row's facts.
  const works = kind === "working";
  const mark = markStateOf(t, { busy: works });
  const said = rowWords(t, { busy: works, agents: t.status === "running" ? 0 : t.agentsAtWork, seenQ: seenAsk(t), now });
  const words = said.asks ? said.text : said.text === "Finished" ? project : [project, said.text].filter(Boolean).join(" · ");

  // What it waits on, said on the tile with what one press can do about it.
  const ask = t.status === "waiting" ? info.ask : undefined;
  const question = t.status === "waiting" && !ask ? info.question : undefined;
  const plan = t.status === "waiting" && !ask && !question ? info.plan : undefined;
  const shell = ask && (ask.tool === "Bash" || ask.tool === "shell" || ask.tool === "execute" || ask.tool === PR_TEST_TOOL);
  // A step that's high risk is held to allow in the session, and an add-on's card is read there: here they open it.
  const askHere = ask && ask.risk !== "high" && !ask.addon;
  const command = ask?.fields.find((f) => f.label === "Command" || f.label === "File")?.value;
  const first = question?.questions[0];
  // Only a question asked alone is answered here; several open the session, as a high-risk step or a plan does.
  const q = question?.questions.length === 1 ? first : undefined;
  const answer = (allow: boolean) => act(() => rpc("approval.answer", { threadId: t.id, itemId: ask!.id, allow }));
  const choose = (label: string) => act(() => rpc("question.answer", { threadId: t.id, itemId: question!.id, answers: { [q!.question]: label } }));

  const settle = () =>
    act(() =>
      rpc("thread.update", { id: t.id, done: true, unread: false }).then(() =>
        toast(`Settled ${t.title}`, { action: { label: "Undo", onClick: () => void rpc("thread.update", { id: t.id, done: false }).catch(fail) }, duration: 5000 }),
      ),
    );
  const retry = () => act(() => rpc("thread.send", { id: t.id, text: RETRY }));
  const fallback = t.status === "limited" ? info.limit?.fallback : undefined;

  // Writing to it: an answer to what it asks (a no with your reason, your own words for its question), else a message.
  const placeholder = askHere ? "Or tell it what to do instead" : q ? "Or answer in your own words" : t.status === "running" ? "Steer it, or ask something" : "Write to it";
  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    const go = askHere
      ? () => rpc("approval.answer", { threadId: t.id, itemId: ask!.id, allow: false, reason: text })
      : q && question
        ? () => rpc("question.answer", { threadId: t.id, itemId: question.id, answers: { [q.question]: text } })
        : () => rpc("thread.send", { id: t.id, text, mode: t.status === "running" ? "steer" : undefined });
    act(() => go().then(() => setDraft("")));
  };

  const live = t.status === "running";
  const write = picked && (t.status === "running" || t.status === "waiting" || kind === "working");
  useEffect(() => {
    if (!write) return;
    field(t.id, box.current);
    return () => field(t.id, null);
  }, [write]);
  // Anywhere on the tile does what its head does, except on its own controls and when you were selecting its words.
  const own = (e: PressEvent) => e.target instanceof Element && e.target.closest("button, a, input, textarea, select, label, [role='button']") !== null;
  const tileClick = (e: PressEvent) => {
    if (own(e) || String(window.getSelection() ?? "").trim()) return;
    picked ? onOpen(t.id) : onPick(t.id);
  };
  return (
    <article className="lc-wt" data-tile={t.id} data-kind={kind} data-picked={picked || undefined} aria-label={`${t.title}, ${seenAsk(t) ? "waits for your answer" : (markLabelOf(t, mark) ?? MARK_WORD[mark]).toLowerCase()}`} onClick={tileClick} onDoubleClick={(e) => !own(e) && onOpen(t.id)}>
      <button
        type="button"
        className="lc-wt-head l-focus"
        aria-pressed={picked}
        title={picked ? `Open it${n <= 9 ? ` (${n} or Enter)` : " (Enter)"}` : `Pick it${n <= 9 ? `, or press ${n} to open it` : ""}`}
        onClick={() => (picked ? onOpen(t.id) : onPick(t.id))}
        onDoubleClick={() => onOpen(t.id)}
      >
        {/* The sidebar's mark, in the mark's place: an answer you haven't read is fresh here as there, under Finished. */}
        <span className="lc-wt-mark">
          <SideMark state={mark} brand={ref ? markOf(ref) : undefined} label={seenAsk(t) ? "Waits for your answer" : markLabelOf(t, mark)} />
        </span>
        <span className="lc-wt-title">{t.title}</span>
        <span className="lc-wt-ago">{ago(t.updatedAt, now)}</span>
        {/* The key that opens it, after the time: the Wall's own, which no sidebar row has. */}
        <span className="lc-wt-n l-num" aria-hidden>
          {n <= 9 ? n : "·"}
        </span>
      </button>
      <div className="lc-wt-sub">
        <span className="lc-wt-said" data-tone={said.tone}>
          {!said.asks && project && <I.folder size={12} />}
          <span>{words}</span>
        </span>
        <span className="lc-sl-facts">
          <SideFacts branch={t.worktree?.branch} model={ref ? markOf(ref) : undefined} modelName={who} pr={t.pr && { number: t.pr.number, tone: prSaid(t.pr).num, said: prSaid(t.pr).text }} />
        </span>
      </div>

      <div className="lc-wt-body">
        {!loaded ? (
          <span className="lc-wt-wait l-shimmer">Reading its timeline</span>
        ) : (
          <>
            {/* The session's own live line (Timeline.tsx LiveLine): the same mark, step count, newest step and clock, and "Waiting for you" where its clock stopped. */}
            {kind !== "done" && <LiveLine threadId={t.id} items={items} className="lc-wt-ll" />}
            {t.status === "error" && <p className="lc-wt-error">{firstLine(info.error ?? "") || "It ran into a problem and stopped."}</p>}
            {t.status === "limited" && <p className="lc-wt-error" data-tone="warn">{firstLine(t.limit?.message ?? info.limit?.message ?? "") || "It reached its usage limit."}</p>}
            {ask && (
              <div className="lc-wt-card">
                <span className="lc-wt-lead">
                  <I.ask size={14} />
                  {shell ? "Wants to run" : "Asks before it goes on"}
                </span>
                {command ? <code className="lc-wt-cmd">{os.tilde(command)}</code> : <b className="lc-wt-what">{ask.title}</b>}
                {/* The agent's own words for what it does, when it gave any; else what Liner says of it. */}
                {(ask.says || ask.description) && <p className="lc-wt-why">{ask.says || ask.description}</p>}
                <div className="lc-wt-acts">
                  {askHere ? (
                    <>
                      <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={busy} onClick={() => answer(false)}>
                        Not this
                      </button>
                      <button type="button" className="lc-btn" data-kind="primary" data-size="sm" disabled={busy} onClick={() => answer(true)}>
                        {shell ? "Run it" : "Allow"}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => onOpen(t.id)}>
                      Open it
                    </button>
                  )}
                </div>
              </div>
            )}
            {question && (
              <div className="lc-wt-card">
                <span className="lc-wt-lead">
                  <I.comment size={14} />
                  {question.questions.length > 1 ? `Asks you ${question.questions.length} things` : "Asks you"}
                </span>
                {first ? <p className="lc-wt-q">{first.question}</p> : <p className="lc-wt-why">It's waiting on a question it didn't say.</p>}
                {q && q.options.length > 0 ? (
                  <div className="lc-wt-choices">
                    {q.options.slice(0, 4).map((o) => (
                      <button key={o.label} type="button" className="lc-wt-chip l-focus" title={o.description} disabled={busy} onClick={() => choose(o.label)}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  !q && (
                    <div className="lc-wt-acts">
                      <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => onOpen(t.id)}>
                        Open it
                      </button>
                    </div>
                  )
                )}
              </div>
            )}
            {plan && (
              <div className="lc-wt-card">
                <span className="lc-wt-lead">
                  <I.list size={14} />
                  Has a plan for you
                </span>
                <b className="lc-wt-what">{plan.title}</b>
                <div className="lc-wt-acts">
                  <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => onOpen(t.id)}>
                    Open it
                  </button>
                </div>
              </div>
            )}
            {t.status === "waiting" && !ask && !question && !plan && (
              <div className="lc-wt-card">
                <span className="lc-wt-lead">
                  <I.ask size={14} />
                  Needs you
                </span>
                <div className="lc-wt-acts">
                  <button type="button" className="lc-btn" data-kind="primary" data-size="sm" onClick={() => onOpen(t.id)}>
                    Open it
                  </button>
                </div>
              </div>
            )}
            {kind === "done" && <Done info={info} roomy={roomy} />}
          </>
        )}
      </div>

      <div className="lc-wt-foot">
        {kind === "done" ? (
          <>
            {info.files > 0 && (
              <>
                <Lines {...info.lines} />
                <span>{plural(info.files, "file")}</span>
              </>
            )}
            {/* The Reviewer's verdict in the words its switch in the session's bar and a turn's last line use. */}
            {t.verdict?.state === "verified" && (
              <span className="lc-wt-vf">
                <I.shield size={14} />
                Reviewer passed
              </span>
            )}
            {t.verdict?.state === "blocked" && (
              <span className="lc-wt-vf" data-tone="danger">
                <I.shield size={14} />
                Reviewer blocked it
              </span>
            )}
            <span className="lc-grow" />
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={busy} title="Out of the way, under Settled, until it's busy again" onClick={settle}>
              <I.settle size={14} />
              Settle
            </button>
          </>
        ) : t.status === "error" ? (
          <>
            <span className="lc-wt-note">Ran into a problem</span>
            <span className="lc-grow" />
            <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={busy} title={`Sends “${RETRY}”`} onClick={retry}>
              <I.refresh size={14} />
              Retry
            </button>
          </>
        ) : t.status === "limited" ? (
          <>
            <span className="lc-wt-note">{t.limit?.until && t.limit.until > now ? `Opens again at ${clock(t.limit.until, now)}` : "Waits for its plan's window"}</span>
            <span className="lc-grow" />
            {fallback && (
              <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={busy} title="Another tool takes over, with the conversation so far" onClick={() => act(() => rpc("thread.carryOn", { id: t.id, model: fallback }))}>
                Carry on with {modelLabel(fallback, providers)}
              </button>
            )}
          </>
        ) : write ? (
          // The reply is the box every place to write to an agent has (Composer.tsx SendBox): the field with the round Send in it, Stop while it works.
          <SendBox
            className="lc-wt-field"
            field={box}
            value={draft}
            onChange={setDraft}
            onSend={send}
            placeholder={placeholder}
            label={`Write to ${t.title}`}
            disabled={busy}
            stop={live ? { onStop: () => act(() => rpc("thread.stop", { id: t.id })) } : undefined}
            // Esc lets go of the field first; a second goes back (the Wall's keys).
            onEscape={() => box.current?.blur()}
          />
        ) : (
          // While the live line shows, it says the step count: the foot doesn't say it again.
          <span className="lc-wt-note l-num">{t.status === "running" ? (info.live ? "" : `${plural(info.count, "step")} this turn`) : kind === "working" ? `${plural(t.agentsAtWork ?? 0, "agent")} still at work in the background` : `Waiting since ${clock(info.since, now)}`}</span>
        )}
      </div>
    </article>
  );
});
