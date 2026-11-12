import { useCallback, useEffect, useState } from 'react';
import { skillsApi } from '../../../api/electronApi';
import type { AgentSkillView } from '../../../../../shared/agentSkills';

/** The installed Agent Skills, kept current by main's change broadcast (imports, edits, restores). */
export function useAgentSkills() {
  const [skills, setSkills] = useState<AgentSkillView[] | null>(null);

  useEffect(() => {
    let live = true;
    void skillsApi.list().then((list) => { if (live) setSkills(list); });
    const off = skillsApi.onChanged((list) => setSkills(list));
    return () => {
      live = false;
      off();
    };
  }, []);

  const setEnabled = useCallback(async (name: string, enabled: boolean) => {
    setSkills((current) => current?.map((skill) => (skill.name === name ? { ...skill, enabled } : skill)) ?? current);
    setSkills(await skillsApi.setEnabled(name, enabled));
  }, []);

  const remove = useCallback(async (name: string) => {
    setSkills(await skillsApi.remove(name));
  }, []);

  return { skills, setEnabled, remove };
}
