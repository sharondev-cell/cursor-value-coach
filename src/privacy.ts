import * as crypto from "crypto";
import * as path from "path";

/** Stable opaque id — never store raw filesystem paths in extension state. */
export function transcriptId(filePath: string): string {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 16);
}

/** Safe label for UI (filename only, no home/project path). */
export function safeTranscriptLabel(filePath: string): string {
  return path.basename(filePath);
}

export interface ToolFingerprint {
  /** Tool name only — safe to show in UI. */
  name: string;
  /** sha256 of name + input shape; raw args are never retained. */
  signature: string;
}

/**
 * Extract tool fingerprints from a JSONL line.
 * Hashes name+input immediately; does not keep argument payloads.
 */
export function extractToolFingerprints(line: string): ToolFingerprint[] {
  const out: ToolFingerprint[] = [];
  const re =
    /"type"\s*:\s*"tool_use"\s*,\s*"name"\s*:\s*"([^"]{1,128})"\s*,\s*"input"\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const name = match[1];
    const inputStart = match.index + match[0].length;
    const inputSlice = sliceBalancedJson(line, inputStart, 4_000);
    const signature = crypto
      .createHash("sha256")
      .update(name)
      .update("\0")
      .update(inputSlice)
      .digest("hex")
      .slice(0, 16);
    out.push({ name, signature });
  }

  // Fallback: older / alternate shapes with tool_calls arrays
  if (out.length === 0 && /"tool_calls"\s*:/.test(line)) {
    const nameRe = /"name"\s*:\s*"([^"]{1,128})"/g;
    let n: RegExpExecArray | null;
    const names: string[] = [];
    while ((n = nameRe.exec(line)) !== null) {
      names.push(n[1]);
    }
    for (const name of names.slice(0, 32)) {
      const signature = crypto
        .createHash("sha256")
        .update(`legacy:${name}:${line.length}`)
        .digest("hex")
        .slice(0, 16);
      out.push({ name, signature });
    }
  }

  return out;
}

/** Read a JSON value starting at `{` or `[`, capped for hashing only. */
function sliceBalancedJson(text: string, start: number, maxLen: number): string {
  while (start < text.length && /\s/.test(text[start])) {
    start += 1;
  }
  if (start >= text.length) {
    return "";
  }
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) {
    return text.slice(start, Math.min(text.length, start + Math.min(maxLen, 256)));
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  const endLimit = Math.min(text.length, start + maxLen);
  for (let i = start; i < endLimit; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return text.slice(start, endLimit);
}

/**
 * Pull only structural fields from a JSONL line.
 * Message bodies / tool args are never returned or retained.
 */
export function structuralFields(line: string): {
  role: string;
  hasTool: boolean;
  toolCount: number;
  fingerprints: ToolFingerprint[];
  ts?: number;
} | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  // Fast path: role / type without full parse of huge payloads
  const roleMatch = trimmed.match(/"(?:role|type)"\s*:\s*"([^"]{1,64})"/i);
  const role = (roleMatch?.[1] ?? "").toLowerCase();

  const fingerprints = extractToolFingerprints(trimmed);
  const toolCount =
    fingerprints.length > 0
      ? fingerprints.length
      : /"tool_calls"\s*:/.test(trimmed) ||
          /"toolCall"\s*:/.test(trimmed) ||
          /"(?:role|type)"\s*:\s*"(?:tool|tool_call|tool_result)"/i.test(
            trimmed
          ) ||
          /"type"\s*:\s*"[^"]*tool[^"]*"/i.test(trimmed)
        ? 1
        : 0;

  const hasTool = toolCount > 0;

  let ts: number | undefined;
  const tsMatch = trimmed.match(
    /"(?:timestamp|createdAt|time)"\s*:\s*("?\d{10,13}"?|"[^"]+")/i
  );
  if (tsMatch) {
    const raw = tsMatch[1].replace(/"/g, "");
    const n = Number(raw);
    if (Number.isFinite(n)) {
      ts = n < 1e12 ? n * 1000 : n;
    } else {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) {
        ts = parsed;
      }
    }
  }

  // User messages often embed <timestamp>... which we can use as activity time
  if (ts == null && (role === "user" || role === "human")) {
    const embedded = trimmed.match(
      /<timestamp>\s*([^<]{8,80})\s*<\/timestamp>/i
    );
    if (embedded) {
      const parsed = Date.parse(embedded[1].trim());
      if (Number.isFinite(parsed)) {
        ts = parsed;
      }
    }
  }

  if (!role && !hasTool) {
    return null;
  }

  return { role, hasTool, toolCount, fingerprints, ts };
}
