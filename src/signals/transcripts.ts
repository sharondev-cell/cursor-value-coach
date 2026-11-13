import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  structuralFields,
  transcriptId,
  type ToolFingerprint,
} from "../privacy";
import type { TranscriptSignal } from "../types";

function cursorHome(): string {
  return process.env.CURSOR_AGENT_HOME || path.join(os.homedir(), ".cursor");
}

function projectsRoot(): string {
  return path.join(cursorHome(), "projects");
}

/** Cursor Application Support / config root (workspaceStorage lives here). */
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

/**
 * Cursor project folder id under ~/.cursor/projects/.
 * Absolute path → replace `/` `.` `\` `:` with `-`, collapse dashes, trim edges.
 */
export function pathToCursorProjectSlug(absPath: string): string {
  const normalized = path.resolve(absPath).replace(/\\/g, "/");
  const slugified = normalized.replace(/[/.:]/g, "-");
  let result = "";
  let prevDash = false;
  for (const c of slugified) {
    if (c === "-") {
      if (!prevDash && result.length > 0) {
        result += "-";
      }
      prevDash = true;
    } else {
      result += c;
      prevDash = false;
    }
  }
  return result.replace(/^-+/, "").replace(/-+$/, "");
}

export interface TranscriptScanScope {
  /** Absolute workspace folder paths for this Cursor window. */
  workspaceFolderPaths: string[];
  /**
   * Preferred composer/chat ids (this window's pinned/focused tab first).
   * When set, those transcripts win over newer chats from other windows.
   */
  preferredComposerIds?: string[];
  /**
   * When true, never fall back to another chat in the same project if the
   * preferred composer transcript is missing. Required for same-folder
   * multi-window isolation (shared project slug, different chats).
   */
  strictPreferred?: boolean;
}

function walkJsonl(dir: string, out: string[], depth = 0): void {
  if (depth > 10 || !fs.existsSync(dir)) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsonl(full, out, depth + 1);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".jsonl") || entry.name.endsWith(".txt"))
    ) {
      if (full.replace(/\\/g, "/").includes("agent-transcripts")) {
        out.push(full);
      }
    }
  }
}

/** Prefer main session transcripts over nested subagent logs when ranking. */
function isSubagentTranscript(filePath: string): boolean {
  return filePath.replace(/\\/g, "/").includes("/subagents/");
}

function composerIdFromTranscriptPath(filePath: string): string | undefined {
  const norm = filePath.replace(/\\/g, "/");
  const base = path.basename(filePath, path.extname(filePath));
  // Nested: .../agent-transcripts/<uuid>/<uuid>.jsonl
  const parent = path.basename(path.dirname(filePath));
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      parent
    ) &&
    parent.toLowerCase() === base.toLowerCase()
  ) {
    return parent;
  }
  // Flat: .../agent-transcripts/<uuid>.txt|jsonl
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      base
    )
  ) {
    return base;
  }
  // Path contains a UUID segment (e.g. subagent under parent)
  const match = norm.match(
    /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i
  );
  return match?.[1];
}

function projectDirsForWorkspace(workspaceFolderPaths: string[]): string[] {
  const root = projectsRoot();
  if (!fs.existsSync(root) || workspaceFolderPaths.length === 0) {
    return [];
  }
  const dirs: string[] = [];
  const seen = new Set<string>();
  for (const folder of workspaceFolderPaths) {
    const slug = pathToCursorProjectSlug(folder);
    if (!slug) {
      continue;
    }
    const dir = path.join(root, slug);
    if (!seen.has(dir) && fs.existsSync(dir)) {
      seen.add(dir);
      dirs.push(dir);
    }
    // Also accept prefix matches when Cursor truncated / variant-encoded the path
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        if (entry.name === slug || entry.name.startsWith(`${slug}-`)) {
          const full = path.join(root, entry.name);
          if (!seen.has(full)) {
            seen.add(full);
            dirs.push(full);
          }
        }
      }
    } catch {
      // ignore listing failures
    }
  }
  return dirs;
}

interface LeanEvent {
  role: string;
  toolCount: number;
  fingerprints: ToolFingerprint[];
  ts?: number;
}

function countInFile(
  filePath: string,
  windowMs: number
): TranscriptSignal | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return undefined;
  }

  let text: string;
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const size = stat.size;
      // Larger tail so multi-tool loops in long sessions stay visible
      const max = 768_000;
      const start = size > max ? size - max : 0;
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }

  const now = Date.now();
  const cutoff = now - windowMs;
  const events: LeanEvent[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const fields = structuralFields(line);
    if (!fields) {
      continue;
    }
    if (fields.role === "turn_ended") {
      continue;
    }
    events.push({
      role: fields.role,
      toolCount: fields.toolCount,
      fingerprints: fields.fingerprints,
      ts: fields.ts,
    });
  }

  // Drop file buffer ASAP
  text = "";

  let userTurns = 0;
  let assistantTurns = 0;
  let toolCalls = 0;
  let lastActivityMs = stat.mtimeMs;
  let lastUserIndex = -1;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.ts != null) {
      lastActivityMs = Math.max(lastActivityMs, e.ts);
    }
    if (e.role === "user" || e.role === "human") {
      userTurns += 1;
      lastUserIndex = i;
    } else if (e.role === "assistant" || e.role === "ai" || e.role === "model") {
      assistantTurns += 1;
    }
    if (e.toolCount > 0) {
      toolCalls += e.toolCount;
    }
  }

  let toolsSinceLastUser = 0;
  for (let i = lastUserIndex + 1; i < events.length; i++) {
    toolsSinceLastUser += events[i].toolCount;
  }

  const recentSigCounts = new Map<string, number>();
  const recentNameBySig = new Map<string, string>();
  let recentToolCalls = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.toolCount <= 0) {
      continue;
    }
    const ts = e.ts ?? stat.mtimeMs;
    const inTimeWindow = e.ts != null ? e.ts >= cutoff : false;
    // Transcripts often lack per-line timestamps. Treat tools after the
    // latest user message as the live segment (walk-away / unattended).
    const inLiveSegment = lastUserIndex >= 0 && i > lastUserIndex;
    if (!inTimeWindow && !inLiveSegment) {
      continue;
    }
    recentToolCalls += e.toolCount;
    for (const fp of e.fingerprints) {
      recentSigCounts.set(
        fp.signature,
        (recentSigCounts.get(fp.signature) ?? 0) + 1
      );
      recentNameBySig.set(fp.signature, fp.name);
    }
    lastActivityMs = Math.max(lastActivityMs, ts);
  }

  let maxRepeatInWindow = 0;
  let topRepeatedTool: string | undefined;
  for (const [sig, count] of recentSigCounts) {
    if (count > maxRepeatInWindow) {
      maxRepeatInWindow = count;
      topRepeatedTool = recentNameBySig.get(sig);
    }
  }

  return {
    path: filePath,
    id: transcriptId(filePath),
    mtimeMs: stat.mtimeMs,
    userTurns,
    assistantTurns,
    toolCalls,
    recentToolCalls,
    toolsSinceLastUser,
    maxRepeatInWindow,
    uniqueSignaturesInWindow: recentSigCounts.size,
    topRepeatedTool,
    lastActivityMs,
    apparentlyActive: now - stat.mtimeMs < Math.min(windowMs, 5 * 60_000),
  };
}

function sortByRecency(files: string[]): string[] {
  return [...files].sort((a, b) => {
    const aSub = isSubagentTranscript(a) ? 1 : 0;
    const bSub = isSubagentTranscript(b) ? 1 : 0;
    if (aSub !== bSub) {
      return aSub - bSub;
    }
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
}

function pickFromFiles(
  files: string[],
  windowMs: number,
  preferredComposerIds?: string[],
  strictPreferred = false
): TranscriptSignal | undefined {
  if (files.length === 0) {
    return undefined;
  }

  const preferred = (preferredComposerIds ?? [])
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);

  if (preferred.length > 0) {
    for (const id of preferred) {
      const matches = files.filter((f) => {
        if (isSubagentTranscript(f)) {
          return false;
        }
        const cid = composerIdFromTranscriptPath(f)?.toLowerCase();
        return cid === id || f.replace(/\\/g, "/").toLowerCase().includes(id);
      });
      const ranked = sortByRecency(matches);
      for (const file of ranked.slice(0, 4)) {
        const signal = countInFile(file, windowMs);
        if (signal && signal.userTurns + signal.assistantTurns > 0) {
          return signal;
        }
      }
      // Prefer the focused chat even if the tail has no turns yet
      if (ranked[0]) {
        const signal = countInFile(ranked[0], windowMs);
        if (signal) {
          return signal;
        }
      }
    }
    if (strictPreferred) {
      // Do not bleed into sibling chats from other windows on this workspace.
      return undefined;
    }
  }

  // No pin yet: avoid merging every chat in the project. Only safe when the
  // caller did not request a preferred id (empty window / first seed).
  if (strictPreferred) {
    return undefined;
  }

  const ranked = sortByRecency(files);
  for (const file of ranked.slice(0, 8)) {
    const signal = countInFile(file, windowMs);
    if (signal && signal.userTurns + signal.assistantTurns > 0) {
      return signal;
    }
  }
  return countInFile(ranked[0], windowMs);
}

/**
 * Read focused/selected composer ids from this workspace's Cursor state.vscdb.
 * Only the allowlisted `composer.composerData` key is read (no auth keys).
 */
export function readFocusedComposerIds(
  workspaceFolderPaths: string[]
): string[] {
  if (workspaceFolderPaths.length === 0) {
    return [];
  }
  const storageRoot = path.join(
    cursorUserDataRoot(),
    "User",
    "workspaceStorage"
  );
  if (!fs.existsSync(storageRoot)) {
    return [];
  }

  const targets = new Set(
    workspaceFolderPaths.map((p) => path.resolve(p).replace(/\\/g, "/").toLowerCase())
  );

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(storageRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(storageRoot, entry.name);
    const metaPath = path.join(dir, "workspace.json");
    let metaRaw: string;
    try {
      metaRaw = fs.readFileSync(metaPath, "utf8");
    } catch {
      continue;
    }
    let folder: string | undefined;
    try {
      const meta = JSON.parse(metaRaw) as {
        folder?: string;
        workspace?: string;
      };
      const uri = meta.folder ?? meta.workspace;
      if (uri) {
        // file:///path or vscode-remote://...
        folder = decodeURIComponent(uri.replace(/^file:\/\//, "")).replace(
          /\\/g,
          "/"
        );
        // Windows file:///C:/...
        if (/^\/[A-Za-z]:\//.test(folder)) {
          folder = folder.slice(1);
        }
      }
    } catch {
      continue;
    }
    if (!folder) {
      continue;
    }
    const resolved = path.resolve(folder).replace(/\\/g, "/").toLowerCase();
    if (![...targets].some((t) => t === resolved || t.startsWith(resolved + "/") || resolved.startsWith(t + "/"))) {
      continue;
    }

    const ids = readComposerFocusFromDb(path.join(dir, "state.vscdb"));
    if (ids.length > 0) {
      return ids;
    }
  }
  return [];
}

function readComposerFocusFromDb(dbPath: string): string[] {
  if (!fs.existsSync(dbPath)) {
    return [];
  }
  try {
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
        .get("composer.composerData");
      if (row?.value == null) {
        return [];
      }
      const parsed = JSON.parse(String(row.value)) as {
        lastFocusedComposerIds?: unknown;
        selectedComposerIds?: unknown;
        selectedComposerId?: unknown;
      };
      const out: string[] = [];
      const pushId = (v: unknown) => {
        if (typeof v === "string" && v.trim()) {
          out.push(v.trim());
        } else if (v && typeof v === "object" && "composerId" in v) {
          const id = (v as { composerId?: unknown }).composerId;
          if (typeof id === "string" && id.trim()) {
            out.push(id.trim());
          }
        }
      };
      for (const list of [
        parsed.lastFocusedComposerIds,
        parsed.selectedComposerIds,
      ]) {
        if (Array.isArray(list)) {
          for (const item of list) {
            pushId(item);
          }
        }
      }
      pushId(parsed.selectedComposerId);
      // Dedupe, preserve order (focused first)
      const seen = new Set<string>();
      return out.filter((id) => {
        const key = id.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/**
 * Find the active transcript for this Cursor window and return counts only.
 * Scoped to the window's workspace project folder(s); prefers the focused
 * composer/chat tab when Cursor exposes it in workspace state.
 */
export function scanLatestTranscript(
  windowMinutes: number,
  scope?: TranscriptScanScope
): TranscriptSignal | undefined {
  const windowMs = windowMinutes * 60_000;
  const folders = scope?.workspaceFolderPaths ?? [];
  const strictPreferred = scope?.strictPreferred === true;
  const preferred = scope?.preferredComposerIds ?? [];

  if (folders.length > 0) {
    const projectDirs = projectDirsForWorkspace(folders);
    const files: string[] = [];
    for (const dir of projectDirs) {
      walkJsonl(path.join(dir, "agent-transcripts"), files);
      // Some layouts nest agent-transcripts under the project root already walked
      if (!fs.existsSync(path.join(dir, "agent-transcripts"))) {
        walkJsonl(dir, files);
      }
    }
    return pickFromFiles(files, windowMs, preferred, strictPreferred);
  }

  // No folder open in this window: refuse the old global merge across all projects
  return undefined;
}
