/*
  Liner Code's icons: one family on a 16px grid, every stroke 1.5 at 16px with round caps and
  joins, each drawn as the thing people already know it by (a gear for settings, people for the
  team, a ± for a diff, an arrow out of a box for "open elsewhere"). One meaning per icon: Settle
  is a ticked circle, not the plain tick; Snooze is a moon, not a clock.
  The session bar's glyphs follow Claude Code's: boxed for what opens in the panel (Session,
  Changes), open for the rest (terminal, globe, folder). They're drawn for sharpness: every straight
  stroke sits on a quarter pixel (x.25 or x.75), so at 16px a 1.5 stroke fills whole device pixels
  on a 2x screen instead of smearing across two. Where a centre line can't be on one (±, the
  globe's equator) the glyph sits a quarter pixel off centre, which the eye doesn't see.
  The mark is the line comment, two slanted strokes, the first in ink and the second in the accent,
  as the app icon, the website and its favicon have it (docs/brand/line-comment). `mark` is that mark
  in small, for whatever an agent made or is; `markMono` is the same in one ink, where the accent
  would shout. (The two turns round one centre, docs/brand/icon-2026, was the mark before it.)

  The weight rule. This file used to say an icon is only ever shown at the size it was drawn for.
  It wasn't true: the call sites asked for 11, 12, 13, 14 and 15 as often as 16, and the stroke
  shrank with the icon, so one screen carried eight real line weights, from 0.89 to 1.7px. Now the
  wrappers set the stroke from the size asked for, so it lands at a real 1.5px from 14px up and
  1.25px below (thinner, because a 1.5 line closes up the counters of a 12px glyph). An icon that
  draws heavier on purpose (send's 1.7, the dots' 2, the level's bars) keeps that proportion to
  1.5, so its dots and bars don't thin out. Sizes in use are 12, 14, 16 and 20.
*/
import { useId, type CSSProperties, type ReactNode } from "react";
import type { AgentGlyph } from "@contracts";
import { BRANDS, TINTS, type Brand } from "./brands";
import type { MarkState } from "./session-state";
export type { MarkState } from "./session-state";

/** The stroke, in grid units, that lands at the real weight for `size`; `w` is the icon's own weight at 1.5, kept in proportion. */
export const wt = (size: number, grid: number, w = 1.5) => +((((size >= 14 ? 1.5 : 1.25) * grid) / size) * (w / 1.5)).toFixed(3);

type P = { size?: number; className?: string; style?: CSSProperties };
const S = ({ size = 16, children, className, style, w = 1.5 }: P & { children: ReactNode; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={wt(size, 16, w)} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className} style={style}>
    {children}
  </svg>
);

const GEAR = "M6.85 3.39 7.01 1.73h1.98l.16 1.66 1.3.54 1.28-1.07 1.41 1.41-1.07 1.28.54 1.3 1.66.16v1.98l-1.66.16-.54 1.3 1.07 1.28-1.41 1.41-1.28-1.07-1.3.54-.16 1.66H7.01l-.16-1.66-1.3-.54-1.28 1.07-1.41-1.41 1.07-1.28-.54-1.3-1.66-.16V7.01l1.66-.16.54-1.3-1.07-1.28 1.41-1.41 1.28 1.07Z";

export const I = {
  compose: (p: P) => <S {...p}><path d="M8 2.75H4.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5V8" /><path d="M11.85 2.65a1.3 1.3 0 0 1 1.85 1.85L8.2 10l-2.45.75.75-2.45Z" /></S>,
  search: (p: P) => <S {...p}><circle cx="7.25" cy="7.25" r="4.5" /><path d="m10.6 10.6 2.65 2.65" /></S>,
  filter: (p: P) => <S {...p}><path d="M2.75 4.25h10.5M4.75 8h6.5M6.75 11.75h2.5" /></S>,
  /** Sort: an arrow up beside an arrow down, their stems on quarter pixels. */
  sort: (p: P) => <S {...p}><path d="M5.25 12.75v-9.5M3 5.5l2.25-2.25L7.5 5.5M10.75 3.25v9.5M8.5 10.5l2.25 2.25L13 10.5" /></S>,
  routines: (p: P) => <S {...p}><path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" /><path d="M12.25 1.9v2.75H9.5M8 5.25V8l1.75 1" /></S>,
  folder: (p: P) => <S {...p}><path d="M2.25 4.75a1.5 1.5 0 0 1 1.5-1.5h2.38c.4 0 .78.16 1.06.44l1.06 1.06h4a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5h-8.5a1.5 1.5 0 0 1-1.5-1.5Z" /></S>,
  /** A folder to add; the old `folderAdd` was this with its plus a quarter pixel off. */
  folderPlus: (p: P) => <S {...p}><path d="M2.25 4.75a1.5 1.5 0 0 1 1.5-1.5h2.38c.4 0 .78.16 1.06.44l1.06 1.06h4a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5h-8.5a1.5 1.5 0 0 1-1.5-1.5Z" /><path d="M8 7.4v3.7M6.15 9.25h3.7" /></S>,
  pin: (p: P) => <S {...p}><path d="M6.25 2.75h3.5M6.75 2.75v3.4L4.75 8.4v1.85h6.5V8.4l-2-2.25v-3.4M8 10.25v3.25" /></S>,
  snooze: (p: P) => <S {...p}><path d="M8 2.5a4 4 0 0 0 5.5 5.5A5.5 5.5 0 1 1 8 2.5Z" /></S>,
  settle: (p: P) => <S {...p}><circle cx="8" cy="8" r="5.5" /><path d="m5.75 8.1 1.6 1.6 2.9-3.2" /></S>,
  /** The Reviewer passed the changes: a ticked circle, drawn apart from Settle so either can change. */
  verified: (p: P) => <S {...p}><circle cx="8" cy="8" r="5.75" /><path d="m5.5 8.25 1.75 1.75 3.25-3.5" /></S>,
  /** The small chevron after a title that opens its menu. */
  caret: (p: P) => <S {...p}><path d="m5.25 6.75 2.75 2.75 2.75-2.75" /></S>,
  check: (p: P) => <S {...p}><path d="M3.5 8.4 6.5 11.25 12.5 4.75" /></S>,
  chevR: (p: P) => <S {...p}><path d="M6.25 4.25 10 8l-3.75 3.75" /></S>,
  chevL: (p: P) => <S {...p}><path d="M9.75 4.25 6 8l3.75 3.75" /></S>,
  chevD: (p: P) => <S {...p}><path d="M4.25 6.25 8 10l3.75-3.75" /></S>,
  chevU: (p: P) => <S {...p}><path d="M4.25 9.75 8 6l3.75 3.75" /></S>,
  sidebar: (p: P) => <S {...p}><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.5" /><path d="M6.25 2.75v10.5" /></S>,
  /** The panel beside the session: a frame with its right part ruled off. (The old `dock` was the same drawing; it is this one now.) */
  panel: (p: P) => <S {...p}><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.25" /><path d="M9.75 2.75v10.5" /></S>,
  /** A panel along the foot; the old `bottom` was this drawing a quarter pixel off. */
  panelBottom: (p: P) => <S {...p}><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.5" /><path d="M2.25 9.75h11.5" /></S>,
  split: (p: P) => <S {...p}><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.25" /><path d="M8 2.75v10.5" /></S>,
  /** A diff in one column: the frame ruled across its middle, the mirror of `split`. */
  unified: (p: P) => <S {...p}><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.25" /><path d="M2.25 8h11.5" /></S>,
  /** The Wall: every session at once, four tiles. */
  wall: (p: P) => <S {...p}><rect x="2.25" y="2.25" width="4.5" height="4.5" rx="1.25" /><rect x="9.25" y="2.25" width="4.5" height="4.5" rx="1.25" /><rect x="2.25" y="9.25" width="4.5" height="4.5" rx="1.25" /><rect x="9.25" y="9.25" width="4.5" height="4.5" rx="1.25" /></S>,
  shrink: (p: P) => <S {...p}><path d="M2.75 9.25h4v4M13.25 6.75h-4v-4M9.25 6.75l4-4M6.75 9.25l-4 4" /></S>,
  /** The New tab guide: four tiles. */
  guide: (p: P) => <S {...p}><rect x="2.75" y="2.75" width="4" height="4" rx="1" /><rect x="9.25" y="2.75" width="4" height="4" rx="1" /><rect x="2.75" y="9.25" width="4" height="4" rx="1" /><rect x="9.25" y="9.25" width="4" height="4" rx="1" /></S>,
  /** A small app: a window with its title bar. */
  app: (p: P) => <S {...p}><rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.75" /><path d="M2.25 6.25h11.5M4.6 4.75h.01M6.35 4.75h.01" /></S>,
  list: (p: P) => <S {...p}><path d="M6.25 4.25h7M6.25 8h7M6.25 11.75h7M3 4.25h.01M3 8h.01M3 11.75h.01" /></S>,
  notes: (p: P) => <S {...p}><rect x="3.75" y="2.25" width="8.5" height="11.5" rx="1.25" /><path d="M6 5.5h4M6 8h4M6 10.5h2" /></S>,
  flask: (p: P) => <S {...p}><path d="M6.25 2.25h3.5M6.75 2.25v4L3.4 12.1a1 1 0 0 0 .87 1.4h7.46a1 1 0 0 0 .87-1.4L9.25 6.25v-4M4.9 9.5h6.2" /></S>,
  /** A page that takes the whole paper. */
  page: (p: P) => <S {...p}><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.25" /><path d="M2.25 5.75h11.5" /></S>,
  /** A tab beside Chat. */
  tab: (p: P) => <S {...p}><path d="M2.25 13.25V5a1 1 0 0 1 1-1h3.5l1.25 1.75h5a1 1 0 0 1 1 1v6.5Z" /></S>,
  agents: (p: P) => <S {...p}><circle cx="6" cy="5.5" r="2.25" /><path d="M2.25 13a3.75 3.75 0 0 1 7.5 0M10.25 3.35a2.25 2.25 0 0 1 0 4.3M11.6 9.65A3.75 3.75 0 0 1 13.75 13" /></S>,
  /** Work sent off: a stem with two branches, each ending in an agent. */
  fanout: (p: P) => <S {...p}><path d="M4.25 2.75v7.5a1.75 1.75 0 0 0 1.75 1.75h2.5M4.25 6.25h4.25" /><circle cx="10.25" cy="6.25" r="1.75" /><circle cx="10.25" cy="12" r="1.75" /></S>,
  changes: (p: P) => <S {...p}><rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.75" /><path d="M7.75 4.75v4M5.75 6.75h4M5.75 11.25h4" /></S>,
  branch: (p: P) => <S {...p}><circle cx="4.5" cy="12" r="1.5" /><circle cx="11.5" cy="4.25" r="1.5" /><path d="M4.5 2.75v7.75M11.5 5.75A6.25 6.25 0 0 1 6 12" /></S>,
  attach: (p: P) => <S {...p}><path d="M12.6 7.45 8.05 12a3.1 3.1 0 0 1-4.4-4.4l4.9-4.9a2.05 2.05 0 0 1 2.9 2.9L6.6 10.45a1.02 1.02 0 0 1-1.45-1.45l4.3-4.3" /></S>,
  send: (p: P) => <S {...p} w={1.7}><path d="M8 12.75V3.5M4.25 7.25 8 3.5l3.75 3.75" /></S>,
  stop: ({ size = 11, className }: P) => (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className={className}>
      <rect x="3" y="3" width="10" height="10" rx="2.2" fill="currentColor" />
    </svg>
  ),
  plug: (p: P) => <S {...p}><path d="M6 2.25v3M10 2.25v3M4 5.25h8v2a4 4 0 0 1-8 0ZM8 11.25v2.5" /></S>,
  blocks: (p: P) => <S {...p}><path d="M2.75 2.75h4.5v4.5h-4.5ZM2.75 8.75h4.5v4.5h-4.5ZM8.75 8.75h4.5v4.5h-4.5ZM11 2.1l3 3-3 3-3-3Z" /></S>,
  lock: (p: P) => <S {...p}><rect x="3.25" y="7" width="9.5" height="6.25" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></S>,
  effort: (p: P) => <S {...p}><path d="M2.75 11.5a5.25 5.25 0 1 1 10.5 0" /><path d="m8 11.5 2.5-3" /></S>,
  laptop: (p: P) => <S {...p}><path d="M3.25 10.25v-6a1 1 0 0 1 1-1h7.5a1 1 0 0 1 1 1v6M1.75 12.75h12.5" /></S>,
  details: (p: P) => <S {...p}><rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.75" /><path d="M5.25 5.75h.01M7.75 5.75h3M5.25 10.25h.01M7.75 10.25h3" /></S>,
  terminal: (p: P) => <S {...p}><path d="M3.75 4.75 7 8l-3.25 3.25M8.5 11.25h3.75" /></S>,
  push: (p: P) => <S {...p}><path d="M8 10.5V2.75M4.75 6 8 2.75 11.25 6M3 13.25h10" /></S>,
  download: (p: P) => <S {...p}><path d="M8 2.75v7.75M4.75 7.25 8 10.5l3.25-3.25M3 13.25h10" /></S>,
  external: (p: P) => <S {...p}><path d="M9.25 2.75h4v4M13.25 2.75 7.75 8.25M11.75 9.25v2.5a1.5 1.5 0 0 1-1.5 1.5h-6a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5h2.5" /></S>,
  file: (p: P) => <S {...p}><path d="M9.25 2.75h-4.5a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1h6.5a1 1 0 0 0 1-1v-6.5Z" /><path d="M9.25 2.75v2.25a.75.75 0 0 0 .75.75h2.25" /></S>,
  plus: (p: P) => <S {...p}><path d="M8 3.25v9.5M3.25 8h9.5" /></S>,
  close: (p: P) => <S {...p}><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></S>,
  expand: (p: P) => <S {...p}><path d="M9.75 2.75h3.5v3.5M6.25 13.25h-3.5v-3.5M13.25 2.75l-4 4M2.75 13.25l4-4" /></S>,
  wrap: (p: P) => <S {...p}><path d="M2.75 4h10.5M2.75 8h8.25a2 2 0 0 1 0 4H8.5M2.75 12h3M10 10.5 8.5 12l1.5 1.5" /></S>,
  /** Show spaces and tabs: the pilcrow, as editors mark their invisibles. */
  pilcrow: (p: P) => <S {...p}><path d="M10.75 13.25V2.75M7.75 13.25V2.75M12.5 2.75H7a2.75 2.75 0 0 0 0 5.5h.75" /></S>,
  /** Fold or unfold every file of a diff: two chevrons apart, up and down. */
  fold: (p: P) => <S {...p}><path d="M4.75 6 8 2.75 11.25 6M4.75 10 8 13.25 11.25 10" /></S>,
  usage: (p: P) => <S {...p}><path d="M2.75 2.75v9.5a1 1 0 0 0 1 1h9.5M6 10.25V7.5M9 10.25v-5M12 10.25V8.5" /></S>,
  settings: (p: P) => <S {...p}><path d={GEAR} /><circle cx="8" cy="8" r="2" /></S>,
  globe: (p: P) => <S {...p}><circle cx="7.75" cy="7.75" r="5.5" /><path d="M2.25 7.75h11M7.75 2.25c1.45 1.55 2.2 3.4 2.2 5.5s-.75 3.95-2.2 5.5c-1.45-1.55-2.2-3.4-2.2-5.5s.75-3.95 2.2-5.5Z" /></S>,
  undo: (p: P) => <S {...p}><path d="M5.75 3.75 3 6.5l2.75 2.75M3 6.5h6.75a3.25 3.25 0 0 1 0 6.5H7.25" /></S>,
  /** Carry on (the sidebar's row for work begun elsewhere): a path that bends back toward you, then goes on. */
  carry: (p: P) => <S {...p}><path d="M12.75 4.25H6.5a3.25 3.25 0 0 0 0 6.5h6.25M10.5 8.5l2.25 2.25L10.5 13" /></S>,
  commit: (p: P) => <S {...p}><circle cx="8" cy="8" r="2.5" /><path d="M1.75 8h3.75M10.5 8h3.75" /></S>,
  drag: (p: P) => <S {...p} w={2}><path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" /></S>,
  info: (p: P) => <S {...p}><circle cx="8" cy="8" r="5.75" /><path d="M8 7.4v3.6M8 5.15v.1" /></S>,
  layers: (p: P) => <S {...p}><path d="M8 2.25 13.75 5.5 8 8.75 2.25 5.5ZM2.25 9.25 8 12.5l5.75-3.25" /></S>,
  /** The four-point star, for AI pictures and brand starts in Design only; whatever an agent made or is takes `turn`. */
  sparkle: (p: P) => <S {...p}><path d="M8 2.25Q9.3 6.7 13.75 8 9.3 9.3 8 13.75 6.7 9.3 2.25 8 6.7 6.7 8 2.25Z" /></S>,
  refresh: (p: P) => <S {...p}><path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" /><path d="M12.25 1.9v2.75H9.5" /></S>,
  copy: (p: P) => <S {...p}><rect x="5.5" y="5.5" width="7.75" height="7.75" rx="1.5" /><path d="M10.5 5.5V4.25a1.5 1.5 0 0 0-1.5-1.5H4.25a1.5 1.5 0 0 0-1.5 1.5V9a1.5 1.5 0 0 0 1.5 1.5H5.5" /></S>,
  edit: (p: P) => <S {...p}><path d="M11.2 2.55a1.6 1.6 0 0 1 2.25 2.25l-7.7 7.7-3 .75.75-3ZM9.75 4l2.25 2.25" /></S>,
  trash: (p: P) => <S {...p}><path d="M2.75 4.25h10.5M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25M4.25 4.25l.55 8.2a1 1 0 0 0 1 .95h4.4a1 1 0 0 0 1-.95l.55-8.2" /></S>,
  /** Add-ons: a puzzle piece, as browsers and editors mark extensions; nothing like the Wall's tiles. Half-circle knobs at the middle of a square body, the whole piece centred on the grid. */
  puzzle: (p: P) => <S {...p}><path d="M2.75 5a.75.75 0 0 1 .75-.75h2.25a1.5 1.5 0 0 1 3 0h2.25a.75.75 0 0 1 .75.75v2.25a1.5 1.5 0 0 1 0 3v2.25a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75Z" /></S>,
  /** How hard it thinks: three bars that step up, as many dark as the level (1 to 3). */
  level: ({ n = 2, ...p }: P & { n?: number }) => (
    <S {...p} w={2.5}>
      <path d="M4 12.25v-2.5" strokeOpacity={n >= 1 ? 1 : 0.28} />
      <path d="M8 12.25v-5.5" strokeOpacity={n >= 2 ? 1 : 0.28} />
      <path d="M12 12.25v-8.5" strokeOpacity={n >= 3 ? 1 : 0.28} />
    </S>
  ),
  /** Goes ahead on its own: two arrowheads, as Claude Code marks accepting edits. */
  auto: (p: P) => <S {...p}><path d="M3.75 4.5 7.25 8l-3.5 3.5M8.75 4.5 12.25 8l-3.5 3.5" /></S>,
  /** The box's commands: a slash in a square. */
  slash: (p: P) => <S {...p}><rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.75" /><path d="M9.25 5.5 6.75 10.5" /></S>,
  more: (p: P) => <S {...p} w={2}><path d="M4 8h.01M8 8h.01M12 8h.01" /></S>,
  fork: (p: P) => <S {...p}><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="11.5" cy="3.5" r="1.5" /><circle cx="8" cy="12.5" r="1.5" /><path d="M4.5 5v1a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V5M8 8v3" /></S>,
  sliders: (p: P) => <S {...p}><path d="M2.75 5h5M11.25 5h2M2.75 11h2M8.25 11h5" /><circle cx="9.5" cy="5" r="1.75" /><circle cx="6.5" cy="11" r="1.75" /></S>,
  contrast: (p: P) => <S {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11a5.5 5.5 0 0 0 0-11Z" fill="currentColor" stroke="none" /></S>,
  bell: (p: P) => <S {...p}><path d="M4.25 6.75a3.75 3.75 0 0 1 7.5 0c0 3.5 1.5 4.5 1.5 4.5H2.75s1.5-1 1.5-4.5M6.75 13.5a1.4 1.4 0 0 0 2.5 0" /></S>,
  keyboard: (p: P) => <S {...p}><rect x="1.75" y="3.75" width="12.5" height="8.5" rx="1.75" /><path d="M4.5 6.5h.01M6.83 6.5h.01M9.17 6.5h.01M11.5 6.5h.01M5.5 9.5h5" /></S>,
  chip: (p: P) => <S {...p}><rect x="4" y="4" width="8" height="8" rx="1.5" /><path d="M6.5 1.75V4M9.5 1.75V4M6.5 12v2.25M9.5 12v2.25M1.75 6.5H4M1.75 9.5H4M12 6.5h2.25M12 9.5h2.25" /></S>,
  shield: (p: P) => <S {...p}><path d="M8 13.75s4.75-1.9 4.75-6.15V3.9L8 2.25 3.25 3.9v3.7C3.25 11.85 8 13.75 8 13.75Z" /><path d="m6 7.9 1.4 1.4 2.6-2.8" /></S>,
  shieldOff: (p: P) => <S {...p}><path d="M12.75 7.6V3.9L8 2.25 5.6 3.08M3.25 4.6v3c0 4.25 4.75 6.15 4.75 6.15s1.7-.68 3.05-2.05M2.25 2.25l11.5 11.5" /></S>,
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
  /** A pen nib, as design tools draw their pen. */
  design: (p: P) => <S {...p}><path d="M8 13.25 4.25 8.5 6 2.75h4l1.75 5.75Z" /><path d="M8 13.25V9.4" /><circle cx="8" cy="8.25" r="1.15" /></S>,
  play: (p: P) => <S {...p}><path d="M5.25 4.3v7.4a.9.9 0 0 0 1.36.77l6.1-3.7a.9.9 0 0 0 0-1.54l-6.1-3.7a.9.9 0 0 0-1.36.77Z" /></S>,
  /** A dev server: a box of two racks. */
  server: (p: P) => <S {...p}><rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.25" /><path d="M2.75 8h10.5M5.25 5.4h2M5.25 10.6h2" /></S>,
  bolt: (p: P) => <S {...p}><path d="M8.75 1.75 3.75 9h4L7 14.25l5-7.25H8Z" /></S>,
  clock: (p: P) => <S {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.25" /></S>,
  /** A calendar page: a period to pick (Security's Overview). */
  calendar: (p: P) => <S {...p}><rect x="2.75" y="3.5" width="10.5" height="9.75" rx="2" /><path d="M2.75 6.75h10.5M5.5 2.25v2.5M10.5 2.25v2.5" /></S>,
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
  /** Not started, or waiting its turn: an empty ring, the size of the tick's reach, so a list of steps keeps one column. */
  ring: (p: P) => <S {...p}><circle cx="8" cy="8" r="4.25" /></S>,
  /** The step in work, held still: the same ring with its middle lit (line and dot, 2026-11-27). */
  now: (p: P) => <S {...p}><circle cx="8" cy="8" r="4.25" /><circle cx="8" cy="8" r="1.75" fill="currentColor" stroke="none" /></S>,
  star: (p: P) => <S {...p}><path d="m8 2.6 1.6 3.4 3.7.5-2.7 2.5.7 3.7L8 10.9l-3.3 1.8.7-3.7-2.7-2.5 3.7-.5Z" /></S>,
  flow: (p: P) => <S {...p}><circle cx="3.75" cy="8" r="1.75" /><circle cx="12.25" cy="4" r="1.75" /><circle cx="12.25" cy="12" r="1.75" /><path d="M5.5 8h.75c1.1 0 2-.9 2-2v-.5c0-.83.67-1.5 1.5-1.5h.75M6.25 8c1.1 0 2 .9 2 2v.5c0 .83.67 1.5 1.5 1.5h.75" /></S>,
  alert: (p: P) => <S {...p}><path d="M7.13 2.9a1 1 0 0 1 1.74 0l5.02 8.9a1 1 0 0 1-.87 1.5H2.98a1 1 0 0 1-.87-1.5Z" /><path d="M8 6.5v2.5M8 11.25v.01" /></S>,
  monitor: (p: P) => <S {...p}><rect x="2" y="3" width="12" height="8" rx="1.5" /><path d="M6 13.25h4M8 11v2.25" /></S>,
  tablet: (p: P) => <S {...p}><rect x="3.5" y="2" width="9" height="12" rx="1.75" /><path d="M7.25 11.75h1.5" /></S>,
  code: (p: P) => <S {...p}><path d="M5.75 5 2.75 8l3 3M10.25 5l3 3-3 3" /></S>,
  /** Goes ahead by itself (the Auto permission): a step forward, up to a bar. */
  ahead: (p: P) => <S {...p}><path d="M3.75 4.3v7.4a.75.75 0 0 0 1.15.63l5.6-3.7a.75.75 0 0 0 0-1.26L4.9 3.67a.75.75 0 0 0-1.15.63Z" /><path d="M12.75 3.75v8.5" /></S>,
  /** One model on its own: a single node. */
  node: (p: P) => <S {...p}><circle cx="8" cy="8" r="4.75" /><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" /></S>,
  minus: (p: P) => <S {...p}><path d="M3.5 8h9" /></S>,
  fit: (p: P) => <S {...p}><path d="M2.75 5.75v-3h3M13.25 5.75v-3h-3M2.75 10.25v3h3M13.25 10.25v3h-3" /></S>,
  /** Actual size, 100%: a 1:1, as no other glyph here says it and `expand` already means the full canvas. */
  actual: (p: P) => <S {...p}><path d="M4.25 5.5 5.75 4.25v7.5M10.25 5.5l1.5-1.25v7.5M8 6.75h.01M8 9.75h.01" /></S>,
  tool: (p: P) => <S {...p}><path d="M10.2 2.9a3.25 3.25 0 0 0-4 4.25L2.9 10.45a1.4 1.4 0 0 0 2 2L8.2 9.15a3.25 3.25 0 0 0 4.25-4l-2 2-1.6-.4-.4-1.6Z" /></S>,
  /**
    Liner's mark in small: the line comment, two slanted strokes, the first in ink and the second in the accent, the site's
    24 grid (site/src/components/Mark.astro) scaled onto this 16 one about its centre. Drawn at 2, heavier than the family's
    1.5 on purpose, as the logo is a bold mark and not a line glyph. For what an agent made, or an agent with no logo.
  */
  mark: (p: P) => <S {...p} w={2}><path d="M3.45 13.05 7.05 2.95" /><path d="M8.95 13.05 12.55 2.95" stroke="var(--l-accent)" /></S>,
  /** The mark in one ink, where the accent would shout (the Demo's mark, a custom agent's disc). */
  markMono: (p: P) => <S {...p} w={2}><path d="M3.45 13.05 7.05 2.95M8.95 13.05 12.55 2.95" /></S>,
  /** Best: a cut stone, the finest you have; a star would read as a favourite or a rating. */
  gem: (p: P) => <S {...p}><path d="M5 3.25h6l2.75 3.5L8 13 2.25 6.75Z" /><path d="M2.25 6.75h11.5M6.25 6.75 8 13l1.75-6.25" /></S>,
  /** Fast: a step forward with motion lines. The bolt stays for triggers. */
  speed: (p: P) => <S {...p}><path d="M8.5 4.25 12.25 8 8.5 11.75" /><path d="M2.75 5.75h3M1.75 8h4.5M2.75 10.25h3" /></S>,
  /** Fusion: two rings that overlap, two models working as one. */
  fusion: (p: P) => <S {...p} w={2}><path d="M3.45 13.05 7.05 2.95" /><path d="M8.95 13.05 12.55 2.95" stroke="var(--lc-act)" /></S>,
  /** Modes: a switch, because you pick how it works. */
  toggle: (p: P) => <S {...p}><rect x="1.75" y="4.5" width="12.5" height="7" rx="3.5" /><circle cx="10.75" cy="8" r="1.75" fill="currentColor" stroke="none" /></S>,
  /** Thinking: the comment bubble with three dots, the agent mid-thought. The dots are heavier, kept in proportion. */
  think: ({ size = 16, ...p }: P) => (
    <S size={size} {...p}>
      <path d="M8 2.75c3.04 0 5.25 2.02 5.25 4.75S11.04 12.25 8 12.25c-.62 0-1.2-.08-1.75-.24L3.25 13.25l.8-2.4C3.18 10 2.75 8.8 2.75 7.5 2.75 4.77 4.96 2.75 8 2.75Z" />
      <path d="M5.75 7.5h.01M8 7.5h.01M10.25 7.5h.01" strokeWidth={wt(size, 16, 2)} />
    </S>
  ),
  /** Asks before it goes on: the same bubble with a question mark, legible at any size. */
  ask: (p: P) => <S {...p}><path d="M8 2.75c3.04 0 5.25 2.02 5.25 4.75S11.04 12.25 8 12.25c-.62 0-1.2-.08-1.75-.24L3.25 13.25l.8-2.4C3.18 10 2.75 8.8 2.75 7.5 2.75 4.77 4.96 2.75 8 2.75Z" /><path d="M6.6 6.2a1.45 1.45 0 0 1 2.8.45c0 .95-1.4 1.15-1.4 2.05M8 10.15v.01" /></S>,
  /** Some package: a plain cube, for a model or tool with no logo of its own. */
  cube: (p: P) => <S {...p}><path d="M8 2.25 13.25 5.25v5.5L8 13.75 2.75 10.75v-5.5Z" /><path d="M2.75 5.25 8 8.25l5.25-3M8 8.25v5.5" /></S>,
};

/** An agent's glyph, for its disc. The ids are what saved profiles hold, so they keep their names when a drawing changes: `sun` is drawn as an orbit, `scope` as a crosshair, `pen` as the family's quill, and `spark` (the default, a custom agent) as the turn in one ink. */
export function Glyph({ glyph, size = 14 }: { glyph: AgentGlyph; size?: number }) {
  switch (glyph) {
    case "sun":
      return <S size={size}><circle cx="8" cy="8" r="1.75" fill="currentColor" stroke="none" /><ellipse cx="8" cy="8" rx="5.75" ry="2.6" transform="rotate(-32 8 8)" /></S>;
    case "moon":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
          <path d="M10.9 9.8A3.6 3.6 0 0 1 6.2 5.1a3.6 3.6 0 1 0 4.7 4.7Z" fill="currentColor" />
        </svg>
      );
    case "pen":
      return <I.edit size={size} />;
    case "code":
      return <S size={size}><path d="M6 5 3 8l3 3M10 5l3 3-3 3" /></S>;
    case "scope":
      return <S size={size}><circle cx="8" cy="8" r="4.25" /><path d="M8 1.75v2.5M8 11.75v2.5M1.75 8h2.5M11.75 8h2.5" /><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none" /></S>;
    case "lens":
      return <S size={size}><path d="M7.2 4.4a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Zm2 4.8 2.4 2.4" /></S>;
    case "shapes":
      return <S size={size}><circle cx="5.75" cy="5.75" r="2.25" /><rect x="8.5" y="8.5" width="4.5" height="4.5" rx="1" /></S>;
    case "leaf":
      return <S size={size}><path d="M3.25 12.75C3.25 7.25 6.5 3.75 12.75 3.25c-.25 6-3.75 9.5-9.5 9.5ZM3.25 12.75 8.5 7.5" /></S>;
    default:
      return <I.markMono size={size} />;
  }
}

/*
  The navigation icons: the same family drawn again on a 20px grid, for the sidebar's rows, the
  rail of surfaces and the top row. They're meant for 20px, where a 1.5 stroke fills whole device
  pixels; asked for another size they follow the same weight rule as `I`.
*/
const L = ({ size = 20, children, className, style }: P & { children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={wt(size, 20)} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className} style={style}>
    {children}
  </svg>
);
const F20 = <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="3.25" />;
const B20 = <rect x="2.75" y="2.75" width="14.5" height="14.5" rx="3.5" />;
export const N = {
  sidebar: (p: P) => <L {...p}>{F20}<path d="M7.75 3.75v12.5" /></L>,
  back: (p: P) => <L {...p}><path d="M8.75 4.75 3.5 10l5.25 5.25M3.75 10H16.5" /></L>,
  forward: (p: P) => <L {...p}><path d="M11.25 4.75 16.5 10l-5.25 5.25M16.25 10H3.5" /></L>,
  plus: (p: P) => <L {...p}><path d="M9.75 4v11.5M4 9.75h11.5" /></L>,
  search: (p: P) => <L {...p}><circle cx="9.25" cy="9.25" r="5.5" /><path d="m13.25 13.25 3.5 3.5" /></L>,
  wall: (p: P) => <L {...p}><rect x="2.75" y="2.75" width="6" height="6" rx="1.75" /><rect x="11.25" y="2.75" width="6" height="6" rx="1.75" /><rect x="2.75" y="11.25" width="6" height="6" rx="1.75" /><rect x="11.25" y="11.25" width="6" height="6" rx="1.75" /></L>,
  /** Add-ons: `I.puzzle` drawn again on this grid, knobs of radius 2 at the middle of an 11.5 body. */
  puzzle: (p: P) => <L {...p}><path d="M3.25 6.25a1 1 0 0 1 1-1h2.75a2 2 0 0 1 4 0h2.75a1 1 0 0 1 1 1v2.75a2 2 0 0 1 0 4v2.75a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1Z" /></L>,
  routines: (p: P) => <L {...p}><path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6" /><path d="M15.25 2.5v3.4h-3.4M10 6.5V10l2.25 1.25" /></L>,
  /** The gear drawn on this grid, not the 16px one scaled up. */
  settings: (p: P) => <L {...p}><path d="M8.8 4.53 8.98 2.82 11.02 2.82 11.2 4.53 13.02 5.28 14.35 4.2 15.8 5.65 14.72 6.98 15.47 8.8 17.18 8.98 17.18 11.02 15.47 11.2 14.72 13.02 15.8 14.35 14.35 15.8 13.02 14.72 11.2 15.47 11.02 17.18 8.98 17.18 8.8 15.47 6.98 14.72 5.65 15.8 4.2 14.35 5.28 13.02 4.53 11.2 2.82 11.02 2.82 8.98 4.53 8.8 5.28 6.98 4.2 5.65 5.65 4.2 6.98 5.28Z" /><circle cx="10" cy="10" r="2.5" /></L>,
  session: (p: P) => <L {...p}>{B20}<path d="M6.5 7.25h.01M9.5 7.25h4M6.5 12.75h.01M9.5 12.75h4" /></L>,
  changes: (p: P) => <L {...p}>{B20}<path d="M9.75 5.75v5M7.25 8.25h5M7.25 13.75h5" /></L>,
  folder: (p: P) => <L {...p}><path d="M2.75 6a2 2 0 0 1 2-2h2.9c.53 0 1.04.21 1.41.59l1.19 1.16h5a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H4.75a2 2 0 0 1-2-2Z" /></L>,
  globe: (p: P) => <L {...p}><circle cx="9.75" cy="9.75" r="7" /><path d="M2.75 9.75h14M9.75 2.75c1.85 1.95 2.8 4.3 2.8 7s-.95 5.05-2.8 7c-1.85-1.95-2.8-4.3-2.8-7s.95-5.05 2.8-7Z" /></L>,
  terminal: (p: P) => <L {...p}><path d="m4.75 6 4 4-4 4M10.75 14h4.5" /></L>,
  design: (p: P) => <L {...p}><path d="M10 16.5 5.25 10.6 7.5 3.5h5l2.25 7.1Z" /><path d="M10 16.5v-4.75" /><circle cx="10" cy="10.3" r="1.45" /></L>,
  agents: (p: P) => <L {...p}><circle cx="7.5" cy="6.75" r="2.75" /><path d="M2.75 16.25a4.75 4.75 0 0 1 9.5 0M12.75 4.1a2.75 2.75 0 0 1 0 5.3M14.5 12.05a4.75 4.75 0 0 1 2.75 4.2" /></L>,
  app: (p: P) => <L {...p}><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5" /><path d="M2.75 7.75h14.5M5.75 5.75h.01M8 5.75h.01" /></L>,
  /** Liner Security's Overview: a shield, as the face's own mark. */
  shield: (p: P) => <L {...p}><path d="M10 3.25 15.75 5.4v4.35c0 3.6-2.35 6.05-5.75 7.1-3.4-1.05-5.75-3.5-5.75-7.1V5.4Z" /></L>,
  /** Findings: a list being looked through. */
  findings: (p: P) => <L {...p}><path d="M3.25 5.75h3.5M3.25 10h2.5M3.25 14.25h3.5" /><circle cx="12.25" cy="9.25" r="3.5" /><path d="m14.75 11.75 2 2" /></L>,
  /** The surfaces the right edge's + opens (Side chat, Pull request, Linked pull requests, Device), drawn again on this grid so a lit one weighs what the four above it do. */
  comment: (p: P) => <L {...p}><path d="M5.25 3.75h9.5a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2H9.75l-3.5 3v-3h-1a2 2 0 0 1-2-2v-5.5a2 2 0 0 1 2-2Z" /></L>,
  pr: (p: P) => <L {...p}><circle cx="5.75" cy="4.75" r="1.75" /><circle cx="5.75" cy="15.25" r="1.75" /><circle cx="14.25" cy="15.25" r="1.75" /><path d="M5.75 6.5v7M14.25 13.5V8.25a2.5 2.5 0 0 0-2.5-2.5h-2.5M11.25 3.75l-2 2 2 2" /></L>,
  link: (p: P) => <L {...p}><path d="M8.5 11.5a3.5 3.5 0 0 0 4.95 0l2.55-2.55a3.5 3.5 0 0 0-4.95-4.95l-.75.75M11.5 8.5a3.5 3.5 0 0 0-4.95 0L4 11.05A3.5 3.5 0 0 0 8.95 16l.75-.75" /></L>,
  device: (p: P) => <L {...p}><rect x="5.75" y="2.75" width="8.5" height="14.5" rx="2.25" /><path d="M9.25 14.25h1.5" /></L>,
  /** The session header's ···: three dots on this grid, so it weighs what the icons before it do. */
  more: (p: P) => <L {...p}><circle cx="4.75" cy="10" r="1.25" fill="currentColor" stroke="none" /><circle cx="10" cy="10" r="1.25" fill="currentColor" stroke="none" /><circle cx="15.25" cy="10" r="1.25" fill="currentColor" stroke="none" /></L>,
};

/** Whose model it is, or which tool runs it: its logo in the current ink. A model nobody's list knows gets a plain cube; the Demo gets the turn in one ink. */
export type MarkKind = Brand | "other" | "demo";
export function ModelMark({ kind, size = 12 }: { kind: MarkKind; size?: number }) {
  const cut = useId();
  // The logo's own colour rides on --lc-tint, which only a place that wants colour (the model picker, models.css) paints with.
  const tint = kind !== "demo" && kind !== "other" ? TINTS[kind] : undefined;
  if (kind !== "demo" && kind !== "other" && BRANDS[kind].paths.length)
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="lc-mark" data-brand={kind} fill="currentColor" fillRule="evenodd" style={tint ? ({ "--lc-tint": typeof tint === "string" ? tint : `url("#${cut}")` } as CSSProperties) : undefined}>
        {Array.isArray(tint) && (
          <defs>
            <linearGradient id={cut} x1="0" y1="0" x2="1" y2="1">
              {tint.map((c, i) => (
                <stop key={c} offset={i / (tint.length - 1)} stopColor={c} />
              ))}
            </linearGradient>
          </defs>
        )}
        {BRANDS[kind].paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
    );
  if (kind === "demo") return <I.markMono size={size} />;
  if (kind === "other") return <I.cube size={size} className="lc-mark" />;
  const { letters } = BRANDS[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="lc-mark" data-brand={kind}>
      <mask id={cut}>
        <rect width="16" height="16" rx="4.5" fill="#fff" />
        <text x="8" y="8.6" textAnchor="middle" dominantBaseline="middle" fill="#000" fontFamily="var(--l-font-display, system-ui)" fontWeight="700" fontSize={letters.length > 1 ? 7.6 : 9.6} letterSpacing={letters.length > 1 ? -0.4 : 0}>
          {letters}
        </text>
      </mask>
      <rect width="16" height="16" rx="4.5" fill="currentColor" mask={`url("#${cut}")`} />
    </svg>
  );
}

/** Each state of the mark in words, for a screen reader and a tooltip: what a caller passes as `label` when it has nothing more exact to say. */
export const MARK_WORD: Record<MarkState, string> = {
  working: "Working",
  needs: "Needs you",
  fresh: "Finished, not opened yet",
  done: "Finished",
  seen: "Waits for your answer",
  new: "Not started",
  pr: "Pull request open",
  checks: "Checks running",
  ready: "Ready to merge",
  merged: "Merged",
  problem: "Ran into a problem",
  limit: "Hit its plan's limit",
};

/*
  The pixel and the gap for each box size (line and dot, 2026-11-27): a compact box of square pixels, set in the middle of
  the mark's own square so it lines up with the icons beside it. 14 is the board's (3px pixels a pixel apart, 11 across);
  the others keep every pixel and gap on a whole device pixel at 2x. A size off the set scales from 14.
*/
const MARK_GRID: Record<number, [number, number]> = { 12: [2.5, 1], 14: [3, 1], 16: [3.5, 1], 20: [4.5, 1.5] };
const markGrid = (size: number): [number, number] => {
  if (MARK_GRID[size]) return MARK_GRID[size];
  return [Math.max(2, Math.round((size * 6) / 14) / 2), Math.max(1, Math.round((size * 2) / 14) / 2)];
};

/**
  How anything stands, as one mark everywhere (session-state.ts MarkState): a compact 3×3 box of square
  pixels (line and dot, 2026-11-27), each state a pattern and a colour. Working is three lit pixels
  travelling round the box in steps, in the progress yellow, the rest of the box at rest: the one mark that
  moves. Needs you and every warning light all nine in amber, Failed all nine in red, New to you is a blue
  cross. No tint by model. `brand` is still taken (the places that pass a model's mark need no change)
  but no longer colours it, and nor does `tint`: a Working mark is the same yellow wherever it is. Only a mark on a coloured chip (a Design frame's lead or sidekick tag)
  takes the chip's own white, from app.css, so a dark dot never sits on the lead's colour. Checks is a light
  crossing corner to corner. A change of `state` plays across the dots, so keep the mark mounted and
  change the state (don't key it by its state). With a `label` it is an image that says its state;
  without one it is decoration. Styles: app.css, the block headed "The state mark".
*/
export function StateMark({ state, size = 14, label, tint, brand, className }: { state: MarkState; size?: number; label?: string; tint?: string; brand?: MarkKind; className?: string }) {
  const [d, g] = markGrid(size);
  // `tint` is taken and dropped (RULING 5): who runs a model is said by its name, never by the mark's colour.
  void tint;
  const style = { "--mk-d": `${d}px`, "--mk-g": `${g}px`, "--mk-box": `${size}px` } as CSSProperties;
  // A question you have seen and not answered yet ("Grey once seen", the owner's ruling): no mark is drawn, never the done tick,
  // since it still waits. Its name stays for a screen reader where one is given.
  if (state === "seen") return label ? <span className="l-sr-only" data-s="seen" role="img" aria-label={label} /> : null;
  // Done is the board's tick in the ok green (the step mark's tick), never a box of pixels: a grey plus read as New to you.
  if (state === "done")
    return (
      <span className={className ? `lc-mk ${className}` : "lc-mk"} data-s="done" data-step="tick" data-tone="ok" style={{ width: size, height: size } as CSSProperties} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
        <I.check size={size} />
      </span>
    );
  return (
    <span className={className ? `lc-mk ${className}` : "lc-mk"} data-s={state} data-brand={brand} style={style} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export type StepState = "waiting" | "working" | "done" | "skipped" | "failed";
const STEP_WORD: Record<StepState, string> = { waiting: "Waiting", working: "Working", done: "Finished", skipped: "Skipped", failed: "Ran into a problem" };
/* A step that waits or was skipped has not started, so both are the empty ring and its words tell them apart. The step in work is "now". */
const STEP_SHAPE: Record<StepState, "tick" | "ring" | "cross" | "now"> = { waiting: "ring", working: "now", done: "tick", skipped: "ring", failed: "cross" };
/**
  How a step stands, in lists of steps and agents (the Plan, Tasks, an agent's rows, step trails, tool
  checks, add-on steps): finished is a plain tick in the fourth ink; not started or waiting is an
  empty ring; failed is a cross in the danger colour; the step in work is a still ring with its middle
  lit, in ink (line and dot, 2026-11-27: in a plan nothing moves, and there is no 3×3 box). Every shape
  sits in one box of `size`, carries the classes lc-mk and lc-stepmark (so the lists that place a mark
  keep placing it) and data-step with its shape, and says its state to a screen reader. `tone="ok"` is
  for a check that passed (a pull request's checks, a build's): its tick is green, where a step that is
  done keeps the grey one. `live` is for a row that is the only sign that something runs (a tool check,
  a commit being pushed, a scan between turns): there the step in work is the state mark's moving
  Working box instead.
*/
export function StepMark({ state, size = 16, label, tone, live, className }: { state: StepState; size?: number; label?: string; tone?: "ok"; live?: boolean; className?: string }) {
  const cls = [className ? `lc-stepmark ${className}` : "lc-stepmark", live ? "lc-mk-live" : ""].filter(Boolean).join(" ");
  const word = label ?? STEP_WORD[state];
  if (state === "working" && live) return <StateMark state="working" size={size} label={word} className={cls} />;
  const shape = STEP_SHAPE[state];
  const Icon = shape === "tick" ? I.check : shape === "cross" ? I.close : shape === "now" ? I.now : I.ring;
  return (
    <span className={`lc-mk ${cls}`} data-step={shape} data-tone={tone} style={{ width: size, height: size } as CSSProperties} role="img" aria-label={word}>
      <Icon size={size} />
    </span>
  );
}
