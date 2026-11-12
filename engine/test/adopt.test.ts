/*
  An old single-HTML design adopted as a frame keeps its pictures and styles: the relative
  addresses it had beside its old file are rewritten to lead there from the frame's place in
  .liner/designs/<file>/frames/. Absolute ones, script bodies and anything that would climb out of
  the session's folder stay as they were. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyUsage } from "../../contracts/src/index.ts";
import * as canvas from "../src/canvas.ts";
import { designCtx, rebase } from "../src/canvas.ts";
import { Designs } from "../src/designs.ts";
import { Store } from "../src/store.ts";

test("adopt: an old design's pictures beside its file still load from the frame's new place", async () => {
  const root = mkdtempSync(join(tmpdir(), "lc-adopt-"));
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-adopt-home-")));
  store.putProject({ id: "p", name: "p", path: root, git: false, createdAt: 1 });
  store.putThread({ id: "t", projectId: "p", title: "Adopt", agent: "forge", status: "idle", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  mkdirSync(join(root, "mock", "img"), { recursive: true });
  writeFileSync(join(root, "mock", "img", "a.png"), "png");
  const old = [
    "<!doctype html><html><head><link rel=\"stylesheet\" href=\"site.css\"><style>.hero{background:url('img/bg.jpg')}</style></head><body>",
    '<img src="img/a.png?v=2#x" srcset="img/a.png 1x, img/a@2x.png 2x"><a href="https://example.com/x.png">out</a><a href="#top">top</a>',
    '<img src="data:image/png;base64,AAAA"><img src="/abs.png"><img src="../../../../../../etc/x.png">',
    '<script src="app.js"></script><script>const s = "img/not-an-address.png";</script>',
    "</body></html>",
  ].join("");
  writeFileSync(join(root, "mock", "screen.html"), old);
  const designs = new Designs(store);
  designs.cwdOf = () => root;
  designs.turnOf = () => 1;
  const { item } = designs.show("t", { title: "Screen", path: "mock/screen.html", size: "phone" });
  const api = canvas.rpc(() => ({ ...designCtx(store), designs }));
  await api["canvas.create"]({ cwd: root, title: "Adopted" });
  const file = await api["canvas.frame.add"]({ cwd: root, file: "adopted", frame: { name: "", w: 0, h: 0, adopt: { threadId: "t", design: item.design } } });
  const html = readFileSync(join(root, ".liner/designs/adopted", file.frames[0].path!), "utf8");
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/\.\.\/mock\/site\.css"/);
  assert.match(html, /url\('\.\.\/\.\.\/\.\.\/\.\.\/mock\/img\/bg\.jpg'\)/);
  assert.match(html, /src="\.\.\/\.\.\/\.\.\/\.\.\/mock\/img\/a\.png\?v=2#x"/, "query and hash kept");
  assert.match(html, /srcset="\.\.\/\.\.\/\.\.\/\.\.\/mock\/img\/a\.png 1x, \.\.\/\.\.\/\.\.\/\.\.\/mock\/img\/a@2x\.png 2x"/);
  assert.match(html, /<script[^>]*src="\.\.\/\.\.\/\.\.\/\.\.\/mock\/app\.js"/);
  for (const kept of ['href="https://example.com/x.png"', 'href="#top"', 'src="data:image/png;base64,AAAA"', 'src="/abs.png"', 'src="../../../../../../etc/x.png"', 'const s = "img/not-an-address.png"']) assert.ok(html.includes(kept), kept);
  // As the files proxy serves it: the frame's base, then the address, is the picture beside the old file.
  const base = "http://localhost:1/.liner/designs/adopted/frames/";
  assert.equal(new URL(/src="([^"]*a\.png[^"]*)"/.exec(html)![1], base).pathname, "/mock/img/a.png");

  // A design among .liner/designs/ (where design_show puts them) works the same way.
  assert.equal(rebase('<img src="tide.png">', ".liner/designs", ".liner/designs/adopted/frames"), '<img src="../../tide.png">');
  assert.equal(rebase('<img src="a.png">', ".", ".liner/designs/x/frames"), '<img src="../../../../a.png">');
});
