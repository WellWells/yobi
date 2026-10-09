import { app, Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { getLangCache, t } from './i18n';

export interface AppMenuDeps {
  onOpenSettings: () => void;
}

const SEPARATOR: MenuItemConstructorOptions = { type: 'separator' };

/**
 * The macOS menu bar; without one Electron shows its stock English bar with developer items. The
 * Edit roles must stay: they make copy and paste work in every text field. Every label comes from
 * the language pack except the dev-build-only developer items. No item may take a key the shortcut
 * registry owns: an unhandled key falls through to the menu and would bypass the registry's guards,
 * so Settings… carries no ⌘, (that key stays `nav.openShortcuts`).
 */
export function buildMacMenuTemplate(
  strings: Record<string, string>,
  deps: AppMenuDeps,
  isPackaged: boolean,
): MenuItemConstructorOptions[] {
  const label = (key: string): string => t(strings, key);
  const developerItems: MenuItemConstructorOptions[] = isPackaged
    ? []
    : [{ role: 'forceReload' }, { role: 'toggleDevTools' }];

  return [
    {
      label: label('app.name'),
      submenu: [
        { role: 'about', label: label('menu.app.about') },
        SEPARATOR,
        { label: label('menu.app.settings'), click: () => deps.onOpenSettings() },
        SEPARATOR,
        { role: 'services', label: label('menu.app.services') },
        SEPARATOR,
        { role: 'hide', label: label('menu.app.hide') },
        { role: 'hideOthers', label: label('menu.app.hideOthers') },
        { role: 'unhide', label: label('menu.app.showAll') },
        SEPARATOR,
        { role: 'quit', label: label('menu.app.quit') },
      ],
    },
    {
      label: label('menu.edit'),
      submenu: [
        { role: 'undo', label: label('menu.edit.undo') },
        { role: 'redo', label: label('menu.edit.redo') },
        SEPARATOR,
        { role: 'cut', label: label('menu.edit.cut') },
        { role: 'copy', label: label('menu.edit.copy') },
        { role: 'paste', label: label('menu.edit.paste') },
        { role: 'pasteAndMatchStyle', label: label('menu.edit.pasteAndMatchStyle') },
        { role: 'delete', label: label('menu.edit.delete') },
        { role: 'selectAll', label: label('menu.edit.selectAll') },
      ],
    },
    {
      label: label('menu.view'),
      submenu: [
        // Listed under Settings → Keyboard shortcuts as a platform shortcut, so it stays in
        // release builds too.
        { role: 'reload', label: label('menu.view.reload') },
        ...developerItems,
        SEPARATOR,
        { role: 'resetZoom', label: label('menu.view.resetZoom') },
        { role: 'zoomIn', label: label('menu.view.zoomIn') },
        { role: 'zoomOut', label: label('menu.view.zoomOut') },
      ],
    },
    {
      label: label('menu.window'),
      role: 'window',
      submenu: [
        { role: 'minimize', label: label('menu.window.minimize') },
        { role: 'zoom', label: label('menu.window.zoom') },
        SEPARATOR,
        { role: 'close', label: label('menu.window.close') },
        SEPARATOR,
        { role: 'front', label: label('menu.window.front') },
      ],
    },
  ];
}

/**
 * Installs the macOS menu bar; a no-op elsewhere. Windows and Linux keep Electron's default
 * menu, which the main window hides — their keyboard shortcuts depend on it. Called again
 * whenever the language changes, because a native menu does not re-render on its own.
 */
export function installAppMenu(deps: AppMenuDeps): void {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMacMenuTemplate(getLangCache(), deps, app.isPackaged)));
}
