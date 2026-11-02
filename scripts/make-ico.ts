/*
  Packs the PNGs make-icon.swift draws into a Windows .ico: one PNG per size, 16 to 256, which every
  Windows since Vista reads as they are.
    node scripts/make-ico.ts <iconset folder> <out.ico>
*/
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [set, out] = process.argv.slice(2);
// The iconset has no 48: Windows scales that one from 64.
const files: [number, string][] = [[16, "icon_16x16.png"], [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"], [128, "icon_128x128.png"], [256, "icon_256x256.png"]];
const images = files.map(([size, file]) => ({ size, png: readFileSync(join(set, file)) }));

const head = Buffer.alloc(6);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map(({ size, png }) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size >= 256 ? 0 : size, 0);
  e.writeUInt8(size >= 256 ? 0 : size, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});
writeFileSync(out, Buffer.concat([head, ...entries, ...images.map((i) => i.png)]));
