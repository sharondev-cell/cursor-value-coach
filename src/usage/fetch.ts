import { readAccessToken, readMembershipHint } from "./token";
import type { UsageLoadResult, UsageSnapshot } from "./types";

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

export async function loadUsageSnapshot(): Promise<UsageLoadResult> {
  let token: string;
  try {
    token = readAccessToken();
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Could not read Cursor login",
    };
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
    });
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Network error fetching usage",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: `Usage API ${res.status} — try signing out/in of Cursor`,
    };
  }

  let json: PeriodUsageResponse;
  try {
    json = (await res.json()) as PeriodUsageResponse;
  } catch {
    return { ok: false, reason: "Usage API returned non-JSON" };
  }

  const plan = json.planUsage ?? {};
  const percentUsed =
    asPercent(plan.totalPercentUsed) ??
    asPercent(plan.autoPercentUsed) ??
    (plan.limit && plan.limit > 0 && plan.includedSpend != null
      ? Math.min((plan.includedSpend / plan.limit) * 100, 100)
      : undefined);

  if (percentUsed == null) {
    return { ok: false, reason: "Usage payload missing percent fields" };
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
    displayMessage: json.displayMessage,
    billingCycleEndMs,
    membershipType: readMembershipHint(),
    fetchedAt: Date.now(),
  };

  return { ok: true, snapshot };
}
