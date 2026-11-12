import type { CoachKind } from "../types";

/** Escalation 0 = first nudge, 1 = worse, 2 = much worse */
export function tipFor(kind: CoachKind, level = 0): string {
  if (kind === "ok") {
    return pick([
      "You're in a good zone. Keep chats short and focused.",
      "Watch the tool stream — stop after ~3 identical retries before quota melts.",
      "Habits that stretch value: new chat per subtask, lighter models for routine work, never leave agents AFK.",
    ]);
  }

  const bank: Record<Exclude<CoachKind, "ok">, string[]> = {
    new_chat: [
      "This thread is getting long. Start a new chat for the next subtask.",
      "Still the same long chat — every extra turn re-sends prior context. Split the work.",
      "This chat is expensive territory. Open a new chat and paste only the goal + 1–2 files.",
    ],
    tool_loop: [
      "Lots of tool activity lately. Narrow to one file or one bug, or start fresh.",
      "Tool calls keep stacking — ask for a plan first, then implement in a new chat.",
      "Likely spinning. Stop, write a tighter prompt, and start a new agent session.",
    ],
    repeat_loop: [
      "Identical tool retries detected. Interrupt now — each retry re-bills the full context.",
      "Same signature keeps firing. Stop the agent, write a one-line diagnosis, continue in a fresh chat.",
      "Hard stop. This is the failure mode behind $100–$2000 blowups. Kill the run before more retries land.",
    ],
    unattended: [
      "Agent is repeating tools alone. If you're stepping away, stop the run — varied long jobs are fine.",
      "Walk-away burn in progress. Don't leave looping agents unattended — set a mental circuit breaker.",
      "Repetitive bulk work belongs in a script you approve once, not an agent looping alone.",
    ],
    costly: [
      "That stretch looked pricey. Prefer a lighter model for routine edits.",
      "Attach fewer files next turn — big context is the usual cost driver.",
      "Reset chat + smaller scope usually recovers more value than pushing the same thread.",
    ],
  };

  const tips = bank[kind];
  const idx = Math.min(Math.max(level, 0), tips.length - 1);
  return tips[idx];
}

function pick(items: string[]): string {
  return items[Math.floor(Date.now() / 60_000) % items.length];
}

/** Explicit rotate for the interactive menu “Another tip” action. */
export function rotateTip(kind: CoachKind, salt = Date.now()): string {
  if (kind === "ok") {
    return tipFor("ok");
  }
  return tipFor(kind, salt % 3);
}

export function titleFor(kind: CoachKind, level: number): string {
  if (kind === "ok") {
    return "Coach: OK";
  }
  if (kind === "repeat_loop") {
    return level >= 2
      ? "Coach: STOP — identical retry"
      : level >= 1
        ? "Coach: Identical retry loop"
        : "Coach: Same tool retrying";
  }
  if (kind === "unattended") {
    return level >= 2
      ? "Coach: STOP — unattended burn"
      : level >= 1
        ? "Coach: Still running alone"
        : "Coach: Unattended burn?";
  }
  if (kind === "new_chat") {
    return level >= 2
      ? "Coach: Reset now"
      : level >= 1
        ? "Coach: Still growing"
        : "Coach: New chat?";
  }
  if (kind === "tool_loop") {
    return level >= 2
      ? "Coach: Likely stuck"
      : level >= 1
        ? "Coach: Tools piling up"
        : "Coach: Tool loop?";
  }
  return "Coach: Pricey turn";
}
