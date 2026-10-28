/*
  Liner Code's icons: one family on a 16px grid, every stroke 1.5 at 16px with round caps and
  joins, each drawn as the thing people already know it by (a gear for settings, people for the
  team, a ± for a diff, an arrow out of a box for "open elsewhere"). One meaning per icon: Settle
  is a ticked circle, not the plain tick; Snooze is a moon, not a clock.
  The mark is two nested Ls sharing a corner: the outer in ink, the inner in a light accent.
*/
import type { CSSProperties, ReactNode } from "react";
import type { AgentGlyph } from "@contracts";
import { BRANDS, type Brand } from "./brands";

type P = { size?: number; className?: string; style?: CSSProperties };
const S = ({ size = 16, children, className, style, w = 1.5 }: P & { children: ReactNode; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className} style={style}>
    {children}
  </svg>
);

const GEAR = "M6.85 3.39 7.01 1.73h1.98l.16 1.66 1.3.54 1.28-1.07 1.41 1.41-1.07 1.28.54 1.3 1.66.16v1.98l-1.66.16-.54 1.3 1.07 1.28-1.41 1.41-1.28-1.07-1.3.54-.16 1.66H7.01l-.16-1.66-1.3-.54-1.28 1.07-1.41-1.41 1.07-1.28-.54-1.3-1.66-.16V7.01l1.66-.16.54-1.3-1.07-1.28 1.41-1.41 1.28 1.07Z";

export const I = {
  compose: (p: P) => <S {...p}><path d="M8 2.75H4.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5V8" /><path d="M11.85 2.65a1.3 1.3 0 0 1 1.85 1.85L8.2 10l-2.45.75.75-2.45Z" /></S>,
  search: (p: P) => <S {...p}><circle cx="7.25" cy="7.25" r="4.5" /><path d="m10.6 10.6 2.65 2.65" /></S>,
  filter: (p: P) => <S {...p}><path d="M2.75 4.25h10.5M4.75 8h6.5M6.75 11.75h2.5" /></S>,
  routines: (p: P) => <S {...p}><path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" /><path d="M12.25 1.9v2.75H9.5M8 5.25V8l1.75 1" /></S>,
  folder: (p: P) => <S {...p}><path d="M2.75 5a1.25 1.25 0 0 1 1.25-1.25h2.4c.36 0 .7.16.94.43l.86 1.07H12A1.25 1.25 0 0 1 13.25 6.5v5.25A1.25 1.25 0 0 1 12 13H4a1.25 1.25 0 0 1-1.25-1.25Z" /></S>,
  pin: (p: P) => <S {...p}><path d="M6.25 2.75h3.5M6.75 2.75v3.4L4.75 8.4v1.85h6.5V8.4l-2-2.25v-3.4M8 10.25v3.25" /></S>,
  snooze: (p: P) => <S {...p}><path d="M8 2.5a4 4 0 0 0 5.5 5.5A5.5 5.5 0 1 1 8 2.5Z" /></S>,
  settle: (p: P) => <S {...p}><circle cx="8" cy="8" r="5.5" /><path d="m5.75 8.1 1.6 1.6 2.9-3.2" /></S>,
  check: (p: P) => <S {...p}><path d="M3.5 8.4 6.5 11.25 12.5 4.75" /></S>,
  chevR: (p: P) => <S {...p}><path d="M6.25 4.25 10 8l-3.75 3.75" /></S>,
  chevL: (p: P) => <S {...p}><path d="M9.75 4.25 6 8l3.75 3.75" /></S>,
  chevD: (p: P) => <S {...p}><path d="M4.25 6.25 8 10l3.75-3.75" /></S>,
  chevU: (p: P) => <S {...p}><path d="M4.25 9.75 8 6l3.75 3.75" /></S>,
  sidebar: (p: P) => <S {...p}><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.25" /><path d="M6.25 2.75v10.5" /></S>,
  panel: (p: P) => <S {...p}><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.25" /><path d="M9.75 2.75v10.5" /></S>,
  bottom: (p: P) => <S {...p}><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.25" /><path d="M2.25 9.5h11.5" /></S>,
  agents: (p: P) => <S {...p}><circle cx="6" cy="5.5" r="2.25" /><path d="M2.25 13a3.75 3.75 0 0 1 7.5 0M10.25 3.35a2.25 2.25 0 0 1 0 4.3M11.6 9.65A3.75 3.75 0 0 1 13.75 13" /></S>,
  changes: (p: P) => <S {...p}><path d="M8 2.75v7M4.5 6.25h7M4.5 13h7" /></S>,
  branch: (p: P) => <S {...p}><circle cx="4.5" cy="12" r="1.5" /><circle cx="11.5" cy="4.25" r="1.5" /><path d="M4.5 2.75v7.75M11.5 5.75A6.25 6.25 0 0 1 6 12" /></S>,
  attach: (p: P) => <S {...p}><path d="M12.6 7.45 8.05 12a3.1 3.1 0 0 1-4.4-4.4l4.9-4.9a2.05 2.05 0 0 1 2.9 2.9L6.6 10.45a1.02 1.02 0 0 1-1.45-1.45l4.3-4.3" /></S>,
  send: (p: P) => <S {...p} w={1.7}><path d="M8 12.75V3.5M4.25 7.25 8 3.5l3.75 3.75" /></S>,
  stop: ({ size = 11, className }: P) => (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className={className}>
      <rect x="3" y="3" width="10" height="10" rx="2.2" fill="currentColor" />
    </svg>
  ),
  lock: (p: P) => <S {...p}><rect x="3.25" y="7" width="9.5" height="6.25" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></S>,
  effort: (p: P) => <S {...p}><path d="M2.75 11.5a5.25 5.25 0 1 1 10.5 0" /><path d="m8 11.5 2.5-3" /></S>,
  laptop: (p: P) => <S {...p}><path d="M3.25 10.25v-6a1 1 0 0 1 1-1h7.5a1 1 0 0 1 1 1v6M1.75 12.75h12.5" /></S>,
  terminal: (p: P) => <S {...p}><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2" /><path d="m5.25 6.25 2 1.75-2 1.75M8.75 9.75h2" /></S>,
  push: (p: P) => <S {...p}><path d="M8 10.5V2.75M4.75 6 8 2.75 11.25 6M3 13.25h10" /></S>,
  download: (p: P) => <S {...p}><path d="M8 2.75v7.75M4.75 7.25 8 10.5l3.25-3.25M3 13.25h10" /></S>,
  external: (p: P) => <S {...p}><path d="M9.25 2.75h4v4M13.25 2.75 7.75 8.25M11.75 9.25v2.5a1.5 1.5 0 0 1-1.5 1.5h-6a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5h2.5" /></S>,
  file: (p: P) => <S {...p}><path d="M9.25 2.75h-4.5a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1h6.5a1 1 0 0 0 1-1v-6.5Z" /><path d="M9.25 2.75v2.25a.75.75 0 0 0 .75.75h2.25" /></S>,
  plus: (p: P) => <S {...p}><path d="M8 3.25v9.5M3.25 8h9.5" /></S>,
  close: (p: P) => <S {...p}><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></S>,
  expand: (p: P) => <S {...p}><path d="M9.75 2.75h3.5v3.5M6.25 13.25h-3.5v-3.5M13.25 2.75l-4 4M2.75 13.25l4-4" /></S>,
  wrap: (p: P) => <S {...p}><path d="M2.75 4h10.5M2.75 8h8.25a2 2 0 0 1 0 4H8.5M2.75 12h3M10 10.5 8.5 12l1.5 1.5" /></S>,
  usage: (p: P) => <S {...p}><path d="M2.75 2.75v9.5a1 1 0 0 0 1 1h9.5M6 10.25V7.5M9 10.25v-5M12 10.25V8.5" /></S>,
  settings: (p: P) => <S {...p}><path d={GEAR} /><circle cx="8" cy="8" r="2" /></S>,
  read: (p: P) => <S {...p}><circle cx="7.25" cy="7.25" r="4.5" /><path d="m10.6 10.6 2.65 2.65" /></S>,
  globe: (p: P) => <S {...p}><circle cx="8" cy="8" r="5.75" /><path d="M2.25 8h11.5M8 2.25A8.8 8.8 0 0 1 10.3 8 8.8 8.8 0 0 1 8 13.75 8.8 8.8 0 0 1 5.7 8 8.8 8.8 0 0 1 8 2.25Z" /></S>,
  undo: (p: P) => <S {...p}><path d="M5.75 3.75 3 6.5l2.75 2.75M3 6.5h6.75a3.25 3.25 0 0 1 0 6.5H7.25" /></S>,
  commit: (p: P) => <S {...p}><circle cx="8" cy="8" r="2.5" /><path d="M1.75 8h3.75M10.5 8h3.75" /></S>,
  drag: (p: P) => <S {...p} w={2}><path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" /></S>,
  sparkle: (p: P) => <S {...p}><path d="M8 2.25Q9.3 6.7 13.75 8 9.3 9.3 8 13.75 6.7 9.3 2.25 8 6.7 6.7 8 2.25Z" /></S>,
  refresh: (p: P) => <S {...p}><path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" /><path d="M12.25 1.9v2.75H9.5" /></S>,
  copy: (p: P) => <S {...p}><rect x="5.5" y="5.5" width="7.75" height="7.75" rx="1.5" /><path d="M10.5 5.5V4.25a1.5 1.5 0 0 0-1.5-1.5H4.25a1.5 1.5 0 0 0-1.5 1.5V9a1.5 1.5 0 0 0 1.5 1.5H5.5" /></S>,
  edit: (p: P) => <S {...p}><path d="M11.2 2.55a1.6 1.6 0 0 1 2.25 2.25l-7.7 7.7-3 .75.75-3ZM9.75 4l2.25 2.25" /></S>,
  trash: (p: P) => <S {...p}><path d="M2.75 4.25h10.5M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25M4.25 4.25l.55 8.2a1 1 0 0 0 1 .95h4.4a1 1 0 0 0 1-.95l.55-8.2" /></S>,
  more: (p: P) => <S {...p} w={2}><path d="M3.75 8h.01M8 8h.01M12.25 8h.01" /></S>,
  fork: (p: P) => <S {...p}><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="11.5" cy="3.5" r="1.5" /><circle cx="8" cy="12.5" r="1.5" /><path d="M4.5 5v1a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V5M8 8v3" /></S>,
  sliders: (p: P) => <S {...p}><path d="M2.75 5h5M11.25 5h2M2.75 11h2M8.25 11h5" /><circle cx="9.5" cy="5" r="1.75" /><circle cx="6.5" cy="11" r="1.75" /></S>,
  contrast: (p: P) => <S {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11a5.5 5.5 0 0 0 0-11Z" fill="currentColor" stroke="none" /></S>,
  bell: (p: P) => <S {...p}><path d="M4.25 6.75a3.75 3.75 0 0 1 7.5 0c0 3.5 1.5 4.5 1.5 4.5H2.75s1.5-1 1.5-4.5M6.75 13.5a1.4 1.4 0 0 0 2.5 0" /></S>,
  keyboard: (p: P) => <S {...p}><rect x="1.75" y="3.75" width="12.5" height="8.5" rx="1.75" /><path d="M4.5 6.5h.01M6.83 6.5h.01M9.17 6.5h.01M11.5 6.5h.01M5.5 9.5h5" /></S>,
  chip: (p: P) => <S {...p}><rect x="4" y="4" width="8" height="8" rx="1.5" /><path d="M6.5 1.75V4M9.5 1.75V4M6.5 12v2.25M9.5 12v2.25M1.75 6.5H4M1.75 9.5H4M12 6.5h2.25M12 9.5h2.25" /></S>,
  shield: (p: P) => <S {...p}><path d="M8 13.75s4.75-1.9 4.75-6.15V3.9L8 2.25 3.25 3.9v3.7C3.25 11.85 8 13.75 8 13.75Z" /><path d="m6 7.9 1.4 1.4 2.6-2.8" /></S>,
  box: (p: P) => <S {...p}><rect x="2.25" y="2.75" width="11.5" height="3.25" rx="1" /><path d="M3.25 6v6.25a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V6M6.5 8.75h3" /></S>,
  drive: (p: P) => <S {...p}><ellipse cx="8" cy="4" rx="5.25" ry="1.75" /><path d="M2.75 4v8c0 .97 2.35 1.75 5.25 1.75s5.25-.78 5.25-1.75V4M2.75 8c0 .97 2.35 1.75 5.25 1.75S13.25 8.97 13.25 8" /></S>,
  back: (p: P) => <S {...p}><path d="M7 3.75 2.75 8 7 12.25M3 8h10.25" /></S>,
  forward: (p: P) => <S {...p}><path d="M9 3.75 13.25 8 9 12.25M13 8H2.75" /></S>,
  pr: (p: P) => <S {...p}><circle cx="4.5" cy="3.75" r="1.5" /><circle cx="4.5" cy="12.25" r="1.5" /><circle cx="11.5" cy="12.25" r="1.5" /><path d="M4.5 5.25v5.5M11.5 10.75V6.5a2 2 0 0 0-2-2H7.25M9 2.75 7.25 4.5 9 6.25" /></S>,
  merge: (p: P) => <S {...p}><circle cx="4.5" cy="3.75" r="1.5" /><circle cx="4.5" cy="12.25" r="1.5" /><circle cx="11.5" cy="9.25" r="1.5" /><path d="M4.5 5.25v5.5M4.5 5.25a4 4 0 0 0 4 4H10" /></S>,
  link: (p: P) => <S {...p}><path d="M6.75 9.25a2.75 2.75 0 0 0 3.9 0l2.1-2.1a2.75 2.75 0 0 0-3.9-3.9l-.6.6M9.25 6.75a2.75 2.75 0 0 0-3.9 0l-2.1 2.1a2.75 2.75 0 0 0 3.9 3.9l.6-.6" /></S>,
  device: (p: P) => <S {...p}><rect x="4.25" y="1.75" width="7.5" height="12.5" rx="1.75" /><path d="M7.25 11.75h1.5" /></S>,
  camera: (p: P) => <S {...p}><path d="M2.25 5.75a1 1 0 0 1 1-1h1.85l1.1-1.75h3.6l1.1 1.75h1.85a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1Z" /><circle cx="8" cy="8.5" r="2.15" /></S>,
  target: (p: P) => <S {...p}><path d="m3.25 3.25 3.9 9.5 1.4-4.2 4.2-1.4Z" /></S>,
  play: (p: P) => <S {...p}><path d="M5 3.5v9l7.25-4.5Z" /></S>,
  bolt: (p: P) => <S {...p}><path d="M8.75 1.75 3.75 9h4L7 14.25l5-7.25H8Z" /></S>,
  clock: (p: P) => <S {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.25" /></S>,
  hand: (p: P) => <S {...p}><path d="M5.5 8.5V4.25a.95.95 0 0 1 1.9 0V7.5M7.4 7V3.4a.95.95 0 0 1 1.9 0V7M9.3 7V4.1a.95.95 0 0 1 1.9 0v4.6c0 2.7-1.6 4.55-3.9 4.55-1.5 0-2.4-.8-3.2-2L2.9 8.9a.95.95 0 0 1 1.5-1.1l1.1 1.2" /></S>,
  branchIf: (p: P) => <S {...p}><path d="M8 2.75V7M8 7l-3.75 3.5v2.75M8 7l3.75 3.5v2.75" /></S>,
  comment: (p: P) => <S {...p}><path d="M4.25 2.75h7.5a1.5 1.5 0 0 1 1.5 1.5v5.25a1.5 1.5 0 0 1-1.5 1.5H7.5l-3.25 2.5V11a1.5 1.5 0 0 1-1.5-1.5V4.25a1.5 1.5 0 0 1 1.5-1.5Z" /></S>,
  label: (p: P) => <S {...p}><path d="M2.75 3.5v4.1l5.65 5.65 4.85-4.85L7.6 2.75H3.5a.75.75 0 0 0-.75.75Z" /><circle cx="5.6" cy="5.6" r=".9" /></S>,
  eye: (p: P) => <S {...p}><path d="M1.9 8S4.1 3.9 8 3.9 14.1 8 14.1 8 11.9 12.1 8 12.1 1.9 8 1.9 8Z" /><circle cx="8" cy="8" r="1.9" /></S>,
  offline: (p: P) => <S {...p}><path d="M2.5 6.2a8 8 0 0 1 2.4-1.5M7 4.3a8 8 0 0 1 6.5 1.9M4.6 8.6a4.8 4.8 0 0 1 4.6-1.2M6.7 10.9a1.9 1.9 0 0 1 2.6 0M3 3l10 10" /></S>,
  home: (p: P) => <S {...p}><path d="M2.75 7 8 2.75 13.25 7v5.25a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1Z" /><path d="M6.25 13.25v-3.5h3.5v3.5" /></S>,
  rotate: (p: P) => <S {...p}><path d="M2.75 8a5.25 5.25 0 1 0 1.54-3.71" /><path d="M3.75 1.9v2.75H6.5" /></S>,
  inbox: (p: P) => <S {...p}><path d="M2.75 9h3l.9 1.6h2.7l.9-1.6h3M4.4 3.25h7.2l1.65 5.75v3.75H2.75V9Z" /></S>,
  close2: (p: P) => <S {...p}><circle cx="8" cy="8" r="5.5" /><path d="m6 6 4 4m0-4-4 4" /></S>,
  dot: (p: P) => <S {...p} w={0}><circle cx="8" cy="8" r="3" fill="currentColor" /></S>,
  star: (p: P) => <S {...p}><path d="m8 2.6 1.6 3.4 3.7.5-2.7 2.5.7 3.7L8 10.9l-3.3 1.8.7-3.7-2.7-2.5 3.7-.5Z" /></S>,
  idea: (p: P) => <S {...p}><path d="M5.75 11.25v-.6c0-.55-.3-1.05-.7-1.45a4.25 4.25 0 1 1 5.9 0c-.4.4-.7.9-.7 1.45v.6ZM6.25 13.5h3.5" /></S>,
  flow: (p: P) => <S {...p}><circle cx="3.75" cy="8" r="1.75" /><circle cx="12.25" cy="4" r="1.75" /><circle cx="12.25" cy="12" r="1.75" /><path d="M5.5 8h.75c1.1 0 2-.9 2-2v-.5c0-.83.67-1.5 1.5-1.5h.75M6.25 8c1.1 0 2 .9 2 2v.5c0 .83.67 1.5 1.5 1.5h.75" /></S>,
  alert: (p: P) => <S {...p}><path d="M7.13 2.9a1 1 0 0 1 1.74 0l5.02 8.9a1 1 0 0 1-.87 1.5H2.98a1 1 0 0 1-.87-1.5Z" /><path d="M8 6.5v2.5M8 11.25v.01" /></S>,
  tool: (p: P) => <S {...p}><path d="M10.2 2.9a3.25 3.25 0 0 0-4 4.25L2.9 10.45a1.4 1.4 0 0 0 2 2L8.2 9.15a3.25 3.25 0 0 0 4.25-4l-2 2-1.6-.4-.4-1.6Z" /></S>,
};

/** The Liner Code mark. `draw` animates both strokes in, as in the intro. */
export function Mark({ size = 17, draw, className }: { size?: number; draw?: boolean; className?: string }) {
  return (
    <svg className={className} width={(size * 28) / 36.4} height={size} viewBox="0 0 28 36.4" aria-hidden data-draw={draw || undefined} style={{ flex: "none", overflow: "visible" }}>
      <path className="lc-mark-o" pathLength={1} d="M1.13 1.13V29.9a5.3 5.3 0 0 0 5.3 5.3h20.44" />
      <g className="lc-mark-g">
        <path className="lc-mark-i" pathLength={1} d="M8.76 1.13V26.2a1.55 1.55 0 0 0 1.55 1.55h16.56" />
      </g>
    </svg>
  );
}

/** An agent's glyph, for its disc. */
export function Glyph({ glyph, size = 13 }: { glyph: AgentGlyph; size?: number }) {
  switch (glyph) {
    case "sun":
      return <S size={size} w={1.4}><circle cx="8" cy="8" r="3" /><path d="M8 2.5v2.5M8 11v2.5M2.5 8H5M11 8h2.5M4.1 4.1l1.8 1.8M10.1 10.1l1.8 1.8M11.9 4.1l-1.8 1.8M5.9 10.1l-1.8 1.8" /></S>;
    case "moon":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
          <path d="M10.9 9.8A3.6 3.6 0 0 1 6.2 5.1a3.6 3.6 0 1 0 4.7 4.7Z" fill="currentColor" />
        </svg>
      );
    case "pen":
      return <S size={size} w={1.3}><path d="m9.6 4.7 1.7 1.7-4.9 4.9-2.1.4.4-2.1 4.9-4.9Z" /></S>;
    case "code":
      return <S size={size} w={1.4}><path d="M6 5 3 8l3 3M10 5l3 3-3 3" /></S>;
    case "scope":
      return <S size={size} w={1.3}><path d="M8 4.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8ZM8 3.4v2M8 10.6v2M3.4 8h2M10.6 8h2" /></S>;
    case "lens":
      return <S size={size}><path d="M7.2 4.4a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Zm2 4.8 2.4 2.4" /></S>;
    case "shapes":
      return <S size={size} w={1.3}><circle cx="5.75" cy="5.75" r="2.25" /><rect x="8.5" y="8.5" width="4.5" height="4.5" rx="1" /></S>;
    case "leaf":
      return <S size={size} w={1.3}><path d="M3.5 12.5c0-5 3-8.5 9-9 0 6-3.5 9-9 9ZM3.5 12.5 9 7" /></S>;
    default:
      return <S size={size} w={1.2}><path d="M8 3.9 9 7l3.1 1L9 9l-1 3.1L7 9 3.9 8 7 7Z" /></S>;
  }
}

/** Whose model it is: the maker's own mark, in the current ink. A model nobody's list knows gets a diamond. */
export type MarkKind = Brand | "other" | "demo";
export function ModelMark({ kind, size = 12 }: { kind: MarkKind; size?: number }) {
  if (kind === "demo") return <S size={size} w={1.3}><path d="M8 3.9 9 7l3.1 1L9 9l-1 3.1L7 9 3.9 8 7 7Z" /></S>;
  if (kind === "other")
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="lc-mark">
        <path d="M8 2.5 13.5 8 8 13.5 2.5 8Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden className="lc-mark" data-brand={kind}>
      {BRANDS[kind].paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/** Rays: an agent at work. */
export function Rays({ size = 10 }: { size?: number }) {
  return (
    <svg className="lc-rays" width={size} height={size} viewBox="0 0 10 10" aria-hidden>
      <circle cx="5" cy="5" r="2" fill="currentColor" />
      <path d="M5 0.5v1.4M5 8.1v1.4M0.5 5h1.4M8.1 5h1.4M1.8 1.8l1 1M7.2 7.2l1 1M8.2 1.8l-1 1M2.8 7.2l-1 1" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

/** Tool kinds, for the tile in a work row. */
export function ToolIcon({ kind, size = 12 }: { kind: string; size?: number }) {
  if (kind === "exec") return <I.terminal size={size} />;
  if (kind === "edit" || kind === "write") return <I.edit size={size} />;
  if (kind === "read") return <I.file size={size} />;
  if (kind === "search") return <I.search size={size} />;
  if (kind === "web" || kind === "fetch") return <I.globe size={size} />;
  if (kind === "task") return <I.agents size={size} />;
  if (kind === "think") return <I.idea size={size} />;
  return <I.tool size={size} />;
}
