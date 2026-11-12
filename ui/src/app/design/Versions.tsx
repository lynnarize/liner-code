/*
  Scrub the turns: the canvas's top row steps back through the copies the engine keeps of the
  design file (canvas.versions, by key): one at the end of each turn that changed it, and one
  "before" copy each time something is brought back. While a kept copy is shown the canvas only
  looks: every change refuses (store.scrub), and a bar over the canvas says which copy it is,
  with Bring this back (canvas.restore, which first keeps what's there now, so
  that can come back too: the toast's Undo brings that copy back) and Back to now.

  A kept turn's frames come from the engine's copy (canvas.version.read: its index and its drawn
  frames' HTML), shown in the file's place without writing anything. A copy that can't be read is
  still named and can be brought back; the canvas then keeps showing the file as it is now.
*/
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { CanvasVersion } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { onStream, rpc, useEngine } from "../engine";
import { I } from "../icons";
import { Pop, Row, Sep } from "../ui";
import * as os from "../os";
import { design, getDesign, onCanvasEvent, useDesign } from "./store";
import "./build.css";

const when = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });


/** What a kept copy is, in words: a turn, or what was there before a turn was brought back. */
export function nameOf(v: CanvasVersion) {
  // backKind: what was being brought back when the copy was taken; "before" means it was the undo of a bring-back.
  return v.kind === "before" ? (v.backKind === "before" ? "Before an undo" : v.back !== undefined ? `Before bringing back turn ${v.back}` : "Before a bring-back") : `Turn ${v.turn}`;
}

// The list is read again after a bring-back or its undo, without waiting for the event.
let relist = () => {};

/**
  Puts a kept copy back by its key and draws the file again from disk (the store's own reload, as
  canvas.changed does it, so the undo stack stays). Answers with the "before" copy the engine took
  of what was there.
*/
async function restoreKey(threadId: string, file: string, key: string) {
  const t0 = Date.now();
  await rpc("canvas.restore", { threadId, file, key });
  design.scrub(undefined);
  const cwd = getDesign().cwd;
  if (cwd) onCanvasEvent({ type: "canvas.changed", cwd, file, by: "you", at: Date.now() });
  const list = await rpc("canvas.versions", { threadId, file }).catch((): CanvasVersion[] => []);
  relist();
  return list.filter((x) => x.kind === "before" && x.at >= t0 - 1000).sort((a, b) => b.at - a.at)[0];
}

/**
  Bring this back, as one step on the canvas's undo stack: ⌘Z (or the toast's Undo, the same
  handle) brings back the "before" copy the engine just took, ⇧⌘Z brings the chosen copy back again.
*/
async function bringBack(threadId: string, file: string, v: CanvasVersion) {
  let before = await restoreKey(threadId, file, v.key);
  const step = design.record({
    label: `Bring back ${nameOf(v).toLowerCase()}`,
    undo: async () => {
      if (!before) return void toast.error("What was here before wasn't kept, so it can't come back.");
      await restoreKey(threadId, file, before.key);
      toast("Put back as it was", { duration: 2500 });
    },
    redo: async () => {
      before = await restoreKey(threadId, file, v.key);
    },
  });
  toast(v.kind === "before" ? "What was there is back" : `Turn ${v.turn} is back`, {
    description: `What was here before is kept too. ${os.mod}Z takes it back.`,
    duration: 8000,
    ...(before ? { action: { label: "Undo", onClick: () => step.undo() } } : {}),
  });
}

/** The top row's control: back and forward a kept copy, and the list of them, by key. */
export function Versions() {
  const threadId = useDesign((s) => s.threadId);
  const file = useDesign((s) => s.file?.id);
  const mock = useDesign((s) => s.mock);
  const scrub = useDesign((s) => s.scrub);
  const status = useEngine((s) => s.threads.find((t) => t.id === threadId)?.status);
  const [list, setList] = useState<CanvasVersion[]>([]);
  const [n, setN] = useState(0);
  const [shown, setShown] = useState(false);
  // Which copy is shown, by its key (two copies can share a turn number); the store only knows that one is.
  const [key, setKey] = useState<string | undefined>();
  useEffect(() => onStream((e) => void (e.type === "canvas.changed" && setN((x) => x + 1))), []);
  useEffect(() => {
    relist = () => setN((x) => x + 1);
    return () => void (relist = () => {});
  }, []);
  useEffect(() => {
    if (!threadId || !file || mock) return setList([]);
    let live = true;
    const t = window.setTimeout(() => void rpc("canvas.versions", { threadId, file }).then((v) => live && setList([...v].sort((a, b) => a.at - b.at)), () => live && setList([])), 400);
    return () => void ((live = false), clearTimeout(t));
  }, [threadId, file, mock, n, status]);
  // Another file, or another session: the canvas shows what's there now again.
  useEffect(() => () => design.scrub(undefined), [threadId, file]);
  useEffect(() => {
    if (scrub === undefined) setKey(undefined);
  }, [scrub]);
  // While a kept copy is shown, what could change the file can't be reached: the inspector, the dock (its send too), the rail, the bars on the canvas.
  useEffect(() => {
    const face = document.querySelector(".ld-face");
    const parts = [...document.querySelectorAll<HTMLElement>(".ld-insp-col, .ld-dock, .ld-rail")];
    const on = scrub !== undefined;
    face?.toggleAttribute("data-ld-scrub", on);
    for (const el of parts) el.inert = on;
    return () => {
      face?.removeAttribute("data-ld-scrub");
      for (const el of parts) el.inert = false;
    };
  }, [scrub]);
  if (!list.length || !threadId || !file) return null;
  const now = scrub === undefined ? undefined : list.find((v) => v.key === key);
  const at = now ? list.indexOf(now) : list.length;
  const look = async (i: number) => {
    if (i >= list.length) return design.scrub(undefined);
    const v = list[Math.max(0, i)];
    setKey(v.key);
    try {
      const got = await rpc("canvas.version.read", { threadId, file, key: v.key });
      setShown(true);
      return design.scrub(v.turn, got);
    } catch {
      // shown by name only
    }
    setShown(false);
    design.scrub(v.turn);
  };
  const busy = status === "running";
  return (
    <span className="ld-ver" role="group" aria-label="Kept copies of this design">
      <button type="button" className="lc-ib l-focus" aria-label="A copy back" title="A copy back" disabled={at <= 0 || busy} onClick={() => void look(at - 1)}>
        <I.chevL size={13} />
      </button>
      <Pop label={now ? `${nameOf(now)}: the kept copies` : "The design now: its kept copies"} width={280} align="end" triggerClass="ld-ver-t" trigger={<><I.clock size={13} /><span className="ld-num ld-ell">{now ? nameOf(now) : "Now"}</span></>} menu>
        {(close) => (
          <>
            <Row title="Now" note="As it is" on={!now} onPick={() => (close(), design.scrub(undefined))} />
            <Sep />
            {[...list].reverse().map((v) => (
              <Row key={v.key} title={nameOf(v)} note={`${when(v.at)} · ${v.frames} ${v.frames === 1 ? "frame" : "frames"}`} on={now?.key === v.key} disabled={busy} onPick={() => (close(), void look(list.indexOf(v)))} />
            ))}
          </>
        )}
      </Pop>
      <button type="button" className="lc-ib l-focus" aria-label="A copy forward" title="A copy forward" disabled={!now} onClick={() => void look(at + 1)}>
        <I.chevR size={13} />
      </button>
      {now && <ScrubBar v={now} shown={shown} threadId={threadId} file={file} />}
    </span>
  );
}

/** Over the canvas while a kept copy is shown: which one, and the two ways out. */
function ScrubBar({ v, shown, threadId, file }: { v: CanvasVersion; shown: boolean; threadId: string; file: string }) {
  const [host, setHost] = useState<Element | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setHost(document.querySelector(".ld-cv")), []);
  if (!host) return null;
  const back = async () => {
    setBusy(true);
    try {
      await bringBack(threadId, file, v);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div className="ld-scrub" role="status" data-ld-ui onPointerDown={(e) => e.stopPropagation()}>
      <I.clock size={14} />
      <span className="ld-ell">
        <b>{nameOf(v)}</b>
        {shown ? `, as it was at ${when(v.at)}. Looking only.` : `, kept at ${when(v.at)}, ${v.frames} ${v.frames === 1 ? "frame" : "frames"}. Bring it back to see it here.`}
      </span>
      <button type="button" className="lc-btn" data-size="sm" data-kind="ghost" onClick={() => design.scrub(undefined)}>
        Back to now
      </button>
      <button type="button" className="lc-btn" data-size="sm" data-kind="ink" disabled={busy} onClick={() => void back()}>
        Bring this back
      </button>
    </div>,
    host,
  );
}
