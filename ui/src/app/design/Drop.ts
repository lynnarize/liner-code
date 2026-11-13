/*
  Your own picture files, dropped on the canvas. Each goes into the design's assets/ through
  pictures.add (as the Picture tool's "From a file" does), which says no, in its own sentence, to
  what isn't a picture or is too big. Where it lands:
  - on a picture layer that's picked: that layer's picture is replaced;
  - on a frame: a picture layer at the drop point, its own size (no wider than most of the frame);
  - on the empty canvas: a new frame the picture's size, with the picture in it.
  However many files, a drop is one step to undo.
*/
import type { DesignFrame, FrameOp } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc } from "../engine";
import { frames } from "./bridge";
import { design, getDesign, isGone } from "./store";

/** A drag carrying files from outside (not a layer, not words). */
export const carriesFiles = (e: { dataTransfer: DataTransfer | null }) => Boolean(e.dataTransfer?.types.includes("Files"));

const read = (f: File) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error ?? new Error(`${f.name} couldn't be read.`));
    r.readAsDataURL(f);
  });
const sizeOf = (url: string) =>
  new Promise<{ w: number; h: number }>((ok) => {
    const img = new Image();
    img.onload = () => ok({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
    img.onerror = () => ok({ w: 400, h: 300 });
    img.src = url;
  });
const id = () => `x${Math.random().toString(36).slice(2, 8)}`;
const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Each file read here first (its picture and its size), so nothing is written for a place that can't take it. */
async function readAll(list: File[]) {
  const out: { f: File; data: string; w: number; h: number }[] = [];
  for (const f of list) {
    try {
      const data = await read(f);
      out.push({ f, data, ...(await sizeOf(data)) });
    } catch (e) {
      toast.error(`${f.name} wasn't added`, { description: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
/** One file into the design's assets: its path, or undefined with the engine's refusal said as it comes. */
async function put(cwd: string, file: string, r: { f: File; data: string }) {
  try {
    return (await rpc("pictures.add", { cwd, file, name: r.f.name, data: r.data })).path;
  } catch (e) {
    toast.error(`${r.f.name} wasn't added`, { description: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}
/** What the engine takes as a frame's side (canvas.frame.add): 40 to 8000 px. */
const side = (n: number) => Math.min(8000, Math.max(40, Math.round(n)));

/** Drops `files` at the canvas point `at` (in the canvas's own units), on `frame` when it's over one. */
export async function dropFiles(files: FileList | File[], at: { x: number; y: number }, frame?: DesignFrame) {
  const s = getDesign();
  const list = [...files];
  if (!list.length) return;
  if (s.mock || !s.cwd || !s.file) return void toast("Pictures need a design file", { description: "The sample canvas can't keep one." });
  if (s.scrub !== undefined) return void toast("An old turn is shown", { description: "Go back to now to change the design." });
  if (frame?.kind === "live") return void toast("A live page can't take a picture", { description: "Drop it on a drawn frame, or on the empty canvas for a frame of its own." });
  if (frame && isGone(frame)) return void toast(`Nothing can be added to ${frame.name}`, { description: `Its file is gone (${frame.path ?? `frames/${frame.id}.html`}).` });
  const files_ = await readAll(list);
  if (!files_.length) return;
  const src = (p: string) => `../${p}`;
  const cwd = s.cwd;
  const fid = s.file.id;

  if (frame) {
    // Where they go is known before anything is written.
    if (!getDesign().tree[frame.id]) await design.refreshTree(frame.id);
    const body = getDesign().tree[frame.id];
    if (!body) return void toast.error(`${frame.name} can't be read just now, so nothing was added to it.`);
    const got: { name: string; path: string; w: number; h: number }[] = [];
    for (const r of files_) {
      const path = await put(cwd, fid, r);
      if (path) got.push({ name: r.f.name, path, w: r.w, h: r.h });
    }
    if (!got.length) return;
    const x = Math.round(at.x - frame.x);
    const y = Math.round(at.y - frame.y);
    // On a picked picture layer: its picture is replaced (the first file; the rest go in beside it).
    const hit = await frames.hit(frame.id, x, y).catch(() => null);
    const picked = hit?.node && hit.node.kind === "image" && getDesign().sel.some((p) => p.frame === frame.id && p.node === hit.node!.id) ? hit.node : undefined;
    const ops: FrameOp[] = [];
    let rest = got;
    if (picked) {
      const read = await frames.read(frame.id, picked.id).catch(() => undefined);
      const tag = /^<(\w+)/.exec(read?.html ?? "")?.[1] ?? "img";
      ops.push(tag.toLowerCase() === "img" ? { id: picked.id, attr: { src: src(got[0].path) } } : { id: picked.id, style: { "background-image": `url(${src(got[0].path)})`, "background-size": "cover", "background-position": "center" } });
      rest = got.slice(1);
    }
    const made: string[] = [];
    rest.forEach((p, i) => {
      const w = Math.min(p.w, Math.round(frame.w * 0.6));
      const n = id();
      made.push(n);
      ops.push({ into: body.id, insert: `<img data-l="${n}" src="${attr(src(p.path))}" alt="${attr(p.name.replace(/\.[^.]+$/, ""))}" style="position: absolute; left: ${x + i * 24}px; top: ${y + i * 24}px; width: ${w}px; height: ${Math.round((w * p.h) / p.w)}px; object-fit: cover; display: block">` });
    });
    // One change of the frame: one step to undo.
    await design.apply(frame.id, ops);
    design.select(made.length ? made.map((node) => ({ frame: frame.id, node })) : picked ? [{ frame: frame.id, node: picked.id }] : []);
    return;
  }

  // The empty canvas: a frame for each, side by side from the drop point, at least 40 × 40 (the
  // picture sits in it at its own size, no bigger than the frame).
  const added: string[] = [];
  const known = new Set(getDesign().file?.frames.map((f) => f.id) ?? []);
  let x = Math.round(at.x);
  for (const r of files_) {
    const w = side(r.w);
    const h = side(r.h);
    const k = Math.min(1, w / r.w, h / r.h);
    const path = await put(cwd, fid, r);
    if (!path) continue;
    const name = r.f.name.replace(/\.[^.]+$/, "");
    const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<style>\n*{box-sizing:border-box;margin:0}\nbody{width:${w}px;min-height:${h}px}\nimg{display:block;width:${Math.round(r.w * k)}px;height:${Math.round(r.h * k)}px}\n</style>\n</head>\n<body>\n<img src="${attr(src(path))}" alt="${attr(name)}">\n</body>\n</html>\n`;
    try {
      const next = await rpc("canvas.frame.add", { cwd, file: fid, frame: { name, w, h, x, y: Math.round(at.y), page: getDesign().page }, html });
      // Each new frame told from the ones known so far, this drop's own included.
      const f = next.frames.find((g) => !known.has(g.id));
      if (f) (known.add(f.id), added.push(f.id));
      x += w + 80;
    } catch (e) {
      // The picture's file is written but no frame takes it: unused (the engine has no call to take it back yet).
      toast.error(`${r.f.name} wasn't added`, { description: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!added.length) return;
  await design.open(cwd, fid);
  design.select(added.map((frame) => ({ frame })));
  // The new frames, as one step: undone, they go together; done again, they come back.
  design.record({ label: "Drop pictures", undo: async () => void (await design.removeFrames(added, { record: false })), redo: () => design.unremoveFrames(added) });
}
