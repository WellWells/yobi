import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { PromptAuthorKind, PromptDraftContext, PromptDraftVariable } from '../../../shared/promptAuthor';
import { fillTemplate } from '../../../shared/fillTemplate';
import { AppButton } from './AppButton';
import { PromptAuthorDialog, type PromptDraftApply } from './PromptAuthorDialog';

interface Props {
  kind: PromptAuthorKind;
  currentPrompt: string;
  t: (key: string) => string;
  onApply: (prompt: string, base: string) => Promise<PromptDraftApply>;
  disabled?: boolean;
  /** The field's own label; the dialog title becomes "<action>: <field>". */
  fieldLabel?: string;
  variables?: PromptDraftVariable[] | (() => PromptDraftVariable[]);
  context?: PromptDraftContext | (() => PromptDraftContext);
}

/** "Write" for an empty field, "Tidy" for custom instructions, otherwise "Rewrite". */
export function promptDraftActionKey(kind: PromptAuthorKind, current: string): string {
  if (kind === 'youtube' || kind === 'maps') return 'settings.promptAuthor.button';
  if (!current.trim()) return 'settings.promptAuthor.write';
  return kind === 'instructions' ? 'settings.promptAuthor.tidy' : 'settings.promptAuthor.button';
}

interface Opened {
  variables?: PromptDraftVariable[];
  context?: PromptDraftContext;
  title?: string;
}

/** The same sparkles button as the reading view's rewrite, opening a draft of this field. */
export function PromptAuthorButton({ kind, currentPrompt, t, onApply, disabled, fieldLabel, variables, context }: Props) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const action = t(promptDraftActionKey(kind, currentPrompt));

  // The catalog and context are read once, when the dialog opens: the draft is bound to them.
  function open(): void {
    setOpened({
      variables: typeof variables === 'function' ? variables() : variables,
      context: typeof context === 'function' ? context() : context,
      title: fieldLabel ? fillTemplate(t('settings.promptAuthor.fieldTitle'), { action, field: fieldLabel }) : undefined,
    });
  }

  return (
    <>
      <AppButton variant="default" size="xs" leftSection={<Sparkles size={12} />} disabled={disabled} onClick={open}>
        {action}
      </AppButton>
      {opened && (
        <PromptAuthorDialog
          kind={kind}
          currentPrompt={currentPrompt}
          t={t}
          onApply={onApply}
          onClose={() => setOpened(null)}
          title={opened.title}
          variables={opened.variables}
          context={opened.context}
        />
      )}
    </>
  );
}
