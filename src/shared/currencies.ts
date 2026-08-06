export const COMMON_CURRENCIES = [
  'USD', 'TWD', 'JPY', 'EUR', 'CNY', 'HKD', 'KRW', 'GBP', 'AUD',
  'CAD', 'CHF', 'SGD', 'THB', 'MYR', 'PHP', 'VND', 'IDR', 'NZD',
] as const;

export type CommonCurrency = (typeof COMMON_CURRENCIES)[number];
