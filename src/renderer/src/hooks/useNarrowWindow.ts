import { useMediaQuery } from '@mantine/hooks';

/**
 * Below this window width the chat and flow sidebars stop sitting beside the view and open over it
 * as a drawer, and a new chat's composer sits at the foot instead of under the greeting. ChatGPT's
 * breakpoint for its 260px sidebar (Perplexity's is 768 for 240px, Gemini's 960 for a wider
 * column): at 800 the 240px sidebar still leaves the conversation 560px.
 */
export const NARROW_WINDOW_BELOW = 800;

export const NARROW_WINDOW_QUERY = `(max-width: ${NARROW_WINDOW_BELOW - 1}px)`;

/** The window is too narrow for a sidebar beside the view. */
export function useNarrowWindow(): boolean {
  return useMediaQuery(NARROW_WINDOW_QUERY, false, { getInitialValueInEffect: false });
}
