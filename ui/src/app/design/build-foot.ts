/*
  What the Design inspector's foot offers, from its counts alone (BuildTab.tsx draws it). The foot has one ink action,
  the most pressing: send a live frame's held changes, else update the code for frames ahead of it, else build. Build
  must stay in reach while one of the first two has the ink, or a frame not built yet beside a frame ahead of the code
  could not be built at all; there it is a quiet button before the ink one.
*/

export type FootCounts = {
  /** Live changes held for the code. */
  waiting: number;
  /** Frames whose design is ahead of their file. */
  ahead: number;
  /** Frames that are screens of the app (not references). */
  screens: number;
  /** Of those, the ones not built yet. */
  notBuilt: number;
};

export type FootButtons = { ink?: "send" | "update" | "build"; quietBuild: boolean };

export function footButtons(n: FootCounts): FootButtons {
  if (n.waiting) return { ink: "send", quietBuild: n.notBuilt > 0 };
  if (n.ahead) return { ink: "update", quietBuild: n.notBuilt > 0 };
  // Every screen built and none ahead: nothing to do, so the foot says so in words with no button.
  if (n.screens && !n.notBuilt) return { quietBuild: false };
  return { ink: "build", quietBuild: false };
}
