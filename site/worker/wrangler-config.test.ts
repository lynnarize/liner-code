/*
  The Worker's Wrangler file. A pull request's build runs `wrangler preview`, which refuses to start without a `previews`
  block that gives each Analytics Engine binding a dataset of its own, so a preview's test pings never land in the real
  usage counts. Run with `node --test site/worker/wrangler-config.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// JSON with comments: what lies outside strings after // or between /* and */ goes, then it is plain JSON.
function jsonc(text: string): any {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      let j = end;
      while (text[j - 1] === "\\") j = text.indexOf('"', j + 1);
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") i = text.indexOf("\n", i) - 1;
    else if (c === "/" && text[i + 1] === "*") i = text.indexOf("*/", i) + 1;
    else out += c;
  }
  return JSON.parse(out);
}

const config = jsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("A pull request's preview has its own usage dataset for every one production writes to, so wrangler preview starts and the real counts stay clean", () => {
  const live = (config.analytics_engine_datasets ?? []) as { binding: string; dataset: string }[];
  const preview = (config.previews?.analytics_engine_datasets ?? []) as { binding: string; dataset: string }[];
  assert.ok(live.length > 0, "production writes to a dataset");
  for (const d of live) {
    const p = preview.find((x) => x.binding === d.binding);
    assert.ok(p, `the previews block names the ${d.binding} binding`);
    assert.ok(p.dataset && !p.dataset.includes("REPLACE_ME"), `${d.binding} has a real preview dataset`);
    assert.notEqual(p.dataset, d.dataset, `${d.binding}'s preview dataset isn't production's`);
  }
});
