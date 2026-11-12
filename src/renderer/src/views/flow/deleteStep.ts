import { showAppNotice } from '../../hooks/useUiNotifications';
import { useFlowStore } from '../../store/useFlowStore';
import { fillTemplate } from '../../../../shared/fillTemplate';

/**
 * Deletes a step without asking: the notice takes it back (with its loop's or condition's end)
 * for a few seconds. The step card's delete and the outline's are this one.
 */
export function deleteStepWithUndo(
  flowId: string,
  stepId: string,
  t: (key: string) => string,
  onUndo?: () => void,
): boolean {
  const store = useFlowStore.getState();
  const index = store.flows.find((flow) => flow.id === flowId)?.steps.findIndex((step) => step.id === stepId) ?? -1;
  const removed = store.removeStep(flowId, stepId);
  if (!removed) return false;
  showAppNotice({
    level: 'info',
    message: fillTemplate(t('flow.step.deleted'), { step: String(index + 1) }),
    undo: {
      label: t('trash.undo'),
      run: () => {
        useFlowStore.getState().restoreRemovedSteps(flowId, removed);
        onUndo?.();
      },
    },
  });
  return true;
}
