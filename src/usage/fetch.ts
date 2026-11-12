import * as vscode from "vscode";
import { scrubSensitive } from "./scrub";
import { readAccessToken, readMembershipHint } from "./token";
import type { UsageLoadResult, UsageSnapshot } from "./types";

/** Hard allowlist — usage traffic may only go here. */
const USAGE_URL =
  "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";

interface PeriodUsageResponse {
  billingCycleEnd?: string | number;
  displayMessage?: string;
  planUsage?: {
    totalPercentUsed?: number;
    autoPercentUsed?: number;
    apiPercentUsed?: number;
    includedSpend?: number;
    totalSpend?: number;
    limit?: number;
  };
}

function asPercent(n: unknown): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    return undefined;
  }
  return Math.max(0, n);
}

function fail(reason: string): UsageLoadResult {
  return { ok: false, reason: scrubSensitive(reason) };
}

export async function loadUsageSnapshot(): Promise<UsageLoadResult> {
  // Defense in depth: never decrypt/call if setting is off
  if (
    !vscode.workspace
      .getConfiguration("valueCoach")
      .get<boolean>("showUsage", false)
  ) {
    return fail("Live usage is disabled");
  }

  if (USAGE_URL !== "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage") {
    return fail("Usage endpoint allowlist check failed");
  }

  let token: string | undefined;
  try {
    token = readAccessToken();
  } catch (e) {
    return fail(
      e instanceof Error ? e.message : "Could not read Cursor login"
    );
  }

  let res: Response;
  try {
    res = await fetch(USAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: "{}",
      redirect: "error",
    });
  } catch (e) {
    return fail(
      e instanceof Error ? e.message : "Network error fetching usage"
    );
  } finally {
    token = undefined;
  }

  if (!res.ok) {
    return fail(`Usage API ${res.status} — try signing out/in of Cursor`);
  }

  let json: PeriodUsageResponse;
  try {
    json = (await res.json()) as PeriodUsageResponse;
  } catch {
    return fail("Usage API returned non-JSON");
  }

  const plan = json.planUsage ?? {};
  const percentUsed =
    asPercent(plan.totalPercentUsed) ??
    asPercent(plan.autoPercentUsed) ??
    (plan.limit && plan.limit > 0 && plan.includedSpend != null
      ? Math.min((plan.includedSpend / plan.limit) * 100, 100)
      : undefined);

  if (percentUsed == null) {
    return fail("Usage payload missing percent fields");
  }

  const endRaw = json.billingCycleEnd;
  const billingCycleEndMs =
    typeof endRaw === "number"
      ? endRaw
      : typeof endRaw === "string" && /^\d+$/.test(endRaw)
        ? Number(endRaw)
        : undefined;

  const snapshot: UsageSnapshot = {
    percentUsed,
    autoPercentUsed: asPercent(plan.autoPercentUsed),
    apiPercentUsed: asPercent(plan.apiPercentUsed),
    displayMessage:
      typeof json.displayMessage === "string"
        ? scrubSensitive(json.displayMessage).slice(0, 280)
        : undefined,
    billingCycleEndMs,
    membershipType: readMembershipHint(),
    fetchedAt: Date.now(),
  };

  return { ok: true, snapshot };
}
