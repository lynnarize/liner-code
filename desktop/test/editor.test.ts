/*
  Opening things from the page (desktop/src/editor.ts). "Open in your editor" (Changes, a Security
  finding) opens a file only when it sits inside the session's or the project's own folder, which the
  shell reads from the engine, not from the page. "Open in" never opens a file as itself, which would
  run a script an agent wrote.
*/
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileIn, folderOf, isInside, openIn, type Opener } from "../src/editor.ts";

const state = {
  threads: [
    { id: "t1", projectId: "p1" },
    { id: "t2", projectId: "p1", worktree: { path: "/work/trees/t2" } },
  ],
  projects: [{ id: "p1", path: "/work/app" }],
};

test("a session's folder is its worktree when it has one, else its project's", () => {
  assert.equal(folderOf(state, { threadId: "t1" }), "/work/app");
  assert.equal(folderOf(state, { threadId: "t2" }), "/work/trees/t2");
});

test("a session the engine doesn't know has no folder, so nothing opens", () => {
  assert.equal(folderOf(state, { threadId: "nobody" }), undefined);
  assert.equal(folderOf({}, { threadId: "t1" }), undefined);
});

test("with no session, a project's folder is the engine's path for it, and an unknown project or none has no folder", () => {
  assert.equal(folderOf(state, { projectId: "p1" }), "/work/app");
  assert.equal(folderOf(state, { projectId: "nope" }), undefined);
  assert.equal(folderOf(state, {}), undefined);
});

test("a session the engine doesn't know isn't made up for by the project the page names beside it", () => {
  assert.equal(folderOf(state, { threadId: "nobody", projectId: "p1" }), undefined);
});

test("a path under the folder is inside it, and the folder itself, its parent and a neighbour are not", () => {
  assert.equal(isInside("/work/app", "/work/app/src/a.ts"), true);
  assert.equal(isInside("/work/app", "/work/app"), false);
  assert.equal(isInside("/work/app", "/work"), false);
  assert.equal(isInside("/work/app", "/work/app-other/a.ts"), false);
  assert.equal(isInside("/work/app", "/work/app/../secret"), false);
});

test("a file of the diff inside the folder opens, at its real path", () => {
  const root = mkdtempSync(join(tmpdir(), "liner-editor-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.ts"), "x");
    assert.deepEqual(fileIn(root, "src/a.ts", realpathSync.native), { file: realpathSync.native(join(root, "src", "a.ts")) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a path that climbs out, an absolute path elsewhere, an empty path or a NUL is refused", () => {
  const root = mkdtempSync(join(tmpdir(), "liner-editor-"));
  try {
    writeFileSync(join(root, "a.ts"), "x");
    for (const p of ["../outside.ts", "src/../../outside.ts", "/etc/hosts", "", ".", "a.ts\0.png"]) assert.deepEqual(fileIn(root, p, realpathSync.native), { why: "outside" }, p);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a link inside the folder that points out of it is refused", () => {
  const root = mkdtempSync(join(tmpdir(), "liner-editor-"));
  const away = mkdtempSync(join(tmpdir(), "liner-away-"));
  try {
    writeFileSync(join(away, "secret.txt"), "x");
    symlinkSync(join(away, "secret.txt"), join(root, "link.txt"));
    assert.deepEqual(fileIn(root, "link.txt", realpathSync.native), { why: "outside" });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(away, { recursive: true, force: true });
  }
});

test("a file inside the folder that isn't there any more says it's gone, not that it's outside the folder", () => {
  const root = mkdtempSync(join(tmpdir(), "liner-editor-"));
  try {
    assert.deepEqual(fileIn(root, "gone.ts", realpathSync.native), { why: "gone" });
    assert.deepEqual(fileIn(join(root, "removed-worktree"), "a.ts", realpathSync.native), { why: "gone" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a path outside the folder reads the same whether or not it exists, and is never looked for", () => {
  const root = mkdtempSync(join(tmpdir(), "liner-editor-"));
  try {
    const looked: string[] = [];
    const real = (p: string) => (looked.push(p), realpathSync.native(p));
    assert.deepEqual(fileIn(root, "../../../../etc/hosts", real), { why: "outside" });
    assert.deepEqual(fileIn(root, "../../../../no/such/file", real), { why: "outside" });
    assert.deepEqual(looked, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A system that opens nothing and writes down what it was asked. */
function fake(o: Partial<Opener> & { files?: string[] }) {
  const did: string[] = [];
  const opener: Opener = {
    isMac: true,
    isWin: false,
    editors: ["com.example.Editor"],
    isFile: (p) => (o.files ?? []).includes(p),
    real: (p) => p,
    opens: async (args) => (did.push(`open ${args.join(" ")}`), false),
    started: async (cmd) => (did.push(`start ${cmd}`), false),
    openPath: async (p) => (did.push(`openPath ${p}`), ""),
    showInFolder: (p) => void did.push(`show ${p}`),
    ...o,
  };
  return { opener, did };
}

test("a file sent to an editor with none found opens as text on a Mac, and is never opened as itself", async () => {
  const { opener, did } = fake({ files: ["/work/app/run.command"] });
  await openIn(opener, "/work/app/run.command", "editor");
  assert.deepEqual(did, ["open -b com.example.Editor /work/app/run.command", "open -t /work/app/run.command", "show /work/app/run.command"]);
  assert.ok(!did.some((d) => d.startsWith("openPath")));
});

test("on Windows with no Notepad to start, a file sent to an editor is shown in its folder, never opened as itself", async () => {
  const { opener, did } = fake({ isMac: false, isWin: true, files: ["C:/app/setup.bat"] });
  await openIn(opener, "C:/app/setup.bat", "editor");
  assert.deepEqual(did, ["start notepad.exe", "show C:/app/setup.bat"]);
});

test("a file sent to Finder or a terminal is shown in its folder, not run", async () => {
  for (const where of ["finder", "terminal"]) {
    const { opener, did } = fake({ files: ["/work/app/run.sh"] });
    await openIn(opener, "/work/app/run.sh", where);
    assert.deepEqual(did, ["show /work/app/run.sh"], where);
  }
});

test("a folder keeps today's way: the editors in turn, then the system opens it", async () => {
  const { opener, did } = fake({});
  await openIn(opener, "/work/app", "editor");
  assert.deepEqual(did, ["open -b com.example.Editor /work/app", "openPath /work/app"]);
  const finder = fake({});
  await openIn(finder.opener, "/work/app", "finder");
  assert.deepEqual(finder.did, ["openPath /work/app"]);
});

test("on a Mac a folder whose name has an extension (an app, a workflow) is shown in Finder whatever was asked, never launched", async () => {
  for (const path of ["/work/app/Evil.app", "/work/app/X.workflow/", "/work/app/Y.prefPane"])
    for (const where of ["editor", "terminal", "finder"]) {
      const { opener, did } = fake({});
      await openIn(opener, path, where);
      assert.deepEqual(did, [`show ${path}`], `${path} ${where}`);
    }
});

test("a plain folder, and one whose only dot starts its name, keep today's way", async () => {
  for (const path of ["/work/app", "/work/.config"]) {
    const { opener, did } = fake({});
    await openIn(opener, path, "finder");
    assert.deepEqual(did, [`openPath ${path}`], path);
  }
});

test("on Windows a file sent to an editor opens in Notepad as its one argument", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const { opener, did } = fake({ isMac: false, isWin: true, files: ["C:/app/notes & more.txt"], started: async (cmd, args) => (calls.push({ cmd, args }), true) });
  await openIn(opener, "C:/app/notes & more.txt", "editor");
  assert.deepEqual(calls, [{ cmd: "notepad.exe", args: ["C:/app/notes & more.txt"] }]);
  assert.deepEqual(did, []);
});

test("on Linux a file sent to an editor is shown in its folder, as xdg-open would run it", async () => {
  const { opener, did } = fake({ isMac: false, isWin: false, files: ["/home/me/app/run.sh"] });
  await openIn(opener, "/home/me/app/run.sh", "editor");
  assert.deepEqual(did, ["show /home/me/app/run.sh"]);
});

test("a link named like a plain path that points at an app is judged by what it points at: shown in Finder, never launched", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "liner-openin-")));
  try {
    mkdirSync(join(root, "Evil.app", "Contents"), { recursive: true });
    mkdirSync(join(root, "tools"));
    symlinkSync(join(root, "Evil.app"), join(root, "tools", "run"));
    writeFileSync(join(root, "run.sh"), "#!/bin/sh\n");
    symlinkSync(join(root, "run.sh"), join(root, "tools", "notes"));
    symlinkSync(join(root, "nowhere"), join(root, "tools", "gone"));
    const isFile = (p: string) => statSync(p).isFile();
    // With no listed editor installed, as when it reached shell.openPath before.
    for (const where of ["finder", "editor", "terminal"]) {
      const { opener, did } = fake({ isFile, real: realpathSync.native });
      await openIn(opener, join(root, "tools", "run"), where);
      assert.deepEqual(did, [`show ${join(root, "Evil.app")}`], where);
    }
    // A link to a script is a file: shown, or opened as text, never run.
    const finder = fake({ isFile, real: realpathSync.native });
    await openIn(finder.opener, join(root, "tools", "notes"), "finder");
    assert.deepEqual(finder.did, [`show ${join(root, "run.sh")}`]);
    // A link to nothing is refused before anything is asked of the system.
    const gone = fake({ isFile, real: realpathSync.native });
    await assert.rejects(openIn(gone.opener, join(root, "tools", "gone"), "finder"), /link to nothing/);
    assert.deepEqual(gone.did, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
