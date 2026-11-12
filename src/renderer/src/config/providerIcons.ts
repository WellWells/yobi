import { MessageSquare } from 'lucide-react';
import { NotionIcon } from './brandIcons';
import { FLOW_COMMAND_ICON } from './chatModes';
import { MODELS } from './models';
import type { ModelIcon, ModelOption } from './models';

/*
 * The mark a saved conversation's row leads with: whose answer it holds. A file stores its provider
 * as the name the answer was written under — a built-in provider ("Claude"), a BYOK key's or key
 * group's own name ("Work keys"), "Notion" for a synced page, or the flow label for a flow's
 * result — so the name is matched back to the model menu's entries, whose icons the picker already
 * draws. A name nothing matches (a key deleted since, a provider Yobi no longer drives) gets the
 * plain chat mark rather than a guess.
 */

function normalise(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase();
}

/**
 * `models` are the model menu's entries beyond the built-in four (BYOK keys and key groups);
 * `flowLabel` is the name flows write their results under, in this locale.
 */
export function providerIconFor(
  provider: string | undefined,
  models: readonly ModelOption[],
  flowLabel: string,
): ModelIcon {
  const name = normalise(provider ?? '');
  if (!name) return MessageSquare;
  if (name === normalise(flowLabel)) return FLOW_COMMAND_ICON;
  if (name === 'notion') return NotionIcon;
  const match = [...MODELS, ...models].find((model) => normalise(model.label) === name);
  return match?.icon ?? MessageSquare;
}
