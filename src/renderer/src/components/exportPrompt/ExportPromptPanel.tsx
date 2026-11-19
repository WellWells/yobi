import React from 'react';
import { Alert, Box, Group, Stack, Text } from '@mantine/core';
import { PaletteSwatch } from '../capture/PalettePicker';
import { CardPreview } from './CardPreview';
import { ExpirySlider } from './ExpirySlider';
import { MarginSlider } from '../capture/MarginSlider';
import { CardOpacitySlider } from '../capture/CardOpacitySlider';
import { Copy, Link2, Save, TriangleExclamationPoint } from 'lucide-react';
import { AppTextInput } from '../AppTextInput';
import { AppButton } from '../AppButton';
import { AppSegmentedControl } from '../AppSegmentedControl';
import { ToggleSwitch } from '../ToggleSwitch';
import { PromptShell } from './PromptShell';
import { ShareConsent } from './ShareConsent';
import { ExportNameButton } from './ExportNameButton';
import {
  captureTooTallNotice, checkCaptureHeight, clampCaptureMargin, clampCardOpacity,
} from '../../../../shared/types';
import { CAPTURE_PALETTES } from '../../../../shared/capturePalettes';
import type { CaptureBackgroundStyle, CaptureDirection } from '../../../../shared/capturePalettes';
import { documentCardRequest } from '../../../../shared/captureCard';
import type {
  CaptureExportAction, ExportNameResult, ExportPromptChoice, ExportPromptPayload, MarkdownCaptureRequest, PanelHeight,
  QuickExportFormat, ShareExpire,
} from '../../../../shared/types';

const CAPTURE_FORMATS: { value: QuickExportFormat; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WEBP' },
  { value: 'pdf', label: 'PDF' },
];

const PREVIEW_WIDTH = 150;

interface Props {
  payload: ExportPromptPayload;
  onSubmit: (choice: ExportPromptChoice) => void;
  onCancel: () => void;
  onHeight: (height: PanelHeight) => void;
  onRequestName: (providerUrl: string) => Promise<ExportNameResult>;
}

export const ExportPromptPanel: React.FC<Props> = ({ payload, onSubmit, onCancel, onHeight, onRequestName }) => {
  const share = payload.share;
  const shareStrings = payload.strings.share;

  const [name, setName] = React.useState(payload.defaultName);
  const [format, setFormat] = React.useState<QuickExportFormat>(payload.format);
  const [zip, setZip] = React.useState(payload.zip);
  const [width, setWidth] = React.useState(payload.width);
  const [palette, setPalette] = React.useState(payload.palette);
  const [backgroundStyle, setBackgroundStyle] = React.useState<CaptureBackgroundStyle>(payload.backgroundStyle);
  const [margin, setMargin] = React.useState(clampCaptureMargin(payload.margin));
  const [cardOpacity, setCardOpacity] = React.useState(clampCardOpacity(payload.cardOpacity));
  const [cardHeight, setCardHeight] = React.useState(0);
  const [nameModelUrl, setNameModelUrl] = React.useState(payload.naming?.modelUrl ?? '');
  const [naming, setNaming] = React.useState(false);
  const [nameError, setNameError] = React.useState('');
  const [hoveredPalette, setHoveredPalette] = React.useState<string | null>(null);
  const [expire, setExpire] = React.useState<ShareExpire>(share.expire);
  const [burn, setBurn] = React.useState(share.burnAfterReading);
  const [consented, setConsented] = React.useState(share.consented);
  const [consentAccepted, setConsentAccepted] = React.useState(false);
  const [asking, setAsking] = React.useState(payload.format === 'text' && !share.consented);
  const [lastCaptureFormat, setLastCaptureFormat] = React.useState<QuickExportFormat>(
    payload.format === 'text' ? 'png' : payload.format,
  );
  const [pending, setPending] = React.useState<CaptureExportAction | 'share' | null>(null);
  const busy = pending !== null;

  const sizeOptions = React.useMemo(
    () => payload.sizes.map((size) => ({ value: String(size.value), label: size.label })),
    [payload.sizes],
  );
  const formatOptions = React.useMemo(
    () => [...CAPTURE_FORMATS, { value: 'text' as QuickExportFormat, label: shareStrings.format }],
    [shareStrings.format],
  );

  const sharing = format === 'text';
  const named = !sharing;
  const extension = zip ? 'zip' : format;
  const trimmed = name.trim();
  const ready = !busy && (sharing || !named || trimmed.length > 0);

  // The card main will render, drawn for real in the preview. The format is not part of it: the
  // card looks the same in all three, so switching format does not redraw the preview.
  const shownPalette = hoveredPalette ?? palette;
  const previewRequest = React.useMemo<MarkdownCaptureRequest | null>(() => {
    const preview = payload.preview;
    if (!preview) return null;
    const look = {
      palette: shownPalette, backgroundStyle, direction: payload.direction, width, margin, cardOpacity,
      pixelRatio: payload.pixelRatio,
    };
    return {
      ...documentCardRequest(preview.payload, look, { format: 'png', zip: false, action: 'copy' }),
      markdownLabels: preview.markdownLabels,
      readingFont: preview.readingFont,
    };
  }, [payload.preview, payload.direction, payload.pixelRatio, shownPalette, backgroundStyle, width, margin, cardOpacity]);

  // The capture's own height guard, run on the preview's measurement: warned here, before the
  // export, instead of after a render that came back too tall. Main still checks for itself.
  const imageFormat = format === 'png' || format === 'webp' ? format : null;
  const verdict = imageFormat && cardHeight > 0
    ? checkCaptureHeight(imageFormat, cardHeight, payload.pixelRatio, width)
    : null;
  const tooTallWarning = verdict && !verdict.ok && imageFormat
    ? captureTooTallNotice(verdict, imageFormat, payload.strings.tooTall)
    : '';
  const outputSize = imageFormat && cardHeight > 0
    ? `${width * payload.pixelRatio} × ${Math.ceil(cardHeight * payload.pixelRatio)} px`
    : '';

  const pickFormat = (next: QuickExportFormat): void => {
    if (next !== 'text') setLastCaptureFormat(next);
    setFormat(next);
    if (next === 'text' && !consented) setAsking(true);
  };

  const declineConsent = (): void => { setFormat(lastCaptureFormat); setAsking(false); };

  const submit = (action: CaptureExportAction = 'copy'): void => {
    if (!ready) return;
    if (format === 'text') {
      setPending('share');
      onSubmit({ kind: 'share', expire, burnAfterReading: burn, consentAccepted });
      return;
    }
    setPending(action);
    onSubmit({
      kind: 'capture', fileName: trimmed, format, zip, width, margin, cardOpacity, palette, backgroundStyle, action,
    });
  };

  const suggestName = async (providerUrl: string): Promise<void> => {
    setNameModelUrl(providerUrl);
    setNameError('');
    setNaming(true);
    const result = await onRequestName(providerUrl);
    setNaming(false);
    if ('name' in result) setName(result.name);
    else setNameError(result.error);
  };

  if (asking) {
    return (
      <PromptShell title={payload.strings.title} onHeight={onHeight} onEscape={declineConsent}>
        <ShareConsent
          share={share}
          strings={shareStrings}
          cancelLabel={payload.strings.cancel}
          onAccept={() => { setConsented(true); setConsentAccepted(true); setAsking(false); }}
          onCancel={declineConsent}
        />
      </PromptShell>
    );
  }

  return (
    <PromptShell title={payload.strings.title} onHeight={onHeight} onEscape={onCancel} onEnter={() => submit('copy')}>
      <AppSegmentedControl
        value={format}
        options={formatOptions}
        onChange={(value) => pickFormat(value as QuickExportFormat)}
        size="sm"
      />

      {payload.notice && (
        <Alert color="var(--mantine-color-error)" variant="light" icon={<TriangleExclamationPoint size={16} />}>
          <Text fz="var(--font-size-sm)" style={{ wordBreak: 'break-word' }}>{payload.notice}</Text>
        </Alert>
      )}

      {sharing ? (
        <>
          <Group justify="space-between" wrap="nowrap" gap={12}>
            <Text fz="var(--font-size-sm)" c="dimmed">{shareStrings.instance}</Text>
            <Text fz="var(--font-size-sm)" c="dimmed" ff="var(--font-mono)">{share.instanceHost}</Text>
          </Group>

          <ExpirySlider
            label={shareStrings.expire}
            options={share.expires}
            value={expire}
            onChange={setExpire}
          />

          <Group justify="space-between" wrap="nowrap" gap={12}>
            <Text fz="var(--font-size-sm)" c="var(--mantine-color-text)">{shareStrings.burn}</Text>
            <ToggleSwitch size="sm" aria-label={shareStrings.burn} checked={burn} onChange={(event) => setBurn(event.currentTarget.checked)} />
          </Group>
        </>
      ) : (
        <>
          <Group align="stretch" gap={12} wrap="wrap">
            <Stack gap={10} style={{ flex: '1 1 14rem' }} miw={0} onMouseLeave={() => setHoveredPalette(null)}>
              <Stack gap={6}>
                <Group justify="space-between" wrap="wrap" gap={8}>
                  <Text fz="var(--font-size-sm)" c="dimmed" style={{ flexShrink: 0 }}>{payload.strings.theme}</Text>
                  <AppSegmentedControl
                    value={backgroundStyle}
                    options={payload.backgroundStyles}
                    onChange={(value) => setBackgroundStyle(value as CaptureBackgroundStyle)}
                    fullWidth={false}
                    size="xs"
                  />
                </Group>
                <Group gap={5} wrap="wrap">
                  {CAPTURE_PALETTES.map((item) => (
                    <PaletteSwatch
                      key={item.key}
                      palette={item}
                      active={palette === item.key}
                      style={backgroundStyle}
                      direction={payload.direction as CaptureDirection}
                      size={24}
                      onSelect={setPalette}
                      onHover={setHoveredPalette}
                    />
                  ))}
                </Group>
              </Stack>

              <Stack gap={2} mt="auto">
                <Text fz="var(--font-size-sm)" c="dimmed">{payload.strings.margin}</Text>
                <MarginSlider value={margin} onChange={setMargin} label={payload.strings.margin} />
              </Stack>
              <Stack gap={2}>
                <Text fz="var(--font-size-sm)" c="dimmed">{payload.strings.cardOpacity}</Text>
                <CardOpacitySlider value={cardOpacity} onChange={setCardOpacity} label={payload.strings.cardOpacity} />
              </Stack>
            </Stack>

            <Stack w={PREVIEW_WIDTH} gap={4} style={{ flexShrink: 0 }}>
              <Box style={{ flex: '1 1 0', minHeight: 0 }}>
                <CardPreview
                  request={previewRequest}
                  onMeasure={setCardHeight}
                  palette={shownPalette}
                  backgroundStyle={backgroundStyle}
                  direction={payload.direction as CaptureDirection}
                  width={width}
                  margin={margin}
                  cardOpacity={cardOpacity}
                  boxWidth={PREVIEW_WIDTH}
                />
              </Box>
              {outputSize && (
                <Text
                  fz="var(--font-size-xs)"
                  c={tooTallWarning ? 'var(--warning-text)' : 'var(--text-muted)'}
                  ta="center"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {outputSize}
                </Text>
              )}
            </Stack>
          </Group>

          {tooTallWarning && (
            <Text fz="var(--font-size-sm)" c="var(--warning-text)" style={{ wordBreak: 'break-word' }}>
              {tooTallWarning}
            </Text>
          )}

          <Stack gap={6}>
            <Text fz="var(--font-size-sm)" c="dimmed">{payload.strings.fileName}</Text>
            <Group gap={8} wrap="nowrap" align="flex-start">
              <AppTextInput
                aria-label={payload.strings.fileName}
                flex={1}
                miw={0}
                value={name}
                disabled={!named}
                onChange={(event) => { setName(event.currentTarget.value); setNameError(''); }}
                spellCheck={false}
                ref={(node) => {
                  if (node && document.activeElement !== node) { node.focus(); node.select(); }
                }}
                rightSection={
                  <Text fz="var(--font-size-sm)" c="var(--text-muted)" pr={4}>{`.${extension}`}</Text>
                }
                rightSectionWidth={56}
              />
              {payload.naming && payload.naming.sections.length > 0 && (
                <ExportNameButton
                  naming={{ ...payload.naming, modelUrl: nameModelUrl }}
                  label={payload.strings.aiName}
                  menuLabel={payload.strings.aiNameMenu}
                  busy={naming}
                  onPick={(providerUrl) => { void suggestName(providerUrl); }}
                />
              )}
            </Group>
            {nameError && (
              <Text fz="var(--font-size-sm)" c="var(--error-text)" style={{ wordBreak: 'break-word' }}>
                {nameError}
              </Text>
            )}
          </Stack>

          <Stack gap={6}>
            <Text fz="var(--font-size-sm)" c="dimmed">{payload.strings.size}</Text>
            <AppSegmentedControl
              value={String(width)}
              options={sizeOptions}
              onChange={(value) => setWidth(Number(value))}
              size="sm"
            />
          </Stack>

          <Group justify="space-between" wrap="nowrap" gap={12}>
            <Text fz="var(--font-size-sm)" c="var(--mantine-color-text)">{payload.strings.zip}</Text>
            <ToggleSwitch size="sm" aria-label={payload.strings.zip} checked={zip} onChange={(event) => setZip(event.currentTarget.checked)} />
          </Group>
        </>
      )}

      <Group gap={8} justify="flex-end" mt={2}>
        <AppButton variant="subtle" color="gray" disabled={busy} onClick={onCancel}>
          {payload.strings.cancel}
        </AppButton>
        {!sharing && (
          <AppButton
            variant="outline"
            leftSection={<Save size={14} />}
            loading={pending === 'save'}
            disabled={!ready}
            onClick={() => submit('save')}
          >
            {payload.strings.save}
          </AppButton>
        )}
        <AppButton
          leftSection={sharing ? <Link2 size={14} /> : <Copy size={14} />}
          loading={pending === 'copy' || pending === 'share'}
          disabled={!ready}
          onClick={() => submit('copy')}
        >
          {sharing
            ? (busy ? shareStrings.creating : shareStrings.create)
            : payload.strings.copy}
        </AppButton>
      </Group>
    </PromptShell>
  );
};
