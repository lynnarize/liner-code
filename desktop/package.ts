/*
  Wraps a staged app folder in Electron as "Liner Code.app" with @electron/packager. No asar: the
  engine's TypeScript runs from plain files on Electron's own Node.
    node desktop/package.ts <staged folder> <icon.icns> <out dir> [extra resource…]
  An Assets.car among the extra resources (actool's build of desktop/AppIcon.icon) lands in
  Contents/Resources and is named by CFBundleIconName, so macOS 26 and later draw that icon and turn
  it dark with the system; the .icns stays CFBundleIconFile for older macOS.
  Signing: with LINER_SIGN_IDENTITY (a "Developer ID Application: …" identity in your keychain) the
  app is signed with the hardened runtime, and with LINER_NOTARY_PROFILE too (a notarytool keychain
  profile: `xcrun notarytool store-credentials`) it's notarized and stapled. Without them the build
  script signs it ad hoc.
  LINER_TARGET=win32-x64 (or win32-arm64) wraps it for Windows instead, as "Liner Code.exe" in a
  folder, with an .ico for its icon. Nothing signs that one.
*/
import { packager } from "@electron/packager";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";

const [dir, icon, out, ...extraResource] = process.argv.slice(2);
const electron = JSON.parse(readFileSync(createRequire(import.meta.url).resolve("electron/package.json"), "utf8")) as { version: string };
const { version } = JSON.parse(readFileSync(`${dir}/package.json`, "utf8")) as { version: string };
const identity = process.env.LINER_SIGN_IDENTITY;
const profile = process.env.LINER_NOTARY_PROFILE;
const [platform, arch] = (process.env.LINER_TARGET || `darwin-${process.arch === "arm64" ? "arm64" : "x64"}`).split("-") as [string, "x64" | "arm64"];

if (platform === "win32") {
  const [win] = await packager({
    dir,
    out,
    name: "Liner Code",
    platform,
    arch,
    electronVersion: electron.version,
    appCopyright: "© 2026 Lin. MIT licence. Your models, your code.",
    appVersion: version,
    buildVersion: version,
    icon,
    extraResource,
    asar: false,
    prune: false,
    overwrite: true,
    quiet: true,
    win32metadata: { CompanyName: "Lin", FileDescription: "Liner Code", ProductName: "Liner Code", InternalName: "Liner Code", OriginalFilename: "Liner Code.exe" },
  });
  console.log(win);
  process.exit(0);
}

const [app] = await packager({
  dir,
  out,
  name: "Liner Code",
  platform: "darwin",
  arch: arch === "arm64" ? "arm64" : "x64",
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
  ...(extraResource.some((f) => basename(f) === "Assets.car") && { extendInfo: { CFBundleIconName: "AppIcon" } }),
  quiet: true,
  ...(identity && {
    osxSign: { identity, optionsForFile: () => ({ hardenedRuntime: true, entitlements: join(import.meta.dirname, "entitlements.mac.plist") }) },
    ...(profile && { osxNotarize: { keychainProfile: profile } }),
  }),
});
console.log(app);
