import * as vscode from "vscode";

const CONSENT_KEY = "valueCoach.usageConsent";

export type UsageConsent = "granted" | "denied";

function cfg() {
  return vscode.workspace.getConfiguration("valueCoach");
}

export function getUsageConsent(
  state: vscode.Memento
): UsageConsent | undefined {
  const v = state.get<string>(CONSENT_KEY);
  return v === "granted" || v === "denied" ? v : undefined;
}

export async function setUsageConsent(
  state: vscode.Memento,
  value: UsageConsent | undefined
): Promise<void> {
  await state.update(CONSENT_KEY, value);
}

async function promptUsageConsent(state: vscode.Memento): Promise<boolean> {
  const pick = await vscode.window.showInformationMessage(
    "Enable live Cursor usage %? Value Coach would read your local Cursor login on this PC and call only api2.cursor.sh GetCurrentPeriodUsage. The token is not saved to disk or sent to the publisher. Coaching still works fully offline. Details: PRIVACY.md, TERMS.md, SECURITY.md.",
    { modal: true },
    "Enable live usage",
    "Keep offline"
  );

  if (pick === "Enable live usage") {
    await setUsageConsent(state, "granted");
    await cfg().update("showUsage", true, vscode.ConfigurationTarget.Global);
    return true;
  }

  await setUsageConsent(state, "denied");
  await cfg().update("showUsage", false, vscode.ConfigurationTarget.Global);
  return false;
}

/**
 * Consent gate before reading Cursor login / calling api2.cursor.sh.
 * Live usage defaults off until granted.
 */
export async function ensureUsageConsent(
  state: vscode.Memento,
  opts?: { interactive?: boolean }
): Promise<boolean> {
  if (getUsageConsent(state) === "granted") {
    return true;
  }

  const showUsage = cfg().get<boolean>("showUsage", false);
  if (!showUsage && !opts?.interactive && getUsageConsent(state) === "denied") {
    return false;
  }

  return promptUsageConsent(state);
}

/** First activate: ask once if we have never recorded a choice. */
export async function bootstrapUsageConsent(
  state: vscode.Memento
): Promise<void> {
  if (getUsageConsent(state) !== undefined) {
    // Upgraded installs that still have showUsage on without grant
    if (
      getUsageConsent(state) !== "granted" &&
      cfg().get<boolean>("showUsage", false)
    ) {
      await ensureUsageConsent(state);
    }
    return;
  }
  await promptUsageConsent(state);
}
