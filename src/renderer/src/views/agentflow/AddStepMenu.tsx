import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Divider, NavLink, Popover, Stack, Text } from '@mantine/core';
import { Plus, Search } from 'lucide-react';
import { AppTextInput } from '../../components/AppTextInput';
import { SKILL_ICON } from './skills';
import { buildSkillGroups, filterSkillGroups, flattenSkillGroups } from './skillCatalog';
import type { SkillType } from '../../../../shared/types';
import styles from './AddStepMenu.module.css';

export interface AddStepMenuProps {
  position?: 'top' | 'bottom';
  t: (k: string) => string;
  onAdd: (type: SkillType) => void;
}

export const AddStepMenu: React.FC<AddStepMenuProps> = ({ position = 'bottom', t, onAdd }) => {
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  const allGroups = useMemo(() => buildSkillGroups(t), [t]);
  const groups = useMemo(() => filterSkillGroups(allGroups, query), [allGroups, query]);
  const visible = useMemo(() => flattenSkillGroups(groups), [groups]);

  useEffect(() => {
    if (!opened) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [opened]);

  const select = (type: SkillType) => {
    onAdd(type);
    setOpened(false);
  };

  const moveActive = (delta: number) => {
    if (visible.length === 0) return;
    const next = (activeIndex + delta + visible.length) % visible.length;
    setActiveIndex(next);
    itemRefs.current[visible[next].type]?.scrollIntoView({ block: 'nearest' });
  };

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const type = visible[activeIndex]?.type;
      if (type) select(type);
    } else if (e.key === 'Escape') {
      setOpened(false);
    }
  };

  return (
    <Popover opened={opened} onChange={setOpened} position={position} width={360} withArrow shadow="md" trapFocus>
      <Popover.Target>
        <Button
          variant={position === 'top' ? 'light' : 'default'}
          size="sm"
          leftSection={<Plus size={14} />}
          fullWidth={position === 'bottom'}
          style={position === 'bottom' ? { borderStyle: 'dashed' } : undefined}
          onClick={() => setOpened((o) => !o)}
        >
          {t('agentflow.addStep')}
        </Button>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Stack gap={0}>
          <Box p={6}>
            <AppTextInput
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.currentTarget.value);
                setActiveIndex(0);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder={t('agentflow.skillSearch.placeholder')}
              leftSection={<Search size={14} />}
            />
          </Box>
          <Divider />
          <Box className={styles.scroll}>
            {visible.length === 0 ? (
              <Text size="xs" c="dimmed" ta="center" py="md">
                {t('agentflow.skillSearch.noMatch')}
              </Text>
            ) : (
              <Stack gap={2} p={6}>
                {groups.map((group) => (
                  <Box key={group.category}>
                    <Text
                      size="xs"
                      fw={700}
                      c="dimmed"
                      px={8}
                      py={4}
                      style={{ letterSpacing: '0.5px', textTransform: 'uppercase' }}
                    >
                      {group.category}
                    </Text>
                    {group.items.map((skill) => {
                      const idx = visible.findIndex((v) => v.type === skill.type);
                      const active = idx === activeIndex;
                      return (
                        <NavLink
                          key={skill.type}
                          ref={(el) => {
                            itemRefs.current[skill.type] = el;
                          }}
                          active={active}
                          onClick={() => select(skill.type)}
                          onMouseEnter={() => setActiveIndex(idx)}
                          leftSection={SKILL_ICON[skill.type]}
                          label={skill.name}
                          description={skill.desc}
                          styles={{ root: { borderRadius: 'var(--mantine-radius-md)' } }}
                        />
                      );
                    })}
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
          <Divider />
          <Text size="xs" c="dimmed" ta="center" py={4}>
            {t('agentflow.skillSearch.hint')}
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};
