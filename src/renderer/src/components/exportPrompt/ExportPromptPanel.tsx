import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Copy, Link2 } from 'lucide-react';
import { AppTextInput } from '../AppTextInput';
import { AppButton } from '../AppButton';
import { AppSegmentedControl } from '../AppSegmentedControl';
import { SelectDropdown } from '../SelectDropdown';
import { ToggleSwitch } from '../ToggleSwitch';
import { PromptShell } from './PromptShell';
import { ShareConsent } from './ShareConsent';
import { captureRidesAsFile } from '../../../../shared/types';
import type {
  ExportPromptChoice, ExportPromptPayload, QuickExportFormat, ShareExpire,
} from '../../../../shared/types';

const CAPTURE_FORMATS: { value: QuickExportFormat; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WEBP' },
  { value: 'pdf', label: 'PDF' },
];

interface Props {
  payload: ExportPromptPayload;
  onSubmit: (choice: ExportPromptChoice) => void;
  onCancel: () => void;
  onHeight: (height: number) => void;
}

export const ExportPromptPanel: React.FC<Props> = ({ payload, onSubmit, onCancel, onHeight }) => {
  const share = payload.share;
  const shareStrings = payload.strings.share;

  const [name, setName] = React.useState(payload.defaultName);
  const [format, setFormat] = React.useState<QuickExportFormat>(payload.format);
  const [zip, setZip] = React.useState(payload.zip);
  const [width, setWidth] = React.useState(payload.width);
  const [expire, setExpire] = React.useState<ShareExpire>(share.expire);
  const [burn, setBurn] = React.useState(share.burnAfterReading);
  const [consented, setConsented] = React.useState(share.consented);
  const [consentAccepted, setConsentAccepted] = React.useState(false);
  const [asking, setAsking] = React.useState(payload.format === 'text' && !share.consented);
  const [lastCaptureFormat, setLastCaptureFormat] = React.useState<QuickExportFormat>(
    payload.format === 'text' ? 'png' : payload.format,
  );
  const [busy, setBusy] = React.useState(false);

  const sizeOptions = React.useMemo(
    () => payload.sizes.map((size) => ({ value: String(size.value), label: size.label })),
    [payload.sizes],
  );
  const formatOptions = React.useMemo(
    () => [...CAPTURE_FORMATS, { value: 'text' as QuickExportFormat, label: shareStrings.format }],
    [shareStrings.format],
  );

  const sharing = format === 'text';
  const named = !sharing && captureRidesAsFile(format, zip);
  const extension = zip ? 'zip' : format;
  const trimmed = name.trim();
  const ready = !busy && (sharing || !named || trimmed.length > 0);

  const pickFormat = (next: QuickExportFormat): void => {
    if (next !== 'text') setLastCaptureFormat(next);
    setFormat(next);
    /* The gate has to live here: the panel has no IPC, so main cannot ask on its behalf. */
    if (next === 'text' && !consented) setAsking(true);
  };

  /* Backing out of the gate returns to the format you were on — it does not close the panel. */
  const declineConsent = (): void => { setFormat(lastCaptureFormat); setAsking(false); };

  const submit = (): void => {
    if (!ready) return;
    setBusy(true);
    if (format === 'text') {
      onSubmit({ kind: 'share', expire, burnAfterReading: burn, consentAccepted });
      return;
    }
    onSubmit({ kind: 'capture', fileName: trimmed, format, zip, width });
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
    <PromptShell title={payload.strings.title} onHeight={onHeight} onEscape={onCancel} onEnter={submit}>
      <AppSegmentedControl
        value={format}
        options={formatOptions}
        onChange={(value) => pickFormat(value as QuickExportFormat)}
        size="sm"
      />

      {sharing ? (
        <>
          <Group justify="space-between" wrap="nowrap" gap={12}>
            <Text fz="var(--font-size-sm)" c="dimmed">{shareStrings.instance}</Text>
            <Text fz="var(--font-size-sm)" c="dimmed" ff="var(--font-mono)">{share.instanceHost}</Text>
          </Group>

          <Stack gap={6}>
            <Text fz="var(--font-size-sm)" c="dimmed">{shareStrings.expire}</Text>
            {/* The window is a fixed 440×~285: eight options at full height would be clipped by it. */}
            <SelectDropdown
              value={expire}
              options={share.expires}
              onChange={(value) => setExpire(value as ShareExpire)}
              size="sm"
              maxDropdownHeight={150}
            />
          </Stack>

          <Group justify="space-between" wrap="nowrap" gap={12}>
            <Text fz="var(--font-size-sm)" c="var(--mantine-color-text)">{shareStrings.burn}</Text>
            <ToggleSwitch size="sm" checked={burn} onChange={(event) => setBurn(event.currentTarget.checked)} />
          </Group>
        </>
      ) : (
        <>
          <Stack gap={6}>
            <Text fz="var(--font-size-sm)" c="dimmed">{payload.strings.fileName}</Text>
            <AppTextInput
              value={name}
              disabled={!named}
              onChange={(event) => setName(event.currentTarget.value)}
              spellCheck={false}
              ref={(node) => {
                if (node && document.activeElement !== node) { node.focus(); node.select(); }
              }}
              rightSection={
                <Text fz="var(--font-size-sm)" c="var(--text-muted)" pr={4}>{`.${extension}`}</Text>
              }
              rightSectionWidth={56}
            />
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
        {/* AppButton keeps the spinner beside the label instead of centred over it. */}
        <AppButton
          leftSection={sharing ? <Link2 size={14} /> : <Copy size={14} />}
          loading={busy}
          disabled={!ready}
          onClick={submit}
        >
          {sharing
            ? (busy ? shareStrings.creating : shareStrings.create)
            : payload.strings.copy}
        </AppButton>
      </Group>
    </PromptShell>
  );
};
