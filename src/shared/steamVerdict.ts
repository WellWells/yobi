export interface VerdictParams {
  min: number;
  mid: number;
  high: number;
  hiBand: number;
  midHiBand: number;
  midBand: number;
  loMidBand: number;
  owPosStar: number;
  owNegStar: number;
}

export const DEFAULT_VERDICT_PARAMS: VerdictParams = {
  min: 10,
  mid: 50,
  high: 500,
  hiBand: 4.5,
  midHiBand: 4.0,
  midBand: 3.0,
  loMidBand: 2.5,
  owPosStar: 4.7,
  owNegStar: 1.5,
};

export const VERDICT_TIER = {
  overwhelminglyPositive: 9,
  veryPositive: 8,
  positive: 7,
  mostlyPositive: 6,
  mixed: 5,
  mostlyNegative: 4,
  negative: 3,
  veryNegative: 2,
  overwhelminglyNegative: 1,
  notEnough: 0,
} as const;

export const VERDICT_LABEL_EN: Record<number, string> = {
  9: 'Overwhelmingly Positive',
  8: 'Very Positive',
  7: 'Positive',
  6: 'Mostly Positive',
  5: 'Mixed',
  4: 'Mostly Negative',
  3: 'Negative',
  2: 'Very Negative',
  1: 'Overwhelmingly Negative',
  0: 'Not enough reviews',
};

export const VERDICT_I18N_KEYS: Record<number, string> = {
  0: 'mapReviews.verdict.0',
  1: 'mapReviews.verdict.1',
  2: 'mapReviews.verdict.2',
  3: 'mapReviews.verdict.3',
  4: 'mapReviews.verdict.4',
  5: 'mapReviews.verdict.5',
  6: 'mapReviews.verdict.6',
  7: 'mapReviews.verdict.7',
  8: 'mapReviews.verdict.8',
  9: 'mapReviews.verdict.9',
};

export function computeVerdictTier(avg: number, count: number, params: VerdictParams = DEFAULT_VERDICT_PARAMS): number {
  if (!Number.isFinite(avg) || !Number.isFinite(count) || avg <= 0) return -1;
  const { min, mid, high, hiBand, midHiBand, midBand, loMidBand, owPosStar, owNegStar } = params;

  if (count < min) return VERDICT_TIER.notEnough;

  if (avg >= hiBand) {
    if (avg >= owPosStar && count >= high) return VERDICT_TIER.overwhelminglyPositive;
    if (count >= mid) return VERDICT_TIER.veryPositive;
    return VERDICT_TIER.positive;
  }
  if (avg >= midHiBand) return VERDICT_TIER.mostlyPositive;
  if (avg >= midBand) return VERDICT_TIER.mixed;
  if (avg >= loMidBand) return VERDICT_TIER.mostlyNegative;

  if (avg <= owNegStar && count >= high) return VERDICT_TIER.overwhelminglyNegative;
  if (count >= mid) return VERDICT_TIER.veryNegative;
  return VERDICT_TIER.negative;
}
