import { create } from 'zustand';

/**
 * Chat names by id, from the last LINE chat list and Telegram group list read in this session
 * (memory only, never saved). A picker shows a saved chat by name while its list is read again,
 * and anything that must never print an id can ask here first.
 */
interface ChatNameState {
  names: ReadonlyMap<string, string>;
  remember: (chats: ReadonlyArray<{ id: string; name: string }>) => void;
}

export const useChatNameStore = create<ChatNameState>()((set) => ({
  names: new Map(),
  remember: (chats) => set((state) => {
    const changed = chats.some((chat) => chat.name && state.names.get(chat.id) !== chat.name);
    if (!changed) return state;
    const names = new Map(state.names);
    for (const chat of chats) if (chat.name) names.set(chat.id, chat.name);
    return { names };
  }),
}));
