/*
  The inspector's tabs, in its top row, as a list each feature adds one line to (Style and Code
  here; Build and Checks join later). `count` is a number beside the name (Checks 4), read from
  the Design face's state. `head: false` leaves out the selected layer's name row, for a tab about
  the whole file (Build). A tab is shown whatever is selected, so its render says what it needs
  (Empty, from Inspector.tsx, says how to select). The other slots are in slots.ts.
*/
import { createElement, type ReactNode } from "react";
import type { DesignState } from "../store";
import { StyleTab } from "./Style";
import { CodeTab } from "../CodeTab";
import { BuildTab } from "../BuildTab";
import { ChecksTab, checksCount } from "../ChecksTab";

export type InspectorTab = { id: string; label: string; count?: (s: DesignState) => number | undefined; head?: false; render: () => ReactNode };

export const TABS: InspectorTab[] = [
  { id: "style", label: "Style", render: () => createElement(StyleTab) },
  { id: "code", label: "Code", render: () => createElement(CodeTab) },
  { id: "build", label: "Build", head: false, render: () => createElement(BuildTab) },
  { id: "checks", label: "Checks", count: () => checksCount(), head: false, render: () => createElement(ChecksTab) },
];
