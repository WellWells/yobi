import React from 'react';
import { Group, List, Text } from '@mantine/core';
import { Download, ExternalLink } from 'lucide-react';
import { AppButton } from '../../../../components/AppButton';
import { clipboardApi } from '../../../../api/electronApi';

const RELEASES_URL = 'https://github.com/TKasperczyk/thunderbird-mcp/releases/latest';
const EXTENSION_URL = 'https://github.com/TKasperczyk/thunderbird-mcp/tree/main/extension';

interface Props {
  t: (key: string) => string;
}

// The connector relays to an add-on that runs inside Thunderbird, so nothing connects until that
// add-on is installed. The card shows these steps whenever the connector is on but not connected.
export const ThunderbirdSetup: React.FC<Props> = ({ t }) => (
  <List type="ordered" size="sm" spacing={8} c="dimmed">
    <List.Item>
      <Group gap={8} wrap="wrap">
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5}>
          {t('settings.mcp.thunderbird.setup.download')}
        </Text>
        <AppButton
          size="compact-xs"
          variant="default"
          leftSection={<Download size={12} />}
          onClick={() => { void clipboardApi.openExternalUrl(RELEASES_URL); }}
        >
          {t('settings.mcp.thunderbird.setup.downloadAction')}
        </AppButton>
        <AppButton
          size="compact-xs"
          variant="subtle"
          leftSection={<ExternalLink size={12} />}
          onClick={() => { void clipboardApi.openExternalUrl(EXTENSION_URL); }}
        >
          {t('settings.mcp.thunderbird.setup.source')}
        </AppButton>
      </Group>
    </List.Item>
    <List.Item>
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5}>{t('settings.mcp.thunderbird.setup.install')}</Text>
    </List.Item>
    <List.Item>
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5}>{t('settings.mcp.thunderbird.setup.keepOpen')}</Text>
    </List.Item>
  </List>
);
