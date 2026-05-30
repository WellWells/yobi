// src/renderer/src/views/agentflow/flowImportParser.ts
// Parses a raw unknown JSON value into an array of FlowDefinition objects.
// Accepts three formats:
//   1. Single FlowDefinition (has "steps" array and "trigger")
//   2. Wrapped export { type: "agentflow-export", version: 1, flow: FlowDefinition }
//   3. Array of the above formats
import type { FlowDefinition } from '../../../../shared/types';

function isFlowDefinition(val: unknown): val is FlowDefinition {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.id === 'string'
    && typeof obj.name === 'string'
    && Array.isArray(obj.steps)
    && typeof obj.trigger === 'object'
    && obj.trigger !== null
  );
}

export function parseImportedFlows(raw: unknown): FlowDefinition[] | null {
  if (Array.isArray(raw)) {
    const flows: FlowDefinition[] = [];
    for (const item of raw) {
      const parsed = parseImportedFlows(item);
      if (parsed) flows.push(...parsed);
    }
    return flows.length > 0 ? flows : null;
  }

  if (typeof raw !== 'object' || raw === null) return null;

  const obj = raw as Record<string, unknown>;

  // Wrapped export format
  if (obj.type === 'agentflow-export' && obj.flow) {
    return isFlowDefinition(obj.flow) ? [obj.flow] : null;
  }

  // Direct FlowDefinition
  if (isFlowDefinition(obj)) return [obj];

  return null;
}
