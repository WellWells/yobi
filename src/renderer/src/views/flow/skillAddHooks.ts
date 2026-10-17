import type { SkillType } from '../../../../shared/types';
import { useYtdlToolsStore } from '../../store/ytdlToolsStore';

/**
 * What adding a step of a given skill does beyond adding it. Only skills that cannot run until the
 * user sets something up belong here, and only when that setup is best offered right away.
 */
const SKILL_ADD_HOOKS: Partial<Record<SkillType, () => void>> = {
  youtube_download: () => {
    void useYtdlToolsStore.getState().promptIfMissing().catch(() => {});
  },
};

export function runSkillAddHook(type: SkillType): void {
  SKILL_ADD_HOOKS[type]?.();
}
