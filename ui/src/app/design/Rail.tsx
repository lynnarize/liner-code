/*
  The tools, a segmented control in the design's top row (board Design; it was a rail at the canvas's left edge): Move and Hand, then what you add (a frame of a size, a
  box, a text, a picture). What to say goes in the dock, always in view, and the say bar under a
  pick puts the caret there, so the rail has no Say of its own. A box, a text or a picture goes into what's
  picked: inside it when it's a stack, after it when it isn't, at the end of the page when a frame
  is picked. A text added is edited at once.
*/
import { toast } from "@liner/components/toast/toast";
import type { DesignSize } from "@contracts";
import { I, wt } from "../icons";
import { Pop, Row } from "../ui";
import { editText } from "./bridge";
import { openLivePicker } from "./Live";
import { PictureTool } from "./Pictures";
import { parentIn } from "./Canvas";
import { design, getDesign, useDesign, type Tool } from "./store";
import { SIZE_ICON, SIZE_NAME, sizeWords } from "./sizes";

type P = { size?: number };
const G = ({ size = 16, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={wt(size, 16)} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
/** The rail's own glyphs, drawn as icons.tsx draws: a 16 grid, round ends, and its weight rule (a real 1.5px from 14 up, 1.25 below). */
export const D = {
  move: (p: P) => <G {...p}><path d="M3.75 2.75 12.25 7l-3.9 1.15-1.6 3.85Z" /></G>,
  frame: (p: P) => <G {...p}><path d="M5.25 2.25v11.5M10.75 2.25v11.5M2.25 5.25h11.5M2.25 10.75h11.5" /></G>,
  box: (p: P) => <G {...p}><rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1.5" /></G>,
  text: (p: P) => <G {...p}><path d="M3.25 3.75h9.5M8 3.75v9" /></G>,
  picture: (p: P) => <G {...p}><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.75" /><path d="m2.75 11 3.25-3.25 2.5 2.5 1.75-1.75 3 3" /><circle cx="10.5" cy="5.75" r="1" /></G>,
  stack: (p: P) => <G {...p}><rect x="2.75" y="2.75" width="10.5" height="4" rx="1" /><rect x="2.75" y="9.25" width="10.5" height="4" rx="1" /></G>,
  /** Lining up and spacing several frames (Style's row for them): an edge or a middle line, and the frames against it. */
  alignLeft: (p: P) => <G {...p}><path d="M2.75 2.25v11.5" /><rect x="5.25" y="3.75" width="8" height="3" rx="1" /><rect x="5.25" y="9.25" width="5" height="3" rx="1" /></G>,
  alignCentreH: (p: P) => <G {...p}><path d="M8 2.25v11.5" /><rect x="3.75" y="3.75" width="8.5" height="3" rx="1" /><rect x="5.25" y="9.25" width="5.5" height="3" rx="1" /></G>,
  alignRight: (p: P) => <G {...p}><path d="M13.25 2.25v11.5" /><rect x="2.75" y="3.75" width="8" height="3" rx="1" /><rect x="5.75" y="9.25" width="5" height="3" rx="1" /></G>,
  alignTop: (p: P) => <G {...p}><path d="M2.25 2.75h11.5" /><rect x="3.75" y="5.25" width="3" height="8" rx="1" /><rect x="9.25" y="5.25" width="3" height="5" rx="1" /></G>,
  alignCentreV: (p: P) => <G {...p}><path d="M2.25 8h11.5" /><rect x="3.75" y="3.75" width="3" height="8.5" rx="1" /><rect x="9.25" y="5.25" width="3" height="5.5" rx="1" /></G>,
  alignBottom: (p: P) => <G {...p}><path d="M2.25 13.25h11.5" /><rect x="3.75" y="2.75" width="3" height="8" rx="1" /><rect x="9.25" y="5.75" width="3" height="5" rx="1" /></G>,
  spreadH: (p: P) => <G {...p}><path d="M2.75 2.25v11.5M13.25 2.25v11.5" /><rect x="6.5" y="4.25" width="3" height="7.5" rx="1" /></G>,
  spreadV: (p: P) => <G {...p}><path d="M2.25 2.75h11.5M2.25 13.25h11.5" /><rect x="4.25" y="6.5" width="7.5" height="3" rx="1" /></G>,
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

const SIZES: DesignSize[] = ["desktop", "tablet", "phone"];

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
      <Pop label="Frame: a new one, of a size" side="bottom" align="center" width={240} triggerClass="lc-tb" triggerAttrs={{ title: "Frame (F)", "aria-pressed": tool === "frame" }} trigger={<D.frame />} menu>
        {(close) => (
          <>
            {/* A size's value at the right end, as every menu shows a value (sizes.ts says them one way). */}
            {SIZES.map((x) => (
              <Row key={x} title={SIZE_NAME[x]} end={sizeWords(x)} icon={SIZE_ICON[x]} onPick={() => (close(), void design.addFrame(x))} />
            ))}
            <Row title="Custom" note="Draw it on the canvas" icon={<D.frame size={16} />} onPick={() => (close(), design.setTool("frame"))} />
            <Row title="The running app, live" note="A page of its dev server" icon={<I.globe size={16} />} onPick={() => (close(), openLivePicker())} />
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
    </div>
  );
}
