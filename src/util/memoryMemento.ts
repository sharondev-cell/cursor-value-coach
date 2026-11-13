/**
 * In-memory memento so snooze/notify gates stay per-window.
 * VS Code workspaceState/globalState are shared across windows on the same
 * folder — unusable for multi-window same-workspace isolation.
 */
export class MemoryMemento {
  private readonly data = new Map<string, unknown>();

  keys(): readonly string[] {
    return [...this.data.keys()];
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.data.has(key)) {
      return this.data.get(key) as T;
    }
    return defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, value);
    }
  }
}
