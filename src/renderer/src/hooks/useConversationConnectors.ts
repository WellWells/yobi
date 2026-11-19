import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { useMcpStore } from '../store/useMcpStore';
import { useKnowledgeStore } from '../store/useKnowledgeStore';
import { KB_CONNECTOR_PREFIX, kbConnectorId, readKnowledgeFileScope } from '../../../shared/knowledgeBase';
import type { KnowledgeFileScope } from '../../../shared/knowledgeBase';
import { agentApi } from '../api/electronApi';
import type { KeywordCandidate } from '../../../shared/connectorKeywords';
import { reachableOnSend } from '../../../shared/mcpConnectOnUse';

function scopeKey(ids: readonly string[], web: boolean, webOff: boolean, agent: boolean, knowledgeOnly = false, files?: KnowledgeFileScope): string {
  return `${agent ? 'a' : '-'}${knowledgeOnly ? 'k' : '-'}${web ? 'w' : webOff ? 'x' : '-'}:${[...ids].sort().join(',')}:${files ? JSON.stringify(files) : ''}`;
}

function isKnowledgeId(id: string): boolean {
  return id.startsWith(KB_CONNECTOR_PREFIX);
}

/** What an agent run is told about the web: on, switched off by the user, or the default (undefined). */
export function webForRun(web: boolean, webOff: boolean): boolean | undefined {
  if (web) return true;
  return webOff ? false : undefined;
}

export interface ConversationConnectors {
  /** Every connector the user could disclose — the agent-enabled ones, connected or not. */
  connectors: KeywordCandidate[];
  activeIds: readonly string[];
  /**
   * Whether the web switch is on. Off by default — a send that holds no capability is an ordinary
   * chat turn that continues the provider's own thread.
   */
  web: boolean;
  /**
   * The user switched the web off themself (the pill, or the undo on the auto-on notice). Only then
   * is an agent run kept offline; off by default, the agent may go online and the switch follows.
   * Stored as `web: false` in the marker, the same value legacy conversations wrote for "off".
   */
  webOff: boolean;
  /** The user's own click: turning it off is a choice that sticks to the conversation. */
  toggleWeb: () => void;
  /** Set by the app, not chosen by the user: never marks the web as switched off. */
  setWeb: (next: boolean) => void;
  /** The user said no to the web for this conversation (the undo on an auto-on notice). */
  optOutWeb: () => void;
  /**
   * Agent switched on by itself. The web and the connectors imply it too, but it can stand alone:
   * an agent with neither still has its own tools, and still picks among every connected
   * connector — selecting one only means "bring this one in for sure".
   */
  agent: boolean;
  setAgent: (next: boolean) => void;
  /**
   * "Knowledge base only": the agent answers from the attached knowledge bases alone (`kb_search`
   * is its one tool). Only true while one is attached; turning the web on or picking a connector
   * turns it off — the user's latest choice wins. Stored as `kbOnly` in the marker.
   */
  knowledgeOnly: boolean;
  setKnowledgeOnly: (next: boolean) => void;
  /**
   * Within "knowledge base only", the documents of each attached base the answers are limited to
   * (picked on the base's page); undefined = the whole bases. Only while `knowledgeOnly` holds:
   * widening the run drops it. Stored as `kbFiles` in the marker.
   */
  knowledgeFiles: KnowledgeFileScope | undefined;
  /** Limits "knowledge base only" to these documents (and switches it on); undefined = whole bases again. */
  setKnowledgeFiles: (next: KnowledgeFileScope | undefined) => void;
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
  replace: (ids: readonly string[]) => void;
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
  // A Notion document has no composer: its marker is never read for modes nor written with them.
  // The row's flag counts before the file is read, or the modes would be written while it loads.
  const selectedPath = useAppStore((s) => (
    s.selectedFile?.notion || (s.conversation?.thread.notion && s.conversation.provider === 'Notion')
      ? ''
      : s.selectedFile?.path ?? ''
  ));
  const threadConnectors = useAppStore((s) => s.conversation?.thread.mcp);
  const threadKnowledge = useAppStore((s) => s.conversation?.thread.kb);
  const threadWeb = useAppStore((s) => s.conversation?.thread.web);
  const threadAgent = useAppStore((s) => s.conversation?.thread.agent);
  const threadKnowledgeOnly = useAppStore((s) => s.conversation?.thread.kbOnly);
  const threadKnowledgeFiles = useAppStore((s) => s.conversation?.thread.kbFiles);
  const conversationLoaded = useAppStore((s) => s.conversation !== null);
  const [activeIds, setActiveIds] = useState<readonly string[]>([]);
  const [web, setWebState] = useState(false);
  const [webOff, setWebOff] = useState(false);
  const [agent, setAgent] = useState(false);
  const [onlyChosen, setOnlyChosen] = useState(false);
  const [chosenFiles, setChosenFiles] = useState<KnowledgeFileScope | undefined>(undefined);

  const bases = useKnowledgeStore(useShallow((s) => s.bases));
  // The knowledge bases ride in the same set as `kb:<id>`: main splits them off before any server
  // lookup and keeps them in the marker's own `kb` field.
  const connectors = useMemo<KeywordCandidate[]>(
    () => [
      ...servers
        .filter((server) => server.agentEnabled !== false)
        .map((server) => ({
          id: server.id,
          name: server.name,
          url: server.url,
          connected: reachableOnSend(server),
        })),
      ...bases.map((kb) => ({ id: kbConnectorId(kb.id), name: kb.name, url: '', connected: true, knowledge: true, aliases: kb.aliases })),
    ],
    [servers, bases],
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
    const stored = [...(threadConnectors ?? []), ...(threadKnowledge ?? []).map(kbConnectorId)];
    // Seeded with what was on disk, not with what survived the filter, so a marker naming a
    // connector that no longer exists gets rewritten instead of being read again every open.
    const storedWeb = threadWeb === true;
    const storedWebOff = threadWeb === false;
    const storedAgent = threadAgent === true;
    const storedOnly = threadKnowledgeOnly === true;
    const storedFiles = storedOnly ? readKnowledgeFileScope(threadKnowledgeFiles, threadKnowledge ?? []) : undefined;
    persisted.current = { path: selectedPath, key: scopeKey(stored, storedWeb, storedWebOff, storedAgent, storedOnly, storedFiles) };
    const restored = stored.filter((id) => knownIds.has(id));
    setActiveIds(restored);
    setWebState(storedWeb);
    setWebOff(storedWebOff);
    setAgent(storedAgent);
    setOnlyChosen(storedOnly);
    setChosenFiles(storedFiles);
    if (restored.length > 0) onRestored(restored);
  }, [selectedPath, conversationLoaded, threadConnectors, threadKnowledge, threadKnowledgeFiles, threadWeb, threadAgent, threadKnowledgeOnly, knownIds, onRestored]);

  // Only with a base attached: with none it would be an agent with no tool at all.
  const knowledgeOnly = onlyChosen && activeIds.some(isKnowledgeId);
  // Only inside "knowledge base only", and only for bases still attached.
  const knowledgeFiles = useMemo(
    () => (knowledgeOnly ? readKnowledgeFileScope(chosenFiles, activeIds.filter(isKnowledgeId).map((id) => id.slice(KB_CONNECTOR_PREFIX.length))) : undefined),
    [knowledgeOnly, chosenFiles, activeIds],
  );

  useEffect(() => {
    if (!selectedPath) return;
    const key = scopeKey(activeIds, web, webOff, agent, knowledgeOnly, knowledgeFiles);
    if (persisted.current.path === selectedPath && persisted.current.key === key) return;
    persisted.current = { path: selectedPath, key };
    void agentApi.setConversationConnectors(selectedPath, [...activeIds], webForRun(web, webOff), agent, knowledgeOnly, knowledgeFiles);
  }, [selectedPath, activeIds, web, webOff, agent, knowledgeOnly, knowledgeFiles]);

  const discloseAll = useCallback((ids: readonly string[]): readonly string[] => {
    const additions = [...new Set(ids)].filter((id) => knownIds.has(id) && !activeIds.includes(id));
    if (additions.length === 0) return activeIds;
    // A connector asked for by name is a wider run than "knowledge base only": the latest choice wins.
    if (additions.some((id) => !isKnowledgeId(id))) { setOnlyChosen(false); setChosenFiles(undefined); }
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

  const clear = useCallback((): void => {
    setActiveIds([]);
    setOnlyChosen(false);
    setChosenFiles(undefined);
  }, []);
  /** Exactly these, whatever was on before (a new chat started with a knowledge base). */
  const replace = useCallback((ids: readonly string[]): void => setActiveIds(ids.filter((id) => knownIds.has(id))), [knownIds]);

  const toggleWeb = useCallback((): void => {
    if (!web) { setOnlyChosen(false); setChosenFiles(undefined); }
    setWebState(!web);
    setWebOff(web);
  }, [web]);
  const setKnowledgeOnly = useCallback((next: boolean): void => {
    setOnlyChosen(next);
    if (!next) setChosenFiles(undefined);
    // Answering from the documents alone means not going online: the web switch shows it.
    if (next) setWebState(false);
  }, []);
  const setKnowledgeFiles = useCallback((next: KnowledgeFileScope | undefined): void => {
    setChosenFiles(next);
    if (!next) return;
    setOnlyChosen(true);
    setWebState(false);
  }, []);
  // Turning it on clears an earlier "no"; the app switching it off (a new chat, `/chat`) is not the
  // user saying no, so it returns to the default rather than remembering a refusal.
  const setWeb = useCallback((next: boolean): void => {
    setWebState(next);
    setWebOff(false);
  }, []);
  const optOutWeb = useCallback((): void => {
    setWebState(false);
    setWebOff(true);
  }, []);

  return {
    connectors, activeIds, web, webOff, toggleWeb, setWeb, optOutWeb, agent, setAgent, knowledgeOnly, setKnowledgeOnly,
    knowledgeFiles, setKnowledgeFiles,
    discloseAll, toggle, remove, clear, replace,
  };
}
