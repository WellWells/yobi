import React from 'react';
import { Text } from '@mantine/core';
import { fillTemplate } from '../../../shared/fillTemplate';
import { useI18nStore } from '../store/i18nStore';

/**
 * The lines under a recipient picker: the platform's hint, then what the step will really do when
 * nothing is picked (everyone paired: many people, so always shown and in the warning colour), and
 * how many saved recipients this platform's lists do not have (picked on another platform).
 */
export const RecipientNotes: React.FC<{
  tokens: readonly string[];
  unlisted: number;
  hint?: string;
  blankHint?: string;
}> = ({ tokens, unlisted, hint, blankHint }) => {
  const t = useI18nStore((s) => s.t);
  return (
    <>
      {unlisted > 0 && (
        <Text fz="xs" c="var(--mantine-color-warning)">
          {fillTemplate(t('flow.recipient.unlistedWarning'), { count: String(unlisted) })}
        </Text>
      )}
      {hint && <Text fz="xs" c="var(--text-muted)">{hint}</Text>}
      {tokens.length === 0 && blankHint && <Text fz="xs" c="var(--mantine-color-warning)">{blankHint}</Text>}
    </>
  );
};
