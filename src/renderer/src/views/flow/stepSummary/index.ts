/**
 * `stepSummary`: one line per step for the block outline, the folded card's headline and the
 * Insert data group titles. Per-type formats follow the long-flow-editor spec (§3.2 and each
 * type's 導覽摘要); the import preview keeps `summarizeStep`, which shows the raw settings.
 */
export type { StepSummary, StepSummaryContext, StepSummaryLookup, StepSummaryState } from './types';
export { stepSummary } from './summary';
export { describeRef, flowScopes, scopeAt, type DescribedRef, type StepScope } from './refs';
export { flowPlaces, placeOf, type StepPlace, type StructureIssue } from './structure';
export { stepDisplayName } from './core';
export { stepSearchText, type StepSearchEntry, type StepSearchField } from './search';
