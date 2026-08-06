import React, { useMemo } from 'react';
import { Badge, Center, Code, Group, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { LayoutTemplate } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { FLOW_TEMPLATES, type FlowTemplate, type TemplateCategory } from './examples';
import { SKILL_ICON, skillHue } from './skills';
import classes from './FlowTemplatesModal.module.css';
import { Z_MODAL } from '../../config/zLayers';

interface FlowTemplatesModalProps {
  open: boolean;
  t: (key: string) => string;
  onClose: () => void;
  onPick: (template: FlowTemplate) => void;
}

const CATEGORIES: { key: TemplateCategory; labelKey: string }[] = [
  { key: 'push', labelKey: 'flow.templates.category.push' },
  { key: 'command', labelKey: 'flow.templates.category.command' },
];

export const FlowTemplatesModal: React.FC<FlowTemplatesModalProps> = ({
  open, t, onClose, onPick,
}) => {
  const byCategory = useMemo(() => {
    const groups = new Map<TemplateCategory, FlowTemplate[]>();
    for (const tpl of FLOW_TEMPLATES) {
      const list = groups.get(tpl.category) ?? [];
      list.push(tpl);
      groups.set(tpl.category, list);
    }
    return groups;
  }, []);

  return (
    <AppModal
      opened={open}
      onClose={onClose}
      title={t('flow.templates')}
      icon={<LayoutTemplate size={16} />}
      size="min(60rem, 88vw)"
      yOffset="3dvh"
      zIndex={Z_MODAL}
    >
      <Stack gap="md">
        {CATEGORIES.map(({ key, labelKey }) => {
          const templates = byCategory.get(key) ?? [];
          if (templates.length === 0) return null;
          return (
            <Stack key={key} gap="xs">
              <Text fz="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.4 }}>
                {t(labelKey)}
              </Text>
              {
}
              <SimpleGrid minColWidth={180} spacing="xs" verticalSpacing="xs">
                {templates.map((tpl) => (
                  <UnstyledButton
                    key={tpl.key}
                    className={classes.tile}
                    onClick={() => { onPick(tpl); }}
                  >
                    <Stack gap={6} h="100%">
                      {
}
                      <Group gap={8} align="center" wrap="nowrap">
                        <Center
                          w={30}
                          h={30}
                          className={classes.icon}
                          style={{ background: `var(--mantine-color-${skillHue(tpl.primarySkill)}-light)` }}
                        >
                          {SKILL_ICON[tpl.primarySkill]}
                        </Center>
                        {tpl.command && (
                          <Code fz="xs" fw={600} style={{ flexShrink: 0 }}>{`/${tpl.command}`}</Code>
                        )}
                        <Text fz="sm" fw={600} lh={1.3} style={{ flex: 1, minWidth: 0 }}>
                          {t(tpl.titleKey)}
                        </Text>
                      </Group>
                      <Text fz="xs" c="dimmed" lh={1.45} className={classes.desc}>
                        {t(tpl.descKey)}
                      </Text>
                      {
}
                      <Badge
                        size="xs"
                        variant="light"
                        color={tpl.setupCount > 0 ? 'orange' : 'teal'}
                        radius="sm"
                        mt="auto"
                        style={{ alignSelf: 'flex-start' }}
                      >
                        {tpl.setupCount > 0
                          ? t('flow.templates.setup').replace('{{count}}', String(tpl.setupCount))
                          : t('flow.templates.ready')}
                      </Badge>
                    </Stack>
                  </UnstyledButton>
                ))}
              </SimpleGrid>
            </Stack>
          );
        })}
      </Stack>
    </AppModal>
  );
};
