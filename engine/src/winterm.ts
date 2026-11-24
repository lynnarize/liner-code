/*
  The Terminal on Windows, where no script can open a pty (the Mac's comes from Python's pty
  module): PowerShell on pipes, running a small loop that prints a prompt, reads a line and runs
  it, with the line editing a terminal would do (echo, Backspace, Ctrl+U, Ctrl+C) done here. Each
  line's output streams back as it comes. A full-screen program (vim, an agent's own UI) needs a
  real console (ConPTY, as T3 Code gets from node-pty) and doesn't draw here.
*/
import { createRequire } from "node:module";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { killTree, which } from "./exec.ts";

/** The loop PowerShell runs: UTF-8 both ways, a prompt with the folder, each line run as you'd type it. */
const loop = (cols: number) => `
$ErrorActionPreference = 'Continue'
$utf8 = New-Object System.Text.UTF8Encoding $false
try { [Console]::InputEncoding = $utf8; [Console]::OutputEncoding = $utf8 } catch {}
$OutputEncoding = $utf8
$global:LINER_WIDTH = ${Math.max(40, cols)}
while ($true) {
  [Console]::Out.Write("PS " + $PWD.ProviderPath + "> ")
  [Console]::Out.Flush()
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line.Trim() -eq 'exit') { break }
  if ($line -match '^__LINER_WIDTH__=(\\d+)$') { $global:LINER_WIDTH = [Math]::Max(40, [int]$Matches[1]); continue }
  if (-not $line.Trim()) { continue }
  try { Invoke-Expression $line | Out-String -Stream -Width $global:LINER_WIDTH | ForEach-Object { [Console]::Out.WriteLine($_) } } catch { [Console]::Out.WriteLine($_.ToString()) }
  [Console]::Out.Flush()
}
`;

export type WinShell = {
  child: ChildProcessWithoutNullStreams | null;
  input: (data: string) => void;
  output: (data: string) => string;
  resize?: (cols: number, rows: number) => void;
  close?: () => void;
  onData?: (fn: (data: string) => void) => void;
  onExit?: (fn: (code: number) => void) => void;
};

type NodePtyProcess = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
};

/** Uses ConPTY via optional `node-pty` when installed on Windows so full-screen TUIs, arrow keys and resize work natively. */
function tryConPty(cwd: string, cols: number, rows: number, env: NodeJS.ProcessEnv): WinShell | null {
  try {
    const req = createRequire(import.meta.url);
    const pty = req("node-pty") as { spawn(file: string, args: string[], opts: Record<string, unknown>): NodePtyProcess };
    const ps = which("pwsh", env) ?? which("powershell", env) ?? "powershell.exe";
    const proc = pty.spawn(ps, ["-NoLogo"], { name: "xterm-256color", cols: Math.max(20, cols || 80), rows: Math.max(5, rows || 24), cwd, env, useConpty: true });
    return {
      child: null,
      input: (data) => proc.write(data),
      output: (data) => data,
      resize: (c, r) => proc.resize(c, r),
      close: () => proc.kill(),
      onData: (fn) => proc.onData(fn),
      onExit: (fn) => proc.onExit((e) => fn(e.exitCode ?? 0)),
    };
  } catch {
    return null;
  }
}

/** PowerShell in `cwd`; prefers ConPTY (`node-pty`) when installed, else runs PowerShell on pipes with line editing and history. */
export function winShell(cwd: string, cols: number, env: NodeJS.ProcessEnv, echo: (text: string) => void, rows = 24): WinShell {
  const conpty = tryConPty(cwd, cols, rows, env);
  if (conpty) return conpty;
  const ps = which("pwsh", env) ?? which("powershell", env) ?? "powershell.exe";
  const script = Buffer.from(loop(cols), "utf16le").toString("base64");
  const child = spawn(ps, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", script], { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let line = "";
  let cr = false;
  const history: string[] = [];
  let histAt = 0;
  const send = (text: string) => child.stdin.writable && child.stdin.write(text);
  const replaceLine = (next: string) => {
    echo("\b \b".repeat(Array.from(line).length));
    line = next;
    echo(line);
  };
  /** Ctrl+C: what the line started is stopped (its tree), and with nothing running, a fresh prompt. */
  const interrupt = () => {
    const pid = child.pid;
    if (!pid) return;
    // Not its console host (windowsHide still gives it one, as its child): that's no job, and killing it leaves no prompt.
    const find = `$n = 0; Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid} AND Name<>'conhost.exe' AND Name<>'OpenConsole.exe'" | ForEach-Object { taskkill /pid $_.ProcessId /T /F | Out-Null; $n++ }; $n`;
    const k = spawn(ps, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", find], { env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let said = "";
    k.stdout.on("data", (d: Buffer) => (said += d.toString()));
    k.on("close", () => said.trim() === "0" && send("\n"));
    k.on("error", () => send("\n"));
  };
  const input = (data: string) => {
    // Handle Up/Down history arrows before stripping remaining ANSI sequences in cooked fallback mode.
    for (let i = 0; i < data.length; ) {
      if (data.startsWith("\x1b[A", i)) {
        if (history.length && histAt > 0) replaceLine(history[--histAt]);
        i += 3;
        continue;
      }
      if (data.startsWith("\x1b[B", i)) {
        if (histAt < history.length - 1) replaceLine(history[++histAt]);
        else if (histAt === history.length - 1) (histAt = history.length), replaceLine("");
        i += 3;
        continue;
      }
      if (data[i] === "\x1b") {
        const m = /^\x1b(?:\[[0-9;?]*[ -/]*[@-~]|O.|.)/.exec(data.slice(i));
        i += m ? m[0].length : 1;
        continue;
      }
      const ch = data[i++];
      const wasCr = cr;
      cr = ch === "\r";
      if (ch === "\n" && wasCr) continue;
      if (ch === "\r" || ch === "\n") {
        echo("\r\n");
        if (line.trim() && history[history.length - 1] !== line) history.push(line);
        histAt = history.length;
        if (/^\s*(cls|clear)\s*$/i.test(line)) {
          echo("\x1b[H\x1b[2J");
          send("\n");
        } else send(`${line}\n`);
        line = "";
      } else if (ch === "\x7f" || ch === "\b") {
        if (!line) continue;
        line = Array.from(line).slice(0, -1).join("");
        echo("\b \b");
      } else if (ch === "\x15") {
        replaceLine("");
      } else if (ch === "\x03") {
        echo("^C\r\n");
        line = "";
        histAt = history.length;
        interrupt();
      } else if (ch === "\x04") {
        if (!line) child.stdin.end();
      } else if (ch >= " " || ch === "\t") {
        line += ch;
        echo(ch);
      }
    }
  };
  // xterm wants \r\n; Windows programs mostly say it already, git and Node often don't.
  const output = (data: string) => data.replace(/\r?\n/g, "\r\n");
  const resize = (nextCols: number) => {
    if (!line && child.stdin.writable) send(`__LINER_WIDTH__=${Math.max(40, Math.round(nextCols))}\n`);
  };
  return { child, input, output, resize };
}

/** Ends the shell and whatever it started. */
export function endShell(child: ChildProcessWithoutNullStreams) {
  child.stdin.end();
  killTree(child);
}
