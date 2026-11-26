/*
  Liner Design's canvas tools, as an agent is told of them: data only, which liner-tools.ts lists
  and canvas.ts answers (canvas.ts re-exports it as its TOOLS). mcp.ts runs on its own and reads
  this list, so nothing here may import anything that does anything.

  `design` names a design file of the folder by its slug (.liner/designs/<slug>/); left out, it's
  the one the person has open, else the only one. `frame` is a frame's id or its name.
*/
import type { ToolDef } from "./liner-tools.ts";

export const TOOLS: ToolDef[] = [
  {
    name: "design_files",
    description:
      "The design files of this session's folder, for Liner Design: each file's frames (id, name, size, the HTML file it is, and whether it's built), the lean it follows when it has one (the project's design rules: read it before you draw; a design needs none) and the design skills loaded for it (their SKILL.md paths: read those first too). Call it before you draw or change a frame. Changes nothing.",
    inputSchema: { type: "object", properties: { design: { type: "string", description: "One design file's slug, for only that one" } } },
  },
  {
    name: "design_frame",
    description: [
      "Creates or replaces a frame on Liner Design's canvas: one whole HTML page at a fixed size (phone 390 × 844, desktop 1280 × 800, or any), from html or an HTML file's path. The same name replaces it.",
      "For a small change, edit its file (design_files) or use design_node. Follow the lean and loaded skills; keep each data-l id.",
      "screen: false for a frame that isn't an app screen, so Build leaves it out.",
      "Returns its id, path and a picture with console errors: fix what's off first.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        design: { type: "string", description: "The design file's slug; made when there's none" },
        name: { type: "string", description: "\"Phone / Today\"" },
        width: { type: "number" },
        height: { type: "number" },
        html: { type: "string" },
        path: { type: "string" },
        screen: { type: "boolean" },
      },
      required: ["name", "width", "height"],
    },
  },
  {
    name: "design_tree",
    description: "A frame's outline, to find what to change: each element's tag, data-l id, name and text, and how many children it has, nested as in the page. Changes nothing.",
    inputSchema: { type: "object", properties: { frame: { type: "string", description: "The frame's id or name" }, design: { type: "string", description: "The design file's slug" } }, required: ["frame"] },
  },
  {
    name: "design_node",
    description: "Reads one element of a frame by its data-l id (its outer HTML), or with html replaces it, keeping its id. For a change to one part of a frame without writing the whole page again.",
    inputSchema: {
      type: "object",
      properties: {
        frame: { type: "string", description: "The frame's id or name" },
        id: { type: "string", description: "The element's data-l id, from design_tree or design_selection" },
        html: { type: "string", description: "Its new outer HTML; leave it out to read it" },
        design: { type: "string", description: "The design file's slug" },
      },
      required: ["frame", "id"],
    },
  },
  {
    name: "design_selection",
    description: "What the person has selected on Liner Design's canvas now: the frames, and the elements (their data-l ids and outer HTML), with any changes they made in the inspector that aren't written yet. When they say \"this\" or \"make it\", it's what they mean.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "design_shot",
    description: "A picture of a frame as drawn at its size, with its console errors and full height.",
    inputSchema: { type: "object", properties: { frame: { type: "string", description: "The frame's id or name" }, design: { type: "string", description: "The design file's slug" } }, required: ["frame"] },
  },
];
