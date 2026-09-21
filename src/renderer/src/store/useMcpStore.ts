import { create } from 'zustand';
import type { McpServerView } from '../../../shared/types';

/**
 * Connected MCP servers, shared by Settings and the chat composer.
 *
 * It lives in a store rather than in the Settings hook because the composer derives one slash
 * command per connected server: with the list held in Settings' local state the two surfaces
 * would disagree the moment a server connected while Settings was closed.
 */
interface McpState {
  servers: McpServerView[];
  setServers: (servers: McpServerView[]) => void;
}

export const useMcpStore = create<McpState>((set) => ({
  servers: [],
  setServers: (servers) => set({ servers }),
}));
