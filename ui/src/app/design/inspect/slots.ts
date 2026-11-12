/*
  Places in the inspector other parts fill, a line each:
  - STYLE_TOP, sections at the top of Style for a node of some kinds (a picture's "Made by / Asked
    for"), above the inspector's own. `render` gets the target (the selected nodes and how to
    change them, target.ts).
  - FOOT, what sits in the foot of the column, level with the composer ("6 frames, none built
    yet" and Build). With nothing in it, the foot isn't drawn.
*/
import type { ReactNode } from "react";
import type { NodeRef } from "@contracts";
import type { Target } from "./target";

export type StyleSlot = { id: string; kinds?: NodeRef["kind"][]; render: (t: Target) => ReactNode };
export const STYLE_TOP: StyleSlot[] = [];

export type FootSlot = { id: string; render: () => ReactNode };
export const FOOT: FootSlot[] = [];
