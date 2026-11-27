/*
  The lean menus (the owner, 2026-11-27, with Capy's "open a tab" menu beside Liner's: "streamline the pop up. make it more
  lean to capy. and the icon too"): one menu surface for every menu and pop-up, lighter icons in menus, pop-ups and the
  session details card, and a + menu that lists only what holds something now, with More for the rest. Read as text, and the
  + menu's rows run from surface-row.ts. Run with `node --test engine/test/lean-menus.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Item } from "../../contracts/src/index.ts";
import { ALWAYS, canPr, hasCanvas, isCanvasItem, MENU_ORDER, surfaceRows, type SurfaceNow } from "../../ui/src/app/surface-row.ts";
import { EDGE, GAP, sideMenuLeft } from "../../ui/src/app/menu-place.ts";

const read = (path: string) => readFileSync(new URL(`../../ui/src/app/${path}`, import.meta.url), "utf8");
/** Every block whose selector list is exactly `sel`. */
const blocks = (css: string, sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim().split("\n").pop()!.trim() === sel).map((m) => m[2]);
const value = (block: string, prop: string) => new RegExp(`(?:^|[;{\\s])${prop.replace(/[-]/g, "\\-")}:\\s*([^;]+);`).exec(block)?.[1].trim();
const one = (css: string, sel: string) => {
  const b = blocks(css, sel);
  assert.ok(b.length > 0, `no rule ${sel}`);
  return b[0];
};

/* ---------- One lean surface ---------- */

test("Every menu and pop-up floats on one lean surface: an 8px corner, 4 in, the float fill, a 0.5px edge and Capy's very soft shadow, with no blur", () => {
  const css = read("app.css");
  const panel = blocks(css, ".l-pop.lc-pop-panel").find((b) => value(b, "padding") === "4px") ?? "";
  assert.equal(value(panel, "border-radius"), "var(--lc-r-menu)");
  assert.equal(value(panel, "background"), "var(--lc-float)");
  assert.equal(value(panel, "box-shadow"), "var(--lc-float-shadow)");
  assert.equal(value(panel, "backdrop-filter"), "none");
  assert.equal(value(panel, "font-weight"), "400", "a menu's words are not regular unless a part says so");
  // The fields keep their 10: the menu has a corner token of its own.
  assert.ok(css.includes("--lc-r-menu: 8px;") && css.includes("--lc-r-field: 10px;"));
  // The shadow is Capy's three short layers under a 0.5px edge, in both looks; the big 22px drop is gone.
  const light = /--lc-float-shadow: ([^;]+);/.exec(css)?.[1] ?? "";
  assert.equal(light, "0 0 0 0.5px rgba(0, 0, 0, 0.11), 0 6px 18px rgba(0, 0, 0, 0.03), 0 3px 9px rgba(0, 0, 0, 0.04), 0 1px 1px rgba(0, 0, 0, 0.05)");
  const dark = [...css.matchAll(/--lc-float-shadow: ([^;]+);/g)].map((m) => m[1]);
  assert.equal(dark.length, 2, "the float shadow is set in more places than the two looks");
  assert.equal(dark[1], "0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 3px 8px rgba(0, 0, 0, 0.13), 0 2px 5px rgba(0, 0, 0, 0.13), 0 1px 1px rgba(0, 0, 0, 0.13)");
  assert.doesNotMatch(css, /22px 48px/, "the big float shadow is back");
  // A row under the pointer is Capy's highlight, a separator 0.5px edge to edge.
  assert.equal(value(one(css, ".lc-row:focus-visible"), "background"), "var(--lc-menu-hl)");
  assert.match(css, /--lc-menu-hl: color-mix\(in oklab, var\(--l-ink\) 4%, transparent\);/);
  assert.match(css, /--lc-menu-hl: color-mix\(in oklab, var\(--l-ink\) 6\.5%, transparent\);/);
  assert.equal(value(one(css, ".lc-sep"), "height"), "0.5px");
  // ⌘K and the model picker's cards take the same edge, fill and shadow; ⌘K keeps its 600 and its 38px rows.
  const models = read("models.css");
  const cmd = one(models, ".l-root .l-cmd__panel");
  assert.equal(value(cmd, "width"), "min(600px, 100%)");
  assert.equal(value(cmd, "box-shadow"), "var(--lc-float-shadow)");
  assert.equal(value(one(models, ".l-root .l-cmd__item"), "min-height"), "38px");
  const card = one(models, ".lc-pk[data-side] .lc-pk-card");
  assert.equal(value(card, "border-radius"), "var(--lc-r-menu)");
  assert.equal(value(card, "box-shadow"), "var(--lc-float-shadow)");
  assert.equal(value(one(models, '.lc-pk[data-side="card"]'), "grid-template-columns"), "37px 320px 288px", "the picker lost its three parts");
});

test("A menu's label is 12px grey on one line cut with an ellipsis, and its rows' ends are 13px grey with keys at 12", () => {
  const css = read("app.css");
  const head = one(css, ".lc-pop-head");
  assert.equal(value(head, "font-size"), "12px");
  assert.equal(value(head, "min-height"), "22px");
  const words = one(css, ".lc-pop-head > span:first-child");
  assert.equal(value(words, "white-space"), "nowrap", "a long session title takes two lines in +");
  assert.equal(value(words, "text-overflow"), "ellipsis");
  const end = one(css, ".lc-row-end");
  assert.equal(value(end, "font-size"), "13px");
  assert.equal(value(end, "font-weight"), "400");
  const kbd = one(css, ".lc-row-end .lc-kbd");
  assert.equal(value(kbd, "font-size"), "12px");
  assert.equal(value(kbd, "font-weight"), "400");
  assert.equal(value(kbd, "background"), "none", "a key at a row's end is a chip again");
  assert.equal(value(one(css, ".lc-row-end > svg"), "color"), "var(--lc-icon-faint)", "a ›'s grey is not the faint one");
  assert.equal(value(one(css, ".lc-row-end > .lc-row-on"), "color"), "var(--l-ink)", "the tick is not in ink");
});

test("Nothing in a menu is set heavier than 500, and a menu row's words and label are regular", () => {
  const menu = /lc-pop|lc-row|lc-perm|lc-sb-menu|lc-envp|lc-plus-menu|lc-mention|lc-pk|l-cmd|lc-dr|lc-da/;
  for (const file of ["app.css", "models.css"]) {
    for (const m of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim().split("\n").filter((l) => !l.trim().startsWith("/*") && !l.trim().startsWith("*")).join(" ");
      if (!menu.test(sel)) continue;
      const w = /font-weight:\s*(\d+)|font:\s*(\d{3}) /.exec(m[2]);
      if (w) assert.ok(Number(w[1] ?? w[2]) <= 500, `${file}: ${sel} sets ${w[1] ?? w[2]} in a menu`);
    }
  }
  const css = read("app.css");
  assert.ok(blocks(css, ".lc-row-t b").every((b) => value(b, "font-weight") === undefined || value(b, "font-weight") === "400"), "a menu row's title is heavier than regular");
  assert.ok(blocks(css, ".lc-pop-head > span:first-child").every((b) => value(b, "font-weight") === "400"), "a menu's label is heavier than regular");
  assert.equal(value(one(css, ".lc-perm-t b"), "font-weight"), "400", "a level's name in the access menu is heavier than regular");
  assert.equal(value(one(css, ".lc-dr-main"), "font-weight"), "400", "the details card's words are heavier than a menu's");
});

/* ---------- Lean icons ---------- */

/** sRGB hex to oklab, a mix in it, and the contrast of two colours, as the browser works color-mix(in oklab) out. */
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const ok = (h: string) => {
  const [r, g, b] = rgb(h).map(lin);
  const [l, m, s] = [0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b].map(Math.cbrt);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const back = ([L, a, b]: number[]) => {
  const [l, m, s] = [L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.291485548 * b].map((x) => x ** 3);
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((c) => Math.min(1, Math.max(0, gam(c))));
};
const mix = (a: string, b: string, p: number) => {
  const A = ok(a);
  const B = ok(b);
  return back(A.map((v, i) => v * p + B[i] * (1 - p)));
};
const lum = (c: number[]) => {
  const [r, g, b] = c.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (x: number[], y: number[]) => (Math.max(lum(x), lum(y)) + 0.05) / (Math.min(lum(x), lum(y)) + 0.05);
const hex = (c: number[]) => "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

test("Icons in menus, pop-ups and the details card are 14px in a muted grey drawn at 0.8 of the stroke, from one rule, and still read at 3:1", () => {
  // One rule: the wrappers scale their stroke by --lc-stroke, and the menu surface, ⌘K, the picker's cards and the details card set it.
  const icons = read("icons.tsx");
  assert.match(icons, /export const lean = \(sw: number, style\?: CSSProperties\): CSSProperties => \(\{ strokeWidth: `calc\(\$\{sw\}px \* var\(--lc-stroke, 1\)\)`, \.\.\.style \}\);/);
  assert.match(icons, /const S = [^\n]*\n[^\n]*style=\{w === 1\.5 \? lean\(wt\(size, 16\), style\) : style\}/, "the 16 grid's icons don't take the place's stroke, or a mark drawn heavier does");
  assert.match(icons, /const L = [^\n]*\n[^\n]*style=\{lean\(wt\(size, 20\), style\)\}/, "the 20 grid's icons don't take the place's stroke");
  const css = read("app.css");
  assert.match(css, /--lc-menu-stroke: 0\.8;/);
  const panel = blocks(css, ".l-pop.lc-pop-panel").find((b) => value(b, "padding") === "4px") ?? "";
  assert.equal(value(panel, "--lc-stroke"), "var(--lc-menu-stroke)");
  assert.equal(value(one(css, ".lc-dcard"), "--lc-stroke"), "var(--lc-menu-stroke)");
  const models = read("models.css");
  assert.equal(value(one(models, ".l-root .l-cmd__panel"), "--lc-stroke"), "var(--lc-menu-stroke)");
  assert.equal(value(one(models, ".lc-pk[data-side]"), "--lc-stroke"), "var(--lc-menu-stroke)");
  // A state mark and a tool's mark keep their own drawing.
  assert.match(css, /\.lc-mk,\nsvg\.lc-mark \{\s*--lc-stroke: 1;/, "a state mark or a tool's mark draws lighter in a menu");
  // 14px in the muted grey: a menu row's, a details row's, ⌘K's.
  assert.equal(value(one(css, ".lc-row-tick > svg"), "width"), "14px");
  assert.equal(value(one(css, ".lc-row-tick"), "color"), "var(--lc-icon)");
  assert.equal(value(one(css, ".lc-dr-main > svg"), "color"), "var(--lc-icon)");
  assert.equal(value(one(models, ".l-root .l-cmd__icon"), "color"), "var(--lc-icon)");
  // A destructive row's icon is the danger colour.
  assert.match(css, /\.lc-row:is\(\[data-danger\], \[data-for-good\]\) \.lc-row-tick,[^{]*\{\s*color: var\(--l-danger-text\);/);
  // Every icon grey reads at 3:1 or more on the menu's fill, in both looks (the light ink on white; the dark on the float).
  const pct = (name: string) => [...css.matchAll(new RegExp(`${name}: color-mix\\(in oklab, var\\(--l-ink\\) ([\\d.]+)%, var\\(--lc-float\\)\\);`, "g"))].map((m) => Number(m[1]) / 100);
  const darkFloat = hex(mix("#f4f4f5", "#101012", 0.065));
  for (const name of ["--lc-icon", "--lc-icon-faint"]) {
    const [l, d] = pct(name);
    assert.ok(l && d, `${name} is not set in both looks`);
    assert.ok(contrast(mix("#18181b", "#ffffff", l), rgb("#ffffff")) >= 3, `${name} is under 3:1 on the light menu`);
    assert.ok(contrast(mix("#f4f4f5", darkFloat, d), rgb(darkFloat)) >= 3, `${name} is under 3:1 on the dark menu`);
  }
  // The details card hands its icons 14, so the lighter stroke lands at 1.2px.
  const env = read("Env.tsx");
  const card = env.slice(env.indexOf("export function DetailsCard("), env.indexOf("/** A row's state mark"));
  assert.doesNotMatch(card, /size=\{16\}/, "a details row's icon is still drawn for 16");
});

/* ---------- + streamlined ---------- */

const ids = ["session", "side", "browser", "design", "terminal", "files", "changes", "pr", "linked", "device", "agents"];
const none: SurfaceNow = { agents: false, pr: false, canvas: false, device: false, open: [] };

test("+ for a session with nothing on lists Session, Changes, Files and Browser, then More with the rest, New side chat, Terminals and its foot", () => {
  const { top, more } = surfaceRows(ids, none);
  assert.deepEqual(top, ["session", "changes", "files", "browser"]);
  assert.deepEqual(ALWAYS, top);
  assert.deepEqual(more, ["agents", "pr", "design", "device"], "More doesn't hold the rest in the board's order, or holds Side chat, the Terminal or Linked");
  // The menu's parts, in order: the title as a grey label, the list, More, a rule, New side chat, a rule, Terminals with New terminal, a rule and the foot.
  const sw = read("Switcher.tsx");
  const list = sw.slice(sw.indexOf("function SurfaceList("), sw.indexOf("/** The menu's shells part"));
  const at = (s: string) => {
    const i = list.indexOf(s);
    assert.ok(i >= 0, `+ has no ${s}`);
    return i;
  };
  const order = ["<PanelHead>{thread.title}</PanelHead>", "{top.map(surface)}", '<SubMenu title="More"', "<Sep />", 'title="New side chat"', "<Shells "];
  order.reduce((was, s) => {
    const i = list.indexOf(s, was);
    assert.ok(i > was, `${s} is out of place in +`);
    return i;
  }, -1);
  assert.ok(at('title="New side chat"') < at("<Shells "));
  const shells = sw.slice(sw.indexOf("function Shells("));
  assert.match(shells, /<PanelHead end=\{shells \? <span className="lc-ptab-live">\{plural\(shells, "shell"\)\}<\/span> : undefined\}>Terminals<\/PanelHead>/, "the Terminals label has no live count with its dot");
  assert.match(shells, /title="New terminal"/);
  assert.match(shells, /<Sep \/>\s*<MenuFoot>\{ports\.length === 0 \? "Nothing of this session's listens yet"/, "the foot line is gone");
  // The title is one line: the label cuts it (lean-menus' label test), and no rule follows it.
  assert.doesNotMatch(list, /<PanelHead>\{thread\.title\}<\/PanelHead>\s*<Sep \/>/, "a rule still follows the title");
  // More also holds Your apps, with New add-on.
  const more2 = list.slice(list.indexOf('<SubMenu title="More"'));
  assert.match(more2, /\{more\.map\(surface\)\}\s*<SubMenu title="Your apps"[\s\S]*?title="New add-on"/, "Your apps and New add-on are not under More");
});

test("+ lists Agents, Pull request, Design and Device once the session has them, and any surface open as a tab, ticked, Side chat too", () => {
  assert.deepEqual(surfaceRows(ids, { ...none, agents: true }).top, ["session", "changes", "files", "browser", "agents"]);
  assert.deepEqual(surfaceRows(ids, { ...none, pr: true }).top, ["session", "changes", "files", "browser", "pr"]);
  assert.deepEqual(surfaceRows(ids, { ...none, canvas: true }).top, ["session", "changes", "files", "browser", "design"]);
  assert.deepEqual(surfaceRows(ids, { ...none, device: true }).top, ["session", "changes", "files", "browser", "device"]);
  const all = surfaceRows(ids, { agents: true, pr: true, canvas: true, device: true, open: ["side"] });
  assert.deepEqual(all.top, ["session", "changes", "files", "browser", "agents", "pr", "design", "side", "device"]);
  assert.deepEqual(all.more, []);
  // An open tab shows whatever the session holds, and leaves More.
  const tab = surfaceRows(ids, { ...none, open: ["device", "changes"] });
  assert.ok(tab.top.includes("device") && !tab.more.includes("device"), "an open tab is not listed in +");
  // Its tick, and a press on the one showing puts it away.
  const sw = read("Switcher.tsx");
  assert.match(sw, /on=\{open\.includes\(id\) \|\| undefined\}/, "an open surface has no tick");
  assert.match(sw, /onDock\(onScreen\(dock, tab\) \? closeTab\(dock, tab\) : openTab\(dock, tab\)\)/, "a ticked surface can't be put away from +");
  // Pull request: the session's own, or a project with a GitHub remote (no network asked to say so).
  assert.equal(canPr({ pr: undefined }, { git: true, remote: undefined }), false, "a project with no GitHub remote offers a pull request");
  assert.equal(canPr({ pr: undefined }, { git: true, remote: "me/tides" }), true);
  assert.equal(canPr({ pr: { number: 3, url: "u", state: "OPEN" } }, undefined), true);
  assert.equal(canPr({ pr: undefined }, { git: false, remote: "me/tides" }), false);
  // A canvas: begun from a design, a design shown, a design tool called, a design file written; not a read of one.
  const tool = (o: Record<string, unknown>) => ({ kind: "tool", id: "t", at: 0, turn: 1, title: "", status: "done", toolKind: "other", tool: "Read", ...o }) as unknown as Item;
  assert.equal(hasCanvas({ design: { file: "tides" } }, []), true);
  assert.equal(hasCanvas({}, []), false);
  assert.equal(isCanvasItem({ kind: "design", id: "d", at: 0, turn: 1, design: "x", title: "x", path: "x.html", version: 1, size: "desktop" } as unknown as Item), true);
  assert.equal(isCanvasItem(tool({ tool: "mcp__liner__design_frame" })), true);
  assert.equal(isCanvasItem(tool({ toolKind: "write", tool: "Write", path: ".liner/designs/tides/frames/home.html" })), true);
  assert.equal(isCanvasItem(tool({ toolKind: "read", tool: "Read", path: ".liner/designs/tides/frames/home.html" })), false, "reading a design counts as having a canvas");
  assert.equal(isCanvasItem(tool({ toolKind: "write", tool: "Write", path: "src/tides.js" })), false);
});

test("No surface is out of reach from +: whatever the session holds, each is in its list or under More, Side chat has its own row, and every key still works", () => {
  const flags = [false, true];
  for (const agents of flags) for (const pr of flags) for (const canvas of flags) for (const device of flags) for (const open of [[], ["side"], ["design", "files"]]) {
    const { top, more } = surfaceRows([...ids, "routines"], { agents, pr, canvas, device, open });
    for (const id of MENU_ORDER.filter((x) => x !== "side")) assert.ok(top.includes(id) !== more.includes(id), `${id} is listed twice or not at all`);
    assert.ok(!more.includes("side"));
  }
  // The keys are the session's (Session.tsx), untouched by the menu: each surface's key still shows or hides it.
  const session = read("Session.tsx");
  assert.match(session, /const s = SURFACES\.find\(\(x\) => is\(e, `surface\.\$\{x\.id\}`\)\);/);
  // A press in Your apps (a side menu of More) is one of More's own, so it doesn't close More under the pointer.
  const ui = read("ui.tsx");
  const sub = ui.slice(ui.indexOf("export function SubMenu("), ui.indexOf("export function ConfirmRow("));
  assert.match(sub, /if \(\[\.\.\.\(subs \?\? \[\]\)\]\.some\(\(s\) => s !== panel\.current && s\.contains\(t\)\)\) return;/, "a press in a side menu's own side menu closes it");
});

test("A side menu opened from a side menu that went left keeps going left, away from the menus before it", () => {
  // +'s More opens left of +, at the panel's right; Your apps, from More, goes left of More rather than back over +.
  assert.equal(sideMenuLeft({ left: 800, right: 1050 }, 250, 1440, true), 800 - GAP - 250);
  assert.equal(sideMenuLeft({ left: 800, right: 1050 }, 250, 1440), 1050 + GAP, "a side menu of a plain menu no longer opens to the right");
  // With no room on the left it still finds room on the right.
  assert.equal(sideMenuLeft({ left: 100, right: 350 }, 250, 1440, true), 350 + GAP);
  assert.ok(EDGE > 0);
  const ui = read("ui.tsx");
  assert.match(ui, /sideMenuLeft\(m, w, vw, menu\?\.dataset\.side === "left"\)/);
  assert.match(ui, /data-side=\{pos\?\.side \?\? "right"\}/, "a side menu doesn't say which way it went");
});
