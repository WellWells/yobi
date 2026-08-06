/*
 * Façade. The skill schema was one 646-line file holding three unrelated things: the specs, the
 * prompt rendering, and the per-skill lore. They are now separate modules so the prompt layer
 * can disclose them in tiers, but every existing import path keeps working through here.
 *
 *   ./flowSkillSpecs   — what a skill IS (config shape, output contract, tier-1 brief)
 *   ./flowSkillNotes   — what goes WRONG with it (tier 3, disclosed per selection)
 *   ./flowSkillPrompt  — how the two are rendered into the generation prompts
 */
export type { SkillConfigField, SkillSpec } from './flowSkillSpecs';
export {
  BRIEF_MAX_CHARS,
  DEFAULT_SKILL_CONFIG,
  LEGACY_SKILL_TYPES,
  SKILL_OUTPUT,
  SKILL_SPECS,
  SKILL_TYPES,
  SKILLS_WITHOUT_OUTPUT_KEY,
  canonicalSkillType,
} from './flowSkillSpecs';

export { NOTE_MAX_CHARS, SKILL_NOTES } from './flowSkillNotes';

export {
  ALWAYS_INCLUDED_SKILLS,
  MAX_SELECTED_SKILLS,
  TRIGGER_BRIEFS,
  buildFlowAssessPrompt,
  buildFlowGenerationPrompt,
  buildFlowRepairPrompt,
  buildSkillIndex,
  renderSkillBrief,
  renderSkillLine,
  resolveSelectedSkills,
} from './flowSkillPrompt';
