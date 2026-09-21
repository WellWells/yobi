import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { useMcpStore } from '../store/useMcpStore';
import { agentApi } from '../api/electronApi';
import type { ConnectorChoice } from '../components/chat/ModeDropdown';

function scopeKey(ids: readonly string[], web: boolean): string {
  return `${web ? 'w' : '-'}:${[...ids].sort().join(',')}`;
}

export interface ConversationConnectors {
  /** Every connector the user could disclose — the agent-enabled ones, connected or not. */
  connectors: ConnectorChoice[];
  activeIds: readonly string[];
  /**
   * Whether this conversation may go online. Off by default — a send that holds no capability is
   * an ordinary chat turn that continues the provider's own thread — so only the on state is stored.
   */
  web: boolean;
  toggleWeb: () => void;
  setWeb: (next: boolean) => void;
  /**
   * Adds whichever of these are not disclosed yet; returns the resulting set either way. Takes
   * a list rather than one id because each call computes its result from the set it closed
   * over, so two calls in one tick would leave only the second connector behind.
   */
  discloseAll: (ids: readonly string[]) => readonly string[];
  toggle: (id: string) => readonly string[];
  /** Drops several at once, for the same reason `discloseAll` exists. */
  remove: (ids: readonly string[]) => readonly string[];
  clear: () => void;
}

/**
 * Which connectors this conversation has disclosed to the agent.
 *
 * The set is per conversation and persisted in the conversation's own thread marker, so
 * reopening it a week later still discloses Notion without the user retyping `/notion`. It holds
 * server ids, never display names or command names: both of those move between servers.
 *
 * `agentEnabled === false` filters a connector out here as well as out of the slash menu. That
 * switch means "an AI may drive this server", and a set that outlived it would walk around it.
 */
export function useConversationConnectors(
  /**
   * Called when reopening a conversation restores a non-empty set. The composer has to follow:
   * a restored connector with the mode left on Chat reads as "Chat - Notion" on the pill for a
   * send that cannot reach Notion at all.
   */
  onRestored: (ids: readonly string[]) => void,
): ConversationConnectors {
  const servers = useMcpStore(useShallow((s) => s.servers));
  const selectedPath = useAppStore((s) => s.selectedFile?.path ?? '');
  const threadConnectors = useAppStore((s) => s.conversation?.thread.mcp);
  const threadWeb = useAppStore((s) => s.conversation?.thread.web);
  const conversationLoaded = useAppStore((s) => s.conversation !== null);
  const [activeIds, setActiveIds] = useState<readonly string[]>([]);
  const [web, setWeb] = useState(false);

  const connectors = useMemo<ConnectorChoice[]>(
    () => servers
      .filter((server) => server.agentEnabled !== false)
      .map((server) => ({
        id: server.id,
        name: server.name,
        url: server.url,
        connected: server.status === 'connected',
      })),
    [servers],
  );
  const knownIds = useMemo(() => new Set(connectors.map((c) => c.id)), [connectors]);

  const previousPath = useRef<string | null>(null);
  const restoredFor = useRef<string | null>(null);
  const persisted = useRef<{ path: string; key: string }>({ path: '', key: '' });

  // A connector deleted or switched off in Settings has to leave the composer immediately.
  // Leaving a live chip for a server the user just disabled is worse than losing the chip: it
  // says the agent can still reach it.
  useEffect(() => {
    setActiveIds((current) => (current.every((id) => knownIds.has(id))
      ? current
      : current.filter((id) => knownIds.has(id))));
  }, [knownIds]);

  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = selectedPath;
    // Moving off a file, or the first turn of a new conversation creating one: the composer's
    // set carries over rather than being restored from a marker that does not exist yet.
    if (previous !== selectedPath && (previous === '' || selectedPath === '')) {
      restoredFor.current = selectedPath;
      return;
    }
    if (!selectedPath || restoredFor.current === selectedPath || !conversationLoaded) return;
    restoredFor.current = selectedPath;
    const stored = threadConnectors ?? [];
    // Seeded with what was on disk, not with what survived the filter, so a marker naming a
    // connector that no longer exists gets rewritten instead of being read again every open.
    const storedWeb = threadWeb === true;
    persisted.current = { path: selectedPath, key: scopeKey(stored, storedWeb) };
    const restored = stored.filter((id) => knownIds.has(id));
    setActiveIds(restored);
    setWeb(storedWeb);
    if (restored.length > 0) onRestored(restored);
  }, [selectedPath, conversationLoaded, threadConnectors, threadWeb, knownIds, onRestored]);

  useEffect(() => {
    if (!selectedPath) return;
    const key = scopeKey(activeIds, web);
    if (persisted.current.path === selectedPath && persisted.current.key === key) return;
    persisted.current = { path: selectedPath, key };
    void agentApi.setConversationConnectors(selectedPath, [...activeIds], web);
  }, [selectedPath, activeIds, web]);

  const discloseAll = useCallback((ids: readonly string[]): readonly string[] => {
    const additions = [...new Set(ids)].filter((id) => knownIds.has(id) && !activeIds.includes(id));
    if (additions.length === 0) return activeIds;
    const next = [...activeIds, ...additions];
    setActiveIds(next);
    return next;
  }, [activeIds, knownIds]);

  const remove = useCallback((ids: readonly string[]): readonly string[] => {
    const dropped = new Set(ids);
    const next = activeIds.filter((id) => !dropped.has(id));
    if (next.length === activeIds.length) return activeIds;
    setActiveIds(next);
    return next;
  }, [activeIds]);

  const toggle = useCallback((id: string): readonly string[] => (activeIds.includes(id)
    ? remove([id])
    : discloseAll([id])), [activeIds, remove, discloseAll]);

  const clear = useCallback((): void => setActiveIds([]), []);

  const toggleWeb = useCallback((): void => setWeb((current) => !current), []);

  return { connectors, activeIds, web, toggleWeb, setWeb, discloseAll, toggle, remove, clear };
}
