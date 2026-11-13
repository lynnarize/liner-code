/*
  The Design face's sidebar body: the lean (the project's DESIGN.md, a press away from its page),
  the skills it loads, the design file's pages, and Layers: the page's frames as top rows, the
  picked frame's outline under it from the bridge, a dot on a frame an agent is drawing. A press
  picks; ⌘[ and ⌘] move what's picked up or down in its stack, here or on the canvas.
*/
import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { TreeNode } from "@contracts";
import { I } from "../icons";
import { parentIn } from "./Canvas";
import { LayerMark } from "./BuildTab";
import { LayerChecks } from "./ChecksTab";
import { useLean } from "./lean";
import { D } from "./Rail";
import { design, getDesign, isBlank, isGone, useDesign } from "./store";

/**
  What other builders put in the sidebar: E's skills rows under the lean (in place of the plain
  list here), and what pressing the lean row does (E's lean page). Each is set once, from the
  module that has it.
*/
export const sideSlots: { skills?: ComponentType<{ cwd: string }>; openLean?: () => void } = {};

/** Moves what's picked one place up (-1) or down (1) in its stack. */
export async function reorder(dir: -1 | 1) {
  const s = getDesign();
  const at = s.sel.find((x) => x.node);
  if (!at) return;
  if (!s.tree[at.frame]) await design.refreshTree(at.frame);
  const here = parentIn(getDesign().tree[at.frame], at.node!);
  if (!here?.parent) return;
  const sib = here.parent.children;
  if (dir < 0 && here.i > 0) await design.apply(at.frame, [{ id: at.node!, move: { before: sib[here.i - 1].id } }]);
  if (dir > 0 && here.i < sib.length - 1) await design.apply(at.frame, [here.i + 2 < sib.length ? { id: at.node!, move: { before: sib[here.i + 2].id } } : { id: at.node!, move: { into: here.parent.id } }]);
}

/**
  The lean's swatches and what it holds, in words. The lean is optional, in three states: none at
  all ("No lean": the agent uses its own taste), skills but no DESIGN.md, and a DESIGN.md.
*/
function LeanRow({ cwd }: { cwd: string }) {
  // The one lean the inspector and the Lean page read too (lean.ts), so an edit there shows here.
  const lean = useLean();
  const skills = useDesign((s) => s.file?.lean.skills.length ?? 0);
  const t = lean?.tokens;
  const name = lean?.off === "builtin" ? "Liner 2.0" : lean ? (lean.path?.split("/").pop() ?? "DESIGN.md") : skills ? "No DESIGN.md" : "No lean";
  const note = t && lean ? [t.colours.length && `${t.colours.length} colours`, t.type.length && `${t.type.length} ${t.type.length === 1 ? "voice" : "voices"}`, t.steps.length && `${t.steps[0]} pt steps`].filter(Boolean).join(" · ") : skills ? `${skills} ${skills === 1 ? "skill" : "skills"} loaded` : "Optional. The agent uses its own taste";
  const sw = (t?.colours ?? []).slice(0, 4);
  return (
    <button type="button" className="ld-lean l-focus" aria-label={`The lean: ${name}. Open it`} onClick={() => (sideSlots.openLean ? sideSlots.openLean() : window.dispatchEvent(new CustomEvent("ld:open-lean", { detail: { cwd } })))}>
      <span className="ld-q4" data-none={!lean || undefined} aria-hidden>
        {sw.length ? sw.map((c) => <i key={c.name} style={{ background: c.value }} />) : <i />}
      </span>
      <span className="ld-lean-t">
        <b>{name}</b>
        {note && <small>{note}</small>}
      </span>
      <I.chevR size={13} />
    </button>
  );
}

/** The skills the design file loads, plainly, until E's rows take their place. */
const NONE: string[] = [];
function SkillRows() {
  const skills = useDesign((s) => s.file?.lean.skills ?? NONE);
  return (
    <>
      {skills.slice(0, 3).map((n) => (
        <div key={n} className="ld-tr" title={`The ${n} skill is loaded for this design`}>
          <span className="ld-sl" aria-hidden>
            /
          </span>
          {n}
        </div>
      ))}
      {skills.length > 3 && <div className="ld-tr" data-rest>+{skills.length - 3} more</div>}
    </>
  );
}

const kindIcon = (n: TreeNode) => (n.kind === "stack" ? <D.stack size={14} /> : n.kind === "text" ? <D.text size={14} /> : n.kind === "image" ? <D.picture size={14} /> : <D.box size={14} />);

function Nodes({ frame, node, depth, open, onToggle, picked }: { frame: string; node: TreeNode; depth: number; open: Set<string>; onToggle: (id: string) => void; picked: Set<string> }) {
  return (
    <>
      {node.children.map((c) => {
        const has = c.children.length > 0;
        const on = open.has(c.id);
        return (
          <div key={c.id} role="none">
            <div className="ld-ly" role="treeitem" aria-level={depth + 1} aria-selected={picked.has(c.id)} aria-expanded={has ? on : undefined} data-on={picked.has(c.id) || undefined} style={{ paddingLeft: 8 + depth * 14 }} onClick={(e) => design.select(e.shiftKey ? [...getDesign().sel, { frame, node: c.id }] : [{ frame, node: c.id }])}>
              {has ? (
                <button type="button" className="ld-ly-tw" aria-label={on ? "Fold" : "Open"} onClick={(e) => (e.stopPropagation(), onToggle(c.id))}>
                  {on ? <I.chevD size={11} /> : <I.chevR size={11} />}
                </button>
              ) : (
                <span className="ld-ly-tw" />
              )}
              {kindIcon(c)}
              <span className="ld-ell">{c.name || c.tag}</span>
            </div>
            {has && on && <Nodes frame={frame} node={c} depth={depth + 1} open={open} onToggle={onToggle} picked={picked} />}
          </div>
        );
      })}
    </>
  );
}

function LayerList() {
  const file = useDesign((s) => s.file);
  const page = useDesign((s) => s.page ?? s.file?.pages[0]?.id);
  const sel = useDesign((s) => s.sel);
  const tree = useDesign((s) => s.tree);
  const presence = useDesign((s) => s.presence);
  const blanks = useDesign((s) => (s.file?.frames ?? []).filter((f) => isBlank(s, f)).map((f) => f.id).join(","));
  const blank = (f: { id: string }) => blanks.split(",").includes(f.id);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const frames = (file?.frames ?? []).filter((f) => f.page === page);
  const selKey = sel.map((x) => `${x.frame}:${x.node ?? ""}`).join(",");
  useEffect(() => {
    setOpen((was) => {
      const next = new Set(was);
      // A node picked shows where it is: its frame and every stack round it open. A frame picked
      // on its own stays as it was, so its chevron opens it with the first press.
      for (const x of sel) {
        if (!x.node) continue;
        next.add(x.frame);
        let at = x.node ? parentIn(tree[x.frame], x.node) : undefined;
        while (at?.parent) {
          next.add(at.parent.id);
          at = parentIn(tree[x.frame], at.parent.id);
        }
      }
      return next;
    });
  }, [selKey, tree]);
  const picked = useMemo(() => new Set(sel.map((x) => x.node).filter(Boolean) as string[]), [selKey]);
  const toggle = (id: string) => setOpen((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  if (!frames.length) return <div className="ld-none">No frames on this page yet. Press F for one, or ask in the dock.</div>;
  return (
    <div className="ld-layers" role="tree" aria-label="Layers">
      {frames.map((f) => {
        const root = tree[f.id];
        // Open only when its outline is there to show: a frame picked a moment ago is marked open
        // before its outline arrives, and a press then must open it, not shut it.
        const on = open.has(f.id) && Boolean(root);
        const p = presence[f.id];
        return (
          <div key={f.id} role="none">
            <div className="ld-ly" data-top role="treeitem" aria-level={1} aria-expanded={on} aria-selected={sel.some((x) => x.frame === f.id && !x.node)} data-on={sel.some((x) => x.frame === f.id && !x.node) || undefined} onClick={(e) => design.select(e.shiftKey ? [...getDesign().sel, { frame: f.id }] : [{ frame: f.id }])}>
              <button
                type="button"
                className="ld-ly-tw"
                aria-label={on ? "Fold" : "Open"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (on) return toggle(f.id);
                  if (!root) void design.refreshTree(f.id);
                  setOpen((was) => new Set(was).add(f.id));
                }}
              >
                {on ? <I.chevD size={11} /> : <I.chevR size={11} />}
              </button>
              <D.frame size={14} />
              <b className="ld-ell">{f.name}</b>
              {isGone(f) && (
                <span className="ld-ly-gone" title={`Its file is gone: ${f.path ?? `frames/${f.id}.html`}`}>
                  file gone
                </span>
              )}
              {!isGone(f) && blank(f) && <span className="ld-m">empty</span>}
              {!isGone(f) && !blank(f) && <LayerMark frame={f} />}
              {!isGone(f) && !blank(f) && <LayerChecks frame={f.id} />}
              {p && <span className="ld-pd" data-lead={p.lead || undefined} aria-label={`${p.name} is drawing this`} />}
            </div>
            {on && root && <Nodes frame={f.id} node={root} depth={1} open={open} onToggle={toggle} picked={picked} />}
          </div>
        );
      })}
    </div>
  );
}

/** Opens the Lean page with DESIGN.md's empty box ready to write in: nothing is written until you write. */
function addDesignMd() {
  sideSlots.openLean?.();
  // The box is there once the page has drawn.
  window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".ld-lp-md textarea")?.focus(), 80);
}

/** The sidebar's body in Design, for the design open in its tab (its folder, `cwd`). */
export function DesignSide({ cwd }: { cwd: string }) {
  const file = useDesign((s) => s.file);
  const page = useDesign((s) => s.page ?? s.file?.pages[0]?.id);
  const lean = useLean();
  const Skills = sideSlots.skills;
  const count = (id: string) => file?.frames.filter((f) => f.page === id).length ?? 0;
  return (
    <div className="ld-side">
      <div className="lc-sb-lab ld-lab">
        Lean
        <span className="ld-lab-q">optional</span>
      </div>
      <LeanRow cwd={cwd} />
      {Skills ? <Skills cwd={cwd} /> : <SkillRows />}
      {!lean && file && (
        <button type="button" className="ld-tr ld-tr-add l-focus" onClick={addDesignMd}>
          <I.plus size={14} />
          <span className="ld-ell">Add DESIGN.md</span>
        </button>
      )}
      {file && (
        <>
          <div className="lc-sb-lab ld-lab">
            Pages
            <button type="button" className="lc-ib l-focus ld-lab-b" aria-label="Add a page" title="Add a page" onClick={() => design.addPage(`Page ${file.pages.length + 1}`)}>
              <I.plus size={14} />
            </button>
          </div>
          {file.pages.map((p) => (
            <button key={p.id} type="button" className="ld-tr l-focus" data-on={p.id === page || undefined} onClick={() => design.setPage(p.id)}>
              <I.file size={14} />
              <span className="ld-ell">{p.name}</span>
              {count(p.id) > 0 && <span className="ld-m">{count(p.id)}</span>}
            </button>
          ))}
          <div className="lc-sb-lab ld-lab">Layers</div>
          <LayerList />
        </>
      )}
    </div>
  );
}
