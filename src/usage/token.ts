import { execFileSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** Only these ItemTable keys may be read from Cursor state.vscdb. */
const ALLOWED_STATE_KEYS = new Set([
  "cursorAuth/accessToken",
  "cursorAuth/stripeMembershipType",
]);

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
  if (!ALLOWED_STATE_KEYS.has(key)) {
    throw new Error("Refused to read non-allowlisted Cursor state key");
  }
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
    const row = db
      .prepare("SELECT value FROM ItemTable WHERE key = ?")
      .get(key);
    if (row?.value == null) {
      return undefined;
    }
    return String(row.value);
  } finally {
    db.close();
  }
}

function wipeFile(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const size = fs.statSync(filePath).size;
    if (size > 0) {
      fs.writeFileSync(filePath, Buffer.alloc(size, 0));
    }
    fs.unlinkSync(filePath);
  } catch {
    // best-effort
  }
}

/**
 * DPAPI unprotect without putting ciphertext/plaintext on the process command line.
 * Uses short-lived temp files + env paths only.
 */
function dpapiUnprotectWindows(buf: Buffer): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-dpapi-"));
  const inFile = path.join(dir, "in.bin");
  const outFile = path.join(dir, "out.bin");
  try {
    fs.writeFileSync(inFile, buf, { mode: 0o600 });
    const ps = `
Add-Type -AssemblyName System.Security
$in = $env:VC_DPAPI_IN
$out = $env:VC_DPAPI_OUT
if (-not $in -or -not $out) { throw 'missing VC_DPAPI paths' }
$bytes = [IO.File]::ReadAllBytes($in)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[IO.File]::WriteAllBytes($out, $plain)
`;
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      {
        env: {
          ...process.env,
          VC_DPAPI_IN: inFile,
          VC_DPAPI_OUT: outFile,
        },
        windowsHide: true,
        timeout: 15_000,
      }
    );
    if (!fs.existsSync(outFile)) {
      throw new Error("DPAPI returned empty");
    }
    return fs.readFileSync(outFile);
  } finally {
    wipeFile(inFile);
    wipeFile(outFile);
    try {
      fs.rmdirSync(dir);
    } catch {
      // best-effort
    }
  }
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
    throw new Error("Unsupported Cursor safe-storage format");
  }
  const raw = Buffer.from(
    sealed.slice("cursor-safe-storage:v1:".length),
    "base64"
  );
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

/**
 * Read + decrypt Cursor access token in memory only.
 * Never writes the token to disk; callers must not log it.
 */
export function readAccessToken(): string {
  const sealed = readItem("cursorAuth/accessToken");
  if (!sealed) {
    throw new Error("No cursorAuth/accessToken in local Cursor storage");
  }
  if (!sealed.startsWith("cursor-safe-storage:")) {
    // Rare plaintext legacy — still never persist; refuse unexpected huge blobs
    if (sealed.length > 8_192) {
      throw new Error("Refusing unexpectedly large auth value");
    }
    return sealed;
  }
  if (process.platform !== "win32") {
    throw new Error(
      "Encrypted Cursor tokens need platform decrypt (Windows supported; open Plan & Usage for now)"
    );
  }
  const key = getOsCryptKeyWindows();
  try {
    return decryptCursorSafeStorage(sealed, key);
  } finally {
    key.fill(0);
  }
}

export function readMembershipHint(): string | undefined {
  const v = readItem("cursorAuth/stripeMembershipType") ?? undefined;
  if (v != null && v.length > 128) {
    return undefined;
  }
  return v;
}
