import { useTranslation } from 'react-i18next';
import { Xmark } from 'iconoir-react';
import { shortcuts } from '../../utils/keyboardShortcuts';
import './ShortcutsModal.css';

interface Props {
  onClose: () => void;
}

export default function ShortcutsModal({ onClose }: Readonly<Props>) {
  const { t } = useTranslation();

  return (
    <dialog className="shortcuts-overlay" open aria-labelledby="shortcuts-title">
      <button type="button" className="dialog-backdrop" onClick={onClose} aria-label="Close" />
      <div className="shortcuts-modal">
        <div className="shortcuts-header">
          <h2 id="shortcuts-title">{t('shortcuts.title', 'Keyboard Shortcuts')}</h2>
          <button className="shortcuts-close" onClick={onClose}><Xmark width={20} height={20} strokeWidth={2} /></button>
        </div>
        <div className="shortcuts-list">
          {shortcuts.map((s) => (
            <div className="shortcuts-row" key={s.key}>
              <span className="shortcuts-action">{t(s.action)}</span>
              <kbd className="shortcuts-key">{s.key}</kbd>
            </div>
          ))}
        </div>
      </div>
    </dialog>
  );
}
