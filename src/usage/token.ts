import { execFileSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function cursorUserDataRoot(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor");
  }
  if (process.platform === "linux") {
    return path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "Cursor"
    );
  }
  return path.join(
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    "Cursor"
  );
}

function stateDbPath(): string {
  return path.join(
    cursorUserDataRoot(),
    "User",
    "globalStorage",
    "state.vscdb"
  );
}

function localStatePath(): string {
  return path.join(cursorUserDataRoot(), "Local State");
}

function readItem(key: string): string | undefined {
  const dbPath = stateDbPath();
  if (!fs.existsSync(dbPath)) {
    return undefined;
  }
  // node:sqlite (Node 22+) opens large DBs without loading into RAM
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (
      path: string,
      opts?: { readOnly?: boolean }
    ) => {
      prepare: (sql: string) => {
        get: (...params: unknown[]) => { value?: unknown } | undefined;
      };
      close: () => void;
    };
  };
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key);
    if (row?.value == null) {
      return undefined;
    }
    return String(row.value);
  } finally {
    db.close();
  }
}

function dpapiUnprotectWindows(buf: Buffer): Buffer {
  const b64 = buf.toString("base64");
  const ps = `
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String('${b64}')
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($plain)
`;
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", ps],
    { encoding: "utf8", windowsHide: true, timeout: 15_000 }
  ).trim();
  if (!out) {
    throw new Error("DPAPI returned empty");
  }
  return Buffer.from(out, "base64");
}

function getOsCryptKeyWindows(): Buffer {
  const localState = JSON.parse(fs.readFileSync(localStatePath(), "utf8")) as {
    os_crypt?: { encrypted_key?: string };
  };
  const encB64 = localState.os_crypt?.encrypted_key;
  if (!encB64) {
    throw new Error("Local State missing os_crypt.encrypted_key");
  }
  const enc = Buffer.from(encB64, "base64");
  if (enc.slice(0, 5).toString("utf8") !== "DPAPI") {
    throw new Error("Unexpected os_crypt key prefix");
  }
  return dpapiUnprotectWindows(enc.slice(5));
}

/**
 * Decrypt Cursor's `cursor-safe-storage:v1:` blob (Electron safeStorage / Chromium OSCrypt).
 * On current Windows Cursor builds the payload is AES-256-GCM even when labeled `v10`.
 */
export function decryptCursorSafeStorage(sealed: string, key: Buffer): string {
  if (!sealed.startsWith("cursor-safe-storage:v1:")) {
    return sealed;
  }
  const raw = Buffer.from(sealed.slice("cursor-safe-storage:v1:".length), "base64");
  if (raw.length < 3 + 12 + 16) {
    throw new Error("Sealed token too short");
  }
  const body = raw.slice(3);
  const nonce = body.slice(0, 12);
  const tag = body.slice(body.length - 16);
  const data = body.slice(12, body.length - 16);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key.subarray(0, 32),
    nonce
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
}

/** Read + decrypt Cursor access token. Token is never written to disk by us. */
export function readAccessToken(): string {
  const sealed = readItem("cursorAuth/accessToken");
  if (!sealed) {
    throw new Error("No cursorAuth/accessToken in local Cursor storage");
  }
  if (!sealed.startsWith("cursor-safe-storage:")) {
    return sealed;
  }
  if (process.platform !== "win32") {
    throw new Error(
      "Encrypted Cursor tokens need platform decrypt (Windows supported; open Plan & Usage for now)"
    );
  }
  const key = getOsCryptKeyWindows();
  return decryptCursorSafeStorage(sealed, key);
}

export function readMembershipHint(): string | undefined {
  return readItem("cursorAuth/stripeMembershipType") ?? undefined;
}
