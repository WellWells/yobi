import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import type { FlowTemplate } from './examples';
import { FlowTemplateGallery } from './FlowTemplateGallery';
import { Z_MODAL } from '../../config/zLayers';

interface FlowTemplatesModalProps {
  open: boolean;
  t: (key: string) => string;
  onClose: () => void;
  onPick: (template: FlowTemplate) => void;
  /** Creates an empty flow. The gallery is the "new flow" page, so starting blank lives here too. */
  onBlank: () => void;
  /** Opens "Create with AI", seeded with an unmatched search (`FlowTemplateGallery`). */
  onGenerate: (seed: string) => void;
  /**
   * Mantine gives each Modal its own Escape listener, so with the setup wizard stacked on top
   * one keypress closes both and the gallery never gets to be the thing you come back to.
   */
  escapeDisabled?: boolean;
}

export const FlowTemplatesModal: React.FC<FlowTemplatesModalProps> = ({
  open, t, onClose, onPick, onBlank, onGenerate, escapeDisabled = false,
}) => {
  const [query, setQuery] = useState('');

  // A gallery that reopens still filtered to the last search looks empty for no stated reason.
  // Keyed on `open` only, so returning from the wizard keeps the search the user typed.
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  return (
    <AppModal
      opened={open}
      onClose={onClose}
      title={t('flow.newFlow')}
      icon={<Plus size={16} />}
      size="min(54rem, 90vw)"
      yOffset="8dvh"
      zIndex={Z_MODAL}
      closeOnEscape={!escapeDisabled}
    >
      <FlowTemplateGallery
        t={t}
        query={query}
        onQueryChange={setQuery}
        onPick={onPick}
        onBlank={onBlank}
        onGenerate={onGenerate}
      />
    </AppModal>
  );
};
