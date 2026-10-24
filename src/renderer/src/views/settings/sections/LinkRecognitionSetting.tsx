import React from 'react';
import { SimpleGrid, Stack, Text } from '@mantine/core';
import { Link } from 'lucide-react';
import { SectionCard, SectionTitle, SettingDivider, SettingRow, ToggleSwitch } from '../components';
import { useLinkRecognitionStore } from '../../../store/linkRecognitionStore';
import { siteLabel } from '../../../../../shared/linkSites/rows';
import type { LinkSiteId } from '../../../../../shared/linkSites/types';

interface Props {
  t: (key: string) => string;
  visible: boolean;
  sectionGap: number;
}

/** A site's name as the user knows it; the playlist row is no site, so it says what it takes. */
function siteName(site: LinkSiteId, t: (key: string) => string): string {
  return site === 'm3u8' ? t('settings.linkRecognition.m3u8') : siteLabel(site);
}

/**
 * Which pasted links Yobi handles itself: the Maps report, then one switch per site in a two-column
 * grid — every site does the same thing, so it is said once above the grid, not per row. A site
 * shown only in its region (PTT, Dcard: Taiwan) is simply absent elsewhere. One set of switches for
 * the desktop and the bots.
 */
export const LinkRecognitionSetting: React.FC<Props> = ({ t, visible, sectionGap }) => {
  const state = useLinkRecognitionStore((s) => s.state);
  const loaded = useLinkRecognitionStore((s) => s.loaded);
  const toggle = useLinkRecognitionStore((s) => s.toggle);

  if (!loaded) return null;

  return (
    <SectionCard style={{ marginBottom: sectionGap, display: visible ? 'block' : 'none' }}>
      <SectionTitle icon={<Link size={15} />} label={t('settings.linkRecognition.title')} mb={4} />
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mb={14}>{t('settings.linkRecognition.hint')}</Text>
      <Stack gap={14}>
        <SettingRow
          label={t('settings.linkRecognition.maps')}
          hint={t('settings.linkRecognition.maps.hint')}
          control={<ToggleSwitch checked={state.maps} onChange={() => { void toggle('maps', !state.maps); }} />}
        />
        <SettingDivider />
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.linkRecognition.sites.hint')}</Text>
        <SimpleGrid cols={2} spacing={24} verticalSpacing={10}>
          {state.sites.map(({ site, on }) => {
            const name = siteName(site, t);
            return (
              <SettingRow
                key={site}
                label={name}
                control={<ToggleSwitch checked={on} aria-label={name} onChange={() => { void toggle(site, !on); }} />}
              />
            );
          })}
        </SimpleGrid>
      </Stack>
    </SectionCard>
  );
};
