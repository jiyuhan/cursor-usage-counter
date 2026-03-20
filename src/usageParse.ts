/**
 * Map GetCurrentPeriodUsage (Connect JSON) → status bar fields.
 * On-demand $ uses spendLimitUsage.individualUsed as whole cents (API contract).
 */

/** Included plan usage; channel fields appear when the API exposes a breakdown (names may vary by Cursor version). */
export type IncludedUsage = {
  total?: number;
  autoComposer?: number;
  api?: number;
};

export function readPercent(v: unknown): number | undefined {
  const r = asObj(v);
  const plan = asObj(r?.planUsage ?? r?.plan_usage);
  const raw = plan?.totalPercentUsed ?? plan?.total_percent_used;
  if (raw === undefined) {
    return undefined;
  }
  return normalizePercent(raw);
}

/**
 * Reads total plus Auto+Composer vs API pool percentages when present.
 * Tries common camelCase / snake_case JSON keys; verbose logs in the extension can list keys if the API shape changes.
 */
export function readIncludedUsage(v: unknown): IncludedUsage {
  const total = readPercent(v);
  const plan = planUsageObj(v);
  if (!plan) {
    return { total };
  }

  const autoComposerDirect = pickFirstPercent(plan, [
    'autoComposerPercentUsed',
    'auto_composer_percent_used',
    'composerAndAutoPercentUsed',
    'composer_and_auto_percent_used',
    'autoAndComposerPercentUsed',
    'auto_and_composer_percent_used',
    'bonusPercentUsed',
    'bonus_percent_used',
  ]);
  const auto = pickFirstPercent(plan, ['autoPercentUsed', 'auto_percent_used']);
  const composer = pickFirstPercent(plan, ['composerPercentUsed', 'composer_percent_used']);
  let autoComposer = autoComposerDirect;
  if (autoComposer === undefined && (auto !== undefined || composer !== undefined)) {
    autoComposer = (auto ?? 0) + (composer ?? 0);
  }

  const api = pickFirstPercent(plan, [
    'apiPercentUsed',
    'api_percent_used',
    'apiPoolPercentUsed',
    'api_pool_percent_used',
  ]);

  return { total, autoComposer, api };
}

export function planUsagePercentFieldKeys(v: unknown): string[] {
  const plan = planUsageObj(v);
  if (!plan) {
    return [];
  }
  return Object.keys(plan)
    .filter((k) => /percent/i.test(k))
    .sort();
}

function planUsageObj(v: unknown): Record<string, unknown> | undefined {
  const r = asObj(v);
  const plan = asObj(r?.planUsage ?? r?.plan_usage);
  return plan;
}

function normalizePercent(raw: unknown): number {
  let n = toNum(raw);
  if (n > 0 && n <= 1) {
    n *= 100;
  }
  return n;
}

function pickFirstPercent(plan: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(plan, k)) {
      continue;
    }
    const raw = plan[k];
    if (raw === undefined || raw === null) {
      continue;
    }
    return normalizePercent(raw);
  }
  return undefined;
}

/** On-demand spend in USD (excludes included pool); source: spendLimitUsage.individualUsed in cents. */
export function readOnDemandUsd(v: unknown): number {
  return readOnDemandBreakdown(v).usd;
}

/** For logging / verification against the dashboard. */
export function readOnDemandBreakdown(v: unknown): {
  usd: number;
  /** Whole cents from API, or null if field absent. */
  cents: number | null;
  raw: unknown;
} {
  const r = asObj(v);
  const sl = asObj(r?.spendLimitUsage ?? r?.spend_limit_usage);
  const raw = sl?.individualUsed ?? sl?.individual_used;
  if (raw === undefined || raw === null) {
    return { usd: 0, cents: null, raw: undefined };
  }
  const cents = toWholeCents(raw);
  return { usd: cents / 100, cents, raw };
}

/** Human-readable plan/tier name when exposed by the API (e.g. Pro, Business). */
export function readPlanInfo(v: unknown): {
  label: string | null;
  raw: unknown;
} {
  const r = asObj(v);
  const plan = planUsageObj(v);
  const billing = asObj(r?.billingUsage ?? r?.billing_usage ?? r?.billing);
  const subscription = asObj(r?.subscriptionUsage ?? r?.subscription_usage ?? r?.subscription);
  const roots = [r, plan, billing, subscription];

  const keys = [
    'membershipType',
    'membership_type',
    'planType',
    'plan_type',
    'planName',
    'plan_name',
    'subscriptionPlan',
    'subscription_plan',
    'tier',
  ];

  for (const obj of roots) {
    if (!obj) {
      continue;
    }
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) {
        continue;
      }
      const raw = obj[key];
      if (raw === undefined || raw === null) {
        continue;
      }
      const label = String(raw).trim();
      if (label !== '') {
        return { label, raw };
      }
    }
  }

  return { label: null, raw: undefined };
}

function asObj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function toNum(v: unknown): number {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : 0;
  }
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** API sends integer cents; truncate so float noise never skews dollars. */
function toWholeCents(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) {
      return Math.trunc(n);
    }
  }
  return 0;
}
