import { describe, expect, it } from 'vitest';
import {
  planUsagePercentFieldKeys,
  readIncludedUsage,
  readOnDemandBreakdown,
  readOnDemandUsd,
  readPlanInfo,
  readPercent,
} from '../src/usageParse';

describe('readOnDemandUsd', () => {
  it('maps individualUsed cents to dollars (number)', () => {
    const body = {
      spendLimitUsage: { individualUsed: 2740 },
    };
    expect(readOnDemandUsd(body)).toBe(27.4);
    expect(readOnDemandBreakdown(body)).toEqual({
      usd: 27.4,
      cents: 2740,
      raw: 2740,
    });
  });

  it('accepts snake_case from JSON', () => {
    const body = { spend_limit_usage: { individual_used: 100 } };
    expect(readOnDemandUsd(body)).toBe(1);
  });

  it('accepts string cents from JSON', () => {
    const body = { spendLimitUsage: { individualUsed: '2450' } };
    expect(readOnDemandUsd(body)).toBe(24.5);
  });

  it('truncates fractional cents defensively', () => {
    const body = { spendLimitUsage: { individualUsed: 2740.9 } };
    expect(readOnDemandUsd(body)).toBe(27.4);
  });

  it('returns 0 when spend block missing', () => {
    expect(readOnDemandUsd({})).toBe(0);
    expect(readOnDemandBreakdown({}).cents).toBeNull();
  });
});

describe('readPercent', () => {
  it('reads planUsage.totalPercentUsed', () => {
    expect(readPercent({ planUsage: { totalPercentUsed: 36.7 } })).toBe(36.7);
  });

  it('reads snake_case total', () => {
    expect(readPercent({ plan_usage: { total_percent_used: 40 } })).toBe(40);
  });

  it('scales 0–1 to percent', () => {
    expect(readPercent({ planUsage: { totalPercentUsed: 0.367 } })).toBeCloseTo(36.7, 5);
  });

  it('round-trips display rounding the way the status bar uses it', () => {
    expect(Math.round(readPercent({ planUsage: { totalPercentUsed: 37.4 } })!)).toBe(37);
    expect(Math.round(readPercent({ planUsage: { totalPercentUsed: 0.374 } })!)).toBe(37);
  });
});

describe('readIncludedUsage', () => {
  it('adds ac/api breakdown when API sends those fields', () => {
    const body = {
      planUsage: {
        totalPercentUsed: 38,
        autoComposerPercentUsed: 18,
        apiPercentUsed: 100,
      },
    };
    expect(readIncludedUsage(body)).toEqual({
      total: 38,
      autoComposer: 18,
      api: 100,
    });
  });

  it('sums auto + composer when given separately', () => {
    const body = {
      planUsage: {
        totalPercentUsed: 30,
        autoPercentUsed: 10,
        composerPercentUsed: 8,
      },
    };
    expect(readIncludedUsage(body)).toEqual({
      total: 30,
      autoComposer: 18,
      api: undefined,
    });
  });

  it('accepts snake_case channel fields', () => {
    const body = {
      plan_usage: {
        total_percent_used: 0.38,
        api_percent_used: 99.2,
        auto_composer_percent_used: 0.21,
      },
    };
    expect(readIncludedUsage(body).total).toBeCloseTo(38, 5);
    expect(readIncludedUsage(body).api).toBeCloseTo(99.2, 5);
    expect(readIncludedUsage(body).autoComposer).toBeCloseTo(21, 5);
  });

  it('lists percent-related plan keys for debugging', () => {
    const body = { planUsage: { totalPercentUsed: 1, apiPercentUsed: 2, other: 3 } };
    expect(planUsagePercentFieldKeys(body)).toEqual(['apiPercentUsed', 'totalPercentUsed']);
  });
});

describe('readPlanInfo', () => {
  it('reads plan label from common root field', () => {
    expect(readPlanInfo({ membershipType: 'pro' })).toEqual({
      label: 'pro',
      raw: 'pro',
    });
  });

  it('reads plan label from nested subscription field', () => {
    expect(readPlanInfo({ subscription_usage: { subscription_plan: 'business' } }).label).toBe(
      'business',
    );
  });

  it('returns null when plan is not present', () => {
    expect(readPlanInfo({})).toEqual({
      label: null,
      raw: undefined,
    });
  });
});
