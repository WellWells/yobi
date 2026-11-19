import React from 'react';
import { Box } from '@mantine/core';
import {
  connectorTint, renderConnectorIcon, renderServerIcon, serverTint,
} from '../../../../config/connectorIcons';
import type { McpCatalogEntry } from '../../../../../../shared/mcpCatalog';
import { useThemeStore } from '../../../../store/themeStore';

type Props = { url: string; entry?: never } | { entry: McpCatalogEntry | undefined; url?: never };

/**
 * A connector card's icon tile, in the brand colour made readable on this theme's tiles. It is the
 * only part of a card that follows the theme, so it alone subscribes to it: previewing a theme
 * repaints these tiles, not the cards around them (theme/liveTheme.ts).
 */
export const ConnectorTile: React.FC<Props> = ({ url, entry }) => {
  const theme = useThemeStore((state) => state.theme);
  const tint = url !== undefined ? serverTint(url, theme) : connectorTint(entry, theme);
  return (
    <Box
      c={tint ?? 'var(--text-primary)'}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 30, flexShrink: 0, borderRadius: 'var(--mantine-radius-sm)',
        background: 'var(--bg-tertiary)',
      }}
    >
      {url !== undefined ? renderServerIcon(url) : renderConnectorIcon(entry)}
    </Box>
  );
};
