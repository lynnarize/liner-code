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
      "Creates or replaces a frame on Liner Design's canvas: a frame is one whole HTML document at a fixed size (390 × 844 a phone, 834 × 1112 a tablet, 1280 × 800 a desktop, or any), drawn where the person watches. Pass the whole page as html, or the path of an HTML file you wrote in this folder. The same name replaces that frame.",
      "To change a frame a little, prefer editing its file with your own tools (design_files gives its path) or design_node: only what was asked. Follow the lean when there is one, and the loaded skills. Every element gets a data-l id, kept across edits, so keep the ones that are there.",
      "A frame that isn't a screen of the app (a brand board, a reference sheet) is made with screen: false, so Build leaves it out.",
      "Returns the frame's id and path, and a picture of it as drawn, with its console errors: look at it and fix what's off before you say it's done.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        design: { type: "string", description: "The design file's slug; a new file is made when there's none" },
        name: { type: "string", description: "The frame's name: \"Phone / Today\"" },
        width: { type: "number", description: "Its width in px" },
        height: { type: "number", description: "Its height in px" },
        html: { type: "string", description: "The whole page" },
        path: { type: "string", description: "Or an HTML file in this folder to take it from" },
        screen: { type: "boolean", description: "false for a frame that isn't a screen of the app (a brand board, a reference sheet)" },
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
