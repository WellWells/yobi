import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import type { NamedModel } from './flowCapabilities';

/** The BYOK keys and key groups under the names the model picker shows them by. */
export function useNamedModels(): readonly NamedModel[] {
  return useAppStore(useShallow((s) => [...s.byokModels, ...s.byokGroupModels]));
}
