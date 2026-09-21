/**
 * The composer shows at most one notice at a time. Stacking them was the old shape: three
 * centred grey lines under the box, each one growing the footer and shoving the transcript up.
 * Priority runs most-consequential first — a connector riding on the next send costs a real
 * agent run, so it must never be the line that loses its slot to "attachments are ignored".
 */
export type ComposerNoticeKind = 'connectors' | 'flow' | 'web' | 'plain';

export interface ComposerNoticeSpec {
  kind: ComposerNoticeKind;
  /** i18n key of the message, or null when `message` already carries resolved text. */
  messageKey: string | null;
  /** Already-translated text; only `plain` arrives this way, from the caller. */
  message: string | null;
  /** Connector display names, interpolated into the message's `{{names}}`. */
  names: readonly string[];
  /** i18n key of the inline undo, or null for a notice with nothing to undo. */
  actionKey: string | null;
}

export interface ComposerNoticeInput {
  /** Connectors a keyword match disclosed AND that are still disclosed. */
  autoAttachedNames: readonly string[];
  /** A flow-building send moved the composer into agent mode. */
  autoFlowActive: boolean;
  /** A send that asked for a web search turned "web" on, AND it is still on. */
  autoWebActive?: boolean;
  /** The web capability's display name, listed with connectors a send added alongside it. */
  webLabel?: string;
  /** Resolved text from the caller, e.g. "attachments are ignored in this mode". */
  plain: string | null;
}

export function pickComposerNotice(input: ComposerNoticeInput): ComposerNoticeSpec | null {
  const autoWeb = input.autoWebActive === true;
  if (input.autoAttachedNames.length > 0) {
    return {
      kind: 'connectors',
      messageKey: 'chat.mode.connectors.auto',
      message: null,
      // One send, one undo: web turned on by the same message is named — and removed — with them.
      names: autoWeb && input.webLabel
        ? [...input.autoAttachedNames, input.webLabel]
        : input.autoAttachedNames,
      actionKey: 'chat.mode.connectors.autoRemove',
    };
  }
  if (input.autoFlowActive) {
    return {
      kind: 'flow',
      messageKey: 'chat.mode.flow.auto',
      message: null,
      names: [],
      actionKey: 'chat.mode.flow.autoUndo',
    };
  }
  if (autoWeb) {
    return {
      kind: 'web',
      messageKey: 'chat.mode.web.auto',
      message: null,
      names: [],
      actionKey: 'chat.mode.web.autoUndo',
    };
  }
  if (input.plain) {
    return { kind: 'plain', messageKey: null, message: input.plain, names: [], actionKey: null };
  }
  return null;
}

export function composerNoticeText(
  spec: ComposerNoticeSpec,
  t: (key: string) => string,
): string {
  if (spec.message !== null) return spec.message;
  if (spec.messageKey === null) return '';
  return t(spec.messageKey).replace('{{names}}', spec.names.join(', '));
}
