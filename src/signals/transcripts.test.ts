import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { pathToCursorProjectSlug, scanLatestTranscript } from "./transcripts";

const CHAT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CHAT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("pathToCursorProjectSlug", () => {
  it("slugifies absolute paths the way Cursor projects folders do", () => {
    expect(pathToCursorProjectSlug("/Users/me/projects/myapp")).toBe(
      "Users-me-projects-myapp"
    );
    expect(pathToCursorProjectSlug("/Users/me/.claude")).toBe("Users-me-claude");
    expect(pathToCursorProjectSlug("/agent/repos/cursor-value-coach")).toBe(
      "agent-repos-cursor-value-coach"
    );
  });
});

describe("scanLatestTranscript strict preferred scoping", () => {
  const temps: string[] = [];

  afterEach(() => {
    delete process.env.CURSOR_AGENT_HOME;
    while (temps.length) {
      const dir = temps.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function makeProject(workspacePath: string) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vc-transcripts-"));
    temps.push(home);
    process.env.CURSOR_AGENT_HOME = home;
    const slug = pathToCursorProjectSlug(workspacePath);
    const chatDir = path.join(home, "projects", slug, "agent-transcripts");
    fs.mkdirSync(chatDir, { recursive: true });

    const writeChat = (id: string, turns: number, mtimeOffsetMs: number) => {
      const dir = path.join(chatDir, id);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${id}.jsonl`);
      const lines: string[] = [];
      for (let i = 0; i < turns; i++) {
        lines.push(
          `{"role":"user","message":{"content":[{"type":"text","text":"u${i}"}]}}`
        );
        lines.push(
          `{"role":"assistant","message":{"content":[{"type":"text","text":"a${i}"}]}}`
        );
      }
      fs.writeFileSync(file, lines.join("\n") + "\n");
      const when = Date.now() + mtimeOffsetMs;
      fs.utimesSync(file, when / 1000, when / 1000);
    };

    return { home, workspacePath, writeChat };
  }

  it("with strictPreferred, only returns the preferred composer chat", () => {
    const workspacePath = "/tmp/vc-workspace-strict";
    const ctx = makeProject(workspacePath);
    ctx.writeChat(CHAT_B, 5, 0); // newer / hotter sibling
    ctx.writeChat(CHAT_A, 3, -60_000);

    const signal = scanLatestTranscript(15, {
      workspaceFolderPaths: [workspacePath],
      preferredComposerIds: [CHAT_A],
      strictPreferred: true,
    });
    expect(signal?.path).toContain(CHAT_A);
    expect(signal?.userTurns).toBe(3);
  });

  it("with strictPreferred and unknown preferred id, does not fall back to sibling", () => {
    const workspacePath = "/tmp/vc-workspace-nofallback";
    const ctx = makeProject(workspacePath);
    ctx.writeChat(CHAT_B, 8, 0);

    const signal = scanLatestTranscript(15, {
      workspaceFolderPaths: [workspacePath],
      preferredComposerIds: [CHAT_A],
      strictPreferred: true,
    });
    expect(signal).toBeUndefined();
  });

  it("with no preferred ids and strictPreferred, returns undefined (no merge)", () => {
    const workspacePath = "/tmp/vc-workspace-empty-pref";
    const ctx = makeProject(workspacePath);
    ctx.writeChat(CHAT_B, 4, 0);

    const signal = scanLatestTranscript(15, {
      workspaceFolderPaths: [workspacePath],
      preferredComposerIds: [],
      strictPreferred: true,
    });
    expect(signal).toBeUndefined();
  });
});
