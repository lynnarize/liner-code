/*
  Build: frames turned into the project's code, and kept in step with it after. The engine knows
  each frame's state against its file (build.state: in step, design ahead with what changed, code
  ahead, not built); this file reads it while a design file is open, again after every change on
  the canvas and every few seconds (a project file changing says nothing to the canvas), and shows
  it in four places: the inspector's Build tab, its foot (the ink Build, where Commit is in Liner
  Code), a mark beside each frame's name on the canvas and in Layers, and the dock's head row when
  something waits to go to code.

  Every action is an ask to the session's agent, sent as a design turn so the engine's "## Design"
  note goes with it: Build names the frames and their paths and asks for design_built for each;
  Update code and Bring it into the frame carry only the difference, in one direction or the other.
*/
import { useEffect, useSyncExternalStore } from "react";
import type { DesignFrame, FrameBuild, ShownChip, Thread, UserShown } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { onStream, rpc, useEngine } from "../engine";
import { I } from "../icons";
import { agentOf } from "../model";
import { compareOn, openCompare } from "./Compare";
import { pendingCount, sendToCode } from "./Live";
import { blankHtml, design, getDesign, isGone, subscribeDesign, useDesign } from "./store";
import { FOOT } from "./inspect/slots";
import "./build.css";

// The builds of the open design file, by frame id.
let builds: Record<string, FrameBuild> = {};
let key = "";
const fns = new Set<() => void>();
const tell = () => fns.forEach((f) => f());
let timer = 0;
let asking = false;

/** Reads build.state again for the open design file (the mock has none). */
export async function refreshBuilds() {
  const s = getDesign();
  if (!s.cwd || !s.file || s.mock) {
    if (key) (builds = {}), (key = ""), tell();
    return;
  }
  if (asking) return;
  asking = true;
  const at = `${s.cwd}\n${s.file.id}`;
  try {
    const list = await rpc("build.state", { cwd: s.cwd, file: s.file.id });
    const now = getDesign();
    if (`${now.cwd}\n${now.file?.id}` !== at) return;
    const next: Record<string, FrameBuild> = {};
    // A frame whose file is gone has nothing to build or send: it's left out of every count and ask
    // (the engine says `missing`; the canvas's own flag counts until it does).
    for (const b of list) if (!(b as FrameBuild & { missing?: boolean }).missing && !isGone(now.file?.frames.find((f) => f.id === b.frame))) next[b.frame] = b;
    if (at !== key || JSON.stringify(next) !== JSON.stringify(builds)) {
      builds = next;
      key = at;
      tell();
    }
  } catch {
    // the next change or the next beat asks again
  } finally {
    asking = false;
  }
}

// Kept fresh while a design file is open: when it opens, on each canvas change, and every few seconds while the window is seen.
let watched = "";
let beat = 0;
let goneKey = "";
subscribeDesign(() => {
  const s = getDesign();
  const at = s.file && s.cwd ? `${s.cwd}\n${s.file.id}` : "";
  // A frame whose file went (or came back): its build is left out (or counted) at once.
  const gone = (s.file?.frames ?? []).filter((f) => isGone(f)).map((f) => f.id).join(",");
  if (gone !== goneKey) {
    goneKey = gone;
    const next = Object.fromEntries(Object.entries(builds).filter(([id]) => !gone.split(",").includes(id)));
    if (Object.keys(next).length !== Object.keys(builds).length) (builds = next), tell();
    if (at === watched) void refreshBuilds();
  }
  if (at === watched) return;
  watched = at;
  clearInterval(beat);
  if (!at) return void refreshBuilds();
  void refreshBuilds();
  beat = window.setInterval(() => document.visibilityState === "visible" && void refreshBuilds(), 4000);
});
onStream((e) => {
  if (e.type !== "canvas.changed") return;
  clearTimeout(timer);
  timer = window.setTimeout(() => void refreshBuilds(), 300);
});

const snapshot = () => builds;
/** Every frame's build, by frame id. */
export const useBuilds = () => useSyncExternalStore((f) => (fns.add(f), () => void fns.delete(f)), snapshot);

/** What changed, as lines (the engine's `changed`, without the line saying the file moved too). */
export const linesOf = (b?: FrameBuild) => (b?.changed ?? "").split("\n").map((l) => l.replace(/^[-·•]\s*/, "").trim()).filter((l) => l && !(b?.both && / changed too\.$/.test(l)));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
  What you read in the chat of an ask Liner writes (thread.send's `shown`): one short line, what kind of ask it is as a
  chip, and the frames it is about (the first three, then how many more). The agent gets the whole ask.
*/
export function shownAsk(text: string, chip: ShownChip, list: { name: string }[] = []): UserShown {
  const frames = list.slice(0, 3).map((f): ShownChip => ({ kind: "frame", label: f.name }));
  return { text, chips: [chip, ...frames, ...(list.length > 3 ? [{ kind: "frame" as const, label: `${list.length - 3} more` }] : [])] };
}
const many = (list: { name: string }[]) => (list.length === 1 ? list[0].name : plural(list.length, "frame"));
/** Update code: the frames ahead of their files, said as you'd say it. */
const updateShown = (list: { f: DesignFrame; b: FrameBuild }[]) =>
  shownAsk(list.length === 1 ? `Change ${list[0].b.file} to match ${list[0].f.name}` : `Change the code to match ${many(list.map((x) => x.f))}`, { kind: "build", label: "Update the code" }, list.map((x) => x.f));
/** Build: the frames to build into the code. */
const buildShown = (list: DesignFrame[]) => shownAsk(`Build ${many(list)} into the code`, { kind: "build", label: list.length === 1 ? "Build 1 frame" : `Build ${list.length} frames` }, list);

/**
  Sends an ask to the session's agent as a design turn (the engine adds the design file's note).
  Queued behind a turn that runs, as the dock's own messages are. `shown`: what you read of it in the chat.
*/
export async function askAgent(text: string, said = "Sent to the agent", shown?: UserShown) {
  const s = getDesign();
  if (!s.file) return void toast.error("Open a design file first");
  if (s.scrub !== undefined) return void toast("Back to now first", { description: "A kept turn is only looked at.", duration: 2500 });
  if (s.mock) return void toast(said, { description: text.split("\n")[0], duration: 2500 });
  try {
    // A design with no session yet gets it here, begun from this design.
    const id = await design.session();
    if (!id) return void toast.error("Open the design's session first");
    await rpc("thread.send", { id, text, mode: "queue", design: { file: s.file.id }, ...(shown ? { shown } : {}) });
    toast(said, { duration: 2000 });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

const sizeOf = (f: DesignFrame) => `${f.w} × ${f.h}`;
const where = (f: DesignFrame) => `.liner/designs/${getDesign().file?.id}/${f.path ?? `frames/${f.id}.html`}`;

/** Build: the frames named, into the project's code, each recorded with design_built. */
export function buildAsk(list: DesignFrame[]) {
  const file = getDesign().file;
  const lines = list.map((f) => `- ${f.name} (${where(f)}, ${sizeOf(f)})`);
  return [
    `Build ${list.length === 1 ? "this frame" : "these frames"} of the design file “${file?.title}” into the project's code:`,
    ...lines,
    "",
    "Read the lean first and follow it, and write each one the way the project's code already works: its framework, its components, its styles. Put each screen where it belongs in the project.",
    `When a frame is built, call design_built with the frame and the file you wrote, so Liner keeps ${list.length === 1 ? "it" : "them"} in step with the code.`,
  ].join("\n");
}

/** Update code: only what the frame changed since it was built, into its file. */
export function updateAsk(list: { f: DesignFrame; b: FrameBuild }[]) {
  const parts = list.map(({ f, b }) => [`${f.name} (${where(f)}) changed since it was built as ${b.file}. Change only this in ${b.file}:`, ...linesOf(b).map((l) => `- ${l}`)].join("\n"));
  return [...parts, "", "Leave the rest of each file as it is. Then call design_built for each frame with its file, so they're in step again."].join("\n\n").replace(/\n\n\n/g, "\n\n");
}

/** Bring it into the frame: what the file changed since the build, into the frame. */
export function bringAsk(f: DesignFrame, b: FrameBuild) {
  return [
    `${b.file} changed after ${f.name} was built from it${b.changed ? `: ${b.changed.split("\n")[0].replace(/\.$/, "")}` : ""}.`,
    `Look at what changed in ${b.file} since then (git can show it) and bring only that into the frame, ${where(f)}. Keep the frame's data-l ids, and leave the rest of it as it is.`,
    `Then call design_built for ${f.name} with ${b.file}, so they're in step again.`,
  ].join("\n");
}

const STATE: Record<FrameBuild["state"], string> = { step: "In step", "design-ahead": "Design ahead", "code-ahead": "Code ahead", none: "Not built" };

/** The state's mark: a tick, an arrow towards the code, one back from it, a ring. */
export function StateIcon({ state, size = 13 }: { state: FrameBuild["state"]; size?: number }) {
  if (state === "step") return <I.check size={size} />;
  if (state === "design-ahead") return <I.forward size={size} />;
  if (state === "code-ahead") return <I.back size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <circle cx="8" cy="8" r="4.25" />
    </svg>
  );
}

/** Not a screen (a brand board, a reference sheet): never built. build.state says so once read; the frame's own mark until then. */
export const notScreen = (f: DesignFrame, b?: FrameBuild) => (b ? b.screen === false : f.screen === false);

/** Marks a frame as not for code, or as a screen again (canvas.save's frame patch); refused while an old turn is shown. */
export async function setScreen(f: DesignFrame, screen: boolean) {
  const s = getDesign();
  if (!s.cwd || !s.file || s.mock) return;
  if (s.scrub !== undefined) return void toast("Back to now first", { description: "A kept turn is only looked at.", duration: 2500 });
  try {
    await rpc("canvas.save", { cwd: s.cwd, file: s.file.id, patch: { frames: [{ id: f.id, screen }] } });
    await refreshBuilds();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

/** Beside a frame's name on the canvas: In step, 3 ahead, Code ahead, Not built, Not for code. */
export function FrameMark({ frame }: { frame: DesignFrame }) {
  const b = useBuilds()[frame.id];
  if (frame.kind === "live" || !b) return null;
  if (notScreen(frame, b)) return <span className="ld-bmark" data-state="sheet" title="Not a screen: Build leaves it out">Not for code</span>;
  const n = linesOf(b).length;
  const text = b.state === "design-ahead" ? (n ? `${n} ahead` : "Design ahead") : STATE[b.state];
  return (
    <span className="ld-bmark" data-state={b.state} title={b.file ? `${STATE[b.state]}: ${b.file}` : STATE[b.state]}>
      {b.state !== "none" && <StateIcon state={b.state} size={12} />}
      {text}
    </span>
  );
}

/** In Layers, on a frame's row: the same mark, as its icon alone. */
export function LayerMark({ frame }: { frame: DesignFrame }) {
  const b = useBuilds()[frame.id];
  if (frame.kind === "live") return <span className="ld-bdot" aria-label="The running app" title="The running app, live" />;
  if (!b || b.state === "none") return null;
  return (
    <span className="ld-bmark ld-bmark-i" data-state={b.state} aria-label={STATE[b.state]} title={b.file ? `${STATE[b.state]}: ${b.file}` : STATE[b.state]}>
      <StateIcon state={b.state} size={13} />
    </span>
  );
}

/** One built frame in the Build tab: its name and state, its file, what changed, and what to do. */
function Built({ f, b }: { f: DesignFrame; b: FrameBuild }) {
  const lines = linesOf(b);
  const comparing = useSyncExternalStore(compareOn.sub, () => compareOn.frame() === f.id);
  return (
    <section className="ld-bt" data-state={b.state}>
      <div className="ld-bt-h">
        <span className="ld-bt-i" data-state={b.state}>
          <StateIcon state={b.state} size={14} />
        </span>
        <button type="button" className="ld-bt-n l-focus" onClick={() => design.select([{ frame: f.id }])}>
          {f.name}
        </button>
        <span className="ld-bt-s">{STATE[b.state]}</span>
      </div>
      {b.file && <div className="ld-bt-f">{b.file}</div>}
      {b.state === "design-ahead" && lines.length > 0 && (
        <ul className="ld-bt-l">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
          {b.both && <li data-warn>{b.file} changed too: Update code keeps the file's own change.</li>}
        </ul>
      )}
      {b.state === "code-ahead" && b.changed && <ul className="ld-bt-l"><li>{b.changed}</li></ul>}
      <div className="ld-bt-a">
        {b.state === "design-ahead" && (
          <button type="button" className="lc-btn" data-size="sm" onClick={() => void askAgent(updateAsk([{ f, b }]), "Sent: update the code", updateShown([{ f, b }]))}>
            Update code
          </button>
        )}
        {b.state === "code-ahead" && (
          <button type="button" className="lc-btn" data-size="sm" onClick={() => void askAgent(bringAsk(f, b), "Sent: bring it into the frame", shownAsk(`Bring what changed in ${b.file} into ${f.name}`, { kind: "build", label: "Bring into the frame" }, [f]))}>
            Bring it into the frame
          </button>
        )}
        {b.state !== "none" && (
          <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" aria-pressed={comparing} onClick={() => openCompare(comparing ? undefined : f.id)}>
            {comparing ? "Stop comparing" : "Compare with the app"}
          </button>
        )}
      </div>
    </section>
  );
}

/** The Build tab: every drawn frame of the file against its file, built ones first. */
export function BuildTab() {
  const file = useDesign((s) => s.file);
  const mock = useDesign((s) => s.mock);
  const builds = useBuilds();
  // Read so a frame drawn into for the first time joins the counts.
  useDesign((s) => s.html);
  const cwd = useDesign((s) => s.cwd);
  const project = useEngine((s) => s.projects.find((p) => p.path === cwd)?.name);
  useEffect(() => void refreshBuilds(), []);
  if (!file) return <div className="ld-body"><div className="ld-bt-empty">Open a design file to build it.</div></div>;
  // A frame whose file is gone has nothing to build.
  // A frame whose file is gone, or with nothing in it yet, has nothing to build.
  const drawn = file.frames.filter((f) => f.kind === "drawn" && !isGone(f) && !blankHtml(getDesign().html[f.id]));
  const live = file.frames.filter((f) => f.kind === "live").length;
  const built = drawn.filter((f) => builds[f.id] && builds[f.id].state !== "none");
  const order: FrameBuild["state"][] = ["step", "design-ahead", "code-ahead"];
  built.sort((a, b) => order.indexOf(builds[a.id].state) - order.indexOf(builds[b.id].state));
  const sheets = drawn.filter((f) => !built.includes(f) && notScreen(f, builds[f.id]));
  const rest = drawn.filter((f) => !built.includes(f) && !sheets.includes(f));
  const last = Math.max(0, ...built.map((f) => file.frames.find((x) => x.id === f.id)?.built?.turn ?? 0));
  return (
    <div className="ld-body ld-build">
      <div className="ld-bt-top">
        <I.folder size={15} />
        <b className="ld-ell">{project ?? file.title}</b>
        <span>{built.length ? (last ? `built in turn ${last}` : `${plural(built.length, "frame")} built`) : "nothing built yet"}</span>
      </div>
      {mock && <div className="ld-bt-empty">The mock has no project files: build states come from the engine.</div>}
      {built.map((f) => (
        <Built key={f.id} f={f} b={builds[f.id]} />
      ))}
      {rest.length > 0 && (
        <section className="ld-bt" data-state="none">
          <div className="ld-bt-h">
            <span className="ld-bt-i" data-state="none">
              <StateIcon state="none" size={14} />
            </span>
            <span className="ld-bt-n">{rest.length === 1 ? rest[0].name : built.length ? `${plural(rest.length, "more frame")}` : plural(rest.length, "frame")}</span>
            <span className="ld-bt-s">Not built</span>
          </div>
          <ul className="ld-bt-rows">
            {rest.map((f) => (
              <li key={f.id}>
                {rest.length > 1 && <span className="ld-ell">{f.name}</span>}
                <button type="button" className="ld-live-lk l-focus" aria-label={`${f.name}: not for code`} title={`${f.name} isn't a screen of the app: Build leaves it out`} onClick={() => void setScreen(f, false)}>
                  Not for code
                </button>
              </li>
            ))}
          </ul>
          <div className="ld-bt-a">
            <button type="button" className="lc-btn" data-size="sm" onClick={() => void askAgent(buildAsk(rest), "Sent: build them", buildShown(rest))}>
              {rest.length === 1 ? "Build it" : "Build them"}
            </button>
          </div>
        </section>
      )}
      {sheets.length > 0 && (
        <section className="ld-bt" data-state="none">
          <div className="ld-bt-h">
            <span className="ld-bt-i" data-state="none" aria-hidden>
              <I.page size={14} />
            </span>
            <span className="ld-bt-n">{sheets.length === 1 ? sheets[0].name : plural(sheets.length, "frame")}</span>
            <span className="ld-bt-s">Not for code</span>
          </div>
          <p className="ld-bt-p">{sheets.length === 1 ? "A reference, not a screen of the app: Build leaves it out." : `${sheets.map((f) => f.name).join(", ").replace(/, ([^,]*)$/, " and $1")}: references, not screens of the app. Build leaves them out.`}</p>
          <ul className="ld-bt-rows">
            {sheets.map((f) => (
              <li key={f.id}>
                {sheets.length > 1 && <span className="ld-ell">{f.name}</span>}
                <button type="button" className="ld-live-lk l-focus" aria-label={`${f.name}: this is a screen`} onClick={() => void setScreen(f, true)}>
                  This is a screen
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {live > 0 && <p className="ld-bt-p ld-bt-live">{plural(live, "live frame")} {live === 1 ? "is" : "are"} the running app itself: {live === 1 ? "its" : "their"} changes go to code from the dock.</p>}
      {!drawn.length && !live && <div className="ld-bt-empty">No frames yet. Draw one, or ask in the dock.</div>}
    </div>
  );
}

/** The inspector's foot: what waits to go to code, and the one ink action for it. */
function BuildFoot() {
  const file = useDesign((s) => s.file);
  const sel = useDesign((s) => s.sel);
  const waiting = useDesign(pendingCount);
  const builds = useBuilds();
  // Read so a frame drawn into for the first time joins the counts.
  useDesign((s) => s.html);
  if (!file) return null;
  // A frame whose file is gone has nothing to build.
  // A frame whose file is gone, or with nothing in it yet, has nothing to build.
  const drawn = file.frames.filter((f) => f.kind === "drawn" && !isGone(f) && !blankHtml(getDesign().html[f.id]));
  if (waiting) {
    return (
      <div className="ld-bfoot">
        <span>{plural(waiting, "change")} waiting</span>
        <button type="button" className="lc-btn" data-kind="ink" onClick={() => void sendToCode()}>
          Send to code
        </button>
      </div>
    );
  }
  const ahead = drawn.filter((f) => builds[f.id]?.state === "design-ahead").map((f) => ({ f, b: builds[f.id] }));
  if (ahead.length) {
    const n = ahead.reduce((k, x) => k + Math.max(1, linesOf(x.b).length), 0);
    return (
      <div className="ld-bfoot">
        <span>{plural(n, "change")} to send</span>
        <button type="button" className="lc-btn" data-kind="ink" onClick={() => void askAgent(updateAsk(ahead), "Sent: update the code", updateShown(ahead))}>
          Update code
        </button>
      </div>
    );
  }
  const screens = drawn.filter((f) => !notScreen(f, builds[f.id]));
  const none = screens.filter((f) => !builds[f.id] || builds[f.id].state === "none");
  const picked = screens.filter((f) => sel.some((x) => x.frame === f.id));
  // Nothing to send: every screen built and none ahead. The button goes quiet and says so; it wakes
  // as soon as a frame is ahead or not built. Code ahead is the Build tab's (bring it into the frame).
  const codeAhead = screens.filter((f) => builds[f.id]?.state === "code-ahead").length;
  if (screens.length && !none.length) {
    return (
      <div className="ld-bfoot">
        <span>{codeAhead ? `Code is ahead in ${plural(codeAhead, "frame")}: see Build` : "Every frame is in step"}</span>
        <button type="button" className="lc-btn" disabled title="Nothing to send: every frame is in step with its file">
          All in step
        </button>
      </div>
    );
  }
  const which = none.length ? none : picked.length ? picked : screens;
  const note = !screens.length ? "No screens to build yet" : none.length === screens.length ? `${plural(screens.length, "frame")}, none built yet` : `${plural(none.length, "frame")} not built`;
  return (
    <div className="ld-bfoot">
      <span>{note}</span>
      <button type="button" className="lc-btn" data-kind="ink" disabled={!which.length} title={which.length ? `Build ${which.map((f) => f.name).join(", ")}` : undefined} onClick={() => void askAgent(buildAsk(which), "Sent: build", buildShown(which))}>
        Build
      </button>
    </div>
  );
}

// The foot is the inspector's slot: one entry, kept once across reloads of this module.
{
  const i = FOOT.findIndex((x) => x.id === "build");
  const entry = { id: "build", render: () => <BuildFoot /> };
  if (i >= 0) FOOT[i] = entry;
  else FOOT.push(entry);
}

/**
  The dock's head row when nothing runs and something waits for the code, as the tray says what
  waits to be committed in Liner Code: a live frame's changes held, else a frame ahead of its file.
*/
export function WaitRow({ thread }: { thread: Thread }) {
  const file = useDesign((s) => s.file);
  const waiting = useDesign(pendingCount);
  const builds = useBuilds();
  // Read so a frame drawn into for the first time joins the counts.
  useDesign((s) => s.html);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  if (!file || thread.status === "running") return null;
  if (waiting) {
    return (
      <div className="lc-trow ld-wait" role="status">
        <span className="ld-bdot" aria-hidden />
        <span className="lc-trow-t">
          <b>Live</b> from the Browser panel's server
        </span>
        <span className="lc-grow" />
        <span className="ld-q">{plural(waiting, "change")} waiting</span>
        <button type="button" className="lc-trow-lk l-focus" onClick={() => void sendToCode()}>
          Send to code
        </button>
      </div>
    );
  }
  const ahead = file.frames.filter((f) => !isGone(f) && builds[f.id]?.state === "design-ahead");
  if (!ahead.length) return null;
  const one = ahead[0];
  const n = linesOf(builds[one.id]).length;
  const who = agentOf(thread.agent, agents, providers).name;
  return (
    <div className="lc-trow ld-wait" role="status">
      <span className="ld-bmark ld-bmark-i" data-state="design-ahead" aria-hidden>
        <I.forward size={14} />
      </span>
      <span className="lc-trow-t">{ahead.length === 1 ? `${one.name} is ${n ? plural(n, "change") : "a change"} ahead of the code` : `${plural(ahead.length, "frame")} are ahead of the code`}</span>
      <span className="lc-grow" />
      <button type="button" className="lc-trow-lk l-focus" title={`Ask ${who} to change only what differs`} onClick={() => void askAgent(updateAsk(ahead.map((f) => ({ f, b: builds[f.id] }))), "Sent: update the code", updateShown(ahead.map((f) => ({ f, b: builds[f.id] }))))}>
        Update code
      </button>
    </div>
  );
}

