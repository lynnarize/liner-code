/*
  A screen or surface that loads apart from the start, fetched once the app is idle (App and Panel
  call `fetch`), so launch has no more to read and its first open has nothing to wait for. A chunk
  that's here is handed over in the same turn: React's lazy takes even a finished import a turn
  later, shows the fallback, and then holds it for its 300ms.

  React's lazy keeps a failed import for good, so a Boundary's Try again would throw the same error
  for ever (a chunk asked for just as the engine restarts, the UI being served from its origin). Here
  the failure is thrown as it is, once, to the Boundary; its Try again calls retryChunks, which puts
  a fresh lazy in the failed one's place, so the next render asks for the chunk again. (Swapping it
  at once would loop: React renders again as the import fails, and would ask again, and again.)
*/
import { createElement, lazy, type ComponentProps, type ComponentType, type LazyExoticComponent } from "react";

/** The parts whose import failed, each with how to make its lazy anew. */
const failed = new Set<() => void>();
/** Lets every part whose code didn't load ask for it again on its next render (Boundary's Try again). */
export function retryChunks() {
  const again = [...failed];
  failed.clear();
  for (const f of again) f();
}

export function early<T extends ComponentType<any>>(load: () => Promise<T>) {
  let got: T | undefined;
  let going: Promise<T> | undefined;
  // One that failed before it was opened is asked for again when it opens.
  const fetch = () => (going ??= load().then((c) => (got = c), (e) => ((going = undefined), Promise.reject(e))));
  const renew = () => void (inner = make());
  const make = (): LazyExoticComponent<T> =>
    lazy(() =>
      got
        ? ({ then: (ok: (m: { default: T }) => void) => ok({ default: got! }) } as unknown as Promise<{ default: T }>)
        : fetch().then(
            (c) => ({ default: c }),
            (e) => {
              failed.add(renew);
              throw e;
            },
          ),
    );
  let inner = make();
  // Always the lazy, and once it has loaded the same one: swapping it for the component itself would remount what it shows.
  const View = (props: ComponentProps<T>) => createElement(inner, props);
  return { View, fetch };
}

/** React's lazy for a component that isn't fetched early, with early's retry: after retryChunks a failed import is asked for again. */
export const lazyAgain = <T extends ComponentType<any>>(load: () => Promise<T>) => early(load).View;
