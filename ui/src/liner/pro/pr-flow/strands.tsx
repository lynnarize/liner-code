/*
  The picture of a pull request: your branch as a line lifted over main, from where it
  forked to where it lands. Your commits ride it as beads; commits that reached main in the
  meantime sit on the line below, amber while they conflict. On merge the branch settles
  onto main and the two lines become one. Lift and reach run on springs that write straight
  to the DOM, and beads glide to their places on CSS.
*/
import { useId, useRef, useState, type CSSProperties } from "react";
import { useIsoLayoutEffect, useSize, useSpring } from "../../lib/hooks";
import { springs } from "../../lib/spring";
import type { PrCommit, PrConflict, PrStage } from "./pr-flow";

const H = 88;
const MAIN = 62;
const RISE = 32;
const PAD = 14;
const BEND = 36;

const branchPath = (fx: number, tx: number, lift: number) => {
  const y = MAIN - RISE * lift;
  const h = BEND / 2;
  return `M${fx} ${MAIN}C${fx + h} ${MAIN} ${fx + h} ${y} ${fx + BEND} ${y}L${tx - BEND} ${y}C${tx - h} ${y} ${tx - h} ${MAIN} ${tx} ${MAIN}`;
};
const syncPath = ([x1, x2]: [number, number], lift: number) => {
  const y = MAIN - RISE * lift;
  const m = (x1 + x2) / 2;
  return `M${x1} ${MAIN}C${m} ${MAIN} ${m} ${y} ${x2} ${y}`;
};

export type StrandsProps = {
  stage: PrStage;
  branch: string;
  base: string;
  commits: PrCommit[];
  conflicts: PrConflict[];
  /** How far the checks have got, 0 to 1, drawn around the landing point. */
  progress: number;
  /** What the picture says, for screen readers. */
  label: string;
};

export function Strands({ stage, branch, base, commits, conflicts, progress, label }: StrandsProps) {
  const clip = `l-prf-${useId().replace(/:/g, "")}`;
  const [box, size] = useSize<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const solid = useRef<SVGPathElement>(null);
  const ghost = useRef<SVGPathElement>(null);
  const edge = useRef<SVGRectElement>(null);
  const syncs = useRef<SVGGElement>(null);
  const [peek, setPeek] = useState<PrCommit | null>(null);

  // Your commits spread along the lifted stretch; main's sit between them on the line below.
  const w = size?.width ?? 0;
  const fx = PAD + 30;
  const tx = Math.max(fx + BEND * 2 + 60, w - PAD - 10);
  const a = fx + BEND + 22;
  const e = tx - BEND - 18;
  const mine = commits.filter((c) => c.lane === "branch");
  const theirs = commits.filter((c) => c.lane === "base");
  const at = new Map<string, number>();
  mine.forEach((c, i) => at.set(c.id, mine.length > 1 ? a + ((e - a) * i) / (mine.length - 1) : a));
  theirs.forEach((c, i) => at.set(c.id, a + ((e - a) * (i + 0.5)) / theirs.length));
  const newest = theirs.at(-1);
  const merges = newest ? mine.filter((c) => c.merge).map((c): [number, number] => [at.get(newest.id)!, at.get(c.id)!]) : [];
  // Conflicts mark the main commit they clash with, or the newest one when they don't say.
  const owner = (k: PrConflict) => k.commit ?? newest?.id;
  const hot = new Set(conflicts.filter((k) => !k.resolved).map(owner));

  const head = mine.length ? at.get(mine[mine.length - 1].id)! : fx;
  const clear = stage === "ready" || stage === "merging" || stage === "merged";
  const reachTo = clear ? tx + 2 : head;
  const liftTo = stage === "merged" ? 0 : 1;

  const geo = useRef({ fx, tx, merges });
  geo.current = { fx, tx, merges };
  const draw = () => {
    const g = geo.current;
    const d = branchPath(g.fx, g.tx, lift.value);
    solid.current?.setAttribute("d", d);
    ghost.current?.setAttribute("d", d);
    edge.current?.setAttribute("width", String(Math.max(0, reach.value)));
    svg.current?.style.setProperty("--lift", String(lift.value));
    syncs.current?.querySelectorAll("path").forEach((p, i) => {
      if (g.merges[i]) p.setAttribute("d", syncPath(g.merges[i], lift.value));
    });
  };
  const lift = useSpring(1, springs.smooth, draw);
  const reach = useSpring(0, springs.smooth, draw);
  const measured = useRef(0);
  useIsoLayoutEffect(() => {
    if (!w) return;
    // The first measure, and any resize, places everything without travel.
    if (measured.current !== w) {
      measured.current = w;
      lift.jump(liftTo);
      reach.jump(reachTo);
    } else {
      lift.set(liftTo);
      reach.set(reachTo);
    }
    draw();
  });

  const target =
    stage === "merged" ? "merged" : stage === "ready" ? "ready" : stage === "testing" ? "testing" : hot.size ? "conflict" : stage === "checking" || stage === "resolving" || stage === "merging" ? "busy" : "pending";

  let peekCard = null;
  if (peek) {
    const mineOf = conflicts.filter((k) => owner(k) === peek.id);
    const left = mineOf.filter((k) => !k.resolved).length;
    // Above your commits and below main's, so the card never sits on the other line.
    const px = Math.min(Math.max(at.get(peek.id) ?? 0, 100), w - 100);
    const above = peek.lane === "branch";
    const py = above ? MAIN - RISE * lift.value - 13 : MAIN + 13;
    peekCard = (
      <div className="l-prf-peek l-glass" data-side={above ? "top" : "bottom"} aria-hidden style={{ left: px, top: py }}>
        <b>{peek.title}</b>
        <span>{[peek.who, peek.when, peek.hash].filter(Boolean).join(" · ")}</span>
        {mineOf.length > 0 && <span data-tone={left ? "warn" : "ok"}>{left ? `${left} ${left === 1 ? "conflict" : "conflicts"} with yours` : "Conflicts resolved"}</span>}
      </div>
    );
  }
  const hit = (c: PrCommit) => <circle className="l-prf-hit" r={12} onPointerEnter={() => setPeek(c)} onPointerLeave={() => setPeek(null)} />;

  return (
    <div ref={box} className="l-prf__hero" data-pushed={mine.length > 0 || undefined}>
      <div className="l-prf__plot">
        {w > 0 && (
          <svg ref={svg} role="img" aria-label={label} width={w} height={H}>
            <defs>
              <clipPath id={clip}>
                <rect ref={edge} x={0} y={0} height={H} />
              </clipPath>
            </defs>
            <path className="l-prf-main" d={`M${PAD} ${MAIN}H${tx}`} />
            <g ref={syncs}>
              {merges.map((_, i) => (
                <path key={i} className="l-prf-sync" pathLength={1} />
              ))}
            </g>
            <path ref={ghost} className="l-prf-ghost" />
            <path ref={solid} className="l-prf-branch" clipPath={`url(#${clip})`} />
            <circle className="l-prf-fork" cx={fx} cy={MAIN} r={4} />
            {theirs.map((c) => (
              <g key={c.id} className="l-prf-bead" data-lane="base" data-conflict={hot.has(c.id) || undefined} style={{ transform: `translate(${at.get(c.id)}px, ${MAIN}px)` }}>
                <circle className="l-prf-halo" r={10} />
                <circle className="l-prf-dot" r={4.5} />
                {hit(c)}
              </g>
            ))}
            {mine.map((c, i) => (
              <g key={c.id} className="l-prf-bead" data-lane="branch" data-merge={c.merge || undefined} style={{ transform: `translate(${at.get(c.id)}px, ${MAIN}px)` }}>
                <g className="l-prf-lift">
                  <circle className="l-prf-dot" r={4.5} style={{ animationDelay: `${120 + Math.min(i, 4) * 110}ms` }} />
                  {hit(c)}
                </g>
              </g>
            ))}
            <g className="l-prf-target" data-state={target} transform={`translate(${tx} ${MAIN})`} style={{ "--p": progress } as CSSProperties}>
              <circle className="l-prf-target__ring" r={8} />
              <circle className="l-prf-target__arc" r={8} pathLength={1} />
              <path className="l-prf-target__tick" d="M-3.4 0.2-1 2.5 3.4-2" />
            </g>
          </svg>
        )}
        <span className="l-prf-lbl" data-lane="branch" style={{ left: fx + BEND - 2, maxWidth: `calc(100% - ${fx + BEND + 40}px)` }}>
          {branch}
        </span>
        <span className="l-prf-lbl" data-lane="base" style={{ left: PAD - 1 }}>
          {base}
        </span>
        {peekCard}
      </div>
    </div>
  );
}
