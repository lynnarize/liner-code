/*
  API keys, encrypted with Electron's safeStorage (on a Mac, a key it keeps in the login keychain
  as "Liner Code Safe Storage") in keys.json beside the app's other data. The engine gets them
  in memory only. Keys the Swift shell kept as keychain items under "Liner Code" come over once.
*/
import { safeStorage } from "electron";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ACCOUNTS = ["key:anthropic", "key:openai"];

export class Keys {
  private file: string;

  constructor(dir: string) {
    this.file = join(dir, "keys.json");
  }

  private read(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }

  set(account: string, value: string | null) {
    if (!account) throw new Error("Which key?");
    const all = this.read();
    if (value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("This computer can't encrypt the key.");
      all[account] = safeStorage.encryptString(value).toString("base64");
    } else delete all[account];
    writeFileSync(this.file, JSON.stringify(all, null, 2), { mode: 0o600 });
  }

  /** Every key that's set, by provider ("anthropic"), for the engine at launch. */
  async all(): Promise<Record<string, string>> {
    if (!existsSync(this.file)) await this.migrate();
    const out: Record<string, string> = {};
    for (const [account, sealed] of Object.entries(this.read())) {
      try {
        out[account.replace(/^key:/, "")] = safeStorage.decryptString(Buffer.from(sealed, "base64"));
      } catch {
        // sealed by another build's key: it stays until you save it again
      }
    }
    return out;
  }

  /**
    The Swift shell's keychain items, read once. Asking whether one exists reads no secret and
    shows no prompt, so only a key that's really there asks you to let Liner Code have it.
  */
  private async migrate() {
    const all: Record<string, string> = {};
    if (process.platform === "darwin") {
      for (const account of ACCOUNTS) {
        const base = ["-s", "Liner Code", "-a", account];
        if ((await security(["find-generic-password", ...base])) === null) continue;
        const value = await security(["find-generic-password", ...base, "-w"]);
        if (value && safeStorage.isEncryptionAvailable()) all[account] = safeStorage.encryptString(value).toString("base64");
      }
    }
    writeFileSync(this.file, JSON.stringify(all, null, 2), { mode: 0o600 });
  }
}

const security = (args: string[]) =>
  new Promise<string | null>((resolve) => execFile("/usr/bin/security", args, { timeout: 60_000, encoding: "utf8" }, (err, out) => resolve(err ? null : out.trim())));
