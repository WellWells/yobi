import React, { Suspense, startTransition, useEffect, useState } from 'react';
import type { MarkdownCaptureRequest } from '../../../../shared/types';
import { CardSchematic } from './CardSchematic';

const LiveCard = React.lazy(() => import('./LiveCard'));

type SchematicProps = React.ComponentProps<typeof CardSchematic>;

interface Props extends SchematicProps {
  /** The card to draw for real; null keeps the schematic. */
  request: MarkdownCaptureRequest | null;
  onMeasure: (logicalHeight: number) => void;
}

/**
 * The quick-export preview. It opens on the hand-drawn schematic — the panel is on screen the moment
 * the hotkey is pressed — and swaps in the real card once its chunk has loaded. The swap is a
 * transition, so laying out a long document yields to typing in the file name.
 */
export const CardPreview: React.FC<Props> = ({ request, onMeasure, ...schematic }) => {
  const [live, setLive] = useState(false);
  useEffect(() => {
    startTransition(() => setLive(true));
  }, []);

  const fallback = <CardSchematic {...schematic} />;
  if (!request || !live) return fallback;
  return (
    <Suspense fallback={fallback}>
      <LiveCard request={request} boxWidth={schematic.boxWidth} onMeasure={onMeasure} />
    </Suspense>
  );
};
