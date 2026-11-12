import type { CoachEvent, CoachKind } from "./types";

const KIND_LABEL: Record<CoachKind, string> = {
  ok: "OK snapshots",
  new_chat: "New-chat suggestions",
  tool_loop: "Tool-loop / thrash warnings",
  repeat_loop: "Identical-retry STOPs",
  unattended: "Unattended-burn warnings",
  costly: "Costly-thread notes",
};

export function buildWeeklyReport(events: CoachEvent[]): string {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = events.filter((e) => e.at >= weekAgo);
  const counts: Record<string, number> = {};
  let maxRepeatSeen = 0;
  let criticalEvents = 0;

  for (const e of recent) {
    counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    if (e.maxRepeat != null) {
      maxRepeatSeen = Math.max(maxRepeatSeen, e.maxRepeat);
    }
    if (e.kind === "repeat_loop" || e.kind === "unattended") {
      criticalEvents += 1;
    }
  }

  const blast =
    criticalEvents >= 5
      ? "High — you hit multiple stop-the-run patterns this week. Treat AFK agents as unsafe."
      : criticalEvents >= 1
        ? "Elevated — at least one identical-retry or unattended burn was flagged."
        : "Calm — no critical burn patterns stored this week.";

  const lines = [
    "# Value Coach — Weekly Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Burn risk (last 7 days)",
    "",
    blast,
    "",
    `- Critical nudges (identical retry + unattended): **${criticalEvents}**`,
    `- Highest identical tool-signature repeat observed: **${maxRepeatSeen}×**`,
    "",
    "## Nudges",
    "",
  ];

  for (const kind of [
    "repeat_loop",
    "unattended",
    "tool_loop",
    "costly",
    "new_chat",
    "ok",
  ] as CoachKind[]) {
    lines.push(`- ${KIND_LABEL[kind]}: ${counts[kind] ?? 0}`);
  }

  lines.push(
    "",
    "## What Reddit users actually lose money on",
    "",
    "1. **Identical tool retries** — agent re-runs the same call; each retry re-sends full context.",
    "2. **Unattended runs** — leave for a meeting/shower; loop burns until a monthly cap (if any).",
    "3. **Long threads** — growing context makes every next turn more expensive.",
    "4. **Bulk work via agents** — tagging 87 tasks in a loop instead of one approved script.",
    "",
    "## Habits that stretch Cursor value",
    "",
    "1. **Stop after 3 identical retries** — don't hope the fourth is different.",
    "2. **Never leave an agent AFK** — if you can't watch the tool stream, stop the run.",
    "3. **New chat per subtask** — long threads re-send context every turn.",
    "4. **Lighter model for routine edits** — save frontier / MAX for hard problems.",
    "5. Turn on Cursor **Usage Summary → Always** and keep on-demand spend capped.",
    "",
    "## Recent coaching events",
    ""
  );

  for (const e of recent.slice(0, 25)) {
    const extras: string[] = [];
    if (e.maxRepeat != null && e.maxRepeat > 1) {
      extras.push(`repeat ${e.maxRepeat}×`);
    }
    if (e.toolCalls != null) {
      extras.push(`${e.toolCalls} tools`);
    }
    const suffix = extras.length ? ` [${extras.join(", ")}]` : "";
    lines.push(
      `- **${e.title}** (${new Date(e.at).toLocaleString()}): ${e.detail}${suffix}`
    );
  }

  if (recent.length === 0) {
    lines.push(
      "_No coaching events stored yet. Keep coding — Coach will fill this in._"
    );
  }

  lines.push("");
  return lines.join("\n");
}
