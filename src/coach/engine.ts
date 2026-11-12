import { tipFor, titleFor } from "./tips";
import type { CoachVerdict, TranscriptSignal } from "../types";

export interface CoachThresholds {
  turnThreshold: number;
  toolLoopThreshold: number;
  /** Same tool+args signature this many times → critical stop. */
  repeatLoopThreshold: number;
  /** Tools since last user turn while transcript still active + stuck. */
  unattendedToolThreshold: number;
}

/** True when tool volume looks stuck: repeats or few unique signatures. */
function isStagnating(
  tools: number,
  maxRepeat: number,
  uniqueSignatures: number
): boolean {
  if (tools <= 0) {
    return false;
  }
  // Starting to retry the same call — classic walk-away precursor
  if (maxRepeat >= 2) {
    return true;
  }
  // Many tools, little new ground (varied busy work has high unique count)
  if (uniqueSignatures > 0 && tools / uniqueSignatures >= 2.5) {
    return true;
  }
  return false;
}

/**
 * Priority matches Reddit blast-radius:
 * repeat_loop / unattended > tool_loop > costly > new_chat > ok
 */
export function evaluate(
  signal: TranscriptSignal | undefined,
  thresholds: CoachThresholds
): CoachVerdict {
  if (!signal) {
    return {
      kind: "ok",
      title: "Coach: OK",
      detail: "No recent agent transcript found.",
      tip: tipFor("ok"),
      level: 0,
      score: 0,
      severity: "info",
    };
  }

  const turns = signal.userTurns + signal.assistantTurns;
  const tools = signal.recentToolCalls;
  const repeats = signal.maxRepeatInWindow;
  const toolHint = signal.topRepeatedTool
    ? ` (${signal.topRepeatedTool})`
    : "";

  // 1) Identical retries — the $1400 / $2000 pattern
  if (repeats >= thresholds.repeatLoopThreshold) {
    const over = repeats - thresholds.repeatLoopThreshold;
    const level = over >= thresholds.repeatLoopThreshold ? 2 : over >= 2 ? 1 : 0;
    return {
      kind: "repeat_loop",
      title: titleFor("repeat_loop", level),
      detail: `Same tool signature repeated ${repeats}×${toolHint}. Each retry re-sends full context — this is how unattended runs torch quotas.`,
      tip: tipFor("repeat_loop", level),
      signal,
      level,
      score: repeats * 10 + tools,
      severity: "critical",
    };
  }

  // 2) Unattended burn — only when the agent looks stuck/repetitive alone.
  // Long varied workloads (many unique tools after one prompt) are normal.
  const sinceUser = signal.toolsSinceLastUser;
  const stagnatingAlone = isStagnating(
    sinceUser,
    signal.maxRepeatInWindow,
    signal.uniqueSignaturesInWindow
  );
  if (
    signal.apparentlyActive &&
    sinceUser >= thresholds.unattendedToolThreshold &&
    stagnatingAlone
  ) {
    const over = sinceUser - thresholds.unattendedToolThreshold;
    const level =
      over >= thresholds.unattendedToolThreshold
        ? 2
        : over >= Math.ceil(thresholds.unattendedToolThreshold / 2)
          ? 1
          : 0;
    return {
      kind: "unattended",
      title: titleFor("unattended", level),
      detail: `${sinceUser} tool events since your last message, with repetitive signatures (max ${signal.maxRepeatInWindow}× across ${signal.uniqueSignaturesInWindow} unique). Walk-away loops are the #1 quota killer.`,
      tip: tipFor("unattended", level),
      signal,
      level,
      score: sinceUser * 5,
      severity: "critical",
    };
  }

  // 3) High tool volume / thrash
  if (tools >= thresholds.toolLoopThreshold) {
    const over = tools - thresholds.toolLoopThreshold;
    const level = over >= thresholds.toolLoopThreshold ? 2 : over >= 4 ? 1 : 0;
    const stagnation = isStagnating(
      tools,
      signal.maxRepeatInWindow,
      signal.uniqueSignaturesInWindow
    );
    return {
      kind: "tool_loop",
      title: titleFor("tool_loop", level),
      detail: stagnation
        ? `${tools} recent tool events across only ${signal.uniqueSignaturesInWindow} unique signatures — lots of motion, little new ground.`
        : `${tools} tool-related events in the lookback window (threshold ${thresholds.toolLoopThreshold}).`,
      tip: tipFor("tool_loop", level),
      signal,
      level,
      score: tools,
      severity: "warn",
    };
  }

  // 4) Long + tool-heavy → context tax
  if (
    turns >= Math.max(12, Math.floor(thresholds.turnThreshold * 0.75)) &&
    signal.toolCalls >= thresholds.toolLoopThreshold
  ) {
    return {
      kind: "costly",
      title: titleFor("costly", 1),
      detail: `~${turns} turns and ${signal.toolCalls} tool events in this transcript. Growing context makes every next step more expensive.`,
      tip: tipFor("costly", 1),
      signal,
      level: 1,
      score: turns + signal.toolCalls,
      severity: "warn",
    };
  }

  // 5) Classic long-thread nudge
  if (turns >= thresholds.turnThreshold) {
    const over = turns - thresholds.turnThreshold;
    const level =
      over >= thresholds.turnThreshold
        ? 2
        : over >= Math.ceil(thresholds.turnThreshold / 2)
          ? 1
          : 0;
    return {
      kind: "new_chat",
      title: titleFor("new_chat", level),
      detail: `~${turns} turns in this transcript (user ${signal.userTurns} / assistant ${signal.assistantTurns}). Threshold ${thresholds.turnThreshold}.`,
      tip: tipFor("new_chat", level),
      signal,
      level,
      score: turns,
      severity: "warn",
    };
  }

  return {
    kind: "ok",
    title: "Coach: OK",
    detail: `Looking fine — ~${turns} turns, ${tools} recent tools, max identical retry ${repeats}×.`,
    tip: tipFor("ok"),
    signal,
    level: 0,
    score: turns,
    severity: "info",
  };
}
