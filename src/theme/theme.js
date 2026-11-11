import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useColorScheme, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@qavora_qa_theme_v2';

export const lightColors = {
  mode: 'light',
  background: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#F1F5F9',
  surfaceAccent: '#EEF2FF',
  primary: '#4f46e5',
  primaryPressed: '#4338ca',
  primarySoft: '#EEF2FF',
  text: '#0F172A',
  textSecondary: '#334155',
  textMuted: '#475569',
  textOnPrimary: '#FFFFFF',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  success: '#15803D',
  successSoft: '#DCFCE7',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  danger: '#B91C1C',
  dangerSoft: '#FEE2E2',
  info: '#4f46e5',
  infoSoft: '#E0E7FF',
  untested: '#475569',
  untestedSoft: '#F1F5F9',
  overlay: 'rgba(15, 23, 42, 0.55)',
  statusBar: 'dark',
};

export const darkColors = {
  mode: 'dark',
  background: '#0B1120',
  surface: '#111827',
  surfaceElevated: '#1E293B',
  surfaceMuted: '#1E293B',
  surfaceAccent: 'rgba(99, 102, 241, 0.14)',
  primary: '#6366f1',
  primaryPressed: '#4f46e5',
  primarySoft: 'rgba(99, 102, 241, 0.18)',
  text: '#F8FAFC',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  textOnPrimary: '#FFFFFF',
  border: '#1E293B',
  borderStrong: '#334155',
  success: '#22C55E',
  successSoft: 'rgba(34, 197, 94, 0.16)',
  warning: '#F59E0B',
  warningSoft: 'rgba(245, 158, 11, 0.16)',
  danger: '#EF4444',
  dangerSoft: 'rgba(239, 68, 68, 0.16)',
  info: '#818CF8',
  infoSoft: 'rgba(129, 140, 248, 0.16)',
  untested: '#94A3B8',
  untestedSoft: 'rgba(148, 163, 184, 0.16)',
  overlay: 'rgba(2, 6, 23, 0.78)',
  statusBar: 'light',
};

export const monoFontFamily = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  web: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  default: 'monospace',
});

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [themePreference, setThemePreferenceState] = useState('light');
  const [isThemeLoaded, setIsThemeLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (mounted && (saved === 'light' || saved === 'dark' || saved === 'system')) {
          setThemePreferenceState(saved);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setIsThemeLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const setThemePreference = (nextPref) => {
    setThemePreferenceState(nextPref);
    AsyncStorage.setItem(STORAGE_KEY, nextPref).catch(() => {});
  };

  const toggleTheme = () => {
    const currentResolved =
      themePreference === 'system'
        ? systemScheme === 'dark'
          ? 'dark'
          : 'light'
        : themePreference;
    setThemePreference(currentResolved === 'dark' ? 'light' : 'dark');
  };

  const resolvedMode = useMemo(() => {
    if (themePreference === 'system') {
      return systemScheme === 'dark' ? 'dark' : 'light';
    }
    return themePreference === 'dark' ? 'dark' : 'light';
  }, [themePreference, systemScheme]);

  const colors = resolvedMode === 'dark' ? darkColors : lightColors;

  const value = useMemo(
    () => ({
      colors,
      isDark: resolvedMode === 'dark',
      themePreference,
      setThemePreference,
      toggleTheme,
      isThemeLoaded,
    }),
    [colors, resolvedMode, themePreference, isThemeLoaded]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
