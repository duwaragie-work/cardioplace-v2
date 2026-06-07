import { bucketizeAlert } from './page';

// P1 — the bell's tier-based bucketing mislabeled HF-decompensation alerts as
// "Low blood pressure" because the engine emits them with tier BP_LEVEL_1_LOW
// (it claims the sbp-low axis). bucketizeAlert now consults ruleId first.

function alert(over: Record<string, unknown> = {}) {
  return { id: 'a1', createdAt: '2026-06-01T00:00:00Z', ...over } as Parameters<typeof bucketizeAlert>[0];
}

describe('bucketizeAlert (P1)', () => {
  it('does NOT bucket HF-decomp (tier BP_LEVEL_1_LOW) as low blood pressure', () => {
    const bucket = bucketizeAlert(
      alert({ ruleId: 'RULE_HF_DECOMPENSATION', tier: 'BP_LEVEL_1_LOW' }),
    );
    expect(bucket).not.toBe('low');
    expect(bucket).toBe('heartFailure');
  });

  it('still buckets a genuine low-BP alert as low', () => {
    expect(
      bucketizeAlert(alert({ ruleId: 'RULE_HFREF_LOW', tier: 'BP_LEVEL_1_LOW' })),
    ).toBe('low');
  });

  it('buckets standard high BP as high', () => {
    expect(
      bucketizeAlert(alert({ ruleId: 'RULE_STANDARD_L1_HIGH', tier: 'BP_LEVEL_1_HIGH' })),
    ).toBe('high');
  });

  it('keeps emergency tiers as emergency', () => {
    expect(bucketizeAlert(alert({ tier: 'BP_LEVEL_2' }))).toBe('emergency');
  });
});
