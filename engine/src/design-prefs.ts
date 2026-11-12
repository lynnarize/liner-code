/*
  Liner Design's settings that decide whether money is spent: each design file's `pictures`
  (when the person is asked before a picture, and which picture model it uses, null for no one).
  They live in the engine's own state under the app's home (design-pictures.json), keyed by folder
  and design slug, never in design.json: that file sits where the agent writes freely, and a
  setting it could write would let it turn the consent off. canvas.ts puts them on the DesignFile
  it hands out and takes them from canvas.save's patch; pictures.ts reads them from there.
*/
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DesignFile } from "../../contracts/src/index.ts";

export type PicturesPref = NonNullable<DesignFile["pictures"]>;

const fileOf = (home: string) => join(home, "design-pictures.json");
const keyOf = (cwd: string, slug: string) => `${resolve(cwd)}\n${slug}`;

function all(home: string): Record<string, PicturesPref> {
  try {
    const v = JSON.parse(readFileSync(fileOf(home), "utf8"));
    return v && typeof v === "object" ? (v as Record<string, PicturesPref>) : {};
  } catch {
    return {};
  }
}

/** A design file's picture setting as the engine holds it; undefined when the person never set one. */
export function picturesPref(home: string, cwd: string, slug: string): PicturesPref | undefined {
  const p = all(home)[keyOf(cwd, slug)];
  if (!p || !["first", "always", "never"].includes(p.ask)) return undefined;
  return { ask: p.ask, ...(p.model === null ? { model: null } : typeof p.model === "string" ? { model: p.model } : {}) };
}

/** Keeps (or with undefined, forgets) a design file's picture setting, written whole through a temp file. */
export function setPicturesPref(home: string, cwd: string, slug: string, pref: PicturesPref | undefined) {
  const map = all(home);
  if (pref) map[keyOf(cwd, slug)] = { ask: pref.ask, ...(pref.model !== undefined ? { model: pref.model } : {}) };
  else delete map[keyOf(cwd, slug)];
  mkdirSync(home, { recursive: true });
  const tmp = `${fileOf(home)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(map, null, 2));
  renameSync(tmp, fileOf(home));
}
