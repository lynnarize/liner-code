/*
  The Demo draws each Foreshore frame in parts (demo-canvas.ts piecesOf), so the canvas shows a
  frame arriving: the page with an empty body first, then more of it each time, the page whole last.
  Each part must be the same page with less in it (nothing rewritten), and the first with anything
  in it small enough that the canvas settles it in (Frame.tsx planOf: 40 new elements at most).
  The page's own scripts come only with the last part: run on a half-written page they throw.
  Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { addressable, outline, parse } from "../src/canvas-html.ts";
import { foreshorePage, piecesOf, TIDE_FRAMES } from "../src/providers/demo-canvas.ts";

const SCRIPT = /<script\b[\s\S]*?<\/script>/gi;
const count = (html: string) => addressable(parse(html)).filter((e) => e.tag !== "body").length;

for (const s of TIDE_FRAMES) {
  test(`${s.name} is written in growing parts, the last the page itself`, () => {
    const page = foreshorePage(s.src, s.night);
    const parts = piecesOf(page);
    assert.ok(parts.length >= 3, `${s.name}: an empty page, at least one part, the page (${parts.length})`);
    assert.equal(parts[parts.length - 1], page, "the last part is the page, byte for byte");
    // Nothing in the body yet, or only the one wrapper the page's parts sit in.
    const first = outline(parts[0]);
    assert.ok(!first || first.children.every((c) => !c.children.length), "the first part has nothing in its body");
    assert.ok(count(parts[1]) > 0 && count(parts[1]) <= 40, `the first part with something in it is small (${count(parts[1])})`);
    for (let i = 1; i < parts.length; i++) assert.ok(count(parts[i]) > count(parts[i - 1]), `part ${i} adds to part ${i - 1}`);
    // Every part is the page with a run of its tail taken out: its head, styles and the body's start are the page's own (scripts aside).
    for (const p of parts) {
      const head = p.slice(0, p.indexOf("<body"));
      assert.equal(head.replace(SCRIPT, ""), page.slice(0, page.indexOf("<body")).replace(SCRIPT, ""), "the head is the page's own");
    }
    for (const p of parts.slice(0, -1)) assert.ok(!/<script\b/i.test(p), "no part but the last carries a script");
  });
}

test("a page with one part, or none, is written whole", () => {
  const one = "<!doctype html><html><head></head><body><div>only</div></body></html>";
  assert.deepEqual(piecesOf(one), [one]);
  const none = "<!doctype html><html><head></head><body></body></html>";
  assert.deepEqual(piecesOf(none), [none]);
});

test("the page's own scripts, in the head, the body or inside a part, come only with the last part", () => {
  const page = `<!doctype html><html><head><script>window.a = 1</script><style>p{}</style></head><body>
<header><p>one</p><script>document.querySelector("footer").append("x")</script></header>
<main><p>two</p></main>
<section><p>three</p></section>
<footer><p>four</p></footer>
<script>document.querySelector("footer").append("y")</script>
</body></html>`;
  const parts = piecesOf(page);
  assert.equal(parts[parts.length - 1], page, "the last part is the page, byte for byte");
  assert.ok(parts.length >= 3);
  for (const p of parts.slice(0, -1)) {
    assert.ok(!/<script\b/i.test(p), `no script before the last part:\n${p}`);
    assert.ok(p.includes("<style>p{}</style>"), "the styles stay");
  }
  assert.ok(parts[1].includes("<p>one</p>"), "the first part keeps its own elements, without its script");
});
