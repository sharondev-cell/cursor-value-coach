import * as vscode from "vscode";
import { loadUsageSnapshot } from "./fetch";
import { openPlanAndUsage } from "./openPlanUsage";
import type { UsageSnapshot } from "./types";

function cfg() {
  return vscode.workspace.getConfiguration("valueCoach");
}

function formatPct(n: number): string {
  return `${Math.round(n)}%`;
}

export class UsageStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | undefined;
  private latest: UsageSnapshot | undefined;
  private lastError: string | undefined;
  private inflight: Promise<void> | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      101
    );
    this.item.command = "valueCoach.usageMenu";
    this.item.text = "$(dashboard) Usage…";
    this.item.tooltip = "Click for Cursor plan usage";
  }

  dispose(): void {
    this.stop();
    this.item.dispose();
  }

  start(): void {
    if (!cfg().get<boolean>("showUsage", true)) {
      this.item.hide();
      this.stop();
      return;
    }
    this.item.show();
    void this.refresh(false);
    this.restartTimer();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  restartTimer(): void {
    this.stop();
    if (!cfg().get<boolean>("showUsage", true)) {
      return;
    }
    const minutes = cfg().get<number>("usageRefreshMinutes", 5);
    this.timer = setInterval(
      () => void this.refresh(false),
      Math.max(1, minutes) * 60_000
    );
  }

  async refresh(interactive: boolean): Promise<void> {
    if (!cfg().get<boolean>("showUsage", true)) {
      this.item.hide();
      return;
    }
    this.item.show();
    if (this.inflight) {
      await this.inflight;
      return;
    }
    this.item.text = "$(sync~spin) Usage";
    this.inflight = this.doRefresh(interactive).finally(() => {
      this.inflight = undefined;
    });
    await this.inflight;
  }

  private async doRefresh(interactive: boolean): Promise<void> {
    const result = await loadUsageSnapshot();
    if (!result.ok) {
      this.lastError = result.reason;
      this.item.text = "$(dashboard) Usage · open";
      this.item.tooltip = [
        "Could not load live usage (click → Plan & Usage).",
        "",
        result.reason,
        "",
        "Coach still works offline from local transcripts.",
      ].join("\n");
      this.item.backgroundColor = undefined;
      if (interactive) {
        const pick = await vscode.window.showWarningMessage(
          `Value Coach usage: ${result.reason}`,
          "Open Plan & Usage",
          "Dismiss"
        );
        if (pick === "Open Plan & Usage") {
          await openPlanAndUsage();
        }
      }
      return;
    }

    this.latest = result.snapshot;
    this.lastError = undefined;
    this.render(result.snapshot);
  }

  private render(s: UsageSnapshot): void {
    const pct = formatPct(s.percentUsed);
    this.item.text = `$(dashboard) ${pct}`;
    const lines = [
      s.displayMessage ?? `You've used ${pct} of included usage`,
      "",
      s.autoPercentUsed != null
        ? `Auto / included: ${formatPct(s.autoPercentUsed)}`
        : undefined,
      s.apiPercentUsed != null
        ? `API pool: ${formatPct(s.apiPercentUsed)}`
        : undefined,
      s.membershipType ? `Plan: ${s.membershipType}` : undefined,
      s.billingCycleEndMs
        ? `Cycle ends: ${new Date(s.billingCycleEndMs).toLocaleString()}`
        : undefined,
      `Updated: ${new Date(s.fetchedAt).toLocaleTimeString()}`,
      "",
      "Click for Plan & Usage / refresh",
    ].filter(Boolean);
    this.item.tooltip = lines.join("\n");

    const warnAt = cfg().get<number>("usageWarnPercent", 80);
    const criticalAt = cfg().get<number>("usageCriticalPercent", 95);
    if (s.percentUsed >= criticalAt) {
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
    } else if (s.percentUsed >= warnAt) {
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
    } else {
      this.item.backgroundColor = undefined;
    }
  }

  async showMenu(): Promise<void> {
    const items: (vscode.QuickPickItem & { id: string })[] = [
      {
        id: "open",
        label: "$(settings-gear) Open Plan & Usage",
        detail: "Skip Settings digging — jump straight to the usage page",
      },
      {
        id: "refresh",
        label: "$(refresh) Refresh usage now",
        detail: this.latest
          ? `Last: ${formatPct(this.latest.percentUsed)} at ${new Date(this.latest.fetchedAt).toLocaleTimeString()}`
          : this.lastError ?? "No snapshot yet",
      },
      {
        id: "dashboard",
        label: "$(link-external) Open cursor.com dashboard",
      },
    ];
    const pick = await vscode.window.showQuickPick(items, {
      title: "Value Coach — Usage",
      placeHolder: "Live usage without hunting through Settings",
    });
    if (!pick) {
      return;
    }
    if (pick.id === "open") {
      await openPlanAndUsage();
    } else if (pick.id === "refresh") {
      await this.refresh(true);
    } else if (pick.id === "dashboard") {
      await vscode.env.openExternal(
        vscode.Uri.parse("https://cursor.com/dashboard?tab=usage")
      );
    }
  }
}
