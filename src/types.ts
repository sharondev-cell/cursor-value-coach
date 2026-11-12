export type CoachKind =
  | "ok"
  | "new_chat"
  | "tool_loop"
  | "repeat_loop"
  | "unattended"
  | "costly";

export interface CoachEvent {
  id: string;
  at: number;
  kind: CoachKind;
  title: string;
  detail: string;
  tip: string;
  /** Opaque hash only — never a filesystem path. */
  transcriptId?: string;
  turnCount?: number;
  toolCalls?: number;
  maxRepeat?: number;
  uniqueSignatures?: number;
}

export interface TranscriptSignal {
  /** Absolute path used only in-memory during a scan; never persisted. */
  path: string;
  id: string;
  mtimeMs: number;
  userTurns: number;
  assistantTurns: number;
  toolCalls: number;
  recentToolCalls: number;
  /** Tool events after the last user turn in the scanned tail. */
  toolsSinceLastUser: number;
  /** Highest identical tool-signature count in the live/recent segment. */
  maxRepeatInWindow: number;
  /** Distinct tool signatures in the live/recent segment. */
  uniqueSignaturesInWindow: number;
  /** Most-repeated tool name (safe to show). */
  topRepeatedTool?: string;
  lastActivityMs: number;
  /** Transcript mtime is fresh — agent may still be running. */
  apparentlyActive: boolean;
}

export interface CoachVerdict {
  kind: CoachKind;
  title: string;
  detail: string;
  tip: string;
  signal?: TranscriptSignal;
  /** 0–2 escalation for progressive copy */
  level?: number;
  /** Turns or tool-count used for “got worse” detection */
  score?: number;
  severity?: "info" | "warn" | "critical";
}
