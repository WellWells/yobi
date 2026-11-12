import { app } from 'electron';
import { chatTargetFilledIn, config, settleChatTarget } from '../config';
import { decideChatTargetDefault } from '../chatTargetDefault';
import { sendLog } from '../helpers';

/** A new install's chat model, by system language; runs before anything sends or opens a window. */
export function applyChatTargetDefault(): void {
  const languages = app.getPreferredSystemLanguages();
  const target = decideChatTargetDefault(chatTargetFilledIn(), languages, config);
  if (!target) return;
  settleChatTarget(target);
  sendLog(`Chat model default: ${target} (system language ${languages[0] ?? 'unknown'})`);
}
