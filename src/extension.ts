import * as vscode from "vscode";
import { evaluate } from "./coach/engine";
import { SessionController } from "./coach/session";
import { rotateTip } from "./coach/tips";
import {
  bootstrapUsageConsent,
  ensureUsageConsent,
  setUsageConsent,
} from "./consent";
import { buildWeeklyReport } from "./report";
import { scanLatestTranscript } from "./signals/transcripts";
import { WindowChatScope } from "./signals/windowChatScope";
import { EventStore } from "./store";
import type { CoachEvent, CoachVerdict } from "./types";
import { EventsProvider } from "./ui/eventsView";
import { openPlanAndUsage } from "./usage/openPlanUsage";
import { UsageStatusBar } from "./usage/statusBar";

let statusBar: vscode.StatusBarItem;
let usageBar: UsageStatusBar | undefined;
let pollTimer: NodeJS.Timeout | undefined;
let latestVerdict: CoachVerdict | undefined;
/** Per extension-host (= per Cursor window) chat pin. */
let chatScope: WindowChatScope | undefined;

function cfg() {
  return vscode.workspace.getConfiguration("valueCoach");
}

/**
 * In-memory memento so snooze/notify gates stay per-window.
 * workspaceState is shared across windows on the same folder — unusable here.
 */
class MemoryMemento implements vscode.Memento {
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

/** Scope coaching to this window's pinned chat — not every chat on the folder. */
function scanActiveTranscript(windowMinutes: number) {
  const scope = chatScope;
  const workspaceFolderPaths = scope?.workspaceFolderPaths() ?? [];
  const preferredComposerIds = scope?.preferredComposerIds() ?? [];
  return scanLatestTranscript(windowMinutes, {
    workspaceFolderPaths,
    preferredComposerIds,
    // Always strict once we participate in multi-window same-folder setups:
    // never fall back to "newest transcript in the project".
    strictPreferred: true,
  });
}

function thresholds() {
  return {
    turnThreshold: cfg().get<number>("turnThreshold", 24),
    toolLoopThreshold: cfg().get<number>("toolLoopThreshold", 12),
    repeatLoopThreshold: cfg().get<number>("repeatLoopThreshold", 3),
    unattendedToolThreshold: cfg().get<number>("unattendedToolThreshold", 8),
  };
}

function toEvent(verdict: CoachVerdict): CoachEvent {
  return {
    id: `${verdict.kind}-${verdict.signal?.id ?? "none"}-${verdict.level ?? 0}-${Math.floor(
      (verdict.signal?.lastActivityMs ?? Date.now()) / 60_000
    )}`,
    at: Date.now(),
    kind: verdict.kind,
    title: verdict.title,
    detail: verdict.detail,
    tip: verdict.tip,
    transcriptId: verdict.signal?.id,
    turnCount:
      verdict.signal != null
        ? verdict.signal.userTurns + verdict.signal.assistantTurns
        : undefined,
    toolCalls: verdict.signal?.recentToolCalls,
    maxRepeat: verdict.signal?.maxRepeatInWindow,
    uniqueSignatures: verdict.signal?.uniqueSignaturesInWindow,
  };
}

async function suggestNewChat(): Promise<void> {
  const candidates = [
    "composer.newAgentChat",
    "composer.createNewComposerTab",
    "aichat.newchat",
    "workbench.action.chat.newChat",
    "composer.focusComposer",
  ];
  for (const id of candidates) {
    try {
      await vscode.commands.executeCommand(id);
      // New chat belongs to this window — drop the old pin and re-seed on focus.
      chatScope?.clearPin();
      chatScope?.refresh();
      vscode.window.showInformationMessage(
        "New chat opened (if Cursor supported the command). Paste only the next subtask."
      );
      return;
    } catch {
      // try next
    }
  }
  vscode.window.showInformationMessage(
    "Use Cursor’s New Chat control, then ask only for the next subtask."
  );
}

async function showCoachMenu(
  session: SessionController,
  store: EventStore,
  provider: EventsProvider
): Promise<void> {
  const verdict =
    latestVerdict ??
    evaluate(
      cfg().get<boolean>("readTranscripts", true)
        ? scanActiveTranscript(cfg().get<number>("toolLoopWindowMinutes", 15))
        : undefined,
      thresholds()
    );

  const snooze = session.snoozeLabel();
  const items: (vscode.QuickPickItem & { id: string })[] = [
    {
      id: "status",
      label: `$(info) ${verdict.title}`,
      description: snooze ? `(${snooze})` : undefined,
      detail: `${verdict.detail}\nTip: ${verdict.tip}`,
    },
    {
      id: "newchat",
      label: "$(add) Start new chat",
      detail: "Best fix when the thread is long or looping",
    },
    {
      id: "tip",
      label: "$(lightbulb) Another tip",
      detail: "Rotate advice for this situation",
    },
    {
      id: "snooze60",
      label: "$(mute) Snooze 1 hour",
      detail: "No toasts until then (status bar still updates)",
    },
    {
      id: "snoozeChat",
      label: "$(debug-disconnect) Snooze until new chat",
      detail: "Quiet until the active transcript changes",
    },
    {
      id: "unsnooze",
      label: "$(bell) Clear snooze",
    },
    {
      id: "refresh",
      label: "$(refresh) Refresh scan",
    },
    {
      id: "usage",
      label: "$(dashboard) Plan usage",
      detail: "Live % in status bar · one-click Plan & Usage",
    },
    {
      id: "report",
      label: "$(notebook) Weekly report",
    },
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title: "Value Coach",
    placeHolder: "Choose an action — Coach won’t spam the same nudge",
    matchOnDetail: true,
  });
  if (!pick) {
    return;
  }

  switch (pick.id) {
    case "newchat":
      await session.clearSnooze();
      await suggestNewChat();
      break;
    case "tip":
      vscode.window.showInformationMessage(
        rotateTip(verdict.kind, Date.now())
      );
      break;
    case "snooze60":
      await session.snoozeMinutes(60);
      vscode.window.showInformationMessage("Value Coach snoozed for 1 hour.");
      updateStatus(verdict, session);
      break;
    case "snoozeChat":
      await session.snoozeUntilNewChat(verdict.signal?.id);
      vscode.window.showInformationMessage(
        "Value Coach snoozed until a different chat/transcript is active."
      );
      updateStatus(verdict, session);
      break;
    case "unsnooze":
      await session.clearSnooze();
      vscode.window.showInformationMessage("Snooze cleared.");
      updateStatus(verdict, session);
      break;
    case "refresh":
      tick(store, provider, session, true);
      void usageBar?.refresh(false);
      vscode.window.showInformationMessage("Refreshed.");
      break;
    case "usage":
      await usageBar?.showMenu();
      break;
    case "report":
      await vscode.commands.executeCommand("valueCoach.weeklyReport");
      break;
    default:
      break;
  }
}

function notifyCooldownMs(verdict: CoachVerdict): number {
  const base = cfg().get<number>("toastCooldownMinutes", 30) * 60_000;
  // Critical blast-radius events (identical retry / unattended) get a shorter gate
  if (verdict.severity === "critical") {
    return Math.min(base, 5 * 60_000);
  }
  return base;
}

async function maybeInteract(
  verdict: CoachVerdict,
  session: SessionController
): Promise<void> {
  if (!cfg().get<boolean>("showToasts", true)) {
    return;
  }
  const cooldown = notifyCooldownMs(verdict);
  if (!session.shouldNotify(verdict, cooldown)) {
    return;
  }
  await session.markNotified(verdict);

  const critical = verdict.severity === "critical";
  const show = critical
    ? vscode.window.showErrorMessage
    : vscode.window.showWarningMessage;
  const pick = await show(
    `${verdict.title} — ${verdict.tip}`,
    "Start new chat",
    "Snooze 1h",
    "Snooze until new chat",
    "Open coach…"
  );
  if (pick === "Start new chat") {
    await session.clearSnooze();
    await suggestNewChat();
  } else if (pick === "Snooze 1h") {
    await session.snoozeMinutes(60);
  } else if (pick === "Snooze until new chat") {
    await session.snoozeUntilNewChat(verdict.signal?.id);
  } else if (pick === "Open coach…") {
    await vscode.commands.executeCommand("valueCoach.showPanel");
  }
}

function updateStatus(
  verdict: CoachVerdict,
  session: SessionController
): void {
  const snooze = session.snoozeLabel();
  const icon =
    verdict.severity === "critical"
      ? "$(alert)"
      : snooze
        ? "$(mute)"
        : "$(heart)";
  statusBar.text = `${icon} ${verdict.title}`;
  const sig = verdict.signal;
  statusBar.tooltip = [
    verdict.detail,
    "",
    `Tip: ${verdict.tip}`,
    sig
      ? `Signals: tools ${sig.recentToolCalls} · max repeat ${sig.maxRepeatInWindow}× · since last msg ${sig.toolsSinceLastUser}`
      : undefined,
    snooze ? `Snooze: ${snooze}` : "Click for actions",
    "",
    "Coach scans local transcripts · usage bar talks to Cursor only when enabled",
  ]
    .filter(Boolean)
    .join("\n");
  if (verdict.kind === "ok" || snooze) {
    statusBar.backgroundColor = undefined;
  } else if (verdict.severity === "critical") {
    statusBar.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground"
    );
  } else {
    statusBar.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
  }
}

function tick(
  store: EventStore,
  provider: EventsProvider,
  session: SessionController,
  silent: boolean
): void {
  if (!cfg().get<boolean>("enabled", true)) {
    statusBar.text = "$(circle-slash) Coach off";
    statusBar.tooltip = "Value Coach disabled in settings";
    latestVerdict = undefined;
    return;
  }

  if (!cfg().get<boolean>("readTranscripts", true)) {
    statusBar.text = "$(shield) Coach: privacy";
    statusBar.tooltip =
      "Transcript reading is off (valueCoach.readTranscripts).";
    statusBar.backgroundColor = undefined;
    latestVerdict = undefined;
    return;
  }

  const windowMin = cfg().get<number>("toolLoopWindowMinutes", 15);
  const signal = scanActiveTranscript(windowMin);
  const verdict = evaluate(signal, thresholds());
  latestVerdict = verdict;
  updateStatus(verdict, session);

  // Clear "until new chat" snooze when transcript id changes
  const gate = session.get();
  if (
    gate.snoozeUntilNewChat &&
    verdict.signal?.id &&
    gate.snoozeTranscriptId &&
    verdict.signal.id !== gate.snoozeTranscriptId
  ) {
    void session.clearSnooze();
  }

  if (verdict.kind !== "ok") {
    const cooldown = notifyCooldownMs(verdict);
    if (session.shouldNotify(verdict, cooldown)) {
      store.push(toEvent(verdict));
      provider.refresh();
      if (!silent) {
        void maybeInteract(verdict, session);
      }
    }
  }

  // Poll faster while a critical burn is active so walk-away loops get caught sooner
  maybeRetunePoll(store, provider, session, verdict);
}

let lastPollSeconds = 0;

function maybeRetunePoll(
  store: EventStore,
  provider: EventsProvider,
  session: SessionController,
  verdict: CoachVerdict
): void {
  const base = cfg().get<number>("pollSeconds", 45);
  const want =
    verdict.severity === "critical" && !session.snoozeLabel()
      ? Math.min(base, 15)
      : base;
  if (want === lastPollSeconds && pollTimer) {
    return;
  }
  lastPollSeconds = want;
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  pollTimer = setInterval(
    () => tick(store, provider, session, false),
    want * 1000
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new EventStore(context.globalState);
  store.scrubLegacyPaths();
  // In-memory: same workspace folder can be open in many windows (different
  // branches/chats); workspaceState/globalState would share snooze across them.
  const session = new SessionController(new MemoryMemento());
  const provider = new EventsProvider(store);
  chatScope = new WindowChatScope();

  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.command = "valueCoach.showPanel";
  statusBar.show();

  usageBar = new UsageStatusBar();

  context.subscriptions.push(
    statusBar,
    usageBar,
    chatScope.bind(),
    vscode.window.registerTreeDataProvider("valueCoach.events", provider),
    vscode.commands.registerCommand("valueCoach.showPanel", () =>
      showCoachMenu(session, store, provider)
    ),
    vscode.commands.registerCommand("valueCoach.refresh", () => {
      tick(store, provider, session, true);
      void usageBar?.refresh(false);
      vscode.window.showInformationMessage("Value Coach refreshed.");
    }),
    vscode.commands.registerCommand("valueCoach.refreshUsage", async () => {
      const ok = await ensureUsageConsent(context.globalState, {
        interactive: true,
      });
      if (ok) {
        await usageBar?.refresh(true);
      }
    }),
    vscode.commands.registerCommand("valueCoach.usageMenu", async () => {
      const show = vscode.workspace
        .getConfiguration("valueCoach")
        .get<boolean>("showUsage", false);
      if (!show) {
        const ok = await ensureUsageConsent(context.globalState, {
          interactive: true,
        });
        if (!ok) {
          await openPlanAndUsage();
          return;
        }
        usageBar?.start();
      }
      await usageBar?.showMenu();
    }),
    vscode.commands.registerCommand("valueCoach.openPlanUsage", () =>
      openPlanAndUsage()
    ),
    vscode.commands.registerCommand("valueCoach.startNewChat", () =>
      suggestNewChat()
    ),
    vscode.commands.registerCommand("valueCoach.clearLocalData", async () => {
      const pick = await vscode.window.showWarningMessage(
        "Clear all stored coaching events, snooze state, and usage-consent choice?",
        { modal: true },
        "Clear"
      );
      if (pick !== "Clear") {
        return;
      }
      store.clear();
      await session.clearSnooze();
      await setUsageConsent(context.globalState, undefined);
      await vscode.workspace
        .getConfiguration("valueCoach")
        .update("showUsage", false, vscode.ConfigurationTarget.Global);
      usageBar?.start();
      provider.refresh();
      vscode.window.showInformationMessage("Value Coach local data cleared.");
    }),
    vscode.commands.registerCommand("valueCoach.weeklyReport", async () => {
      const md = buildWeeklyReport(store.list());
      const doc = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: md,
      });
      await vscode.window.showTextDocument(doc);
    }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration("valueCoach")) {
        return;
      }
      if (e.affectsConfiguration("valueCoach.showUsage")) {
        const enabled = vscode.workspace
          .getConfiguration("valueCoach")
          .get<boolean>("showUsage", false);
        if (enabled) {
          const ok = await ensureUsageConsent(context.globalState);
          if (!ok) {
            usageBar?.start();
            return;
          }
        }
      }
      lastPollSeconds = 0;
      restartPoll(store, provider, session, context);
      tick(store, provider, session, true);
      usageBar?.restartTimer();
      usageBar?.start();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      chatScope?.clearPin();
      chatScope?.refresh();
      tick(store, provider, session, true);
    }),
    {
      dispose: () => {
        if (pollTimer) {
          clearInterval(pollTimer);
        }
      },
    }
  );

  await bootstrapUsageConsent(context.globalState);

  tick(store, provider, session, true);
  restartPoll(store, provider, session, context);
  usageBar.start();
}

function restartPoll(
  store: EventStore,
  provider: EventsProvider,
  session: SessionController,
  context: vscode.ExtensionContext
): void {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  const seconds = cfg().get<number>("pollSeconds", 45);
  lastPollSeconds = seconds;
  pollTimer = setInterval(
    () => tick(store, provider, session, false),
    seconds * 1000
  );
  void context;
}

export function deactivate(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
}
