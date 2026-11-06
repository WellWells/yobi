import React, { Fragment, useState } from 'react';
import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { Check, Sparkles } from 'lucide-react';
import { getByokTypeIcon, getModelIconByUrl } from '../../config/models';
import type { ExportNameModel, ExportNaming } from '../../../../shared/types';

interface Props {
  naming: ExportNaming;
  label: string;
  menuLabel: string;
  busy: boolean;
  onPick: (providerUrl: string) => void;
}

function iconOf(model: ExportNameModel): React.ComponentType<{ size?: number }> {
  return model.byokType ? getByokTypeIcon(model.byokType) : getModelIconByUrl(model.url);
}

/**
 * The one popup in the quick-export panel. Each click asks which model names the file, so the
 * model in use is never a guess; the one used last is ticked. Escape closes the menu only: the
 * dropdown is portalled, but React still bubbles its keys to the panel, whose Escape cancels the
 * whole export. The tooltip steps aside while the menu is open, or it sits over the menu's items.
 */
export const ExportNameButton: React.FC<Props> = ({ naming, label, menuLabel, busy, onPick }) => {
  const [opened, setOpened] = useState(false);
  return (
    <Menu position="bottom-end" offset={6} withinPortal disabled={busy} opened={opened} onChange={setOpened}>
      <Menu.Target>
        <Tooltip label={label} disabled={busy || opened}>
          <ActionIcon variant="default" size="input-sm" aria-label={label} loading={busy}>
            <Sparkles size={16} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>

      <Menu.Dropdown
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.stopPropagation();
        }}
      >
        <Menu.Label>{menuLabel}</Menu.Label>
        {naming.sections.map((section) => (
          <Fragment key={section.label ?? 'providers'}>
            {section.label && <Menu.Label>{section.label}</Menu.Label>}
            {section.models.map((model) => {
              const Icon = iconOf(model);
              const selected = model.url === naming.modelUrl;
              return (
                <Menu.Item
                  key={model.url}
                  leftSection={<Icon size={15} />}
                  rightSection={selected ? <Check size={13} color="var(--mantine-color-accent)" /> : null}
                  onClick={() => onPick(model.url)}
                >
                  {model.label}
                </Menu.Item>
              );
            })}
          </Fragment>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
};
