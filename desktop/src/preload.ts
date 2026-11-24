/*
  The page's side of the shell. Before any of the page's scripts run, window.__LINER__ says
  where the engine is and the token it wants, and the traffic lights' place goes on the root
  as CSS variables. window.linerShell.call(method, params) reaches main.ts over one IPC
  channel and resolves with its answer; menu-bar commands come back through onCommand.
*/
import { contextBridge, ipcRenderer } from "electron";

type Lights = { x: number; y: number };
type WindowState = { maximized: boolean; fullScreen: boolean; focused: boolean };
type Boot = { base: string; token: string; machine: string; user: string; platform: string; lights: Lights; clear: boolean };

const boot = ipcRenderer.sendSync("liner:boot") as Boot;

contextBridge.exposeInMainWorld("__LINER__", { base: boot.base, token: boot.token, machine: boot.machine, user: boot.user });
contextBridge.exposeInMainWorld("linerShell", {
  platform: boot.platform,
  /** The window can be see-through, the desktop behind the app (the Mac addon is there). */
  clear: boot.clear,
  async call(method: string, params?: Record<string, unknown>) {
    const r = (await ipcRenderer.invoke("liner", method, params ?? {})) as { ok: boolean; value: unknown };
    if (!r.ok) throw new Error(String(r.value));
    return r.value;
  },
  onCommand(fn: (name: string) => void) {
    const handler = (_e: Electron.IpcRendererEvent, name: string) => fn(name);
    ipcRenderer.on("liner:command", handler);
    return () => {
      ipcRenderer.removeListener("liner:command", handler);
    };
  },
  onWindowState(fn: (state: WindowState) => void) {
    const handler = (_e: Electron.IpcRendererEvent, state: WindowState) => fn(state);
    ipcRenderer.on("liner:windowState", handler);
    return () => {
      ipcRenderer.removeListener("liner:windowState", handler);
    };
  },
});

const setLights = (l: Lights) => {
  const h = document.documentElement;
  if (!h) return void document.addEventListener("DOMContentLoaded", () => setLights(l), { once: true });
  h.style.setProperty("--lc-lights-y", `${l.y}px`);
  h.style.setProperty("--lc-lights-x", `${l.x}px`);
};
setLights(boot.lights);
// Full screen hides the traffic lights, so the page's top row moves back to the edge.
ipcRenderer.on("liner:lights", (_e, l: Lights) => setLights(l));
