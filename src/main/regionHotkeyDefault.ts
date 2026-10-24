import { config, regionHotkeyFilledIn, settleRegionHotkey } from './config';
import { isSamePress } from './hotkey';
import { sendLog } from './helpers';
import type { FlowDefinition } from '../shared/types';

function flowHotkeys(flow: FlowDefinition): string[] {
  return [flow.trigger, ...(flow.extraTriggers ?? [])]
    .flatMap((trigger) => (trigger?.type === 'hotkey' && trigger.keys ? [trigger.keys] : []));
}

/**
 * A config from before the region hotkey (1.9's config.json, or an old backup) had its default
 * filled in, and an enabled flow may already use that combo. The flow keeps it and the region
 * hotkey starts off. Call before the region hotkey is bound; does nothing for a stored combo.
 */
export async function settleFilledInRegionHotkey(loadFlows: () => Promise<FlowDefinition[]>): Promise<void> {
  if (!regionHotkeyFilledIn()) return;
  const combo = config.regionHotkey;
  const flows = combo ? await loadFlows().catch(() => []) : [];
  const holder = flows.find((flow) => flow.enabled && flowHotkeys(flow).some((keys) => isSamePress(keys, combo)));
  if (holder) {
    config.regionHotkey = '';
    sendLog(`⌨️  Screen region hotkey left off: flow "${holder.name}" already uses ${combo}`);
  }
  settleRegionHotkey(config.regionHotkey);
}
