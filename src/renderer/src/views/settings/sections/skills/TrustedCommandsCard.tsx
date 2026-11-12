import React, { useEffect, useState } from 'react';
import { ActionIcon, Stack, Text, Tooltip } from '@mantine/core';
import { ShieldCheck, Trash } from 'lucide-react';
import { SectionCard, SectionTitle, SettingDivider, SettingRow } from '../../components';
import { skillsApi } from '../../../../api/electronApi';
import { trustedCommandLabel } from '../../../../../../shared/trustedCommands';
import type { TrustedCommand } from '../../../../../../shared/trustedCommands';

interface Props {
  t: (key: string) => string;
  sectionGap: number;
}

/**
 * The programs and actions `/agent` runs without asking. Added only from a command's confirmation
 * ("Always allow"), removed here; the card shows once there is something to remove.
 */
export const TrustedCommandsCard: React.FC<Props> = ({ t, sectionGap }) => {
  const [list, setList] = useState<TrustedCommand[]>([]);

  useEffect(() => {
    let live = true;
    void skillsApi.trustedCommands().then((next) => { if (live) setList(next); });
    const off = skillsApi.onTrustedCommandsChanged((next) => setList(next));
    return () => {
      live = false;
      off();
    };
  }, []);

  if (list.length === 0) return null;

  return (
    <SectionCard style={{ marginBottom: sectionGap }}>
      <SectionTitle icon={<ShieldCheck size={15} />} label={t('settings.skills.trusted.title')} />
      <Stack gap={12}>
        <Text fz="var(--font-size-sm)" c="var(--text-muted)" lh={1.6}>{t('settings.skills.trusted.hint')}</Text>
        {list.map((entry, index) => (
          <React.Fragment key={`${entry.program}\n${entry.verb}`}>
            {index > 0 && <SettingDivider my={0} />}
            <SettingRow
              label={trustedCommandLabel(entry)}
              // The full path: two programs can share a name, and this is the one that runs.
              hint={<Text span inherit style={{ wordBreak: 'break-all' }}>{entry.program}</Text>}
              control={(
                <Tooltip label={t('settings.skills.trusted.remove')} position="bottom">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size={30}
                    aria-label={t('settings.skills.trusted.remove')}
                    onClick={() => { void skillsApi.removeTrustedCommand(entry).then(setList); }}
                  >
                    <Trash size={15} />
                  </ActionIcon>
                </Tooltip>
              )}
            />
          </React.Fragment>
        ))}
      </Stack>
    </SectionCard>
  );
};
