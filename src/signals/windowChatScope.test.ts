import { afterEach, describe, expect, it } from "vitest";
import {
  WindowChatScope,
  type WindowChatScopeDeps,
  type WindowFocusState,
} from "./windowChatScope";

const CHAT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CHAT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CHAT_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const FOLDER = "/Users/sharon/proj";

type FocusListener = (state: WindowFocusState) => void;

function createHarness(opts?: {
  focused?: boolean;
  sharedFocus?: string[];
}) {
  let focused = opts?.focused ?? true;
  let sharedFocus = [...(opts?.sharedFocus ?? [])];
  const listeners: FocusListener[] = [];

  const deps: WindowChatScopeDeps = {
    isFocused: () => focused,
    onDidChangeWindowState: (listener) => {
      listeners.push(listener);
      return {
        dispose: () => {
          const i = listeners.indexOf(listener);
          if (i >= 0) {
            listeners.splice(i, 1);
          }
        },
      };
    },
    workspaceFolderPaths: () => [FOLDER],
    readFocusedComposerIds: () => [...sharedFocus],
  };

  const scope = new WindowChatScope(deps);
  const binding = scope.bind();

  return {
    scope,
    setSharedFocus(ids: string[]) {
      sharedFocus = [...ids];
    },
    setWindowFocused(next: boolean) {
      if (focused === next) {
        return;
      }
      focused = next;
      for (const listener of [...listeners]) {
        listener({ focused: next });
      }
    },
    dispose() {
      binding.dispose();
    },
  };
}

describe("WindowChatScope", () => {
  const harnesses: Array<ReturnType<typeof createHarness>> = [];

  afterEach(() => {
    while (harnesses.length) {
      harnesses.pop()?.dispose();
    }
  });

  function harness(opts?: Parameters<typeof createHarness>[0]) {
    const h = createHarness(opts);
    harnesses.push(h);
    return h;
  }

  it("seeds pin from shared focus when this window starts focused", () => {
    const h = harness({ focused: true, sharedFocus: [CHAT_A] });
    expect(h.scope.pinnedId()).toBe(CHAT_A);
    expect(h.scope.preferredComposerIds()).toEqual([CHAT_A]);
  });

  it("does not seed while unfocused (no pin until this window focuses)", () => {
    const h = harness({ focused: false, sharedFocus: [CHAT_A] });
    expect(h.scope.pinnedId()).toBeUndefined();
    expect(h.scope.preferredComposerIds()).toEqual([]);
  });

  it("keeps sticky pin when sibling updates shared focus while unfocused", () => {
    const h = harness({ focused: true, sharedFocus: [CHAT_A] });
    expect(h.scope.pinnedId()).toBe(CHAT_A);

    h.setWindowFocused(false);
    h.setSharedFocus([CHAT_B]); // sibling window's chat
    h.scope.refresh(); // tick while unfocused must no-op
    expect(h.scope.pinnedId()).toBe(CHAT_A);

    h.setWindowFocused(true);
    // Sibling still owns shared focus id — must not steal our pin
    h.scope.refresh();
    expect(h.scope.pinnedId()).toBe(CHAT_A);
    expect(h.scope.preferredComposerIds()).toEqual([CHAT_A]);
  });

  it("follows in-window tab switch (shared focus changes while focused)", () => {
    const h = harness({ focused: true, sharedFocus: [CHAT_A] });
    expect(h.scope.pinnedId()).toBe(CHAT_A);

    h.setSharedFocus([CHAT_C]);
    h.scope.refresh();
    expect(h.scope.pinnedId()).toBe(CHAT_C);
  });

  it("does not treat sibling focus as a tab switch across a focus gap", () => {
    const h = harness({ focused: true, sharedFocus: [CHAT_A] });
    h.setWindowFocused(false);
    h.setSharedFocus([CHAT_B]);
    h.setWindowFocused(true);
    // On regain, seedOnly keeps pin A; lastSeen becomes B
    expect(h.scope.pinnedId()).toBe(CHAT_A);

    // Same shared focus as on regain — not an in-window change
    h.scope.refresh();
    expect(h.scope.pinnedId()).toBe(CHAT_A);

    // Real in-window switch after regain
    h.setSharedFocus([CHAT_C]);
    h.scope.refresh();
    expect(h.scope.pinnedId()).toBe(CHAT_C);
  });

  it("preferredComposerIds returns only the pin, never raw shared focus extras", () => {
    const h = harness({ focused: true, sharedFocus: [CHAT_A, CHAT_B] });
    expect(h.scope.preferredComposerIds()).toEqual([CHAT_A]);
    h.setSharedFocus([CHAT_B, CHAT_A]);
    // Still focused continuously with lastSeen A → switch to B
    h.scope.refresh();
    expect(h.scope.preferredComposerIds()).toEqual([CHAT_B]);
  });

  it("clearPin drops affinity; next focused refresh re-seeds", () => {
    const h = harness({ focused: true, sharedFocus: [CHAT_A] });
    h.scope.clearPin();
    expect(h.scope.pinnedId()).toBeUndefined();
    h.setSharedFocus([CHAT_B]);
    h.scope.refresh();
    expect(h.scope.pinnedId()).toBe(CHAT_B);
  });

  it("pinComposer forces this window's chat id", () => {
    const h = harness({ focused: true, sharedFocus: [CHAT_A] });
    h.scope.pinComposer(CHAT_C);
    expect(h.scope.pinnedId()).toBe(CHAT_C);
    // Sibling noise while focused without lastSeen change path:
    // after pinComposer, lastSeen is C; shared still A until refresh adopts...
    h.setSharedFocus([CHAT_A]);
    h.scope.refresh();
    // lastSeen was C, shared is A → treated as in-window switch to A
    expect(h.scope.pinnedId()).toBe(CHAT_A);
  });

  it("isolates pins across two window harnesses on the same folder", () => {
    // One shared focus DB both windows read (like real workspaceStorage).
    let sharedFocus = [CHAT_A];
    let focused1 = true;
    let focused2 = false;
    const listeners1: FocusListener[] = [];
    const listeners2: FocusListener[] = [];

    const deps1: WindowChatScopeDeps = {
      isFocused: () => focused1,
      onDidChangeWindowState: (listener) => {
        listeners1.push(listener);
        return { dispose: () => undefined };
      },
      workspaceFolderPaths: () => [FOLDER],
      readFocusedComposerIds: () => [...sharedFocus],
    };
    const deps2: WindowChatScopeDeps = {
      isFocused: () => focused2,
      onDidChangeWindowState: (listener) => {
        listeners2.push(listener);
        return { dispose: () => undefined };
      },
      workspaceFolderPaths: () => [FOLDER],
      readFocusedComposerIds: () => [...sharedFocus],
    };

    const win1 = new WindowChatScope(deps1);
    const win2 = new WindowChatScope(deps2);
    win1.bind();
    win2.bind();

    expect(win1.pinnedId()).toBe(CHAT_A);
    expect(win2.pinnedId()).toBeUndefined();

    // Window 1 blurs; window 2 focuses and switches to chat B
    focused1 = false;
    for (const l of listeners1) {
      l({ focused: false });
    }
    focused2 = true;
    for (const l of listeners2) {
      l({ focused: true });
    }
    expect(win2.pinnedId()).toBe(CHAT_A);
    sharedFocus = [CHAT_B];
    win2.refresh();
    expect(win2.pinnedId()).toBe(CHAT_B);

    // Sibling already owns shared focus B before window 1 regains focus
    focused2 = false;
    for (const l of listeners2) {
      l({ focused: false });
    }
    focused1 = true;
    for (const l of listeners1) {
      l({ focused: true });
    }
    win1.refresh();
    expect(win1.pinnedId()).toBe(CHAT_A);
    expect(win2.pinnedId()).toBe(CHAT_B);
  });
});
