export interface UsageSnapshot {
  /** Included / total plan usage percent (0–100+). */
  percentUsed: number;
  autoPercentUsed?: number;
  apiPercentUsed?: number;
  displayMessage?: string;
  billingCycleEndMs?: number;
  membershipType?: string;
  fetchedAt: number;
}

export type UsageLoadResult =
  | { ok: true; snapshot: UsageSnapshot }
  | { ok: false; reason: string };
