import React from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { FolderOpen } from 'lucide-react';
import { systemApi } from '../api/electronApi';
import { AppTextInput } from './AppTextInput';
import type { AppInputTone } from './inputStyles';

interface PathInputProps {
  value: string;
  onChange: (value: string) => void;
  mode?: 'file' | 'folder';
  filters?: { name: string; extensions: string[] }[];
  browseLabel: string;
  label?: string;
  placeholder?: string;
  description?: string;
  error?: string;
  size?: string;
  tone?: AppInputTone;
  disabled?: boolean;
}

export const PathInput: React.FC<PathInputProps> = ({
  value, onChange, mode = 'file', filters, browseLabel,
  label, placeholder, description, error, size = 'sm', tone, disabled,
}) => {
  const handleBrowse = async () => {
    const picked = await systemApi.selectPath({ mode, filters });
    if (picked) onChange(picked.path);
  };

  return (
    <AppTextInput
      label={label}
      placeholder={placeholder}
      description={description}
      error={error}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      size={size}
      mono
      tone={tone}
      disabled={disabled}
      rightSectionPointerEvents="all"
      rightSection={(
        <Tooltip label={browseLabel} position="top">
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => void handleBrowse()}
            aria-label={browseLabel}
            disabled={disabled}
          >
            <FolderOpen size={15} />
          </ActionIcon>
        </Tooltip>
      )}
    />
  );
};
