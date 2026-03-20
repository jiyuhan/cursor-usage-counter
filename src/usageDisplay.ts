import type { IncludedUsage } from './usageParse';

export type UsageTier = 'ok' | 'warn' | 'danger';

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** Single-line status label with emoji markers for pools. */
export function formatStatusBarText(usage: IncludedUsage, usd: number): string {
  const parts: string[] = [];
  if (usage.total !== undefined) {
    parts.push(`📊 ${Math.round(usage.total)}%`);
  }
  if (usage.autoComposer !== undefined || usage.api !== undefined) {
    if (usage.autoComposer !== undefined) {
      parts.push(`🤖 ${Math.round(usage.autoComposer)}%`);
    }
    if (usage.api !== undefined) {
      parts.push(`🔌 ${Math.round(usage.api)}%`);
    }
  }
  parts.push(formatUsd(usd));
  return parts.join(' · ');
}

/** Worst pool drives warn / danger styling (e.g. API at 100% while total is lower). */
export function tierDrivingPercent(usage: IncludedUsage): number | undefined {
  const candidates = [usage.total, usage.autoComposer, usage.api].filter(
    (n): n is number => n !== undefined,
  );
  if (candidates.length === 0) {
    return undefined;
  }
  return Math.max(...candidates);
}

export function tierFromPercent(pct: number | undefined): UsageTier | undefined {
  if (pct === undefined) {
    return undefined;
  }
  const p = Math.max(0, pct);
  if (p < 70) {
    return 'ok';
  }
  if (p < 92) {
    return 'warn';
  }
  return 'danger';
}

/** On-demand thresholds: < $50 ok, < $200 warn, >= $200 danger. */
export function tierFromSpendUsd(usd: number): UsageTier {
  if (usd < 50) {
    return 'ok';
  }
  if (usd < 200) {
    return 'warn';
  }
  return 'danger';
}

export function formatUsageTooltip(usage: IncludedUsage, usd: number): string {
  const inc: string[] = [];
  if (usage.total !== undefined) {
    inc.push(`total ~${Math.round(usage.total)}%`);
  }
  if (usage.autoComposer !== undefined) {
    inc.push(`Auto+Composer ~${Math.round(usage.autoComposer)}%`);
  }
  if (usage.api !== undefined) {
    inc.push(`API ~${Math.round(usage.api)}%`);
  }
  const head =
    inc.length > 0 ? `Included: ${inc.join(', ')}.` : 'Included: (no % in response).';
  return `${head} On-demand ${formatUsd(usd)}. Click: Settings. Command **Cursor Usage: Show Log** for details.`;
}
