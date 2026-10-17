import React from 'react';
import { MonitorDown } from 'lucide-react';
import { AppModal } from '../AppModal';
import { useI18nStore } from '../../store/i18nStore';
import { useYtdlToolsStore } from '../../store/ytdlToolsStore';
import { YtdlToolsSetup } from './YtdlToolsSetup';

/**
 * Asks once, when a video download step is added and the tools are not there yet. Closing it while
 * the download runs leaves the download going; the step's own notice keeps the button.
 */
export const YtdlToolsDialog: React.FC = () => {
  const t = useI18nStore((s) => s.t);
  const opened = useYtdlToolsStore((s) => s.dialogOpen);
  const close = useYtdlToolsStore((s) => s.closeDialog);

  return (
    <AppModal
      opened={opened}
      onClose={close}
      icon={<MonitorDown size={18} />}
      title={t('ytdl.tools.title')}
      size="md"
    >
      <YtdlToolsSetup onLater={close} onReady={close} />
    </AppModal>
  );
};
