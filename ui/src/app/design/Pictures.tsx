/*
  The picture model: a third role beside the lead and its sidekick. The lead designs; when a frame
  needs a picture it asks the picture model through Liner's design_picture tool, the way it asks
  its sidekick, and only when one is set up (Settings › Models › AI pictures, an endpoint that speaks
  OpenAI's Images API) and you allow it (the design file's `pictures.ask`: before the first, before
  each, or never). You can also ask it yourself from a picture's Style tab.

  Here: the Settings section, the AI pictures (a row of the box's + menu, and a chip after the +
  while a design file's choice isn't the default), a picture
  layer's Made by / Asked for at the top of Style (who made it, what it cost and took when the
  model said, the words in the message box's own field with its Send, 3 more like this), the shimmer and the maker's tag on a picture being
  made, the dock's row while one is, and the rail's Picture tool (ask the model, a file, a picture
  of the project's). Who made an agent's picture comes from its design_picture call on the
  session's timeline; one you made here is marked on the element (data-by, data-prompt).
*/
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import type { DesignFile, DesignFrame, Item, PictureEndpoint, Rect } from "@contracts";
import { pictureKey } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "../bridge";
import { getState, onStream, rpc, useEngine, useItems } from "../engine";
import { pairOf } from "../Crew";
import { I, StateMark } from "../icons";
import { agentOf, duration, money } from "../model";
import { NamedSwitch, Pop, Row } from "../ui";
import { PaneButton, PaneRow } from "../Pane";
import { SendBox } from "../Composer";
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
    return { prompt, model: m?.[1] ?? "the model for AI pictures", ms: m ? Number(m[2]) * 1000 : 0, cost: m?.[3] ? Number(m[3]) : undefined, asker: "lead" };
  }
  return undefined;
}

/** Asks the picture model for `count` pictures for a node, the size of its box; the first goes in, the rest are offered. */
async function makeFor(frame: string, node: { id: string; tag: string; rect: Rect }, prompt: string, count = 1, lean = true) {
  const s = getDesign();
  if (shownOld()) return;
  const e = modelFor(s.file, getState().settings.pictures ?? []);
  if (!e) return void toast("No AI pictures for this design", { description: "Pick a model in the dock's AI pictures menu, or add one in Settings › Agent tools › AI pictures. Your own image files always work." });
  if (!prompt.trim()) return void toast("Say what the picture shows first");
  if (s.mock || !s.cwd || !s.file) return void toast("AI pictures need a design file", { description: "The sample canvas can't ask a model for one." });
  // A design with no session yet gets its session here, as its first ask would.
  const threadId = s.threadId ?? (await design.session().catch(() => undefined));
  if (!threadId) return void toast("AI pictures need the design's session", { description: "Say something in the dock first." });
  const key = `you:${frame}:${node.id}:${Date.now()}`;
  making = { ...making, [key]: { key, frame, node: node.id, rect: node.rect, maker: e.label || e.model, asker: "you", done: 0, count } };
  ping();
  try {
    const r = await rpc("pictures.make", { threadId, cwd: s.cwd, file: s.file.id, prompt: prompt.trim(), size: { w: Math.max(16, Math.round(node.rect.w)), h: Math.max(16, Math.round(node.rect.h)) }, count, model: e.id, ...(lean ? {} : { lean: false }) });
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
        <I.search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a picture" aria-label="Find a picture in the project" spellCheck={false} autoFocus />
      </label>
      <div className="ld-pic-list">
        {list === null && <p className="ld-note l-shimmer">Looking in the project</p>}
        {list?.length === 0 && <p className="ld-note">No pictures in the project{q ? " match that" : ""}.</p>}
        {list?.map((p) => <Row key={p} title={p.split("/").pop()} which={p} whichPath onPick={() => onPick(p)} />)}
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
  const field = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => setWords(asked), [asked, t.node.id]);
  useEffect(() => {
    // The rail's "Ask for an AI picture" puts the caret here.
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
        {/* The message box's field and Send: Send makes the picture from these words (again, once it has one). Each Send costs
            money, so Enter is a new line and only ⌘Enter sends; with no model, or while one is made, only Send waits, never the words. */}
        <SendBox field={field} className="ld-pic-ask" lines={3} value={words} label="What the picture shows" placeholder={model ? "What the picture shows, its light and its style" : "No model for AI pictures yet"} enter="line" sendOff={!model || busy} onChange={setWords} onSend={() => void makeFor(t.frame, node, words, 1, lean)} />
        {model ? (
          // Three takes to choose from is another thing than Send, which makes one and puts it in: it keeps its own button.
          <div className="ld-ck-acts">
            <PaneButton disabled={busy || !words.trim()} onClick={() => void makeFor(t.frame, node, words, 3, lean)}>
              3 more like this
            </PaneButton>
            {busy && (
              <span className="ld-ck-q ld-pic-busy">
                <StateMark state="working" size={12} label="Making the picture" />
                Making
              </span>
            )}
          </div>
        ) : (
          <p className="ld-note ld-pic-note">No model makes AI pictures for this design. The dock's AI pictures menu picks one; your own image files always work.</p>
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
      {/* An action in a body is a row: From a file opens the Mac's picker, From the project opens its list under it. */}
      <Section id="pic-own" title="Or use your own" plain>
        <div className="ld-pic-own">
          <PaneRow icon={<I.file size={14} />} value="On this Mac" quiet opens onClick={() => fromFile(t.frame, node)}>
            From a file
          </PaneRow>
          <PaneRow icon={<I.folder size={14} />} value={picking ? "Hide" : undefined} quiet opens={!picking} onClick={() => setPicking((x) => !x)}>
            From the project
          </PaneRow>
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
          {model && <Row title="Ask for an AI picture" note={model.label || model.model} icon={<I.sparkle size={16} />} onPick={() => (close(), (want = "ask"), void add(() => {}))} />}
          <Row title="From a file" note="On this Mac" icon={<I.file size={16} />} onPick={() => (close(), void add((f, n) => fromFile(f, n)))} />
          <Row title="From the project" note="A picture it already has" icon={<I.folder size={16} />} onPick={() => (close(), (want = "project"), void add(() => {}))} />
          {!models.length && (
            <Row title="Add a model for AI pictures" note="Settings › Agent tools › AI pictures" icon={<I.plus size={16} />} onPick={() => (close(), window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "models" })))} />
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
      return [{ key: it.id, frame: f?.id, node: into?.id, maker: models[0]?.label || models[0]?.model || "The model for AI pictures" }];
    } catch {
      return [{ key: it.id, frame: undefined, node: undefined, maker: models[0]?.label || "The model for AI pictures" }];
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
          <div key={m.key} className="ld-pic-making" style={b}>
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
      <StateMark state="working" />
      <span className="lc-trow-t">
        <b>{maker}</b> is making {one && one.count > 1 ? `${one.count} pictures` : "a picture"} for {forWhom}
        {one && one.count > 1 && <span className="ld-q"> {one.done} of {one.count}</span>}
      </span>
    </div>
  );
}

// ---------- AI pictures: a row of the box's + menu, and a chip after the + once it isn't the default

/**
  The AI pictures where you are, for the + menu's row: the model's name ("No one" for none), and
  whether this design file's choice differs from the default (Settings' first model, asking before
  the first picture), which is when the box shows it as a chip too. Design Home has no file yet, so
  it never differs there.
*/
export function usePicturesNow(home?: boolean): { name: string; own: boolean } {
  const models = usePictureModels();
  const file = useDesign((s) => s.file);
  useDesign((s) => s.mock);
  const on = modelFor(home ? undefined : file, models);
  const ask = file?.pictures?.ask ?? "first";
  return { name: on ? on.label || on.model : "No one", own: !home && ((on?.id ?? null) !== (models[0]?.id ?? null) || (Boolean(on) && ask !== "first")) };
}

/** The chip after the +, shown while this design file's AI pictures aren't the default: it opens their panel. */
export function PicturesChip({ threadId, lead }: { threadId?: string; lead?: string }) {
  const { name: model } = usePicturesNow();
  const on = model !== "No one";
  const name = on ? `AI pictures: ${model}` : "No AI pictures";
  return (
    <Pop label={`${name}. Change it`} side="top" width={320} triggerClass="lc-seg-b ld-pic-chip" trigger={<><D.picture size={14} /><span className="lc-chip-name">{name}</span><I.chevD size={12} /></>}>
      {() => <PicturesPanel threadId={threadId} lead={lead} />}
    </Pop>
  );
}

/**
  Who makes AI pictures for this design file, picked from rows as the who panel's are (the lead and
  its sidekick are picked in who works, not here), and whether it asks you first. `lead`: who will
  lead, for a design with no session yet, named in the words. `home`: Design Home's, before there's
  a design file to pick for.
*/
export function PicturesPanel({ threadId, lead, home }: { threadId?: string; lead?: string; home?: boolean }) {
  const models = usePictureModels();
  const file = useDesign((s) => s.file);
  const cwd = useDesign((s) => s.cwd);
  const mock = useDesign((s) => s.mock);
  const thread = useEngine((s) => s.threads.find((t) => t.id === threadId));
  useEngine((s) => s.providers);
  const said = whoOf(threadId);
  const who = threadId || !lead ? said : { ...said, lead };
  const [, redraw] = useState(0);
  // The model this file will really use: its own pick, else Settings' first; null when it's No one.
  const on = modelFor(home ? undefined : file, models);
  const ask = file?.pictures?.ask ?? "first";
  void thread;
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
    <div className="ld-pic-pop">
      {models.length > 0 && !home ? (
        <div className="lc-who-scroll" role="group" aria-label="AI pictures for this design from">
          {models.map((m) => (
            <button key={m.id} type="button" className="lc-who-row l-focus" data-on={on?.id === m.id || undefined} aria-pressed={on?.id === m.id} onClick={() => pick(m.id)}>
              <I.sparkle size={14} />
              <span className="lc-who-row-t">{m.label || m.model}</span>
              <span className="lc-who-row-n">{host(m.url)}</span>
              {on?.id === m.id && <I.check size={16} className="lc-who-tick" />}
            </button>
          ))}
          <button type="button" className="lc-who-row l-focus" data-on={!on || undefined} aria-pressed={!on} onClick={() => pick(null)}>
            <span className="lc-who-row-t">No one</span>
            <span className="lc-who-row-n">No AI pictures</span>
            {!on && <I.check size={16} className="lc-who-tick" />}
          </button>
        </div>
      ) : (
        <div className="lc-who-row" aria-disabled>
          <I.sparkle size={14} />
          <span className="lc-who-row-t">{on ? on.label || on.model : "No one"}</span>
          <span className="lc-who-row-n">{on ? `your ${host(on.url)} key` : "optional"}</span>
        </div>
      )}
      <p className="ld-note ld-pic-note">This is only for pictures an AI makes from words. Your own image files always work: drop them on a frame or use the Picture tool.</p>
      {on ? (
        <>
          <p className="ld-note ld-pic-note">
            {who.lead} designs but doesn't make pictures, so it asks {on.label || on.model} through Liner, the way it asks a sidekick.
          </p>
          <div className="lc-team-lab">Before a picture</div>
          <div className="lc-who-scroll" role="group" aria-label="Before a picture">
            {(
              [
                ["first", "Ask me first", "Before the first one"],
                ["always", "Ask me each time", "Before each one"],
                ["never", "Don't ask", "It goes ahead"],
              ] as const
            ).map(([v, title, note]) => (
              <button key={v} type="button" className="lc-who-row l-focus" data-on={ask === v || undefined} aria-pressed={ask === v} onClick={() => setAsk(v)}>
                <span className="lc-who-row-t">{title}</span>
                <span className="lc-who-row-n">{note}</span>
                {ask === v && <I.check size={16} className="lc-who-tick" />}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="ld-note ld-pic-note">With no one here, {who.lead} leaves a labelled empty box where it would have asked for a picture, and nothing is charged.</p>
          {!models.length && (
            <button type="button" className="ld-pic-add l-focus" onClick={() => window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "models" }))}>
              <I.plus size={14} />
              Add a model for AI pictures
            </button>
          )}
        </>
      )}
    </div>
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
      title="AI pictures"
      note="Optional. A model that makes pictures from words, for Liner Design: the lead designs and asks it for the pictures a frame needs, as it asks a sidekick. Any endpoint that speaks OpenAI's Images API. Your own image files always work without one."
      end={
        !adding && (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => setAdding(true)}>
            <I.plus size={12} />
            Add a model for AI pictures
          </button>
        )
      }
    >
      {adding && <PictureForm taken={list} onDone={() => setAdding(false)} />}
      {list.map((e, i) => (
        <Field key={e.id} lead={<span className="lc-st-mark"><D.picture size={16} /></span>} title={<>{e.label || e.model}{i === 0 && list.length > 1 && <span className="ld-q"> · used first</span>}</>} note={`${e.model} · ${host(e.url)}`}>
          <button type="button" className="lc-ib l-focus" aria-label={`Remove ${e.label || e.model}`} title="Remove" onClick={() => remove(e)}>
            <I.trash size={14} />
          </button>
        </Field>
      ))}
      {!adding && !list.length && <p className="lc-st-none lc-quiet">None yet. With none, the lead leaves a labelled empty box where it would have asked for a picture, and nothing is charged. Your own image files always work.</p>}
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
      toast.success(`Added ${label.trim() || model.trim()}`, { description: "The lead can ask it for AI pictures in Liner Design." });
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
      <p className="lc-quiet lc-st-form-n">{clash ? "There's already a model for AI pictures by that name." : "Liner asks <address>/images/generations. The key goes only in that request's header, never to an agent."}</p>
      <div className="lc-st-form-f">
        <span className="lc-grow" />
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={onDone}>
          Cancel
        </button>
        {/* The form's one action is ink, as every form's is; accent is Send's alone. */}
        <button type="button" className="lc-btn" data-kind="ink" data-size="sm" disabled={!ok || busy} onClick={() => void add()}>
          Add a model for AI pictures
        </button>
      </div>
    </div>
  );
}

