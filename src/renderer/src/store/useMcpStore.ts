import { create } from 'zustand';
import type { McpServerView } from '../../../shared/types';

/**
 * Connected MCP servers, shared by Settings and the chat composer (a store so the composer's
 * per-server slash commands see servers that connect while Settings is closed).
 */
interface McpState {
  servers: McpServerView[];
  setServers: (servers: McpServerView[]) => void;
}

export const useMcpStore = create<McpState>((set) => ({
  servers: [],
  setServers: (servers) => set({ servers }),
}));
