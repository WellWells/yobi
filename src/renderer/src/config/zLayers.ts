/**
 * The Settings dialog: under the caption controls (150, `TitleBar`), which stay lit and clickable
 * over its backdrop, as a native title bar would; it opens below their row. Every dialog opened
 * from inside Settings is Z_MODAL or above, over both.
 */
export const Z_SETTINGS = 140;

/**
 * The sidebar out as a drawer over a narrow window, and its backdrop one under it: over the view's
 * own rows (the flow band is 3), under Settings and the caption controls, which stay clickable.
 */
export const Z_SIDEBAR_DRAWER = 120;

export const Z_MODAL = 200;
export const Z_MODAL_NESTED = 205;
export const Z_MODAL_CONFIRM = 210;

export const Z_POPOVER = 300;

export const Z_CONTEXT_MENU = 2000;
