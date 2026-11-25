/*
  Download links: the latest release's Apple silicon dmg and Windows x64 setup, and nowhere else.
  An Intel Mac and Windows on ARM are sent to the releases page. Run with
  `node --test site/src/lib/downloads.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { archFromSignals, downloadsFromRelease, planDownloads } from "./downloads.ts";

const releases = "https://github.com/lynnarize/liner-code/releases/latest";
const mac = "https://github.com/lynnarize/liner-code/releases/download/v0.3.1/Liner-Code-0.3.1-mac-arm64.dmg";
const win = "https://github.com/lynnarize/liner-code/releases/download/v0.3.1/Liner-Code-0.3.1-win-x64-setup.exe";

const release = {
  tag_name: "v0.3.1",
  assets: [
    { name: "Liner-Code-0.3.1-mac-arm64.dmg", browser_download_url: mac },
    { name: "Liner-Code-0.3.1-mac-arm64.dmg.sha256", browser_download_url: mac + ".sha256" },
    { name: "Liner-Code-0.3.1-mac-arm64.zip", browser_download_url: mac.replace(/\.dmg$/, ".zip") },
    { name: "Liner-Code-0.3.1-win-x64-setup.exe", browser_download_url: win },
    { name: "Liner-Code-0.3.1-win-x64-setup.exe.sha256", browser_download_url: win + ".sha256" },
    { name: "Liner-Code-0.3.1-win-x64.zip", browser_download_url: win.replace("-setup.exe", ".zip") },
  ],
};

test("the buttons use the Apple silicon dmg and the Windows x64 setup, not the zip or the checksum", () => {
  assert.deepEqual(downloadsFromRelease(release), { version: "0.3.1", mac, win });
});

test("a download URL that is not this repo's release asset is ignored", () => {
  const evil = downloadsFromRelease({
    assets: [
      { name: "Liner-Code-0.3.1-mac-arm64.dmg", browser_download_url: "https://evil.example/Liner-Code-0.3.1-mac-arm64.dmg" },
      { name: "Liner-Code-0.3.1-win-x64-setup.exe", browser_download_url: "https://github.com/other/liner-code/releases/download/v0.3.1/Liner-Code-0.3.1-win-x64-setup.exe" },
      { name: "Liner-Code-0.3.1-mac-x64.dmg", browser_download_url: mac.replace("arm64", "x64") },
    ],
  });
  assert.deepEqual(evil, {});
});

test("an Intel Mac is sent to the releases page, and an Apple silicon Mac gets the dmg", () => {
  const intel = planDownloads("mac", "x64", { mac, win }, releases);
  assert.equal(intel.macHref, releases);
  assert.equal(intel.winHref, win);
  assert.equal(intel.primary, "mac");
  assert.match(intel.note ?? "", /no Intel Mac build/);
  const arm = planDownloads("mac", "arm", { mac, win }, releases);
  assert.equal(arm.macHref, mac);
  assert.equal(arm.primary, "mac");
  assert.equal(arm.note, undefined);
  const unknown = planDownloads("mac", "unknown", { mac, win }, releases);
  assert.equal(unknown.macHref, mac);
});

test("Windows on ARM is sent to the releases page, and Windows x64 gets the setup", () => {
  const arm = planDownloads("win", "arm", { mac, win }, releases);
  assert.equal(arm.winHref, releases);
  assert.equal(arm.macHref, mac);
  assert.equal(arm.primary, "win");
  assert.match(arm.note ?? "", /no Windows on ARM build/);
  const x64 = planDownloads("win", "x64", { mac, win }, releases);
  assert.equal(x64.winHref, win);
  assert.equal(x64.primary, "win");
  assert.equal(planDownloads("win", "unknown", { mac, win }, releases).winHref, win);
});

test("with no asset yet, both buttons go to the releases page", () => {
  const plan = planDownloads("mac", "arm", {}, releases);
  assert.equal(plan.macHref, releases);
  assert.equal(plan.winHref, releases);
});

test("the chip comes from userAgentData before the user-agent string, which hides Windows on ARM", () => {
  const spoofed = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  assert.equal(archFromSignals({ os: "win", ua: spoofed, uaDataArch: "arm" }), "arm");
  assert.equal(archFromSignals({ os: "win", ua: spoofed }), "x64");
  assert.equal(archFromSignals({ os: "win", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; ARM64; rv:109.0)" }), "arm");
  assert.equal(archFromSignals({ os: "mac", uaDataArch: "x86", gpu: "Apple M2" }), "x64");
  assert.equal(archFromSignals({ os: "mac", gpu: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)" }), "arm");
  assert.equal(archFromSignals({ os: "mac", gpu: "Intel(R) Iris Plus Graphics OpenGL Engine" }), "x64");
  assert.equal(archFromSignals({ os: "mac", gpu: "AMD Radeon Pro 5500M OpenGL Engine" }), "x64");
  assert.equal(archFromSignals({ os: "mac" }), "unknown");
});
