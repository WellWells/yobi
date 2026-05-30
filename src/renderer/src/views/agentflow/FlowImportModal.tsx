// src/renderer/src/views/agentflow/FlowImportModal.tsx
// Modal for importing flows from a URL or a local JSON file via file input.
import React, { useCallback, useRef, useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { Download, Link } from 'lucide-react';
import { AppTextInput } from '../../components/AppTextInput';
import type { FlowDefinition } from '../../../../shared/types';
import { parseImportedFlows } from './flowImportParser';

interface FlowImportModalProps {
  open: boolean;
  t: (key: string) => string;
  existingFlowNames: string[];
  onClose: () => void;
  onImport: (flows: FlowDefinition[]) => void;
}

export const FlowImportModal: React.FC<FlowImportModalProps> = ({
  open, t, onClose, onImport,
}) => {
  const [urlValue, setUrlValue] = useState('');
  const [urlError, setUrlError] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUrlImport = useCallback(async () => {
    const url = urlValue.trim();
    if (!url) return;
    setUrlError('');
    setUrlLoading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        setUrlError(t('agentflow.import.url.error.fetch'));
        return;
      }
      const raw: unknown = await res.json();
      const flows = parseImportedFlows(raw);
      if (!flows || flows.length === 0) {
        setUrlError(t('agentflow.import.url.error.invalid'));
        return;
      }
      onImport(flows);
      setUrlValue('');
    } catch {
      setUrlError(t('agentflow.import.url.error.fetch'));
    } finally {
      setUrlLoading(false);
    }
  }, [urlValue, t, onImport]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const raw: unknown = JSON.parse(evt.target?.result as string);
        const flows = parseImportedFlows(raw);
        if (flows && flows.length > 0) {
          onImport(flows);
        }
      } catch {
        // Silently ignore malformed JSON
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  }, [onImport]);

  return (
    <Modal
      opened={open}
      onClose={onClose}
      title={t('agentflow.import')}
      centered
      size="sm"
      zIndex={200}
    >
      <Stack gap="md">
        {/* File import */}
        <Stack gap="xs">
          <Text fz="sm" fw={600}>{t('agentflow.import.file.label')}</Text>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <Button
            variant="default"
            leftSection={<Download size={14} />}
            onClick={() => fileInputRef.current?.click()}
            fullWidth
          >
            {t('agentflow.import.file.button')}
          </Button>
        </Stack>

        {/* URL import */}
        <Stack gap="xs">
          <Text fz="sm" fw={600}>{t('agentflow.import.url.label')}</Text>
          <AppTextInput
            value={urlValue}
            onChange={(e) => { setUrlValue(e.currentTarget.value); setUrlError(''); }}
            placeholder={t('agentflow.import.url.placeholder')}
            leftSection={<Link size={14} />}
            error={urlError || undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !urlLoading) void handleUrlImport();
            }}
          />
          <Group justify="flex-end">
            <Button
              variant="filled"
              size="xs"
              loading={urlLoading}
              disabled={!urlValue.trim()}
              onClick={() => { void handleUrlImport(); }}
            >
              {t('agentflow.import.url.fetch')}
            </Button>
          </Group>
        </Stack>
      </Stack>
    </Modal>
  );
};
