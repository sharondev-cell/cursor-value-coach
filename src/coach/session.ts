import type { CoachKind, CoachVerdict } from "../types";

const STATE_KEY = "valueCoach.sessionGate";

/** Minimal memento shape (vscode.Memento or in-memory per-window store). */
export interface SessionStore {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export interface SessionGate {
  snoozeUntil: number;
  /** Don't notify again until transcript id changes */
  snoozeUntilNewChat: boolean;
  snoozeTranscriptId?: string;
  lastKind?: CoachKind;
  lastLevel?: number;
  lastScore?: number;
  lastTranscriptId?: string;
  lastNotifiedAt?: number;
}

export class SessionController {
  constructor(private readonly state: SessionStore) {}

  get(): SessionGate {
    return (
      this.state.get<SessionGate>(STATE_KEY) ?? {
        snoozeUntil: 0,
        snoozeUntilNewChat: false,
      }
    );
  }

  async patch(partial: Partial<SessionGate>): Promise<void> {
    await this.state.update(STATE_KEY, { ...this.get(), ...partial });
  }

  async snoozeMinutes(minutes: number): Promise<void> {
    await this.patch({
      snoozeUntil: Date.now() + minutes * 60_000,
      snoozeUntilNewChat: false,
    });
  }

  async snoozeUntilNewChat(transcriptId?: string): Promise<void> {
    await this.patch({
      snoozeUntilNewChat: true,
      snoozeTranscriptId: transcriptId,
      snoozeUntil: 0,
    });
  }

  async clearSnooze(): Promise<void> {
    await this.patch({
      snoozeUntil: 0,
      snoozeUntilNewChat: false,
      snoozeTranscriptId: undefined,
    });
  }

  isSnoozed(verdict: CoachVerdict): boolean {
    const g = this.get();
    if (g.snoozeUntil > Date.now()) {
      return true;
    }
    if (g.snoozeUntilNewChat) {
      const id = verdict.signal?.id;
      if (!id || id === g.snoozeTranscriptId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Notify only when something meaningful changed:
   * new transcript, kind change, or score/level escalation.
   */
  shouldNotify(verdict: CoachVerdict, minCooldownMs: number): boolean {
    if (verdict.kind === "ok") {
      return false;
    }
    if (this.isSnoozed(verdict)) {
      return false;
    }

    const g = this.get();
    const id = verdict.signal?.id;
    const level = verdict.level ?? 0;
    const score = verdict.score ?? 0;

    const critical = verdict.severity === "critical";
    const scoreStep = critical ? 3 : 8;

    if (g.lastNotifiedAt && Date.now() - g.lastNotifiedAt < minCooldownMs) {
      // Allow early notify only on real escalation
      const escalated =
        verdict.kind !== g.lastKind ||
        level > (g.lastLevel ?? 0) ||
        (id != null && id !== g.lastTranscriptId) ||
        score >= (g.lastScore ?? 0) + scoreStep ||
        (critical && g.lastKind !== verdict.kind);
      if (!escalated) {
        return false;
      }
    }

    if (
      verdict.kind === g.lastKind &&
      level <= (g.lastLevel ?? 0) &&
      id === g.lastTranscriptId &&
      score < (g.lastScore ?? 0) + scoreStep
    ) {
      return false;
    }

    return true;
  }

  async markNotified(verdict: CoachVerdict): Promise<void> {
    await this.patch({
      lastKind: verdict.kind,
      lastLevel: verdict.level ?? 0,
      lastScore: verdict.score ?? 0,
      lastTranscriptId: verdict.signal?.id,
      lastNotifiedAt: Date.now(),
    });
  }

  snoozeLabel(): string | undefined {
    const g = this.get();
    if (g.snoozeUntilNewChat) {
      return "snoozed until new chat";
    }
    if (g.snoozeUntil > Date.now()) {
      const mins = Math.ceil((g.snoozeUntil - Date.now()) / 60_000);
      return `snoozed ${mins}m`;
    }
    return undefined;
  }
}
