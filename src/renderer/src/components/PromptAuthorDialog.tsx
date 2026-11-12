import { useEffect, useRef, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Sparkles } from 'lucide-react';
import { draftVariableChanges, FLOW_DRAFT_KINDS, unknownDraftVariables } from '../../../shared/promptAuthor';
import type { PromptAuthorKind, PromptDraftContext, PromptDraftVariable } from '../../../shared/promptAuthor';
import { fillTemplate } from '../../../shared/fillTemplate';
import { settingsApi } from '../api/electronApi';
import { useProviderModels } from '../hooks/useProviderModels';
import { PROVIDER_DROPDOWN_MAX_HEIGHT, providerSectionsToSelectData } from '../config/models';
import { Z_MODAL } from '../config/zLayers';
import { AppModal } from './AppModal';
import { SelectDropdown } from './SelectDropdown';
import { AppButton } from './AppButton';
import { AppTextarea } from './AppTextarea';
import { SettingField } from './SettingField';
import { StatusLine } from './StatusLine';
import { useI18nStore } from '../store/i18nStore';

/**
 * What applying did. `changed` = the field is no longer the text the draft started from (edited
 * elsewhere, or a different target), so nothing was written and the draft stays.
 */
export type PromptDraftApply = boolean | 'changed';

export interface PromptAuthorDialogProps {
  kind: PromptAuthorKind;
  currentPrompt: string;
  t: (key: string) => string;
  /** Receives the draft and the text it was made from, as it was when the dialog opened. */
  onApply: (prompt: string, base: string) => Promise<PromptDraftApply>;
  onClose: () => void;
  /** Overrides the kind's own title (the flow fields and custom instructions name their field). */
  title?: string;
  /** Flow kinds: the step's data, the same catalog as its Insert data menu. */
  variables?: PromptDraftVariable[];
  context?: PromptDraftContext;
}

/** The refs as the app language lists them: 「{{a}}、{{b}}」, "{{a}}, {{b}}". */
export function draftRefList(list: string[], locale: string): string {
  const refs = list.map((name) => `{{${name}}}`);
  try {
    return new Intl.ListFormat(locale, { type: 'conjunction' }).format(refs);
  } catch {
    return refs.join(', ');
  }
}

export function PromptAuthorDialog({ kind, currentPrompt, t, onApply, onClose, title, variables, context }: PromptAuthorDialogProps) {
  // The text the draft is for, fixed when the dialog opens: a late change to the field is not it.
  const [base] = useState(currentPrompt);
  const locale = useI18nStore((s) => s.locale);
  const [instructions, setInstructions] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const activeRequest = useRef<string | null>(null);
  const { sections, hiddenSuffix } = useProviderModels(targetUrl);
  const busy = generating || applying;
  const flowField = FLOW_DRAFT_KINDS.has(kind);
  const writing = !base.trim();
  const changes = flowField && draft ? draftVariableChanges(base, draft) : { added: [], removed: [] };
  const unknown = flowField && draft ? unknownDraftVariables(draft, variables ?? [], base) : [];
  const placeholderKey = `settings.promptAuthor.instructions.${kind}Placeholder`;

  useEffect(() => () => {
    const id = activeRequest.current;
    activeRequest.current = null;
    if (id) void settingsApi.cancelPromptDraft(id).catch(() => {});
  }, []);

  function cancel(): void {
    const id = activeRequest.current;
    activeRequest.current = null;
    setGenerating(false);
    if (id) void settingsApi.cancelPromptDraft(id).catch(() => {});
  }

  function close(): void {
    if (applying) return;
    cancel();
    onClose();
  }

  async function generate(): Promise<void> {
    if (!instructions.trim() || busy) return;
    const id = crypto.randomUUID();
    activeRequest.current = id;
    setGenerating(true);
    setError('');
    try {
      const result = await settingsApi.generatePromptDraft({
        id,
        kind,
        instructions,
        currentPrompt: draft || base,
        targetUrl,
        ...(variables ? { variables } : {}),
        ...(context ? { context } : {}),
      });
      if (activeRequest.current !== id) return;
      if (result.ok) {
        setDraft(result.prompt);
        setNotes(result.notes ?? []);
      } else if (!result.cancelled) setError(result.error || t('settings.promptAuthor.failed'));
    } catch {
      if (activeRequest.current === id) setError(t('settings.promptAuthor.failed'));
    } finally {
      if (activeRequest.current === id) {
        activeRequest.current = null;
        setGenerating(false);
      }
    }
  }

  async function apply(): Promise<void> {
    if (!draft.trim() || busy || unknown.length > 0) return;
    setApplying(true);
    setError('');
    try {
      const outcome = await onApply(draft, base);
      if (outcome === true) onClose();
      else setError(t(outcome === 'changed' ? 'settings.promptAuthor.changed' : `settings.promptAuthor.${kind === 'instructions' ? 'instructionsApplyFailed' : 'applyFailed'}`));
    } catch {
      setError(t(kind === 'instructions' ? 'settings.promptAuthor.instructionsApplyFailed' : 'settings.promptAuthor.applyFailed'));
    } finally {
      setApplying(false);
    }
  }

  return (
    <AppModal opened onClose={close} title={title ?? t(`settings.promptAuthor.${kind}Title`)} icon={<Sparkles size={18} />} size="lg" zIndex={Z_MODAL}>
      <Stack gap={14}>
        {/* Separate lines: a joining space reads wrong after CJK punctuation. */}
        <Stack gap={2}>
          <Text fz="var(--font-size-sm)" c="dimmed">
            {t(writing && kind !== 'youtube' && kind !== 'maps' ? 'settings.promptAuthor.writeHint' : 'settings.promptAuthor.hint')}
          </Text>
          {flowField && <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.promptAuthor.flowApplyNote')}</Text>}
        </Stack>
        <SettingField label={t('settings.promptAuthor.instructions.label')}>
          <AppTextarea
            value={instructions}
            onChange={(event) => setInstructions(event.currentTarget.value)}
            aria-label={t('settings.promptAuthor.instructions.label')}
            placeholder={t(placeholderKey)}
            disabled={busy}
            autosize
            minRows={3}
            maxRows={6}
            data-autofocus
          />
        </SettingField>
        <SettingField label={t('settings.promptAuthor.model')}>
          <SelectDropdown
            value={targetUrl}
            onChange={setTargetUrl}
            options={[
              { value: '', label: t('settings.promptAuthor.followDefault') },
              ...providerSectionsToSelectData(sections, hiddenSuffix),
            ]}
            aria-label={t('settings.promptAuthor.model')}
            maxDropdownHeight={PROVIDER_DROPDOWN_MAX_HEIGHT}
            disabled={busy}
          />
        </SettingField>
        <Group gap={8}>
          <AppButton leftSection={<Sparkles size={14} />} loading={generating} disabled={!instructions.trim() || applying} onClick={() => { void generate(); }}>
            {t('settings.promptAuthor.generate')}
          </AppButton>
          {generating && <AppButton variant="default" onClick={cancel}>{t('settings.promptAuthor.cancel')}</AppButton>}
        </Group>
        {error && <StatusLine tone="error">{error}</StatusLine>}
        {draft && notes.length > 0 && (
          <Stack gap={4}>
            <StatusLine tone="warning">{t('settings.promptAuthor.conflicts')}</StatusLine>
            {notes.map((note, index) => (
              <Text key={index} fz="var(--font-size-sm)" pl={22} className="selectable">{note}</Text>
            ))}
          </Stack>
        )}
        {draft && (
          <SettingField label={t('settings.promptAuthor.preview')}>
            <AppTextarea
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              aria-label={t('settings.promptAuthor.preview')}
              disabled={busy}
              autosize
              minRows={6}
              maxRows={12}
            />
          </SettingField>
        )}
        {unknown.length > 0 && <StatusLine tone="error">{fillTemplate(t('settings.promptAuthor.unknownInPreview'), { names: draftRefList(unknown, locale) })}</StatusLine>}
        {changes.added.length > 0 && <Text fz="var(--font-size-sm)" c="dimmed">{fillTemplate(t('settings.promptAuthor.added'), { names: draftRefList(changes.added, locale) })}</Text>}
        {changes.removed.length > 0 && <StatusLine tone="warning">{fillTemplate(t('settings.promptAuthor.removed'), { names: draftRefList(changes.removed, locale) })}</StatusLine>}
        <Group justify="flex-end" gap={8}>
          <AppButton variant="default" disabled={applying} onClick={close}>{t('dialog.cancel')}</AppButton>
          <AppButton loading={applying} disabled={!draft.trim() || generating || unknown.length > 0} onClick={() => { void apply(); }}>
            {t('settings.promptAuthor.apply')}
          </AppButton>
        </Group>
      </Stack>
    </AppModal>
  );
}
