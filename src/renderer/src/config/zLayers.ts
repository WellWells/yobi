/**
 * Stacking order for anything that portals to document.body.
 *
 * The rule that matters: a popover is almost always opened from inside a dialog, so the
 * popover layer has to clear the whole dialog range at once. Numbering popovers per call
 * site is what broke the RSS feed picker — its dropdown sat at 200 while the setup wizard
 * that hosted it sat at 205, so the list opened behind the modal and read as "won't open".
 * Anything that renders on top of the app belongs in this file rather than inline.
 */

/** Ordinary dialogs. */
export const Z_MODAL = 200;
/** A dialog opened from another dialog. */
export const Z_MODAL_NESTED = 205;
/** A confirmation raised over a nested dialog. */
export const Z_MODAL_CONFIRM = 210;

/** Dropdowns, selects and menus. Above every dialog above. */
export const Z_POPOVER = 300;

/** Right-click menus, which must clear everything else. */
export const Z_CONTEXT_MENU = 2000;

/** Every dialog layer, for the test that pins the popover-above-dialog invariant. */
export const MODAL_LAYERS = [Z_MODAL, Z_MODAL_NESTED, Z_MODAL_CONFIRM] as const;
