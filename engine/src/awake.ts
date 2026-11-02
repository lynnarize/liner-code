/*
  Keeps the Mac from sleeping while an agent works: `caffeinate -i` (no idle sleep; the display
  still dims and sleeps) for as long as a session runs or a routine run is going. It's tied to the
  engine's own process, so it ends with the engine whatever happens. Settings › General turns it off.
*/
import { spawn, type ChildProcess } from "node:child_process";
import type { Store } from "./store.ts";

export class Awake {
  private child: ChildProcess | null = null;
  private readonly store: Store;
  private readonly busy: () => boolean;

  constructor(store: Store, busy: () => boolean) {
    this.store = store;
    this.busy = busy;
  }

  /** Looks again at every change the engine reports. */
  start() {
    this.store.on(() => this.check());
    this.check();
  }

  check() {
    const want = (process.platform === "darwin" || process.platform === "win32") && this.store.settings.keepAwake !== false && this.busy();
    if (want && !this.child) {
      const child = process.platform === "win32" ? stayAwake() : spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
      const gone = () => {
        if (this.child === child) this.child = null;
      };
      child.on("exit", gone);
      child.on("error", gone);
      this.child = child;
    } else if (!want && this.child) this.stop();
  }

  stop() {
    this.child?.kill();
    this.child = null;
  }
}

/**
  Windows' caffeinate: PowerShell asks the system to stay awake (SetThreadExecutionState, which
  lasts as long as the process does) and waits on its stdin, so it ends when it's stopped or when
  the engine goes and the pipe closes.
*/
const AWAKE = `Add-Type -Name P -Namespace Liner -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
[Liner.P]::SetThreadExecutionState(0x80000001) | Out-Null
[Console]::In.ReadToEnd() | Out-Null`;
const stayAwake = () => spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(AWAKE, "utf16le").toString("base64")], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
