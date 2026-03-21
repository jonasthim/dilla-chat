const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);
const mod = isMac ? '\u2318' : 'Ctrl';

export interface KeyboardShortcut {
  key: string;
  action: string;
}

export const shortcuts: KeyboardShortcut[] = [
  { key: `${mod}+K`, action: 'shortcuts.search' },
  { key: 'Escape', action: 'shortcuts.closePanel' },
  { key: `${mod}+Shift+M`, action: 'shortcuts.toggleMute' },
  { key: `${mod}+Shift+D`, action: 'shortcuts.toggleDeafen' },
  { key: 'Alt+\u2191/\u2193', action: 'shortcuts.navigateChannels' },
  { key: `${mod}+/`, action: 'shortcuts.showShortcuts' },
];
