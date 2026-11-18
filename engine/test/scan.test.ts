/*
  First launch's look for repositories (api.ts findRepos, behind projects.scan): each repository once, by where it really
  is. The usual places include ~/Code and ~/code, which are one folder on a disk that ignores case (a Mac's, a PC's), so
  the path given back is the disk's own spelling; a link to a repository is the repository; two real folders on a disk
  that minds case are both looked in. A project added earlier under another spelling reads as added, and adding it again
  gives back the one you have. Everything happens in a temp folder of its own. Run with `npm test -w engine`.
*/
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { FoundRepo, Project } from "../../contracts/src/index.ts";

// The temp folder as the disk has it (on a Mac, /var is a link to /private/var).
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "lc-scan-")));
process.env.LINER_HOME = join(root, "home");
const { createApi, findRepos } = await import("../src/api.ts");
const { Runtime } = await import("../src/runtime.ts");
const { Store } = await import("../src/store.ts");
after(() => rmSync(root, { recursive: true, force: true }));

/** A folder that reads as a repository: it holds a .git folder. */
const repo = (path: string) => mkdirSync(join(path, ".git"), { recursive: true });
/** Whether this disk ignores case: a file written as X can be found as x. */
const ignoresCase = (() => {
  writeFileSync(join(root, "CaseProbe"), "");
  return existsSync(join(root, "caseprobe"));
})();

test("~/Code and ~/code list each repository once, in the disk's own spelling, or both folders where the disk minds case", async () => {
  const home = join(root, "a");
  // The real folder is lower case; "Code" comes first in the usual places, as in api.ts ROOTS.
  repo(join(home, "code", "ledger"));
  repo(join(home, "code", "group", "tidewater"));
  if (!ignoresCase) repo(join(home, "Code", "notes"));
  const found = await findRepos([join(home, "Code"), join(home, "code"), join(home, "Projects")]);
  if (ignoresCase) assert.deepEqual(found.sort(), [join(home, "code", "group", "tidewater"), join(home, "code", "ledger")]);
  else assert.deepEqual(found.map((p) => basename(p)).sort(), ["ledger", "notes", "tidewater"]);
});

test("a link to a repository, or to a root, doesn't list it twice", { skip: process.platform === "win32" }, async () => {
  const home = join(root, "b");
  repo(join(home, "Code", "foreshore"));
  mkdirSync(join(home, "Projects"), { recursive: true });
  symlinkSync(join(home, "Code", "foreshore"), join(home, "Projects", "foreshore"));
  symlinkSync(join(home, "Code"), join(home, "src"));
  const found = await findRepos([join(home, "Projects"), join(home, "Code"), join(home, "src")]);
  assert.deepEqual(found, [join(home, "Code", "foreshore")]);
});

test("two different repositories with the same name are both listed", async () => {
  const home = join(root, "c");
  repo(join(home, "Code", "app"));
  repo(join(home, "Projects", "app"));
  assert.equal((await findRepos([join(home, "Code"), join(home, "Projects")])).length, 2);
});

test("a project added under another spelling reads as added, and adding it again gives back the one you have", { skip: !ignoresCase && "the disk minds case" }, async () => {
  const home = join(root, "d");
  repo(join(home, "code", "harbour"));
  const store = new Store(join(root, "d-home"));
  // Added earlier through the folder picker, spelled the way the picker gave it.
  store.putProject({ id: "p1", name: "harbour", path: join(home, "CODE", "harbour"), git: true, createdAt: Date.now() });
  const runtime = new Runtime(store, { PATH: "/usr/bin:/bin" });
  const api = createApi(store, runtime, { PATH: "/usr/bin:/bin" }, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const found = (await api.call("projects.scan", { roots: [join(home, "Code"), join(home, "code")] })) as FoundRepo[];
  assert.deepEqual(found.map((f) => [f.path, f.added]), [[join(home, "code", "harbour"), true]]);
  const again = (await api.call("project.add", { path: join(home, "Code", "harbour") })) as Project;
  assert.equal(again.id, "p1");
  assert.equal(store.projects.length, 1);
  // Its save goes now, before the temp folder does.
  store.flush();
});
