/*
  The picture model: a third role beside the lead and its sidekick. The lead designs; when a frame
  needs a picture it asks the picture model through Liner's design_picture tool, the way it asks
  its sidekick, and only when one is set up (Settings › Models › Pictures, an endpoint that speaks
  OpenAI's Images API) and you allow it (the design file's `pictures.ask`: before the first, before
  each, or never). You can also ask it yourself from a picture's Style tab.

  Here: the Settings section, the dock's "Pair + pictures" chip with who does what, a picture
  layer's Made by / Asked for at the top of Style (who made it, what it cost and took when the
  model said, the words, Make again, 3 more), the shimmer and the maker's tag on a picture being
  made, the dock's row while one is, and the rail's Picture tool (ask the model, a file, a picture
  of the project's). Who made an agent's picture comes from its design_picture call on the
  session's timeline; one you made here is marked on the element (data-by, data-prompt).
*/
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import type { DesignFile, DesignFrame, Item, PictureEndpoint, Rect } from "@contracts";
import { pictureKey } from "@contracts";
import { Segmented } from "@liner/components/segmented/segmented";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "../bridge";
import { getState, onStream, rpc, useEngine, useItems } from "../engine";
import { pairOf } from "../Crew";
import { I } from "../icons";
import { agentOf, duration, money } from "../model";
import { NamedSwitch, Pop, Row } from "../ui";
import { frames } from "./bridge";
import { Row as IRow, Section } from "./inspect/controls";
import { STYLE_TOP } from "./inspect/slots";
import type { Target } from "./inspect/target";
import { D, insert } from "./Rail";
import { design, getDesign, onCanvasEvent, useDesign } from "./store";
import "./ways.css";

const NONE: PictureEndpoint[] = [];
const usePictureModels = () => useEngine((s) => s.settings.pictures) ?? NONE;
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** The picture model this design file uses: its own choice (pictures.model), else Settings' first; null for "No one". */
let mockPick: string | null | undefined;
export function modelFor(file: DesignFile | undefined, models: PictureEndpoint[]): PictureEndpoint | null {
  const want = getDesign().mock && mockPick !== undefined ? mockPick : file?.pictures?.model;
  if (want === null) return null;
  return models.find((m) => m.id === want) ?? models[0] ?? null;
}
const useModelNow = () => {
  const models = usePictureModels();
  const file = useDesign((s) => s.file);
  return modelFor(file, models);
};
/** An old turn is shown (Versions): nothing is written until you go back to now. */
const shownOld = () => {
  if (getDesign().scrub === undefined) return false;
  toast("An old turn is shown", { description: "Go back to now to change the design." });
  return true;
};

/** Who leads this session, and its sidekick, by name. */
function whoOf(threadId?: string) {
  const e = getState();
  const t = threadId ? e.threads.find((x) => x.id === threadId) : undefined;
  if (!t) return { lead: getDesign().mock ? "Claude" : "The agent", side: undefined as string | undefined };
  const pair = pairOf(t, e.agents, e.providers);
  return { lead: pair?.lead ?? agentOf(t.agent, e.agents, e.providers).name, side: pair?.side };
}

// ---------- What is being made, and what was

type Making = { key: string; frame: string; node?: string; rect?: Rect; maker: string; asker: string; done: number; count: number; cost?: number };
type Made = { prompt: string; model: string; ms: number; cost?: number; asker: string; lean?: boolean };
let making: Record<string, Making> = {};
/** Pictures made here, by path from the design's folder ("assets/x.png"), for Made by. */
const made: Record<string, Made> = {};
/** "3 more": the other pictures of one ask, by the node they're for. */
let more: Record<string, { paths: string[]; cost?: number; ms: number }> = {};
const fns = new Set<() => void>();
const ping = () => fns.forEach((f) => f());
const sub = (f: () => void) => (fns.add(f), () => void fns.delete(f));
const useMaking = () => useSyncExternalStore(sub, () => making);
const useMore = () => useSyncExternalStore(sub, () => more);

// The engine says how a picture an agent asked for is coming along.
let heard = false;
function hearProgress() {
  if (heard) return;
  heard = true;
  onStream((e) => {
    if (e.type !== "pictures.progress") return;
    const k = `agent:${e.call}`;
    if (e.error || e.done >= e.count) {
      if (making[k]) {
        const { [k]: _gone, ...rest } = making;
        making = rest;
        ping();
      }
      return;
    }
    const was = making[k];
    if (was) making = { ...making, [k]: { ...was, done: e.done, count: e.count } };
    ping();
  });
}

/** A path from the design's folder, from what an element shows: "../assets/x.png" is "assets/x.png". */
const pathOf = (src?: string) => src?.replace(/^\.\.\//, "").replace(/^\.\//, "").split(/[?#]/)[0];
const attrOf = (html: string, name: string) => new RegExp(`^<[^>]*\\s${name}="([^"]*)"`, "i").exec(html)?.[1];
function srcOf(html: string) {
  return attrOf(html, "src") ?? /background-image:\s*url\(["']?([^"')]+)/i.exec(attrOf(html, "style") ?? "")?.[1];
}

/** An agent's design_picture call that made this picture: its words, model, time and cost. */
function fromTimeline(items: Item[], path: string): Made | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== "tool" || !/design_picture$/.test(it.tool) || !it.output?.includes(path)) continue;
    let prompt = "";
    try {
      prompt = String((JSON.parse(it.input ?? "{}") as { prompt?: unknown }).prompt ?? "");
    } catch {
      // no input to read
    }
    const m = /by (.+?) in ([\d.]+) s(?:, \$([\d.]+))?/.exec(it.output);
    return { prompt, model: m?.[1] ?? "the picture model", ms: m ? Number(m[2]) * 1000 : 0, cost: m?.[3] ? Number(m[3]) : undefined, asker: "lead" };
  }
  return undefined;
}

/** Asks the picture model for `count` pictures for a node, the size of its box; the first goes in, the rest are offered. */
async function makeFor(frame: string, node: { id: string; tag: string; rect: Rect }, prompt: string, count = 1, lean = true) {
  const s = getDesign();
  if (shownOld()) return;
  const e = modelFor(s.file, getState().settings.pictures ?? []);
  if (!e) return void toast("No one makes pictures for this design", { description: "Pick a picture model in the dock's Pictures menu, or add one in Settings › Models › Pictures." });
  if (!prompt.trim()) return void toast("Say what the picture shows first");
  if (s.mock || !s.cwd || !s.file || !s.threadId) return void toast("Pictures need a session", { description: "The sample canvas can't ask a picture model." });
  const key = `you:${frame}:${node.id}:${Date.now()}`;
  making = { ...making, [key]: { key, frame, node: node.id, rect: node.rect, maker: e.label || e.model, asker: "you", done: 0, count } };
  ping();
  try {
    const r = await rpc("pictures.make", { threadId: s.threadId, cwd: s.cwd, file: s.file.id, prompt: prompt.trim(), size: { w: Math.max(16, Math.round(node.rect.w)), h: Math.max(16, Math.round(node.rect.h)) }, count, model: e.id, ...(lean ? {} : { lean: false }) });
    const each = r.cost !== undefined ? r.cost / r.paths.length : undefined;
    for (const p of r.paths) made[p] = { prompt: prompt.trim(), model: e.label || e.model, ms: r.ms, cost: each, asker: "you", lean };
    if (count === 1) await placeIn(frame, node, r.paths[0], e.label || e.model, prompt.trim(), lean);
    else more = { ...more, [`${frame}:${node.id}`]: { paths: r.paths, cost: r.cost, ms: r.ms } };
  } catch (err) {
    toast.error((err as Error).message);
  } finally {
    const { [key]: _gone, ...rest } = making;
    making = rest;
    ping();
  }
}

/** Puts a picture in: an img's src, anything else's background, marked with who made it and the words. */
async function placeIn(frame: string, node: { id: string; tag: string }, src: string, by?: string, prompt?: string, lean = true) {
  if (shownOld()) return;
  const url = /^(data:|https?:|\.\.\/|\/)/.test(src) ? src : `../${src}`;
  // The same marks design_picture writes: who, the words, and data-lean="0" only when the lean's colours were left out.
  const marks = { "data-by": by ?? null, "data-prompt": prompt ?? null, "data-lean": by && !lean ? "0" : null };
  await design.apply(
    frame,
    node.tag.toLowerCase() === "img"
      ? [{ id: node.id, attr: { src: url, ...marks } }]
      : [{ id: node.id, style: { "background-image": `url(${url})`, "background-size": "cover", "background-position": "center" } }, { id: node.id, attr: marks }],
  );
}

// ---------- Your own: a file, or a picture of the project's

/** A picture from a file on this Mac: added to the design's assets (pictures.add), which says no to what isn't a picture. */
function fromFile(frame: string, node: { id: string; tag: string }) {
  if (shownOld()) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    const s = getDesign();
    if (s.mock || !s.cwd || !s.file) return void toast("Pictures need a design file", { description: "The sample canvas can't keep one." });
    const { cwd, file } = { cwd: s.cwd, file: s.file.id };
    const r = new FileReader();
    r.onload = () =>
      void rpc("pictures.add", { cwd, file, name: f.name, data: String(r.result) })
        .then((a) => placeIn(frame, node, a.path))
        .catch((e: Error) => toast.error(e.message));
    r.readAsDataURL(f);
  };
  input.click();
}

/** The project's pictures, to pick one: its path from the frame goes in (frames/ is four folders down). */
function ProjectPictures({ onPick }: { onPick: (path: string) => void }) {
  const cwd = useDesign((s) => s.cwd);
  const threadId = useDesign((s) => s.threadId);
  const project = useEngine((s) => s.projects.find((p) => p.path === cwd) ?? s.projects.find((p) => s.threads.some((t) => t.id === threadId && t.projectId === p.id)));
  const [q, setQ] = useState("");
  const [list, setList] = useState<string[] | null>(null);
  useEffect(() => {
    if (!project) return setList([]);
    let live = true;
    const t = setTimeout(() => {
      void rpc("fs.files", { projectId: project.id, threadId, query: q || undefined, limit: 400 })
        .then((r) => live && setList(r.map((x) => x.path).filter((p) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p) && !p.startsWith(".liner/")).slice(0, 40)))
        .catch(() => live && setList([]));
    }, 120);
    return () => ((live = false), clearTimeout(t));
  }, [project?.id, q]);
  return (
    <>
      <label className="lc-mp-find lc-who-find">
        <I.search size={13} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a picture" aria-label="Find a picture in the project" spellCheck={false} autoFocus />
      </label>
      <div className="ld-pic-list">
        {list === null && <p className="ld-note l-shimmer">Looking in the project</p>}
        {list?.length === 0 && <p className="ld-note">No pictures in the project{q ? " match that" : ""}.</p>}
        {list?.map((p) => <Row key={p} title={p.split("/").pop()} note={p} onPick={() => onPick(p)} />)}
      </div>
    </>
  );
}
const fromProject = (frame: string, node: { id: string; tag: string }, path: string) => placeIn(frame, node, `../../../../${path}`);

// ---------- A picture layer's Style: Made by, Asked for

function MadeBy({ t }: { t: Target }) {
  const threadId = useDesign((s) => s.threadId);
  const base = useDesign((s) => s.base);
  const items = useItems(threadId);
  const model = useModelNow();
  const moreNow = useMore();
  const busy = Object.values(useMaking()).some((m) => m.frame === t.frame && m.node === t.node.id);
  const src = srcOf(t.node.html);
  const path = pathOf(src);
  const info = useMemo(() => (path ? (made[path] ?? fromTimeline(items, path)) : undefined), [path, items, busy]);
  const by = attrOf(t.node.html, "data-by");
  const asked = info?.prompt || attrOf(t.node.html, "data-prompt") || "";
  const [words, setWords] = useState(asked);
  const [editing, setEditing] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => setWords(asked), [asked, t.node.id]);
  useEffect(() => {
    // The rail's "Ask the picture model" puts the caret here.
    if (want === "ask" && !asked) requestAnimationFrame(() => field.current?.focus());
    if (want === "project") setPicking(true);
    want = undefined;
  }, [t.node.id]);
  const who = whoOf(threadId);
  const maker = info?.model ?? by;
  const asker = info?.asker === "you" || (!info && by) ? "you" : who.lead;
  const node = { id: t.node.id, tag: t.node.tag, rect: t.node.rect };
  const alt = moreNow[`${t.frame}:${t.node.id}`];
  // Keep to the lean's colours: on unless the layer says it was made without them (data-lean="0").
  const lean = attrOf(t.node.html, "data-lean") !== "0";
  const setLean = (on: boolean) => {
    if (shownOld()) return;
    void design.apply(t.frame, [{ id: t.node.id, attr: { "data-lean": on ? null : "0" } }]);
  };
  return (
    <>
      <Section id="made-by" title="Made by" plain>
        <IRow>
          {maker ? (
            <span className="ld-pic-by">
              <span className="ld-way-tag">{maker}</span>
              <span className="ld-ell">asked by {asker === "you" ? "you" : asker}</span>
              <span className="lc-grow" />
              {info && (info.cost !== undefined || info.ms > 0) && <span className="ld-num">{[info.cost !== undefined ? money(info.cost) : "", info.ms > 0 ? duration(info.ms / 1000) : ""].filter(Boolean).join(" · ")}</span>}
            </span>
          ) : (
            <span className="ld-pic-by ld-q">{src ? "A picture of the design's own, not made by a model" : "No picture yet"}</span>
          )}
        </IRow>
      </Section>
      <Section id="asked-for" title="Asked for" plain>
        {editing || !asked ? (
          <textarea ref={field} className="lc-input ld-pic-ask" rows={4} value={words} placeholder={model ? "What the picture shows, its light and its style" : "No one makes pictures for this design"} onChange={(e) => setWords(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && model && void makeFor(t.frame, node, words, 1, lean)} />
        ) : (
          <button type="button" className="ld-pic-words l-focus" title="Change the words" onClick={() => (setEditing(true), requestAnimationFrame(() => field.current?.focus()))}>
            {words}
            <I.edit size={13} />
          </button>
        )}
        {model ? (
          <div className="ld-ck-acts">
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={busy || !words.trim()} onClick={() => void makeFor(t.frame, node, words, 1, lean)}>
              {src ? "Make again" : "Make it"}
            </button>
            <button type="button" className="lc-btn" data-kind="plain" data-size="sm" disabled={busy || !words.trim()} onClick={() => void makeFor(t.frame, node, words, 3, lean)}>
              3 more
            </button>
            {busy && <span className="ld-ck-q l-shimmer">Making</span>}
          </div>
        ) : (
          <p className="ld-note ld-pic-note">No one makes pictures for this design. The dock's Pictures menu picks a model.</p>
        )}
        {alt && (
          <div className="ld-pic-alt">
            <div className="ld-pic-alt-h">
              <span>3 more of the picture</span>
              {alt.cost !== undefined && <span className="ld-num">{money(alt.cost / alt.paths.length)} each</span>}
            </div>
            <div className="ld-pic-alt-row">
              {alt.paths.map((p) => (
                <button key={p} type="button" className="ld-pic-th l-focus" aria-label="Swap this one in" onClick={() => void placeIn(t.frame, node, p, made[p]?.model, made[p]?.prompt, made[p]?.lean ?? true)}>
                  <img src={`${base?.replace(/\/?$/, "/")}${p}`} alt="" />
                </button>
              ))}
            </div>
            <small className="ld-q">Press one to swap it in</small>
          </div>
        )}
      </Section>
      <Section id="pic-lean" title="From the lean" plain>
        <IRow>
          <span className="ld-pic-by">
            <span>Keep to the lean's colours</span>
            <span className="lc-grow" />
            <NamedSwitch name="Keep to the lean's colours" checked={lean} onCheckedChange={setLean} />
          </span>
        </IRow>
        <p className="ld-note ld-pic-note">{lean ? "The lean's palette goes with the ask, so the picture keeps to its colours." : "The next ask goes without the lean's palette."}</p>
      </Section>
      <Section id="pic-own" title="Or use your own" plain>
        <div className="ld-ck-acts">
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => fromFile(t.frame, node)}>
            From a file
          </button>
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" aria-expanded={picking} onClick={() => setPicking((x) => !x)}>
            From the project
          </button>
        </div>
        {picking && <ProjectPictures onPick={(p) => (setPicking(false), void fromProject(t.frame, node, p))} />}
      </Section>
    </>
  );
}
STYLE_TOP.push({ id: "made-by", kinds: ["image"], render: (t) => <MadeBy t={t} /> });

// ---------- The rail's Picture tool

let want: "ask" | "project" | undefined;
/** Into what's picked: an empty picture, then the words for the model, a file, or one of the project's. */
export function PictureTool() {
  const models = usePictureModels();
  const model = useModelNow();
  const add = async (then: (frame: string, node: { id: string; tag: string }) => void) => {
    await insert("picture");
    const s = getDesign();
    const at = s.sel[0];
    if (at?.node) then(at.frame, { id: at.node, tag: "img" });
  };
  return (
    <Pop label="Picture: into what's picked" side="left" width={260} triggerClass="lc-tb" triggerAttrs={{ title: "Picture: into what's picked" }} trigger={<D.picture />} menu>
      {(close) => (
        <>
          {model && <Row title="Ask the picture model" note={model.label || model.model} icon={<I.sparkle size={14} />} onPick={() => (close(), (want = "ask"), void add(() => {}))} />}
          <Row title="From a file" note="On this Mac" icon={<I.file size={14} />} onPick={() => (close(), void add((f, n) => fromFile(f, n)))} />
          <Row title="From the project" note="A picture it already has" icon={<I.folder size={14} />} onPick={() => (close(), (want = "project"), void add(() => {}))} />
          {!models.length && (
            <Row title="Add a picture model" note="Settings › Models › Pictures" icon={<I.plus size={14} />} onPick={() => (close(), window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "models" })))} />
          )}
        </>
      )}
    </Pop>
  );
}

// ---------- On the canvas: a picture being made shimmers, with its maker's tag

type BoxOf = (f: DesignFrame, r?: Rect) => { left: number; top: number; width: number; height: number };

/** An agent's design_picture calls running now that say where the picture goes. */
function useAgentMaking(threadId?: string) {
  const items = useItems(threadId);
  const models = usePictureModels();
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const running = useMemo(() => items.filter((it): it is Extract<Item, { kind: "tool" }> => it.kind === "tool" && it.status === "running" && /design_picture$/.test(it.tool)), [items]);
  const file = useDesign((s) => s.file);
  const list = running.flatMap((it) => {
    try {
      const into = (JSON.parse(it.input ?? "{}") as { into?: { frame?: string; id?: string } }).into;
      const f = into?.frame ? file?.frames.find((x) => x.id === into.frame || x.name.toLowerCase() === String(into.frame).toLowerCase()) : undefined;
      return [{ key: it.id, frame: f?.id, node: into?.id, maker: models[0]?.label || models[0]?.model || "The picture model" }];
    } catch {
      return [{ key: it.id, frame: undefined, node: undefined, maker: models[0]?.label || "The picture model" }];
    }
  });
  const want = list.map((x) => `${x.frame}:${x.node}`).join(",");
  useEffect(() => {
    for (const x of list) {
      if (!x.frame || !x.node || rects[`${x.frame}:${x.node}`]) continue;
      void frames.read(x.frame, x.node).then((n) => n && setRects((r) => ({ ...r, [`${x.frame}:${x.node}`]: n.rect })), () => {});
    }
  }, [want]);
  return list.map((x) => ({ ...x, rect: x.frame && x.node ? rects[`${x.frame}:${x.node}`] : undefined }));
}

export function PictureOver({ frames: onPage, boxOf }: { frames: DesignFrame[]; boxOf: BoxOf }) {
  hearProgress();
  const mine = useMaking();
  const threadId = useDesign((s) => s.threadId);
  const agent = useAgentMaking(threadId);
  const all = [...Object.values(mine).map((m) => ({ key: m.key, frame: m.frame, rect: m.rect, maker: m.maker })), ...agent];
  return (
    <>
      {all.map((m) => {
        const f = onPage.find((x) => x.id === m.frame);
        if (!f || !m.rect) return null;
        const b = boxOf(f, m.rect);
        return (
          <div key={m.key} className="ld-pic-making l-shimmer" style={b}>
            <span className="ld-ptag">{m.maker}</span>
          </div>
        );
      })}
    </>
  );
}

/** The dock's row while a picture is being made: who for whom, how far. */
export function PicturesRow() {
  hearProgress();
  const mine = useMaking();
  const threadId = useDesign((s) => s.threadId);
  const agent = useAgentMaking(threadId);
  const who = whoOf(threadId);
  const list = Object.values(mine);
  if (!list.length && !agent.length) return null;
  const one = list[0];
  const maker = one?.maker ?? agent[0].maker;
  const forWhom = one ? (one.asker === "you" ? "you" : one.asker) : who.lead;
  return (
    <div className="lc-trow ld-pic-row" role="status">
      <span className="ld-pd" aria-hidden />
      <span className="lc-trow-t">
        <b>{maker}</b> is making {one && one.count > 1 ? `${one.count} pictures` : "a picture"} for {forWhom}
        {one && one.count > 1 && <span className="ld-q"> {one.done} of {one.count}</span>}
      </span>
    </div>
  );
}

// ---------- The dock's chip: who does what

export function PicturesChip({ threadId }: { threadId: string }) {
  const models = usePictureModels();
  const file = useDesign((s) => s.file);
  const cwd = useDesign((s) => s.cwd);
  const mock = useDesign((s) => s.mock);
  const thread = useEngine((s) => s.threads.find((t) => t.id === threadId));
  useEngine((s) => s.providers);
  const who = whoOf(threadId);
  const [, redraw] = useState(0);
  // The model this file will really use: its own pick, else Settings' first; null when it's No one.
  const on = modelFor(file, models);
  const ask = file?.pictures?.ask ?? "first";
  const pair = Boolean(thread?.sidekick);
  const name = on ? (pair ? "Pair + pictures" : "With pictures") : "No pictures";
  /** The design file's pictures, saved (canvas.save), and the canvas reads the file again. */
  const save = (pictures: NonNullable<DesignFile["pictures"]>) => {
    if (shownOld()) return;
    if (mock) return ((mockPick = pictures.model), redraw((n) => n + 1));
    if (!file || !cwd) return;
    void rpc("canvas.save", { cwd, file: file.id, patch: { pictures } })
      .then(() => onCanvasEvent({ type: "canvas.changed", cwd, file: file.id, by: "you", at: Date.now() }))
      .catch((err: Error) => toast.error(err.message));
  };
  const pick = (model: string | null) => save({ ask, model });
  const setAsk = (v: "first" | "always" | "never") => save({ ask: v, model: file?.pictures?.model });
  return (
    <Pop label={`Who does what: ${name}`} side="top" width={360} triggerClass="lc-seg-b ld-pic-chip" trigger={<><span className="lc-chip-name">{name}</span><I.chevD size={11} /></>}>
      {() => (
        <div className="ld-pic-pop">
          <div className="ld-way-mh">Who does what</div>
          <div className="ld-pic-who">
            <span className="ld-pd" data-lead aria-hidden />
            <b>Lead</b>
            <span className="ld-ell">{who.lead}</span>
            <small>designs</small>
          </div>
          {who.side && (
            <div className="ld-pic-who">
              <span className="ld-pd" aria-hidden />
              <b>Sidekick</b>
              <span className="ld-ell">{who.side}</span>
              <small>small jobs</small>
            </div>
          )}
          <div className="ld-pic-who" data-on>
            <span className="ld-pd" data-pic aria-hidden />
            <b>Pictures</b>
            <span className="ld-ell">{on ? on.label || on.model : "No one"}</span>
            <small>{on ? `your ${host(on.url)} key` : "picture boxes stay empty"}</small>
          </div>
          {models.length > 0 && (
            <div role="group" aria-label="Pictures from">
              <div className="ld-way-mh">Pictures for this design from</div>
              {models.map((m) => (
                <Row key={m.id} title={m.label || m.model} note={host(m.url)} on={on?.id === m.id} onPick={() => pick(m.id)} />
              ))}
              <Row title="No one" note="picture boxes stay empty" on={!on} onPick={() => pick(null)} />
            </div>
          )}
          {on ? (
            <>
              <p className="ld-note ld-pic-note">
                {who.lead} designs but doesn't make pictures, so it asks {on.label || on.model} through Liner, the way it asks a sidekick.{" "}
                {ask === "never" ? "It doesn't ask you first." : ask === "always" ? "It asks you before each one." : "It asks you before the first one."}
              </p>
              <div className="ld-pic-askw">
                <Segmented size="sm" full value={ask} onValueChange={(v) => setAsk(v as "first" | "always" | "never")} aria-label="Ask me" options={[{ value: "first", label: "Ask first" }, { value: "always", label: "Ask each time" }, { value: "never", label: "Don't ask" }]} />
              </div>
            </>
          ) : models.length ? (
            <p className="ld-note ld-pic-note">No one makes pictures for this design: {who.lead} leaves picture boxes empty and nothing is charged.</p>
          ) : (
            <>
              <p className="ld-note ld-pic-note">{who.lead} designs but doesn't make pictures. Add a picture model and it can ask that one for them, the way it asks a sidekick; with none, picture boxes stay empty and nothing is charged.</p>
              <div className="ld-pic-askw">
                <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={() => window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "models" }))}>
                  <I.plus size={12} />
                  Add a picture model
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Pop>
  );
}

// ---------- Settings › Models › Pictures

type GroupT = ComponentType<{ title: string; note?: ReactNode; end?: ReactNode; children: ReactNode }>;
type FieldT = ComponentType<{ title: ReactNode; note?: ReactNode; children?: ReactNode; lead?: ReactNode }>;
const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** The picture models: listed with the others, added with an address, a key and a model. Settings.tsx passes its own Group and Field. */
export function PicturesSettings({ Group, Field }: { Group: GroupT; Field: FieldT }) {
  const list = usePictureModels();
  const [adding, setAdding] = useState(false);
  const remove = (e: PictureEndpoint) => {
    void rpc("settings.save", { pictures: list.filter((x) => x.id !== e.id) }).catch((err: Error) => toast.error(err.message));
    void bridge.keychainSet(`key:${pictureKey(e.id)}`, null).catch(() => {});
    void rpc("keys.set", { provider: pictureKey(e.id), key: null }).catch(() => {});
  };
  return (
    <Group
      title="Pictures"
      note="A model that makes pictures, for Liner Design: the lead designs and asks it for the pictures a frame needs, as it asks a sidekick. Any endpoint that speaks OpenAI's Images API."
      end={
        !adding && (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setAdding(true)}>
            <I.plus size={12} />
            Add a picture model
          </button>
        )
      }
    >
      {adding && <PictureForm taken={list} onDone={() => setAdding(false)} />}
      {list.map((e, i) => (
        <Field key={e.id} lead={<span className="lc-st-mark"><D.picture size={15} /></span>} title={<>{e.label || e.model}{i === 0 && list.length > 1 && <span className="ld-q"> · used first</span>}</>} note={`${e.model} · ${host(e.url)}`}>
          <button type="button" className="lc-ib l-focus" aria-label={`Remove ${e.label || e.model}`} title="Remove" onClick={() => remove(e)}>
            <I.trash size={13} />
          </button>
        </Field>
      ))}
      {!adding && !list.length && <p className="lc-st-none lc-quiet">None yet. With none, Liner Design's picture boxes stay empty and nothing is charged.</p>}
    </Group>
  );
}

function PictureForm({ taken, onDone }: { taken: PictureEndpoint[]; onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("https://api.openai.com/v1");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("gpt-image-1");
  const [busy, setBusy] = useState(false);
  const id = `pic-${slugOf(label || model)}`;
  const clash = taken.some((e) => e.id === id);
  const ok = Boolean(slugOf(label || model)) && !clash && /^https?:\/\//.test(url.trim()) && model.trim().length > 0;
  const add = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      if (key.trim()) {
        await bridge.keychainSet(`key:${pictureKey(id)}`, key.trim());
        await rpc("keys.set", { provider: pictureKey(id), key: key.trim() });
      }
      await rpc("settings.save", { pictures: [...taken, { id, label: label.trim() || model.trim(), url: url.trim(), model: model.trim() }] });
      toast.success(`Added ${label.trim() || model.trim()}`, { description: "The lead can ask it for pictures in Liner Design." });
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="lc-st-form">
      <div className="lc-st-form-g">
        <label>
          <span>Name</span>
          <input className="lc-input" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ChatGPT" aria-invalid={clash || undefined} />
        </label>
        <label>
          <span>Model</span>
          <input className="lc-input lc-mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-image-1" spellCheck={false} />
        </label>
        <label className="lc-st-form-w">
          <span>Address</span>
          <input className="lc-input lc-mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.openai.com/v1" spellCheck={false} />
        </label>
        <label className="lc-st-form-w">
          <span>Key</span>
          <input className="lc-input lc-mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Kept in the keychain" autoComplete="off" />
        </label>
      </div>
      <p className="lc-quiet lc-st-form-n">{clash ? "There's already a picture model by that name." : "Liner asks <address>/images/generations. The key goes only in that request's header, never to an agent."}</p>
      <div className="lc-st-form-f">
        <span className="lc-grow" />
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="lc-btn" data-kind="accent" data-size="sm" disabled={!ok || busy} onClick={() => void add()}>
          Add picture model
        </button>
      </div>
    </div>
  );
}

