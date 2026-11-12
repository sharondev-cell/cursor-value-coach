import * as vscode from "vscode";

/** Open Cursor Settings → Plan & Usage (one click; no Settings dig). */
export async function openPlanAndUsage(): Promise<void> {
  const candidates: Array<{ id: string; args?: unknown }> = [
    { id: "cursor.openCursorSettings", args: { settingsTab: "plan-usage" } },
    { id: "cursor.openCursorSettings", args: { settingsTab: "planAndUsage" } },
    { id: "workbench.action.openSettings", args: "plan usage" },
  ];

  for (const c of candidates) {
    try {
      if (c.args !== undefined) {
        await vscode.commands.executeCommand(c.id, c.args);
      } else {
        await vscode.commands.executeCommand(c.id);
      }
      return;
    } catch {
      // try next
    }
  }

  await vscode.env.openExternal(
    vscode.Uri.parse("https://cursor.com/dashboard?tab=usage")
  );
}
