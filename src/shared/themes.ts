// Single source of truth for every app theme. The renderer derives CSS
// variables, the Mantine palette, picker swatches and the Shiki code theme
// from THEME_DEFS; the main process reads window background colors from it.
// Adding a theme = one entry here + a `settings.theme.<name>` key in every
// language/*.json file.

export interface ThemeColors {
  bgPrimary: string;
  bgSurface: string;
  bgElevated: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
}

export interface ThemeDef {
  colors: ThemeColors;
  /** Light color scheme (drives Mantine colorScheme and hover lerp direction). */
  light?: boolean;
  /** Shiki bundled theme id used to highlight code blocks. */
  shiki: string;
  /**
   * Darker accent used for the Mantine brand tuple when `colors.accent` is too
   * bright to carry white button text. Omit to reuse `colors.accent`.
   */
  buttonAccent?: string;
}

// Text ordering contract: textPrimary > textSecondary > textMuted > textDisabled
// (disabled must read dimmer than muted, or disabled controls look enabled).
export const THEME_DEFS = {
  dark: {
    colors: {
      bgPrimary: '#0d1117', bgSurface: '#161b22', bgElevated: '#21262d',
      border: '#30363d',
      textPrimary: '#e6edf3', textSecondary: '#c9d1d9', textMuted: '#8b949e', textDisabled: '#6e7681',
      accent: '#58a6ff',
      success: '#3fb950', warning: '#d29922', error: '#f85149',
    },
    shiki: 'github-dark',
    buttonAccent: '#0969da',
  },
  light: {
    colors: {
      bgPrimary: '#ffffff', bgSurface: '#f6f8fa', bgElevated: '#eaeef2',
      border: '#d0d7de',
      textPrimary: '#1f2328', textSecondary: '#24292f', textMuted: '#656d76', textDisabled: '#8c959f',
      accent: '#0969da',
      success: '#1a7f37', warning: '#9a6700', error: '#d1242f',
    },
    light: true,
    shiki: 'github-light',
  },
  dracula: {
    colors: {
      bgPrimary: '#282a36', bgSurface: '#1e1f29', bgElevated: '#44475a',
      border: '#6272a4',
      textPrimary: '#f8f8f2', textSecondary: '#e2e0ff', textMuted: '#8b9ec7', textDisabled: '#6272a4',
      accent: '#bd93f9',
      success: '#50fa7b', warning: '#f1fa8c', error: '#ff5555',
    },
    shiki: 'dracula',
    buttonAccent: '#8434f4',
  },
  nord: {
    colors: {
      bgPrimary: '#2e3440', bgSurface: '#3b4252', bgElevated: '#434c5e',
      border: '#4c566a',
      textPrimary: '#eceff4', textSecondary: '#e5e9f0', textMuted: '#81a1c1', textDisabled: '#71809c',
      accent: '#88c0d0',
      success: '#a3be8c', warning: '#ebcb8b', error: '#bf616a',
    },
    shiki: 'nord',
    buttonAccent: '#4698af',
  },
  amoled: {
    colors: {
      bgPrimary: '#000000', bgSurface: '#0a0a0a', bgElevated: '#141414',
      border: '#222222',
      textPrimary: '#ffffff', textSecondary: '#e0e0e0', textMuted: '#b0b0b0', textDisabled: '#909090',
      accent: '#00b4d8',
      success: '#00e676', warning: '#ffab00', error: '#ff5252',
    },
    shiki: 'github-dark',
  },
  sepia: {
    colors: {
      bgPrimary: '#f5f0e8', bgSurface: '#ece7de', bgElevated: '#e0d8cc',
      border: '#c8bfaf',
      textPrimary: '#2c2018', textSecondary: '#3d2e20', textMuted: '#7a6a59', textDisabled: '#9b8978',
      accent: '#b5451b',
      success: '#4a7c59', warning: '#c07f1f', error: '#a63220',
    },
    light: true,
    shiki: 'solarized-light',
  },
  catppuccin: {
    colors: {
      bgPrimary: '#1e1e2e', bgSurface: '#181825', bgElevated: '#313244',
      border: '#45475a',
      textPrimary: '#cdd6f4', textSecondary: '#bac2de', textMuted: '#a6adc8', textDisabled: '#9399b2',
      accent: '#cba6f7',
      success: '#a6e3a1', warning: '#f9e2af', error: '#f38ba8',
    },
    shiki: 'catppuccin-mocha',
  },
  everforest: {
    colors: {
      bgPrimary: '#2d353b', bgSurface: '#272e33', bgElevated: '#343f44',
      border: '#475258',
      textPrimary: '#d3c6aa', textSecondary: '#c5b7a3', textMuted: '#9ca6a3', textDisabled: '#7a8478',
      accent: '#a7c080',
      success: '#a7c080', warning: '#dbbc7f', error: '#e67e80',
    },
    shiki: 'everforest-dark',
  },
  rosepine: {
    colors: {
      bgPrimary: '#faf4ed', bgSurface: '#fffaf3', bgElevated: '#f2e9e1',
      border: '#dfd7cc',
      textPrimary: '#575279', textSecondary: '#4a485b', textMuted: '#9893a5', textDisabled: '#b6b4ba',
      accent: '#b4637a',
      success: '#56949f', warning: '#ea9d34', error: '#b4637a',
    },
    light: true,
    shiki: 'rose-pine-dawn',
  },
  gruvbox: {
    colors: {
      bgPrimary: '#282828', bgSurface: '#1d2021', bgElevated: '#3c3836',
      border: '#504945',
      textPrimary: '#ebdbb2', textSecondary: '#d5c4a1', textMuted: '#a89984', textDisabled: '#928374',
      accent: '#fe8019',
      success: '#b8bb26', warning: '#fabd2f', error: '#fb4934',
    },
    shiki: 'gruvbox-dark-medium',
    buttonAccent: '#8b6304',
  },
  cyberpunk: {
    colors: {
      bgPrimary: '#0d0d1a', bgSurface: '#070711', bgElevated: '#12122a',
      border: '#1a1a3e',
      textPrimary: '#e0e0ff', textSecondary: '#c0c0f0', textMuted: '#a0a0dd', textDisabled: '#8080cc',
      accent: '#00e5ff',
      success: '#00ff88', warning: '#ffcc00', error: '#ff3355',
    },
    shiki: 'synthwave-84',
    buttonAccent: '#008a99',
  },
  tokyonight: {
    colors: {
      bgPrimary: '#1a1b26', bgSurface: '#16161e', bgElevated: '#24283b',
      border: '#3b4261',
      textPrimary: '#c0caf5', textSecondary: '#a9b1d6', textMuted: '#787c99', textDisabled: '#565f89',
      accent: '#7aa2f7',
      success: '#9ece6a', warning: '#e0af68', error: '#f7768e',
    },
    shiki: 'tokyo-night',
    buttonAccent: '#3d59a1',
  },
  onedark: {
    colors: {
      bgPrimary: '#282c34', bgSurface: '#21252b', bgElevated: '#2c313a',
      border: '#3e4451',
      textPrimary: '#c8ccd4', textSecondary: '#abb2bf', textMuted: '#7f848e', textDisabled: '#5c6370',
      accent: '#61afef',
      success: '#98c379', warning: '#d19a66', error: '#e06c75',
    },
    shiki: 'one-dark-pro',
  },
  monokai: {
    colors: {
      bgPrimary: '#272822', bgSurface: '#1e1f1c', bgElevated: '#3e3d32',
      border: '#49483e',
      textPrimary: '#f8f8f2', textSecondary: '#d8d8d2', textMuted: '#a59f85', textDisabled: '#75715e',
      accent: '#66d9ef',
      success: '#a6e22e', warning: '#fd971f', error: '#f92672',
    },
    shiki: 'monokai',
  },
  solarizeddark: {
    colors: {
      bgPrimary: '#002b36', bgSurface: '#073642', bgElevated: '#0e4553',
      border: '#2a5a67',
      textPrimary: '#93a1a1', textSecondary: '#839496', textMuted: '#657b83', textDisabled: '#586e75',
      accent: '#268bd2',
      success: '#859900', warning: '#b58900', error: '#dc322f',
    },
    shiki: 'solarized-dark',
  },
  solarizedlight: {
    colors: {
      bgPrimary: '#fdf6e3', bgSurface: '#eee8d5', bgElevated: '#e3dcc6',
      border: '#d1c9b0',
      textPrimary: '#073642', textSecondary: '#586e75', textMuted: '#657b83', textDisabled: '#93a1a1',
      accent: '#268bd2',
      success: '#859900', warning: '#b58900', error: '#dc322f',
    },
    light: true,
    shiki: 'solarized-light',
  },
  latte: {
    colors: {
      bgPrimary: '#eff1f5', bgSurface: '#e6e9ef', bgElevated: '#dce0e8',
      border: '#bcc0cc',
      textPrimary: '#4c4f69', textSecondary: '#5c5f77', textMuted: '#7c7f93', textDisabled: '#9ca0b0',
      accent: '#8839ef',
      success: '#40a02b', warning: '#df8e1d', error: '#d20f39',
    },
    light: true,
    shiki: 'catppuccin-latte',
  },
  highcontrast: {
    colors: {
      bgPrimary: '#000000', bgSurface: '#101010', bgElevated: '#1a1a1a',
      border: '#b8b8b8',
      textPrimary: '#ffffff', textSecondary: '#f0f0f0', textMuted: '#d4d4d4', textDisabled: '#9d9d9d',
      accent: '#ffd700',
      success: '#2ee66b', warning: '#ff8c00', error: '#ff4d4d',
    },
    shiki: 'github-dark-high-contrast',
  },
} as const satisfies Record<string, ThemeDef>;

export type Theme = keyof typeof THEME_DEFS;

/** Stored preference: a concrete theme, or 'auto' to follow the OS scheme. */
export type ThemePreference = Theme | 'auto';

export const VALID_THEMES = Object.keys(THEME_DEFS) as readonly Theme[];

/** Widens the per-entry literal types so optional fields are accessible. */
export function themeDef(theme: Theme): ThemeDef {
  return THEME_DEFS[theme];
}

export function isTheme(value: unknown): value is Theme {
  // Object.hasOwn (not `in`): guards against prototype keys like 'toString'.
  return typeof value === 'string' && Object.hasOwn(THEME_DEFS, value);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'auto' || isTheme(value);
}

/** Window background for a stored preference ('auto'/invalid → system scheme). */
export function themeBackground(preference: string, prefersDark: boolean): string {
  const theme: Theme = isTheme(preference) ? preference : prefersDark ? 'dark' : 'light';
  return themeDef(theme).colors.bgPrimary;
}
