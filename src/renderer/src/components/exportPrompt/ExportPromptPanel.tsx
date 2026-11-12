import React from 'react';
import { Alert, Box, Group, Stack, Text } from '@mantine/core';
import { PaletteSwatch } from '../capture/PalettePicker';
import { CardSchematic } from './CardSchematic';
import { ExpirySlider } from './ExpirySlider';
import { MarginSlider } from '../capture/MarginSlider';
import { Copy, Link2, Save, TriangleExclamationPoint } from 'lucide-react';
import { AppTextInput } from '../AppTextInput';
import { AppButton } from '../AppButton';
import { AppSegmentedControl } from '../AppSegmentedControl';
import { ToggleSwitch } from '../ToggleSwitch';
import { PromptShell } from './PromptShell';
import { ShareConsent } from './ShareConsent';
import { ExportNameButton } from './ExportNameButton';
import { clampCaptureMargin } from '../../../../shared/types';
import { CAPTURE_PALETTES } from '../../../../shared/capturePalettes';
import type { CaptureBackgroundStyle, CaptureDirection } from '../../../../shared/capturePalettes';
import type {
  CaptureExportAction, ExportNameResult, ExportPromptChoice, ExportPromptPayload, PanelHeight, QuickExportFormat,
  ShareExpire,
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
    onSubmit({ kind: 'capture', fileName: trimmed, format, zip, width, margin, palette, backgroundStyle, action });
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
            <ToggleSwitch size="sm" checked={burn} onChange={(event) => setBurn(event.currentTarget.checked)} />
          </Group>
        </>
      ) : (
        <>
          <Group align="stretch" gap={12} wrap="nowrap">
            <Stack gap={10} flex={1} miw={0} onMouseLeave={() => setHoveredPalette(null)}>
              <Stack gap={6}>
                <Group justify="space-between" wrap="nowrap" gap={8}>
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
            </Stack>

            <Box w={PREVIEW_WIDTH} style={{ flexShrink: 0 }}>
              <CardSchematic
                palette={hoveredPalette ?? palette}
                backgroundStyle={backgroundStyle}
                direction={payload.direction as CaptureDirection}
                width={width}
                margin={margin}
                boxWidth={PREVIEW_WIDTH}
              />
            </Box>
          </Group>

          <Stack gap={6}>
            <Text fz="var(--font-size-sm)" c="dimmed">{payload.strings.fileName}</Text>
            <Group gap={8} wrap="nowrap" align="flex-start">
              <AppTextInput
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
              <Text fz="var(--font-size-sm)" c="var(--mantine-color-error)" style={{ wordBreak: 'break-word' }}>
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
            <ToggleSwitch size="sm" checked={zip} onChange={(event) => setZip(event.currentTarget.checked)} />
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
