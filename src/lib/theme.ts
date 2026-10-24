/**
 * Colour themes (style.md §9). The choice is per browser, stored in a cookie like the
 * table density, and applied as data-theme on <html> by hooks.server.ts so the login
 * page and the first paint are themed too. "auto" follows the OS via a tiny inline
 * script in app.html; the server renders it as light.
 */
export const THEME_COOKIE = 'faktura_theme';

export const THEMES = ['light', 'solarized', 'dark', 'auto'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  light: 'Lys',
  solarized: 'Solarized',
  dark: 'Mørk',
  auto: 'Auto'
};

export function parseTheme(value: string | undefined | null): Theme {
  return (THEMES as readonly string[]).includes(value ?? '') ? (value as Theme) : 'light';
}
