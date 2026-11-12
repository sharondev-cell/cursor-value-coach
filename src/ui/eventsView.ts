import * as vscode from "vscode";
import type { EventStore } from "../store";
import type { CoachEvent } from "../types";

export class EventsProvider implements vscode.TreeDataProvider<CoachEvent> {
  private readonly _onDidChange = new vscode.EventEmitter<
    CoachEvent | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly store: EventStore) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(element: CoachEvent): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.title,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = new Date(element.at).toLocaleString();
    item.tooltip = `${element.detail}\n\nTip: ${element.tip}`;
    item.iconPath = new vscode.ThemeIcon(
      element.kind === "ok"
        ? "check"
        : element.kind === "repeat_loop" || element.kind === "unattended"
          ? "error"
          : "warning"
    );
    return item;
  }

  getChildren(): CoachEvent[] {
    return this.store.list();
  }
}
