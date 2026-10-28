/*
  Wraps a staged app folder in Electron as "Liner Code.app" with @electron/packager. No asar: the
  engine's TypeScript runs from plain files on Electron's own Node.
    node desktop/package.ts <staged folder> <icon.icns> <out dir> [extra resource…]
  Signing: with LINER_SIGN_IDENTITY (a "Developer ID Application: …" identity in your keychain) the
  app is signed with the hardened runtime, and with LINER_NOTARY_PROFILE too (a notarytool keychain
  profile: `xcrun notarytool store-credentials`) it's notarized and stapled. Without them the build
  script signs it ad hoc.
*/
import { packager } from "@electron/packager";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const [dir, icon, out, ...extraResource] = process.argv.slice(2);
const electron = JSON.parse(readFileSync(createRequire(import.meta.url).resolve("electron/package.json"), "utf8")) as { version: string };
const { version } = JSON.parse(readFileSync(`${dir}/package.json`, "utf8")) as { version: string };
const identity = process.env.LINER_SIGN_IDENTITY;
const profile = process.env.LINER_NOTARY_PROFILE;

const [app] = await packager({
  dir,
  out,
  name: "Liner Code",
  platform: "darwin",
  arch: process.arch === "arm64" ? "arm64" : "x64",
  electronVersion: electron.version,
  appBundleId: "app.liner.code",
  appCategoryType: "public.app-category.developer-tools",
  appCopyright: "© 2026 Lin. MIT licence. Your models, your code.",
  appVersion: version,
  buildVersion: version,
  icon,
  extraResource,
  asar: false,
  prune: false,
  overwrite: true,
  darwinDarkModeSupport: true,
  quiet: true,
  ...(identity && {
    osxSign: { identity, optionsForFile: () => ({ hardenedRuntime: true, entitlements: join(import.meta.dirname, "entitlements.mac.plist") }) },
    ...(profile && { osxNotarize: { keychainProfile: profile } }),
  }),
});
console.log(app);
