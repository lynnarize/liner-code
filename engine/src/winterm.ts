/*
  The Terminal on Windows, where no script can open a pty (the Mac's comes from Python's pty
  module): PowerShell on pipes, running a small loop that prints a prompt, reads a line and runs
  it, with the line editing a terminal would do (echo, Backspace, Ctrl+U, Ctrl+C) done here. Each
  line's output streams back as it comes. A full-screen program (vim, an agent's own UI) needs a
  real console (ConPTY, as T3 Code gets from node-pty) and doesn't draw here.
*/
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { killTree, which } from "./exec.ts";

/** The loop PowerShell runs: UTF-8 both ways, a prompt with the folder, each line run as you'd type it. */
const loop = (cols: number) => `
$ErrorActionPreference = 'Continue'
$utf8 = New-Object System.Text.UTF8Encoding $false
try { [Console]::InputEncoding = $utf8; [Console]::OutputEncoding = $utf8 } catch {}
$OutputEncoding = $utf8
while ($true) {
  [Console]::Out.Write("PS " + $PWD.ProviderPath + "> ")
  [Console]::Out.Flush()
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line.Trim() -eq 'exit') { break }
  if (-not $line.Trim()) { continue }
  try { Invoke-Expression $line | Out-String -Stream -Width ${Math.max(40, cols)} | ForEach-Object { [Console]::Out.WriteLine($_) } } catch { [Console]::Out.WriteLine($_.ToString()) }
  [Console]::Out.Flush()
}
`;

export type WinShell = { child: ChildProcessWithoutNullStreams; input: (data: string) => void; output: (data: string) => string };

/** PowerShell in `cwd`; `echo` puts what you type on screen, through the same stream as the shell's output. */
export function winShell(cwd: string, cols: number, env: NodeJS.ProcessEnv, echo: (text: string) => void): WinShell {
  const ps = which("pwsh", env) ?? which("powershell", env) ?? "powershell.exe";
  const script = Buffer.from(loop(cols), "utf16le").toString("base64");
  const child = spawn(ps, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", script], { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let line = "";
  let cr = false;
  const send = (text: string) => child.stdin.writable && child.stdin.write(text);
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
    // Arrow keys and the like: there's no history or cursor here to move.
    for (const ch of data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1bO.|\x1b./g, "")) {
      const wasCr = cr;
      cr = ch === "\r";
      if (ch === "\n" && wasCr) continue;
      if (ch === "\r" || ch === "\n") {
        echo("\r\n");
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
        echo("\b \b".repeat(Array.from(line).length));
        line = "";
      } else if (ch === "\x03") {
        echo("^C\r\n");
        line = "";
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
  return { child, input, output };
}

/** Ends the shell and whatever it started. */
export function endShell(child: ChildProcessWithoutNullStreams) {
  child.stdin.end();
  killTree(child);
}
