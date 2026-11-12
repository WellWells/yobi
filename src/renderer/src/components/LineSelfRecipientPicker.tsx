import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { RefreshCw, Settings } from 'lucide-react';
import { AppButton } from './AppButton';
import { MultiSelectDropdown } from './MultiSelectDropdown';
import { RecipientNotes } from './RecipientNotes';
import { lineApi, socketBotApi } from '../api/electronApi';
import { useI18nStore } from '../store/i18nStore';
import { useAppStore } from '../store/appStore';
import { lineSelfRecipientOptions } from '../utils/lineSelfRecipientOptions';
import {
  recipientTokens, unlistedRecipientCount, withOtherRecipients, withTypedRecipient,
} from '../utils/recipientChoices';
import type { FlowVariable, LinePairedUser, LineSelfTargetListResult } from '../../../shared/types';

export interface LineSelfRecipientPickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  blankHint?: string;
  error?: string;
  offerStepChoices?: boolean;
  variables?: readonly FlowVariable[];
  onBeforeNavigate?: () => void;
}

/**
 * Recipients of a LINE PC bot step: the user themself, any group or friend LINE PC has on this
 * computer, and everyone who asked Yobi. Searchable, since one account can have hundreds of chats.
 * There is no text field: every value the step holds is a named choice (see `withOtherRecipients`).
 */
export const LineSelfRecipientPicker: React.FC<LineSelfRecipientPickerProps> = ({
  value, onChange, label, hint, blankHint, error, offerStepChoices, variables, onBeforeNavigate,
}) => {
  const t = useI18nStore((s) => s.t);
  const openSettingsCategory = useAppStore((s) => s.openSettingsCategory);
  const currentView = useAppStore((s) => s.currentView);
  const [result, setResult] = useState<LineSelfTargetListResult | null>(null);
  const [paired, setPaired] = useState<LinePairedUser[]>([]);

  const load = useCallback(() => {
    setResult(null);
    void lineApi.listSelfTargets().then(setResult);
    void socketBotApi.getSettings('lineSelf').then((s) => setPaired(s?.pairing.pairedUsers ?? []));
  }, []);

  useEffect(() => {
    if (currentView !== 'flow') return;
    load();
  }, [currentView, load]);

  const loading = result === null;
  const tokens = useMemo(() => recipientTokens(value), [value]);
  const base = useMemo(() => lineSelfRecipientOptions(result?.ok ? result : null, paired, t), [result, paired, t]);
  const ctx = useMemo(
    () => ({ platform: 'lineSelf' as const, t, offerStepChoices, variables, loading }),
    [t, offerStepChoices, variables, loading],
  );
  const options = useMemo(() => withOtherRecipients(base, tokens, ctx), [base, tokens, ctx]);
  // A list that failed to load has not said a saved chat is missing.
  const unlisted = useMemo(() => (result?.ok ? unlistedRecipientCount(base, tokens, ctx) : 0), [result, base, tokens, ctx]);

  const goToConnectors = (): void => {
    onBeforeNavigate?.();
    openSettingsCategory('connectors');
  };

  const failure = result !== null && !result.ok ? result : null;
  const [search, setSearch] = useState('');

  return (
    <Stack gap={4}>
      <MultiSelectDropdown
        label={label}
        aria-label={label ? undefined : t('flow.recipient.lineSelf.pick')}
        options={withTypedRecipient(options, search, t)}
        value={tokens}
        onChange={(next) => onChange(next.join(','))}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        nothingFoundMessage={t('flow.recipient.lineSelf.noMatch')}
        placeholder={loading ? t('flow.recipient.lineSelf.loading') : t('flow.recipient.lineSelf.pick')}
        error={error || undefined}
        size="sm"
      />
      {failure && (
        <Group gap="xs" align="center" wrap="nowrap">
          <Text fz="xs" c="var(--mantine-color-warning)" style={{ flex: 1 }}>{failure.message}</Text>
          {failure.reason === 'disabled' ? (
            <AppButton
              variant="light"
              size="compact-xs"
              leftSection={<Settings size={12} />}
              onClick={goToConnectors}
              style={{ flexShrink: 0 }}
            >
              {t('flow.setup.openSettings')}
            </AppButton>
          ) : (
            <AppButton
              variant="light"
              size="compact-xs"
              leftSection={<RefreshCw size={12} />}
              onClick={load}
              style={{ flexShrink: 0 }}
            >
              {t('flow.recipient.lineSelf.retry')}
            </AppButton>
          )}
        </Group>
      )}
      <RecipientNotes tokens={tokens} unlisted={unlisted} blankHint={blankHint} hint={hint} />
    </Stack>
  );
};
