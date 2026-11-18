/*
  A screen or surface that loads apart from the start, fetched once the app is idle (App and Panel
  call `fetch`), so launch has no more to read and its first open has nothing to wait for. A chunk
  that's here is handed over in the same turn: React's lazy takes even a finished import a turn
  later, shows the fallback, and then holds it for its 300ms.
*/
import { lazy, type ComponentType } from "react";

export function early<T extends ComponentType<any>>(load: () => Promise<T>) {
  let got: T | undefined;
  let going: Promise<T> | undefined;
  // One that failed (the engine restarting) before it was opened is asked for again when it opens.
  // Once it has asked, it waits on the same fetch, and a failure then is kept by lazy for good.
  const fetch = () => (going ??= load().then((c) => (got = c), (e) => ((going = undefined), Promise.reject(e))));
  const View = lazy(() => (got ? ({ then: (ok: (m: { default: T }) => void) => ok({ default: got! }) } as unknown as Promise<{ default: T }>) : fetch().then((c) => ({ default: c }))));
  return { View, fetch };
}
