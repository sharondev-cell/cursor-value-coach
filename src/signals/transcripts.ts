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

/** Find the most recently active transcript and return counts only. */
export function scanLatestTranscript(
  windowMinutes: number
): TranscriptSignal | undefined {
  const root = projectsRoot();
  if (!fs.existsSync(root)) {
    return undefined;
  }
  const files: string[] = [];
  walkJsonl(root, files);
  if (files.length === 0) {
    return undefined;
  }

  files.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });

  const windowMs = windowMinutes * 60_000;
  for (const file of files.slice(0, 8)) {
    const signal = countInFile(file, windowMs);
    if (signal && signal.userTurns + signal.assistantTurns > 0) {
      return signal;
    }
  }
  return countInFile(files[0], windowMs);
}
