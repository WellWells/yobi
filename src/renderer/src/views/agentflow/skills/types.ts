import type React from 'react';
import type { SkillInstance, SkillType } from '../../../../../shared/types';

export interface SkillConfigProps {
  step: SkillInstance;
  onChange: (config: Record<string, string>) => void;
  t: (k: string) => string;
}

export type SkillConfigEditor = React.FC<SkillConfigProps>;
export type SkillConfigEditorMap = Record<SkillType, SkillConfigEditor>;
