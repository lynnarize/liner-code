/*
  Writing a file whole or not at all, one way for the engine: into a hidden file beside it (the same folder, so the same
  disk), flushed to disk when the caller asks, renamed over it, and its folder flushed too when asked, so a crash or a full
  disk mid-write leaves the file as it was, never half of it, and never a temp file behind. canvas.ts (writeWhole), lean.ts
  (DESIGN.md, AI pictures), design-prefs.ts and the add-ons write through it. store.ts keeps its own on purpose: state.json
  must never be written in place, so where this falls back to an in-place write when a Windows rename is held for about
  300 ms, store.ts tries again and then throws, and it keeps a .bak beside it.
*/
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";

export type AtomicOptions = {
  /** Make the folder first. */
  mkdir?: boolean;
  /** The file's own mode, exactly, when it is there already (a umask can't take bits off). */
  keepMode?: boolean;
  /** Flush the file before the rename and the folder after it: a rename alone can leave an empty file after a power cut. */
  sync?: boolean;
};

/**
  Writes `abs` whole. The hidden file never matches a frame's or design.json's name, so the canvas's watcher leaves it be.
  Node's rename replaces a file that's there on Windows too (MoveFileEx with replace); when it's refused there (the file
  held open without sharing, by an editor or a scanner), it's tried again for a moment, then written in place.
*/
export function writeAtomic(abs: string, data: string | Buffer, o: AtomicOptions = {}) {
  if (o.mkdir) mkdirSync(dirname(abs), { recursive: true });
  const was = o.keepMode ? statSync(abs, { throwIfNoEntry: false }) : undefined;
  const tmp = join(dirname(abs), `.${basename(abs)}.${process.pid}.${createHash("sha1").update(`${Math.random()}${Date.now()}`).digest("hex").slice(0, 8)}.tmp`);
  try {
    if (o.sync) {
      const fd = openSync(tmp, "w", was ? was.mode & 0o7777 : 0o666);
      try {
        writeFileSync(fd, data);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } else writeFileSync(tmp, data, was ? { mode: was.mode & 0o7777 } : {});
    if (was) chmodSync(tmp, was.mode & 0o7777);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  for (let tries = 0; ; tries++) {
    try {
      renameSync(tmp, abs);
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const held = process.platform === "win32" && (code === "EPERM" || code === "EACCES" || code === "EBUSY");
      if (held && tries < 5) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (tries + 1));
        continue;
      }
      if (held) {
        // Still held: written in place, as the file is open for reading only by whoever holds it.
        try {
          writeFileSync(abs, data);
          return;
        } finally {
          rmSync(tmp, { force: true });
        }
      }
      rmSync(tmp, { force: true });
      throw e;
    }
  }
  if (!o.sync) return;
  try {
    const dir = openSync(dirname(abs), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } catch {
    // a folder that can't be flushed: the rename is as safe as the system makes it
  }
}
