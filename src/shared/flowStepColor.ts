/** User annotations, independent of a step's skill category or execution status. */
export const FLOW_STEP_COLORS = ['blue', 'cyan', 'green', 'yellow', 'orange', 'pink', 'violet', 'gray'] as const;
export type FlowStepColor = typeof FLOW_STEP_COLORS[number];

/** Old flows have no colour; unknown values never become CSS or block an import. */
export function readFlowStepColor(value: unknown): FlowStepColor | undefined {
  return typeof value === 'string' && (FLOW_STEP_COLORS as readonly string[]).includes(value)
    ? value as FlowStepColor : undefined;
}
