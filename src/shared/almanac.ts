/** The almanac step's span cap, shared by the step editor and the handler. */
export const MAX_ALMANAC_DAYS = 62;

/** With a filter only matching days come back, as short entries, so the span can be a year. */
export const MAX_ALMANAC_FILTER_DAYS = 366;

/**
 * The activities the step editor offers for finding good days — piliapp's 挑吉日 list plus 安葬.
 * `term` is what the step stores and the almanac matches (Traditional; Simplified matches too),
 * `id` names its label key.
 */
export const ALMANAC_ACTIVITY_PRESETS = [
  { id: 'wedding', term: '嫁娶' },
  { id: 'betrothal', term: '納采' },
  { id: 'moveIn', term: '入宅' },
  { id: 'relocate', term: '移徙' },
  { id: 'openBusiness', term: '開市' },
  { id: 'travel', term: '出行' },
  { id: 'groundbreaking', term: '動土' },
  { id: 'bed', term: '安床' },
  { id: 'prayer', term: '祈福' },
  { id: 'trade', term: '交易' },
  { id: 'burial', term: '安葬' },
] as const;
