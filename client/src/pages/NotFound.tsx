import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function NotFound() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        padding: '2rem',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '4rem', fontFamily: 'var(--font-display)', margin: 0 }}>404</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        {t('errors.notFound', 'This page doesn\'t exist.')}
      </p>
      <button
        className="btn-primary"
        onClick={() => navigate('/')}
      >
        {t('common.goHome', 'Go Home')}
      </button>
    </div>
  );
}
