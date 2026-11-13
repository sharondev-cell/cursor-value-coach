import * as vscode from "vscode";
import { readFocusedComposerIds } from "./transcripts";

export interface WindowFocusState {
  focused: boolean;
}

export interface WindowChatScopeDeps {
  isFocused: () => boolean;
  onDidChangeWindowState: (
    listener: (state: WindowFocusState) => void
  ) => { dispose(): void };
  workspaceFolderPaths: () => string[];
  readFocusedComposerIds: (folders: string[]) => string[];
}

function defaultDeps(): WindowChatScopeDeps {
  return {
    isFocused: () => vscode.window.state.focused,
    onDidChangeWindowState: (listener) =>
      vscode.window.onDidChangeWindowState((state) =>
        listener({ focused: state.focused })
      ),
    workspaceFolderPaths: () =>
      (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    readFocusedComposerIds,
  };
}

/**
 * Per-window (extension-host) affinity for the active Cursor chat.
 *
 * Multiple Cursor windows can open the *same* workspace folder (often on
 * different git branches). They share ~/.cursor/projects/<slug>/ transcripts
 * and workspaceStorage composer.composerData focus fields — so "newest
 * transcript" or "read lastFocusedComposerIds every tick" merges every
 * window's chats into one stream.
 *
 * Each window runs its own extension host, so this in-memory pin is already
 * window-local. We only adopt Cursor's *shared* focus id while *this* window
 * is focused; updates that happen while we are unfocused (sibling window)
 * never steal the pin.
 *
 * `deps` is injectable for unit tests.
 */
export class WindowChatScope {
  private pinnedComposerId: string | undefined;
  /** Last focus id observed during a contiguous focused period. */
  private lastSeenFocusWhileFocused: string | undefined;
  private windowFocused: boolean;
  private readonly deps: WindowChatScopeDeps;

  constructor(deps?: Partial<WindowChatScopeDeps>) {
    // When tests pass a full deps object, skip vscode defaults entirely.
    if (
      deps?.isFocused &&
      deps.onDidChangeWindowState &&
      deps.workspaceFolderPaths &&
      deps.readFocusedComposerIds
    ) {
      this.deps = deps as WindowChatScopeDeps;
    } else {
      this.deps = { ...defaultDeps(), ...deps };
    }
    this.windowFocused = this.deps.isFocused();
    if (this.windowFocused) {
      this.adoptFocusIfNeeded(true);
    }
  }

  /** Subscribe to window focus; returns a disposable. */
  bind(): { dispose(): void } {
    return this.deps.onDidChangeWindowState((state) => {
      const wasFocused = this.windowFocused;
      this.windowFocused = state.focused;
      if (!state.focused) {
        // End this focused episode so a foreign DB update isn't treated as
        // an in-window tab switch when we become focused again.
        this.lastSeenFocusWhileFocused = undefined;
        return;
      }
      if (!wasFocused) {
        // Gained focus: keep an existing pin (sibling may still own shared
        // lastFocused). Only seed when we have no pin yet.
        this.adoptFocusIfNeeded(true);
      }
    });
  }

  /** Call on each coach tick so in-window tab switches are picked up. */
  refresh(): void {
    if (!this.windowFocused) {
      return;
    }
    this.adoptFocusIfNeeded(false);
  }

  /** Force-pin after this window starts a new chat (or clear to re-seed). */
  pinComposer(composerId: string | undefined): void {
    this.pinnedComposerId = composerId?.trim() || undefined;
    if (this.windowFocused) {
      this.lastSeenFocusWhileFocused = this.pinnedComposerId;
    }
  }

  clearPin(): void {
    this.pinnedComposerId = undefined;
    this.lastSeenFocusWhileFocused = undefined;
  }

  pinnedId(): string | undefined {
    return this.pinnedComposerId;
  }

  workspaceFolderPaths(): string[] {
    return this.deps.workspaceFolderPaths();
  }

  /**
   * Preferred composer ids for scanning — only this window's pin.
   * Never append shared lastFocused ids (those can belong to a sibling window).
   */
  preferredComposerIds(): string[] {
    this.refresh();
    return this.pinnedComposerId ? [this.pinnedComposerId] : [];
  }

  private adoptFocusIfNeeded(seedOnly: boolean): void {
    const focused = this.deps.readFocusedComposerIds(
      this.deps.workspaceFolderPaths()
    );
    const current = focused[0]?.trim();
    if (!current) {
      return;
    }

    if (!this.pinnedComposerId) {
      // First pin for this window. May briefly match a sibling's chat if that
      // sibling last wrote shared focus; corrects on the next in-window tab
      // switch (focus id change while we stay focused).
      this.pinnedComposerId = current;
      this.lastSeenFocusWhileFocused = current;
      return;
    }

    if (seedOnly) {
      // Keep sticky pin across focus regain; start a new focused episode.
      this.lastSeenFocusWhileFocused = current;
      return;
    }

    // Tab switch in *this* window: shared focus id changed while we stayed focused.
    if (
      this.lastSeenFocusWhileFocused &&
      current.toLowerCase() !== this.lastSeenFocusWhileFocused.toLowerCase()
    ) {
      this.pinnedComposerId = current;
    }
    this.lastSeenFocusWhileFocused = current;
  }
}
