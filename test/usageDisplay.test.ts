import { describe, expect, it } from 'vitest';
import {
  formatStatusBarText,
  formatUsd,
  formatUsageTooltip,
  tierFromPercent,
  tierFromSpendUsd,
  tierDrivingPercent,
} from '../src/usageDisplay';

describe('formatUsd', () => {
  it('always uses two decimal places', () => {
    expect(formatUsd(27.4)).toBe('$27.40');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(1)).toBe('$1.00');
    expect(formatUsd(99.999)).toBe('$100.00');
  });
});

describe('formatStatusBarText', () => {
  it('renders total + on-demand like before when there is no channel breakdown', () => {
    expect(formatStatusBarText({ total: 38 }, 27.4)).toBe('📊 38% · $27.40');
  });

  it('inserts emoji-tagged auto/api pools between total and $', () => {
    expect(formatStatusBarText({ total: 38, autoComposer: 18, api: 100 }, 27.4)).toBe(
      '📊 38% · 🤖 18% · 🔌 100% · $27.40',
    );
  });

  it('rounds percentages the same way as Math.round', () => {
    expect(formatStatusBarText({ total: 37.4, autoComposer: 17.6, api: 99.2 }, 0)).toBe(
      '📊 37% · 🤖 18% · 🔌 99% · $0.00',
    );
  });

  it('omits total if absent but still shows channels and $', () => {
    expect(formatStatusBarText({ autoComposer: 5, api: 10 }, 1)).toBe('🤖 5% · 🔌 10% · $1.00');
  });
});

describe('tierDrivingPercent', () => {
  it('uses the maximum pool for styling', () => {
    expect(tierDrivingPercent({ total: 38, autoComposer: 18, api: 100 })).toBe(100);
  });

  it('returns undefined when nothing is known', () => {
    expect(tierDrivingPercent({})).toBeUndefined();
  });
});

describe('tierFromPercent', () => {
  it('maps percent bands to ok/warn/danger', () => {
    expect(tierFromPercent(10)).toBe('ok');
    expect(tierFromPercent(69.9)).toBe('ok');
    expect(tierFromPercent(70)).toBe('warn');
    expect(tierFromPercent(91.9)).toBe('warn');
    expect(tierFromPercent(92)).toBe('danger');
  });
});

describe('tierFromSpendUsd', () => {
  it('uses spend thresholds requested by product', () => {
    expect(tierFromSpendUsd(0)).toBe('ok');
    expect(tierFromSpendUsd(49.99)).toBe('ok');
    expect(tierFromSpendUsd(50)).toBe('warn');
    expect(tierFromSpendUsd(199.99)).toBe('warn');
    expect(tierFromSpendUsd(200)).toBe('danger');
  });
});

describe('formatUsageTooltip', () => {
  it('includes readable pool labels', () => {
    expect(formatUsageTooltip({ total: 38, autoComposer: 18, api: 100 }, 27.4)).toContain(
      'Auto+Composer ~18%',
    );
    expect(formatUsageTooltip({ total: 38, autoComposer: 18, api: 100 }, 27.4)).toContain(
      'API ~100%',
    );
    expect(formatUsageTooltip({ total: 38, autoComposer: 18, api: 100 }, 27.4)).toContain(
      '$27.40',
    );
  });
});
