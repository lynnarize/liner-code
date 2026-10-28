/*
  The addon in native/mac.mm, when it's there (macOS, built by build.ts). Without it the shell
  still runs: Vibrancy and Liquid Glass become Electron's own vibrancy behind the whole window,
  the traffic lights' place is worked out from where the shell puts them, and there's no tap.
*/
import { join } from "node:path";

export type Rect = { x: number; y: number; width: number; height: number };
/** The window's glass frame, and the paper inside it that the material leaves out. */
export type Frame = Rect & { hole?: Rect & { radius: number } };

type Mac = {
  backdrop(handle: Buffer, material: string, frame: Frame): void;
  lights(handle: Buffer): { x: number; y: number } | undefined;
  haptic(): void;
  quietWritingBadge(): void;
};

export const mac: Mac | null = (() => {
  if (process.platform !== "darwin") return null;
  try {
    return require(join(__dirname, "mac.node")) as Mac;
  } catch (e) {
    console.error("[shell] the Mac addon didn't load:", (e as Error).message);
    return null;
  }
})();
