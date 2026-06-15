import React, { useCallback, useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { Download, Link } from 'lucide-react';
import { AppTextInput } from '../../components/AppTextInput';
import { AppButton } from '../../components/AppButton';
import { systemApi } from '../../api/electronApi';
import type { FlowDefinition } from '../../../../shared/types';
import { parseImportedFlows } from './flowImportParser';

interface FlowImportModalProps {
  open: boolean;
  t: (key: string) => string;
  onClose: () => void;
  onImport: (flows: FlowDefinition[]) => void;
}

export const FlowImportModal: React.FC<FlowImportModalProps> = ({
  open, t, onClose, onImport,
}) => {
  const [urlValue, setUrlValue] = useState('');
  const [urlError, setUrlError] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [fileError, setFileError] = useState('');

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

  const handleFilePick = useCallback(async () => {
    setFileError('');
    const picked = await systemApi.selectPath({
      mode: 'file',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      readContent: true,
    });
    if (!picked) return;
    if (picked.content === undefined) {
      setFileError(t('agentflow.import.file.error'));
      return;
    }
    try {
      const raw: unknown = JSON.parse(picked.content);
      const flows = parseImportedFlows(raw);
      if (flows && flows.length > 0) {
        onImport(flows);
      } else {
        setFileError(t('agentflow.import.file.error'));
      }
    } catch {
      setFileError(t('agentflow.import.file.error'));
    }
  }, [onImport, t]);

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
        <Stack gap="xs">
          <Text fz="sm" fw={600}>{t('agentflow.import.file.label')}</Text>
          <Button
            variant="default"
            leftSection={<Download size={14} />}
            onClick={() => { void handleFilePick(); }}
            fullWidth
          >
            {t('agentflow.import.file.button')}
          </Button>
          {fileError && <Text fz="xs" c="red">{fileError}</Text>}
        </Stack>

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
            <AppButton
              variant="filled"
              size="xs"
              loading={urlLoading}
              disabled={!urlValue.trim()}
              onClick={() => { void handleUrlImport(); }}
            >
              {t('agentflow.import.url.fetch')}
            </AppButton>
          </Group>
        </Stack>
      </Stack>
    </Modal>
  );
};
