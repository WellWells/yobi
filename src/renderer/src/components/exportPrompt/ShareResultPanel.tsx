import React from 'react';
import { ActionIcon, Alert, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Check, ExternalLink, Trash2, TriangleAlert } from 'lucide-react';
import { AppButton } from '../AppButton';
import { AppTextInput } from '../AppTextInput';
import { PromptShell } from './PromptShell';
import { selectAllOnClick } from '../../utils/selectAllOnClick';
import type { PanelHeight, ShareResultAction, ShareResultState } from '../../../../shared/types';

interface Props {
  title: string;
  state: ShareResultState;
  onAction: (action: ShareResultAction) => void;
  onHeight: (height: PanelHeight) => void;
}

export const ShareResultPanel: React.FC<Props> = ({ title, state, onAction, onHeight }) => {
  const [busy, setBusy] = React.useState(false);
  const done = (): void => onAction('done');

  React.useEffect(() => { setBusy(false); }, [state]);

  return (
    <PromptShell title={title} onHeight={onHeight} onEscape={done} onEnter={done}>
      {state.revoked ? (
        <Alert color="gray" icon={<Trash2 size={16} />} variant="light">
          {state.strings.revoked}
        </Alert>
      ) : (
        <Stack gap={10}>
          <Text fz="var(--font-size-sm)" c="dimmed" lh={1.65}>{state.strings.hint}</Text>
          <AppTextInput
            value={state.url}
            readOnly
            mono
            {...selectAllOnClick}
            ref={(node) => {
              if (node && document.activeElement !== node) { node.focus(); node.select(); }
            }}
            rightSectionWidth={34}
            rightSectionPointerEvents="all"
            rightSection={(
              <Tooltip
                label={state.burned ? state.strings.burnBlocked : state.strings.open}
                position="top"
                maw={280}
                multiline
              >
                <Box>
                  <ActionIcon
                    variant="subtle"
                    size={22}
                    disabled={state.burned}
                    aria-label={state.strings.open}
                    onClick={() => onAction('open')}
                  >
                    <ExternalLink size={13} />
                  </ActionIcon>
                </Box>
              </Tooltip>
            )}
          />
          <Group gap={6} c="var(--accent)">
            <Check size={13} />
            <Text fz="var(--font-size-sm)">{state.strings.copied}</Text>
          </Group>
        </Stack>
      )}

      {state.error && (
        <Alert color="red" variant="light" icon={<TriangleAlert size={16} />}>
          <Text fz="var(--font-size-sm)" style={{ wordBreak: 'break-word' }}>{state.error}</Text>
        </Alert>
      )}

      <Group justify="space-between" gap={8} mt={2}>
        <AppButton
          variant="subtle"
          color="red"
          leftSection={<Trash2 size={14} />}
          loading={busy}
          disabled={state.revoked}
          onClick={() => { setBusy(true); onAction('revoke'); }}
        >
          {state.strings.revoke}
        </AppButton>
        <AppButton variant="filled" onClick={done}>{state.strings.done}</AppButton>
      </Group>
    </PromptShell>
  );
};
