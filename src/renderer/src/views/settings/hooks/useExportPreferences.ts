import { useCallback, useEffect } from 'react';
import { useExportSettingsStore } from '../../../store/exportSettingsStore';
import { clampCaptureMargin } from '../../../../../shared/types';
import type { CardLayout } from '../../../../../shared/types';
import type { CaptureBackgroundStyle } from '../../../../../shared/capturePalettes';

export function useExportPreferences() {
  const capture = useExportSettingsStore((s) => s.capture);
  const patchCapture = useExportSettingsStore((s) => s.patchCapture);
  const load = useExportSettingsStore((s) => s.load);

  useEffect(() => { void load(); }, [load]);

  return {
    palette: capture.palette,
    setPalette: useCallback((palette: string) => patchCapture({ palette }), [patchCapture]),
    backgroundStyle: capture.backgroundStyle as CaptureBackgroundStyle,
    setBackgroundStyle: useCallback(
      (backgroundStyle: CaptureBackgroundStyle) => patchCapture({ backgroundStyle }),
      [patchCapture],
    ),
    direction: capture.direction,
    setDirection: useCallback((direction: string) => patchCapture({ direction }), [patchCapture]),
    cardLayout: capture.cardLayout,
    setCardLayout: useCallback((cardLayout: CardLayout) => patchCapture({ cardLayout }), [patchCapture]),
    width: capture.width,
    setWidth: useCallback((width: number) => patchCapture({ width }), [patchCapture]),
    margin: clampCaptureMargin(capture.margin),
    setMargin: useCallback((margin: number) => patchCapture({ margin }), [patchCapture]),
    hiDpi: capture.pixelRatio === 2,
    setHiDpi: useCallback((on: boolean) => patchCapture({ pixelRatio: on ? 2 : 1 }), [patchCapture]),
  };
}
