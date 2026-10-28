/*
  Wraps a staged app folder in Electron as "Liner Code.app" with @electron/packager. No asar: the
  engine's TypeScript runs from plain files on Electron's own Node.
    node desktop/package.ts <staged folder> <icon.icns> <out dir>
*/
import { packager } from "@electron/packager";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const [dir, icon, out] = process.argv.slice(2);
const electron = JSON.parse(readFileSync(createRequire(import.meta.url).resolve("electron/package.json"), "utf8")) as { version: string };
const { version } = JSON.parse(readFileSync(`${dir}/package.json`, "utf8")) as { version: string };

const [app] = await packager({
  dir,
  out,
  name: "Liner Code",
  platform: "darwin",
  arch: process.arch === "arm64" ? "arm64" : "x64",
  electronVersion: electron.version,
  appBundleId: "app.liner.code",
  appCategoryType: "public.app-category.developer-tools",
  appCopyright: "Liner Code. Your models, your code.",
  appVersion: version,
  buildVersion: version,
  icon,
  asar: false,
  prune: false,
  overwrite: true,
  darwinDarkModeSupport: true,
  quiet: true,
});
console.log(app);
