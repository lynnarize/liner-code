/*
  How the Browser's frame is sized and drawn when the page isn't shown at its own pixels: Desktop
  in a panel narrower than a laptop, a phone or tablet wider than the panel, or the page's own zoom.

  The frame is zoomed, not scaled by a transform. Under a transform the page inside can't tell it
  is drawn smaller: Desktop in a 348px panel told it "1280 by 2523 at 2x", so a page that sizes a
  canvas by its window (most animations do) kept one of 2560 by 5046 pixels and painted all thirteen
  million of them every frame to fill a box of one million. The graphics process couldn't keep up
  and the whole app fell to about six frames a second with it. Under zoom the page still lays out
  1280 wide, and its devicePixelRatio is the pixels it is really shown at, as in a browser zoomed
  out, so its canvas is the size of the box.

  desktop/test/browser-zoom.test.ts holds this in real Electron: it is Chromium that carries a
  frame's zoom into the page inside, in another process too.
*/

/** What Desktop lays a page out at when the panel is narrower: a laptop's width, past the breakpoints most sites switch to their desktop layout at. */
export const DESKTOP = 1280;

/**
  The frame's place for a page `w` wide (null: Desktop, as wide as the panel) at the page's `zoom`,
  in a stage `room` wide (0: not measured yet). `fit` is how much smaller it is drawn to fit, and
  `scale` what a page pixel is drawn at: its zoom, times the fit.
*/
export function frameBox(w: number | null, zoom: number, room: number) {
  // A phone or tablet wider than the panel is drawn smaller, 12px in from the stage's edges all
  // round, so it never runs under them; the page still lays out at the device's own width.
  // Desktop fills the stage edge to edge: in a panel narrower than a laptop, the page lays out
  // DESKTOP wide and is drawn smaller, rather than squeezed into the phone layout the panel's width asks for.
  const fit = w ? (room > 24 ? Math.min(1, (room - 24) / w) : 1) : room > 0 ? Math.min(1, room / DESKTOP) : 1;
  const scale = zoom * fit;
  // A length in px is drawn at the zoom and one in % is not, so 100% is the box whatever the zoom,
  // and the page inside is 1/scale as wide and tall as the box. Desktop drawn smaller says its
  // width outright: a box 348 wide over a scale of 0.271875 can come out as 1279.
  const style: { width: string; height: string; zoom?: number } = { width: !w && fit < 1 ? `${DESKTOP / zoom}px` : "100%", height: "100%" };
  if (scale !== 1) style.zoom = scale;
  return { fit, scale, style };
}

/**
  Whether a page width other than Desktop needs saying in the Browser's top row. A phone or tablet drawn at its own size
  is a frame narrower than the stage, and that says it; one drawn smaller to fit fills the stage edge to edge, as Desktop
  does, so nothing in the page tells it apart. Not measured yet (`room` 0), the frame says nothing either.
*/
export const widthUnseen = (w: number | null, room: number) => w !== null && (room <= 24 || frameBox(w, 1, room).fit < 1);
