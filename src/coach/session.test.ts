import { describe, expect, it } from "vitest";
import type { CoachVerdict, TranscriptSignal } from "../types";
import { MemoryMemento } from "../util/memoryMemento";
import { SessionController } from "./session";

function verdict(
  partial: Partial<CoachVerdict> & Pick<CoachVerdict, "kind">
): CoachVerdict {
  return {
    title: partial.title ?? partial.kind,
    detail: partial.detail ?? "",
    tip: partial.tip ?? "",
    ...partial,
  };
}

function signal(id: string): TranscriptSignal {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    mtimeMs: Date.now(),
    userTurns: 10,
    assistantTurns: 10,
    toolCalls: 5,
    recentToolCalls: 5,
    toolsSinceLastUser: 0,
    maxRepeatInWindow: 1,
    uniqueSignaturesInWindow: 3,
    lastActivityMs: Date.now(),
    apparentlyActive: true,
  };
}

describe("SessionController per-window MemoryMemento", () => {
  it("keeps snooze isolated across two window stores", async () => {
    const windowA = new SessionController(new MemoryMemento());
    const windowB = new SessionController(new MemoryMemento());

    await windowA.snoozeMinutes(60);
    expect(windowA.snoozeLabel()).toMatch(/snoozed/);
    expect(windowB.snoozeLabel()).toBeUndefined();

    const v = verdict({
      kind: "tool_loop",
      severity: "warn",
      signal: signal("chat-a"),
      level: 1,
      score: 12,
    });
    expect(windowA.shouldNotify(v, 0)).toBe(false);
    expect(windowB.shouldNotify(v, 0)).toBe(true);
  });

  it("snooze-until-new-chat is per store (not shared)", async () => {
    const windowA = new SessionController(new MemoryMemento());
    const windowB = new SessionController(new MemoryMemento());

    await windowA.snoozeUntilNewChat("chat-a");
    const same = verdict({
      kind: "repeat_loop",
      severity: "critical",
      signal: signal("chat-a"),
      level: 2,
      score: 20,
    });
    const other = verdict({
      kind: "repeat_loop",
      severity: "critical",
      signal: signal("chat-b"),
      level: 2,
      score: 20,
    });

    expect(windowA.isSnoozed(same)).toBe(true);
    expect(windowA.isSnoozed(other)).toBe(false);
    expect(windowB.isSnoozed(same)).toBe(false);
    expect(windowB.shouldNotify(same, 0)).toBe(true);
  });
});
