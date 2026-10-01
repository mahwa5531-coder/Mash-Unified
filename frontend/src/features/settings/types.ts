export interface ThemeConfig {
  mode: 'system' | 'light' | 'dark';
  light: {
    preset: string;
    background: string;
    foreground: string;
    accent: string;
  };
  dark: {
    preset: string;
    background: string;
    foreground: string;
    accent: string;
  };
}

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'dark',
  light: {
    preset: 'Default Light',
    background: '#F9F9F9',
    foreground: '#101010',
    accent: '#007ACC',
  },
  dark: {
    preset: 'Default Dark',
    background: '#101010',
    foreground: '#CCCCCC',
    accent: '#007ACC',
  },
};

export function sanitizeThemeConfig(raw: any): ThemeConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_THEME_CONFIG;
  return {
    mode: (raw.mode === 'system' || raw.mode === 'light' || raw.mode === 'dark') ? raw.mode : DEFAULT_THEME_CONFIG.mode,
    light: {
      preset: raw.light?.preset || DEFAULT_THEME_CONFIG.light.preset,
      background: raw.light?.background || DEFAULT_THEME_CONFIG.light.background,
      foreground: raw.light?.foreground || DEFAULT_THEME_CONFIG.light.foreground,
      accent: raw.light?.accent || DEFAULT_THEME_CONFIG.light.accent,
    },
    dark: {
      preset: raw.dark?.preset || DEFAULT_THEME_CONFIG.dark.preset,
      background: raw.dark?.background || DEFAULT_THEME_CONFIG.dark.background,
      foreground: raw.dark?.foreground || DEFAULT_THEME_CONFIG.dark.foreground,
      accent: raw.dark?.accent || DEFAULT_THEME_CONFIG.dark.accent,
    },
  };
}

export interface AuditSettings {
  auditorName: string;
  firmName: string;
  currency: string;
  dateFormat: string;
  autoSaveWorkingPapers: boolean;
}

export const DEFAULT_AUDIT_SETTINGS: AuditSettings = {
  auditorName: 'Audit Lead',
  firmName: 'Audit & Assurance Practice',
  currency: '₹ (INR)',
  dateFormat: 'DD/MM/YYYY',
  autoSaveWorkingPapers: true,
};
