/*
  Your attachments, as the tools take them. Every file is saved under the Liner Code home and
  named in the message, so any agent can open it; images (and PDFs, for Claude Code) also go to
  the model as they are, where the tool takes them, so it sees them without a step to read them.
*/
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

const IMAGE: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

/** An image the models read, by its name: its media type, or nothing for any other file. */
export const imageType = (path: string): string | undefined => IMAGE[extname(path).toLowerCase()];
export const isPdf = (path: string) => extname(path).toLowerCase() === ".pdf";

/** A file's bytes, or null when it's gone or bigger than `max`. */
export function readUpTo(path: string, max: number): Buffer | null {
  try {
    if (statSync(path).size > max) return null;
    return readFileSync(path);
  } catch {
    return null;
  }
}

/** A saved image as a data URL, for tools that take images that way (Codex). */
export function dataUrl(path: string, max = 20 * 1024 * 1024): string | null {
  const type = imageType(path);
  const bytes = type ? readUpTo(path, max) : null;
  return type && bytes ? `data:${type};base64,${bytes.toString("base64")}` : null;
}

/** What base64 makes of `n` bytes, with a little for its framing. */
export const base64Size = (n: number) => 4 * Math.ceil(n / 3) + 128;

/**
  How many pages a PDF has, or null when it can't say for sure. Claude reads at most 100 pages of
  documents in a conversation, so a PDF only goes to it whole when its pages are known; otherwise
  the agent gets its path and reads it itself. Only a plain page tree is counted (T3 Code's
  estimateClaudePdfPages, ClaudeAdapterV2.ts): compressed object streams hide their pages, so a
  PDF with them, or whose page count and pages disagree, is "don't know".
*/
export function pdfPages(bytes: Buffer): number | null {
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-" || !bytes.subarray(-1024).includes("%%EOF")) return null;
  const text = bytes.toString("latin1");
  if (/\/ObjStm\b|\/XRef\b|\/Encrypt\b/.test(text)) return null;
  const pages = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  const count = Math.max(0, ...[...text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)].map((m) => Number(m[1] ?? m[2])));
  return pages > 0 && count === pages ? pages : null;
}

/** The line that names your attachments in the message, so the agent can open them. */
export const attachNote = (files: string[]) => (files.length ? `I attached: ${files.join(", ")}` : "");
