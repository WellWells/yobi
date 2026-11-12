import { isUsableWatchFolder } from '../../../../shared/flowFileTrigger';
import { missingRequiredVariables } from '../../../../shared/flowVariables';
import type { FlowDefinition, FlowSetupNeed, FlowVariable } from '../../../../shared/types';

type Translate = (key: string) => string;

/**
 * The key the wizard's folder question goes by. It is not a flow variable and is never saved as
 * one; the dot keeps it apart from every variable key, which cannot hold one.
 */
const WATCH_FOLDER_QUESTION_KEY = 'trigger.watchFolder';

/**
 * The connections the wizard warns about before "Add". The rest have their own place in it: the
 * bot its banner and the recipient field's hint, the downloader its install row. A calendar is
 * left out because the one template that reads it, the morning brief, runs without one.
 */
export const WIZARD_SETUP_NEEDS: readonly FlowSetupNeed[] = ['line', 'mailbox', 'email', 'telegram'];

/** Where the wizard's "Open settings" goes: Telegram is set up under Bots, the rest under Connectors. */
export function setupNeedsCategory(needs: readonly FlowSetupNeed[]): 'bots' | 'connectors' {
  return needs.length > 0 && needs.every((need) => need === 'telegram') ? 'bots' : 'connectors';
}

/**
 * A file trigger's folder is the one setting a template cannot seed (a schedule or a command name
 * has a safe default; which folder to watch is only the user's to know), so the wizard asks for it
 * as it asks for a variable. The answer goes into the trigger, which stays its only home: no
 * variable mirrors it, so the folder changed later in the trigger is the folder watched.
 */
export function watchFolderQuestion(flow: FlowDefinition, t: Translate): FlowVariable | null {
  if (flow.trigger.type !== 'file') return null;
  return {
    key: WATCH_FOLDER_QUESTION_KEY,
    type: 'folder',
    label: t('flow.trigger.file.folder'),
    question: t('flow.setup.watchFolder.question'),
    hint: t('flow.trigger.file.hint'),
    value: flow.trigger.watchFolder ?? '',
    required: true,
  };
}

export function withWatchFolder(flow: FlowDefinition, folder: string): FlowDefinition {
  return { ...flow, trigger: { ...flow.trigger, watchFolder: folder } };
}

/** Every question the wizard asks, in order: the folder first, then the variables it shows. */
export function setupQuestions(flow: FlowDefinition, t: Translate): FlowVariable[] {
  const folder = watchFolderQuestion(flow, t);
  const variables = (flow.variables ?? []).filter((variable) => !variable.hiddenInSetup);
  return folder ? [folder, ...variables] : variables;
}

/** What still keeps "Add" off: a folder that is not a full path, then blank required variables. */
export function setupMissing(flow: FlowDefinition, t: Translate): FlowVariable[] {
  const folder = watchFolderQuestion(flow, t);
  const folderMissing = folder && !isUsableWatchFolder(folder.value) ? [folder] : [];
  return [...folderMissing, ...missingRequiredVariables(flow)];
}
