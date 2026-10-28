/*
  What the window's glass shows, and the picture behind the session. The window is one glass frame
  (the sidebar and the gaps around the paper): with Vibrancy or Liquid Glass the desktop is behind
  it, and Clear to Tinted says how much of it comes through. The picture you chose in Settings,
  Appearance is the paper's alone, blurred under a white wash so the work stays easy to read; the
  sidebar never shows it. Pictures come from the engine as JPEGs and are kept as blob URLs for the
  life of the page.
*/
import { useEffect, useState, type CSSProperties } from "react";
import { isNative } from "./bridge";
import { rpc } from "./engine";
import { readLook, type Look } from "./look";

const urls = new Map<string, Promise<string | null>>();
let ownVersion = 0;

const toBlobUrl = (data: string, type: string) => {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type }));
};

/** A picture's URL, fetched once per side (a dynamic wallpaper has a day and a night one). */
export function backgroundUrl(id: string, dark: boolean) {
  const key = id === "own" ? `own:${ownVersion}` : `${id}:${dark ? "dark" : "light"}`;
  if (!urls.has(key)) urls.set(key, rpc("background.image", { id, dark }).then((r) => (r ? toBlobUrl(r.data, r.type) : null)).catch(() => null));
  return urls.get(key)!;
}

/** Your own picture changed: the next read fetches it again. */
export function ownChanged() {
  ownVersion++;
  window.dispatchEvent(new Event("lc:bg-own"));
}

export function useBackgroundUrl(id?: string) {
  const [url, setUrl] = useState<string | null>(null);
  // The theme the page is in now; the look changing re-renders whoever reads it.
  const dark = useLook() && document.documentElement.dataset.theme === "dark";
  const [v, setV] = useState(ownVersion);
  useEffect(() => {
    const on = () => setV(ownVersion);
    window.addEventListener("lc:bg-own", on);
    return () => window.removeEventListener("lc:bg-own", on);
  }, []);
  useEffect(() => {
    if (!id || id === "none") return setUrl(null);
    let live = true;
    void backgroundUrl(id, dark).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [id, v, dark]);
  return url;
}

/** The look as Settings changes it. */
export function useLook() {
  const [look, setLook] = useState<Look>(readLook);
  useEffect(() => {
    const on = (e: Event) => setLook((e as CustomEvent<Look>).detail);
    window.addEventListener("lc:look", on);
    return () => window.removeEventListener("lc:look", on);
  }, []);
  return look;
}

/** What's behind the frame's glass: the desktop, or nothing but the window. */
export type Scene = "desktop" | "none";
export const sceneOf = (look: Look): Scene => (isNative() && look.material !== "solid" ? "desktop" : "none");

/** Says on <html> what the frame's glass shows, and whether a picture is behind the session. */
export function Scene() {
  const look = useLook();
  const url = useBackgroundUrl(look.background);
  const scene = sceneOf(look);
  useEffect(() => {
    const h = document.documentElement;
    h.dataset.scene = scene;
    // The paper's own surfaces turn see-through only while a picture is behind them.
    h.toggleAttribute("data-bg", Boolean(url));
  }, [scene, url]);
  return null;
}

/** Under a paper: the picture, blurred, under a white wash. */
export function Backdrop() {
  const look = useLook();
  const url = useBackgroundUrl(look.background);
  if (!url) return null;
  return <div className="lc-bg" aria-hidden style={{ "--lc-bg": `url("${url}")`, "--lc-bg-blur": `${look.bgBlur ?? 28}px`, "--lc-bg-show": String(look.bgShow ?? 0.45) } as CSSProperties} />;
}
