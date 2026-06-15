import React from 'react';
import { Center, Modal, NavLink, Stack, Text } from '@mantine/core';
import { ChevronRight } from 'lucide-react';
import type { FlowDefinition } from '../../../../shared/types';
import { FLOW_TEMPLATES } from './examples';
import { SKILL_ICON, skillHue } from './skills';

interface FlowTemplatesModalProps {
  open: boolean;
  t: (key: string) => string;
  onClose: () => void;
  onImport: (flows: FlowDefinition[]) => void;
}

export const FlowTemplatesModal: React.FC<FlowTemplatesModalProps> = ({
  open, t, onClose, onImport,
}) => (
  <Modal
    opened={open}
    onClose={onClose}
    title={t('agentflow.templates')}
    centered
    size="md"
    zIndex={200}
  >
    <Stack gap={4}>
      {FLOW_TEMPLATES.map((tpl) => (
        <NavLink
          key={tpl.key}
          onClick={() => { onImport([tpl.build(t)]); }}
          leftSection={
            <Center
              w={36}
              h={36}
              style={{
                flexShrink: 0,
                borderRadius: 'var(--mantine-radius-md)',
                background: `var(--mantine-color-${skillHue(tpl.primarySkill)}-light)`,
              }}
            >
              {SKILL_ICON[tpl.primarySkill]}
            </Center>
          }
          label={<Text fz="sm" fw={600}>{t(tpl.titleKey)}</Text>}
          description={
            <Text fz="xs" c="dimmed" mt={3} style={{ whiteSpace: 'normal', lineHeight: 1.5 }}>
              {t(tpl.descKey)}
            </Text>
          }
          rightSection={<ChevronRight size={16} style={{ opacity: 0.35 }} />}
          styles={{
            root: { borderRadius: 'var(--mantine-radius-md)', padding: '10px 12px' },
            section: { alignSelf: 'center' },
          }}
        />
      ))}
    </Stack>
  </Modal>
);
