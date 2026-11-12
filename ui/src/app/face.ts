/*
  The little of Liner Design that Liner Code itself needs, so nothing else of it loads for someone
  who never opens it: which face the window shows (Code or Design, kept per window), and whether
  the turn running now is drawing on a design file (for "Watch on the canvas" in the composer).
  Everything else, the canvas and its store included, loads with the Design face (design/).
*/
import { useSyncExternalStore } from "react";
import type { Item } from "@contracts";
import "./face.css";

export type Face = "code" | "design";
const KEY = "liner.face";
let face: Face = (() => {
  try {
    return sessionStorage.getItem(KEY) === "design" ? "design" : "code";
  } catch {
    return "code";
  }
})();
const listeners = new Set<() => void>();

export const getFace = () => face;
export function setFace(next: Face) {
  try {
    sessionStorage.setItem(KEY, next);
  } catch {
    // a window without storage keeps the face until it closes
  }
  if (face === next) return;
  face = next;
  for (const l of listeners) l();
}
export const toggleFace = () => setFace(face === "design" ? "code" : "design");
export const subscribeFace = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const useFace = () => useSyncExternalStore(subscribeFace, getFace);

type Tool = Extract<Item, { kind: "tool" }>;
/** A tool call that draws on a design file: Liner's design tools by any tool's name for them. */
export const CANVAS_TOOL = /^(?:mcp__liner__|liner\.|liner_)?design_(frame|node|picture|built)\b/;
const framePath = (p?: string) => (p && /\.liner\/designs\/[^/]+\/frames\/[^/]+\.html$/.test(p.replace(/\\/g, "/")) ? p.replace(/\\/g, "/") : undefined);
const nameIn = (input?: string, key = "name") => {
  try {
    const v = (JSON.parse(input ?? "") as Record<string, unknown>)[key];
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
};

/** What the agent is drawing in the turn that runs now, if it's drawing: the call, and the frame it names. */
export function drawingOf(items: Item[]): { tool: Tool; frame?: string } | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "user" || it.kind === "checkpoint") return undefined;
    if (it.kind !== "tool" || it.status !== "running") continue;
    if (CANVAS_TOOL.test(it.tool)) return { tool: it, frame: nameIn(it.input) ?? nameIn(it.input, "frame") };
    const p = framePath(it.path);
    if (p && (it.toolKind === "edit" || it.toolKind === "write")) return { tool: it, frame: p.split("/").pop()!.replace(/\.html$/, "") };
  }
  return undefined;
}
