import { describe, it, expect, beforeEach } from 'vitest';
import { useUserSettingsStore } from './userSettingsStore';
// Import themeStore to trigger subscription
import { useThemeStore } from './themeStore';

beforeEach(() => {
  useUserSettingsStore.setState({ theme: 'dark' });
  useThemeStore.setState({ theme: 'dark' });
});

describe('themeStore', () => {
  it('applies CSS variables to document.documentElement', () => {
    // Theme store applies on creation — check that data-theme is set
    const root = document.documentElement;
    expect(root.dataset.theme).toBe('dark');
  });

  it('syncs when userSettingsStore theme changes', () => {
    useUserSettingsStore.getState().setTheme('light');
    // Allow subscription to fire
    expect(useThemeStore.getState().theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
