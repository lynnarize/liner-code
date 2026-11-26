import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterCrash, closeOf, engineStatusDue, hideEvery, senderOf, type Hideable } from "../src/window-state.ts";

test("the menu-bar item reads the engine itself only once no window's page is alive, never over a quiet page", () => {
  // A window open (or hidden by the close button on a Mac) whose page has said nothing for a minute: its last word stands.
  assert.equal(engineStatusDue([{ destroyed: false }]), false);
  assert.equal(engineStatusDue([{ destroyed: true }, { destroyed: false }]), false);
  // Every window gone: no page is there to say, so the engine is read.
  assert.equal(engineStatusDue([{ destroyed: true }]), true);
  assert.equal(engineStatusDue([]), true);
});

test("a page that keeps going is loaded again three times a minute, then asked about once, not once a crash", () => {
  let gone: number[] = [];
  const steps: string[] = [];
  for (const at of [0, 1000, 2000]) {
    const s = afterCrash(gone, at, false);
    gone = s.gone;
    steps.push(s.then);
  }
  assert.deepEqual(steps, ["reload", "reload", "reload"]);
  const ask = afterCrash(gone, 3000, false);
  assert.equal(ask.then, "ask");
  // While that question is up, more crashes add no dialog over it.
  assert.equal(afterCrash(ask.gone, 4000, true).then, "nothing");
  // A minute later the count starts again.
  assert.equal(afterCrash(ask.gone, 70_000, false).then, "reload");
});

test("closing the last window open keeps the app as one window did, whichever window it is, and any other just closes", () => {
  // A New Window and the first one: the first closed for good, then the second, which was made as a secondary one, was
  // destroyed too on a Mac, leaving no window for the Dock to show; elsewhere it quit with sessions at work, unasked.
  assert.equal(closeOf({ open: 2, quitting: false, mac: true }), "close");
  assert.equal(closeOf({ open: 1, quitting: false, mac: true }), "hide");
  assert.equal(closeOf({ open: 1, quitting: false, mac: false }), "ask");
  assert.equal(closeOf({ open: 1, quitting: true, mac: true }), "close", "a quit closes it for good");
  // main.ts decides with it, by the windows open, never by which one was made first.
  const main = readFileSync(join(import.meta.dirname, "..", "src", "main.ts"), "utf8");
  assert.match(main, /closeOf\(\{ open: windows\.size, quitting, mac: isMac \}\)/);
  assert.doesNotMatch(main, /if \(quitting \|\| secondary \|\| windows\.size > 1\) return;/);
});

/** A window as senderOf sees it: its page and that page's top frame. */
const pageWindow = (name: string) => {
  const mainFrame = { name: `${name}'s top frame` };
  return { name, gone: false, isDestroyed() { return this.gone; }, webContents: { mainFrame } };
};

test("a bridge call from any of the app's windows is that window's, focused or not, and one from anything else is no window's", () => {
  const first = pageWindow("first");
  const second = pageWindow("New Window");
  const windows = [first, second];
  // The New Window behind the first sends its status and badge: it's answered, as its own window.
  assert.equal(senderOf(windows, second.webContents, second.webContents.mainFrame), second);
  assert.equal(senderOf(windows, first.webContents, first.webContents.mainFrame), first);
  // A frame inside a window's page (the Browser surface's, a panel's) is never the window, nor is a gone frame.
  assert.equal(senderOf(windows, second.webContents, { name: "the Browser surface's frame" }), undefined);
  assert.equal(senderOf(windows, second.webContents, null), undefined);
  // One window's page can't speak with another's frame, and a page of no window (a snapshot's) is no one's.
  assert.equal(senderOf(windows, first.webContents, second.webContents.mainFrame), undefined);
  const shot = pageWindow("snapshot");
  assert.equal(senderOf(windows, shot.webContents, shot.webContents.mainFrame), undefined);
  // A window that has gone answers nothing.
  second.gone = true;
  assert.equal(senderOf(windows, second.webContents, second.webContents.mainFrame), undefined);
});

test("the bridge in main.ts takes a call from any of its windows and acts on the window it came from", () => {
  const main = readFileSync(join(import.meta.dirname, "..", "src", "main.ts"), "utf8");
  assert.match(main, /const w = senderOf\(windows\.values\(\), e\.sender, e\.senderFrame\);\n  if \(!w \|\| !ours\(e\.senderFrame\?\.url \?\? ""\)\) return \{ ok: false, value: "Not the app's page\." \};/);
  assert.doesNotMatch(main, /e\.sender !== win\.webContents/);
  assert.match(main, /await handle\(str\(method\), \(params \?\? \{\}\) as Record<string, unknown>, w\)/);
  // A snapshot, a zoom and a folder dialog are the calling window's, not whichever was focused last.
  assert.match(main, /from\.webContents\.capturePage\(/);
  assert.match(main, /return from\.isMaximized\(\) \? from\.unmaximize\(\) : from\.maximize\(\);/);
  assert.match(main, /dialog\.showOpenDialog\(from, /);
});

/** A window as hideEvery sees it, writing down what was done to it. */
class FakeWindow implements Hideable {
  did: string[] = [];
  full: boolean;
  gone = false;
  leave: (() => void) | undefined;
  constructor(full = false) {
    this.full = full;
  }
  isDestroyed() {
    return this.gone;
  }
  isFullScreen() {
    return this.full;
  }
  setFullScreen(on: boolean) {
    this.did.push(on ? "full screen" : "leave full screen");
  }
  once(_event: "leave-full-screen", f: () => void) {
    this.leave = f;
  }
  hide() {
    this.did.push("hide");
  }
}

test("a quit that waits puts every window out of sight, a New Window too, and says which it hid", () => {
  const first = new FakeWindow();
  const second = new FakeWindow();
  const gone = new FakeWindow();
  gone.gone = true;
  const hid = hideEvery([first, second, gone], () => true);
  assert.deepEqual(first.did, ["hide"]);
  assert.deepEqual(second.did, ["hide"], "the window not focused is hidden as well");
  assert.deepEqual(gone.did, []);
  assert.deepEqual(hid, [first, second], "to be shown again if the quit is called off");
});

test("a full-screen window leaves full screen first and is hidden once out of it, unless the quit was called off by then", () => {
  const full = new FakeWindow(true);
  let waiting = true;
  hideEvery([full], () => waiting);
  assert.deepEqual(full.did, ["leave full screen"]);
  full.leave?.();
  assert.deepEqual(full.did, ["leave full screen", "hide"]);
  const back = new FakeWindow(true);
  hideEvery([back], () => waiting);
  waiting = false;
  back.leave?.();
  assert.deepEqual(back.did, ["leave full screen"], "you came back meanwhile: it stays");
});

test("main.ts hides and brings back every window for a quit that waits, and puts the material and lights on each window", () => {
  const main = readFileSync(join(import.meta.dirname, "..", "src", "main.ts"), "utf8");
  assert.match(main, /hidForWaiting = hideEvery\(windows\.values\(\), \(\) => !!waiting\);/);
  assert.match(main, /for \(const w of hidForWaiting\) if \(!w\.isDestroyed\(\) && w !== win\) w\.showInactive\(\);/);
  // The material is each window's: the one being made, shown or going full screen, and every window when Settings picks one.
  assert.match(main, /function applyMaterial\(w: BrowserWindow\)/);
  assert.doesNotMatch(main, /applyMaterial\(\)/);
  assert.match(main, /case "setMaterial": \{[\s\S]*?return applyMaterialEverywhere\(\);/);
  assert.match(main, /for \(const w of windows\.values\(\)\) applyMaterial\(w\);/);
  // The lights go to the page of the window they were read from.
  assert.match(main, /const syncLights = \(w: BrowserWindow\) => !w\.isDestroyed\(\) && w\.webContents\.send\("liner:lights", lights\(w\)\);/);
  assert.doesNotMatch(main, /syncLights\(\)/);
});
