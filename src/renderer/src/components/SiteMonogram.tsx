import { Box } from '@mantine/core';
import { citationSite } from '../../../shared/citations';

/**
 * A site's first letter in a small grey square, where Claude shows a favicon. Loading a favicon
 * would be a request to a site the reader never opened, and the page loads no remote image.
 */
export function SiteMonogram({ url, size = 14 }: { url: string; size?: number }) {
  const letter = citationSite(url).charAt(0).toUpperCase() || '?';
  return (
    <Box
      component="span"
      aria-hidden
      w={size}
      h={size}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        borderRadius: 3,
        background: 'var(--bg-hover)',
        color: 'var(--text-muted)',
        fontSize: Math.round(size * 0.65),
        fontWeight: 600,
        lineHeight: 1,
      }}
    >
      {letter}
    </Box>
  );
}
