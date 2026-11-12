/*
  The tool rail at the canvas's left edge: Move and Hand, then what you add (a frame of a size, a
  box, a text, a picture; parts come later), then Say. A box, a text or a picture goes into what's
  picked: inside it when it's a stack, after it when it isn't, at the end of the page when a frame
  is picked. A text added is edited at once.
*/
import { toast } from "@liner/components/toast/toast";
import type { DesignSize } from "@contracts";
import { I } from "../icons";
import { Pop, Row } from "../ui";
import { editText } from "./bridge";
import { openLivePicker } from "./Live";
import { PictureTool } from "./Pictures";
import { parentIn } from "./Canvas";
import { design, getDesign, useDesign, type Tool } from "./store";

type P = { size?: number };
const G = ({ size = 16, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
/** The rail's own glyphs, drawn as icons.tsx draws: a 16 grid, 1.5 strokes, round ends. */
export const D = {
  move: (p: P) => <G {...p}><path d="M3.75 2.75 12.25 7l-3.9 1.15-1.6 3.85Z" /></G>,
  frame: (p: P) => <G {...p}><path d="M5.25 2.25v11.5M10.75 2.25v11.5M2.25 5.25h11.5M2.25 10.75h11.5" /></G>,
  box: (p: P) => <G {...p}><rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1.5" /></G>,
  text: (p: P) => <G {...p}><path d="M3.25 3.75h9.5M8 3.75v9" /></G>,
  picture: (p: P) => <G {...p}><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.75" /><path d="m2.75 11 3.25-3.25 2.5 2.5 1.75-1.75 3 3" /><circle cx="10.5" cy="5.75" r="1" /></G>,
  part: (p: P) => <G {...p}><path d="M8 1.75 10 3.75 8 5.75 6 3.75ZM8 10.25l2 2-2 2-2-2ZM3.75 6l2 2-2 2-2-2ZM12.25 6l2 2-2 2-2-2Z" /></G>,
  stack: (p: P) => <G {...p}><rect x="2.75" y="2.75" width="10.5" height="4" rx="1" /><rect x="2.75" y="9.25" width="10.5" height="4" rx="1" /></G>,
};

const SNIPPETS = {
  box: `<div style="width: 160px; height: 96px; border-radius: 8px; background: #E4E7E6"></div>`,
  text: `<p style="margin: 0">Text</p>`,
  picture: `<img alt="" style="display: block; width: 200px; height: 140px; object-fit: cover; border-radius: 8px; background: #E4E7E6">`,
};

/** Adds a box, a text or a picture into what's picked (see the header). */
export async function insert(kind: keyof typeof SNIPPETS) {
  const s = getDesign();
  const at = s.sel[0];
  if (!at) return void toast("Pick a frame or a stack first", { description: "What you add goes into it.", duration: 2500 });
  if (!s.tree[at.frame]) await design.refreshTree(at.frame);
  const tree = getDesign().tree[at.frame];
  if (!tree) return;
  const id = `x${Math.random().toString(36).slice(2, 8)}`;
  const html = SNIPPETS[kind].replace(/^<(\w+)/, `<$1 data-l="${id}"`);
  let op: { into: string; insert: string; before?: string };
  if (!at.node) op = { into: tree.id, insert: html };
  else {
    const here = parentIn(tree, at.node);
    if (!here) return;
    if (here.node.kind === "stack") op = { into: here.node.id, insert: html };
    else op = { into: here.parent?.id ?? tree.id, insert: html, before: here.parent?.children[here.i + 1]?.id };
  }
  await design.apply(at.frame, [op]);
  design.select([{ frame: at.frame, node: id }]);
  design.setTool("select");
  if (kind === "text") {
    design.edit({ frame: at.frame, node: id });
    editText(at.frame, id, true);
  }
}

const SIZES: { id: DesignSize; title: string; note: string; icon: React.ReactNode }[] = [
  { id: "desktop", title: "Desktop", note: "1280 × 800", icon: <I.monitor size={14} /> },
  { id: "tablet", title: "Tablet", note: "834 × 1112", icon: <I.tablet size={14} /> },
  { id: "phone", title: "Phone", note: "390 × 844", icon: <I.device size={14} /> },
];

export function Rail() {
  const tool = useDesign((s) => s.tool);
  const pick = (t: Tool) => () => design.setTool(tool === t && t !== "select" ? "select" : t);
  const Btn = ({ t, label, keys, children }: { t: Tool; label: string; keys?: string; children: React.ReactNode }) => (
    <button type="button" className="lc-tb l-focus" aria-label={label} title={keys ? `${label} (${keys})` : label} aria-pressed={tool === t} onClick={pick(t)}>
      {children}
    </button>
  );
  return (
    <div className="ld-rail" role="toolbar" aria-label="Tools" onPointerDown={(e) => e.stopPropagation()}>
      <Btn t="select" label="Move" keys="V">
        <D.move />
      </Btn>
      <Btn t="hand" label="Hand" keys="H, or hold Space">
        <I.hand size={16} />
      </Btn>
      <hr />
      <Pop label="Frame: a new one, of a size" side="left" width={240} triggerClass="lc-tb" triggerAttrs={{ title: "Frame (F)", "aria-pressed": tool === "frame" }} trigger={<D.frame />} menu>
        {(close) => (
          <>
            {SIZES.map((x) => (
              <Row key={x.id} title={x.title} note={x.note} icon={x.icon} onPick={() => (close(), void design.addFrame(x.id))} />
            ))}
            <Row title="Custom" note="Draw it on the canvas" icon={<D.frame size={14} />} onPick={() => (close(), design.setTool("frame"))} />
            <Row title="The running app, live" note="A page of its dev server" icon={<I.globe size={14} />} onPick={() => (close(), openLivePicker())} />
          </>
        )}
      </Pop>
      <button type="button" className="lc-tb l-focus" aria-label="Box" title="Box (R): into what's picked" onClick={() => void insert("box")}>
        <D.box />
      </button>
      <button type="button" className="lc-tb l-focus" aria-label="Text" title="Text (T): into what's picked" onClick={() => void insert("text")}>
        <D.text />
      </button>
      <PictureTool />
      <button type="button" className="lc-tb l-focus" aria-label="Part: something you reuse" title="Parts come later" disabled>
        <D.part />
      </button>
      <hr />
      <button type="button" className="lc-tb l-focus" aria-label="Say: point at a thing and say what should change" title="Say: point at a thing and say what should change" onClick={() => document.querySelector<HTMLTextAreaElement>(".ld-dock textarea")?.focus()}>
        <I.comment size={16} />
      </button>
    </div>
  );
}
