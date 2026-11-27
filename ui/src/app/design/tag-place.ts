/*
  Where a picked layer's name tag goes on the canvas (Canvas.tsx, design-face.css .ld-sel[data-n]). A frame's own label
  row stands above the frame, its top 22 above and its foot 4 above; the tag is 15 high and sits 1.5 above the layer.
  When, above the layer, the tag would reach into that row it goes inside the layer's top edge instead (board Design),
  so the frame's name and its checks stay readable. Its own module, with nothing of React, so a test can run it.
*/

/** Whether the tag goes inside: `y` is the layer's top in the frame, `zoom` the canvas's. */
export const tagInside = (y: number, zoom: number) => y * zoom - 1.5 - 15 < -4;
