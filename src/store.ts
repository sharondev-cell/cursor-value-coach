import * as vscode from "vscode";
import type { CoachEvent } from "./types";

const KEY = "valueCoach.events";
const EVENT_LIMIT = 100;

export class EventStore {
  constructor(private readonly state: vscode.Memento) {}

  list(): CoachEvent[] {
    const all = this.state.get<CoachEvent[]>(KEY, []);
    return all.slice(0, EVENT_LIMIT);
  }

  push(event: CoachEvent): void {
    const all = this.state.get<CoachEvent[]>(KEY, []);
    const next = [event, ...all.filter((e) => e.id !== event.id)];
    void this.state.update(KEY, next.slice(0, EVENT_LIMIT));
  }

  clear(): void {
    void this.state.update(KEY, []);
  }

  /** Remove legacy fields that may have stored absolute paths. */
  scrubLegacyPaths(): void {
    const all = this.state.get<Array<CoachEvent & { transcriptPath?: string }>>(
      KEY,
      []
    );
    const cleaned = all.map((e) => {
      const { transcriptPath: _drop, ...rest } = e;
      return rest as CoachEvent;
    });
    void this.state.update(KEY, cleaned);
  }
}
