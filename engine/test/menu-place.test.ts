/*
  Where a menu opens (ui/src/app/menu-place.ts): under a row's ···, above it when there's no room below, and never over the
  window's top row, where the Mac's red, yellow and green buttons are. Run with `node --test engine/test/menu-place.test.ts`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { EDGE, GAP, panelLeft, panelSide, sideMenuLeft, WHOLE_MIN, placeMenu, TOP_ROW } from "../../ui/src/app/menu-place.ts";
import { PICKER, PICKER_NARROW, PICKER_WIDE, pickerOut } from "../../ui/src/app/picker.ts";

const vw = 1200;
const vh = 800;
// A sidebar row 260 wide at the window's left, its ··· at its right end.
const row = (top: number) => ({ left: 8, top, right: 268, bottom: top + 44 });
const dots = (top: number) => ({ left: 238, top: top + 2, right: 262, bottom: top + 26 });

test("A row's menu hangs under its ··· with their right edges on one line", () => {
  const p = placeMenu({ at: { x: 262, y: 126 }, under: dots(100), row: row(100), w: 200, h: 270, vw, vh });
  assert.deepEqual(p, { top: 126 + GAP, left: 262 - 200, side: "bottom" });
});

test("A row's menu wider than the room left of its ··· starts on the row's left edge instead", () => {
  const p = placeMenu({ at: { x: 262, y: 126 }, under: dots(100), row: row(100), w: 258, h: 270, vw, vh });
  assert.equal(p.left, EDGE, "kept inside the window, from the row's left edge");
  const wide = placeMenu({ at: { x: 262, y: 126 }, under: dots(100), row: { ...row(100), left: 40 }, w: 258, h: 270, vw, vh });
  assert.equal(wide.left, 40, "the menu doesn't start on the row's left edge");
});

test("A row's menu flips above its ··· when there is no room below, its foot at the button's top", () => {
  const p = placeMenu({ at: { x: 262, y: 726 }, under: dots(700), row: row(700), w: 200, h: 270, vw, vh });
  assert.equal(p.side, "top");
  assert.equal(p.top + 270, 702 - GAP, "the menu's foot is not at the button");
});

test("A menu is never placed over the window's top row, even when it is too tall for either side", () => {
  // The old menu: twelve rows, six of them two lines, from a row half way down a short window.
  const tall = placeMenu({ at: { x: 262, y: 326 }, under: dots(300), row: row(300), w: 250, h: 520, vw, vh: 600 });
  assert.ok(tall.top >= TOP_ROW, `the menu starts at ${tall.top}, over the window's buttons`);
  assert.ok(tall.max !== undefined && tall.top + tall.max <= 600 - EDGE, "the menu runs past the window's foot instead of scrolling inside");
  // Above with no room below: it stops under the top row and scrolls.
  const high = placeMenu({ at: { x: 262, y: 556 }, under: dots(530), row: row(530), w: 250, h: 700, vw, vh: 600 });
  assert.equal(high.side, "top");
  assert.equal(high.top, TOP_ROW);
  assert.equal(high.max, 532 - GAP - TOP_ROW);
  // A right-click opens below the pointer while it fits; flipped up, it still stops under the top row.
  const click = placeMenu({ at: { x: 30, y: 60 }, w: 240, h: 300, vw, vh });
  assert.deepEqual(click, { top: 60, left: 30, side: "bottom" });
  const flipped = placeMenu({ at: { x: 30, y: 700 }, w: 240, h: 680, vw, vh });
  assert.ok(flipped.top >= TOP_ROW, "a right-click's menu flipped up over the window's buttons");
});

test("A right-click inside the top row (a panel's tab) opens just under the top row, not at the pointer over it", () => {
  const p = placeMenu({ at: { x: 900, y: 22 }, w: 240, h: 200, vw, vh });
  assert.equal(p.side, "bottom");
  assert.equal(p.top, TOP_ROW, `the menu starts at ${p.top}, inside the top row`);
});

test("A menu the keyboard opens from a row flips above the row clear of it, never over the row that opened it", () => {
  const r = row(700);
  // Opened from the keyboard: at the row's foot, the row's box with it, no button.
  const p = placeMenu({ at: { x: r.left + 24, y: r.bottom }, row: r, w: 200, h: 270, vw, vh });
  assert.equal(p.side, "top");
  assert.ok(p.top + 270 <= r.top, `the menu's foot at ${p.top + 270} covers the row from ${r.top}`);
  assert.equal(p.top + 270, r.top - GAP);
  // Too tall for either side, above: it scrolls between the top row and the row.
  const tall = placeMenu({ at: { x: r.left + 24, y: r.bottom }, row: r, w: 200, h: 900, vw, vh });
  assert.equal(tall.top, TOP_ROW);
  assert.ok(tall.max !== undefined && tall.top + tall.max <= r.top, "the scrolling menu still covers its row");
});

test("A right-click's menu stays inside the window sideways", () => {
  assert.equal(placeMenu({ at: { x: 1150, y: 200 }, w: 240, h: 200, vw, vh }).left, vw - 240 - EDGE);
  assert.equal(placeMenu({ at: { x: 2, y: 200 }, w: 240, h: 200, vw, vh }).left, EDGE);
});

// The model picker's bare Pop under or over the message box's who chip: its cards 476 high.
const roomAt = (chipTop: number, chipBottom: number, vh: number) => ({ below: vh - chipBottom - GAP - EDGE, above: chipTop - GAP - TOP_ROW });

test("The model picker opens below its chip when it all fits there", () => {
  const p = panelSide({ h: 476, ...roomAt(200, 236, 900), prefer: "bottom", keep: true, keepMin: 260, whole: true });
  assert.deepEqual(p, { side: "bottom" });
});

test("On Home, with the box mid-window, the model picker opens under its chip fitted to the room there, never running off the window", () => {
  // A 1440 by 900 window: the chip's foot at 545 leaves 341 below; its top at 525 leaves 477 above the top row.
  const room = roomAt(525, 545, 900);
  assert.equal(room.below, 341);
  const p = panelSide({ h: 476, ...room, prefer: "bottom", keep: true, keepMin: 260, whole: true });
  assert.deepEqual(p, { side: "bottom", max: 341 }, "the picker left the room under its chip, or was given more than that room");
  // A panel that keeps its side (the + menu on Home) still does, fitted to the room.
  assert.deepEqual(panelSide({ h: 476, ...room, prefer: "bottom", keep: true, keepMin: 260 }), { side: "bottom", max: 341 });
});

test("The model picker goes under its chip first: whole when it fits, fitted while there is fair room, and only then above", () => {
  // The owner's tall window: 515 below the chip, so it all fits there.
  const tall = roomAt(782, 832, 1361);
  assert.equal(tall.below, 515);
  assert.deepEqual(panelSide({ h: 476, ...tall, prefer: "bottom", keep: true, keepMin: 260, whole: true }), { side: "bottom" });
  // Fair room below, more above: still below, fitted, as the owner asked.
  assert.deepEqual(panelSide({ h: 476, below: 300, above: 400, prefer: "bottom", whole: true }), { side: "bottom", max: 300 });
  assert.deepEqual(panelSide({ h: 476, below: WHOLE_MIN, above: 700, prefer: "top", whole: true }), { side: "bottom", max: WHOLE_MIN }, "whatever side its place prefers");
  // In a session the box is at the window's foot: no fair room below, so it opens above.
  assert.deepEqual(panelSide({ h: 476, below: 20, above: 700, prefer: "top", whole: true }), { side: "top" });
  assert.deepEqual(panelSide({ h: 476, below: WHOLE_MIN - 1, above: 300, prefer: "bottom", whole: true }), { side: "top", max: 300 });
  // Little room either way: the side with more, and exactly that room.
  assert.deepEqual(panelSide({ h: 476, below: 60, above: 40, prefer: "bottom", whole: true }), { side: "bottom", max: 60 });
});


test("The model picker hung below Home's chip stays inside the window sideways, its right edge on the chip's", () => {
  const chip = { left: 1300, right: 1420, width: 120 };
  assert.equal(panelLeft("end", chip, 636, EDGE, 2000 - EDGE), 1420 - 636);
  // A chip near the window's left edge: the picker starts at the edge, not past it.
  assert.equal(panelLeft("end", { left: 20, right: 140, width: 120 }, 636, EDGE, 2000 - EDGE), EDGE);
  // A window too narrow for it sideways keeps its right edge inside.
  const left = panelLeft("start", { left: 900, right: 1000, width: 100 }, 636, EDGE, 1200 - EDGE);
  assert.ok(left + 636 <= 1200 - EDGE, "the picker runs past the window's right edge");
});

test("The model picker's list, not its side card, stands over the chip: the card goes past the chip to the right, and the picker slides left only as far as the window makes it", () => {
  const chip = { left: 1001, right: 1073, width: 72 };
  const listLeft = (left: number) => left + PICKER.rail + PICKER.gap;
  // A 1440 window, the message box's chip: the list ends on the chip's right edge, the card stands past it.
  const out = pickerOut("end", true);
  const left = panelLeft("end", chip, PICKER_WIDE, EDGE, 1440 - EDGE, out);
  assert.equal(listLeft(left) + PICKER.list, chip.right, "the list does not end on the chip's right edge");
  assert.ok(left + PICKER_WIDE <= 1440 - EDGE, "the card runs past the window");
  // A window with no room for the card past the chip: it slides left by what is missing and no more, so the list stays the nearest part.
  const tight = panelLeft("end", { left: 831, right: 903, width: 72 }, PICKER_WIDE, EDGE, 1100 - EDGE, out);
  assert.equal(tight + PICKER_WIDE, 1100 - EDGE);
  // Without its card (a narrow window) nothing hangs past the chip.
  assert.equal(pickerOut("end", false), 0);
  assert.equal(panelLeft("end", chip, PICKER_NARROW, EDGE, 1440 - EDGE, pickerOut("end", false)), chip.right - PICKER_NARROW);
  // Hung by its left (a field in a dialog): the list starts on the field's left edge, the rail before it.
  const field = { left: 400, right: 640, width: 240 };
  assert.equal(listLeft(panelLeft("start", field, PICKER_WIDE, EDGE, 1440 - EDGE, pickerOut("start", true))), field.left);
  // A field at the window's left edge keeps the rail inside.
  assert.equal(panelLeft("start", { left: 20, right: 200, width: 180 }, PICKER_WIDE, EDGE, 1440 - EDGE, pickerOut("start", true)), EDGE);
});

test("A side menu opens to the right of its menu while the window has room there, and to the left only when it has not", () => {
  // The title menu, at the left of the session: its side menu goes right, not over the sidebar.
  assert.equal(sideMenuLeft({ left: 276, right: 616 }, 240, 1440), 616 + GAP);
  // The switcher's ··· at the window's right edge: no room on the right, so it goes left.
  assert.equal(sideMenuLeft({ left: 1180, right: 1430 }, 240, 1440), 1180 - GAP - 240);
  // Room on neither side (a narrow window): kept inside the window's right edge.
  assert.equal(sideMenuLeft({ left: 60, right: 400 }, 240, 480), 480 - EDGE - 240);
});
