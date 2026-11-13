import { vi } from "vitest";

vi.mock("vscode", () => ({
  window: {
    state: { focused: false },
    onDidChangeWindowState: () => ({ dispose() {} }),
  },
  workspace: {
    workspaceFolders: undefined,
  },
}));
