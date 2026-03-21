export function MockSettingsLayout({
  children,
  sections,
  onSelect,
  onClose,
}: Readonly<{
  children: React.ReactNode;
  sections: Array<{ label?: string; items: Array<{ id: string; label: string; danger?: boolean }> }>;
  onSelect: (id: string) => void;
  onClose: () => void;
}>) {
  return (
    <div data-testid="settings-layout">
      <nav data-testid="settings-nav">
        {sections.flatMap((s) =>
          s.items.map((item) => (
            <button key={item.id} data-testid={`nav-${item.id}`} onClick={() => onSelect(item.id)}>
              {item.label}
            </button>
          )),
        )}
      </nav>
      <button data-testid="close-btn" onClick={onClose}>
        Close
      </button>
      <div data-testid="settings-content">{children}</div>
    </div>
  );
}
