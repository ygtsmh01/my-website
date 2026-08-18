import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { sb } from '../../lib/supabase';
import { useTheme } from '../../lib/ThemeContext';
import './nav.css';

const LINKS = [
  { to: '/', label: '🎮 Oyun' },
  { to: '/profile', label: '👤 Profil' },
  { to: '/leaderboard', label: '🏆 Sıralama' },
  { to: '/history', label: '📚 Geçmiş' },
  { to: '/live', label: '⚡ Canlı Yarışma' },
  { to: '/guide', label: '❓ Kılavuz' },
];

export default function Nav() {
  const [uid, setUid] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      const id = data.session?.user.id || null;
      setUid(id);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setUid(s?.user.id || null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!uid) { setIsAdmin(false); return; }
    sb.from('profiles').select('is_admin').eq('id', uid).single().then(({ data }) => {
      setIsAdmin(!!data?.is_admin);
    });
  }, [uid]);

  if (!uid) return null;

  async function logout() {
    await sb.auth.signOut();
    setOpen(false);
    navigate('/');
  }

  return (
    <>
      <button className="aitakip-nav-btn" aria-label="Menü" onClick={() => setOpen(true)}>☰</button>
      <div className={'aitakip-nav-overlay' + (open ? ' open' : '')} onClick={() => setOpen(false)} />
      <div className={'aitakip-nav-drawer' + (open ? ' open' : '')}>
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className={location.pathname === l.to ? 'active' : ''} onClick={() => setOpen(false)}>
            {l.label}
          </Link>
        ))}
        {isAdmin && (
          <Link to="/admin" className={location.pathname === '/admin' ? 'active' : ''} onClick={() => setOpen(false)}>
            🛠 Admin Paneli
          </Link>
        )}
        <div className="aitakip-nav-sep" />
        <button className="aitakip-item" onClick={toggleTheme}>
          {theme === 'dark' ? '☀ Aydınlık Tema' : '🌙 Karanlık Tema'}
        </button>
        <button className="aitakip-item" onClick={logout}>🚪 Çıkış Yap</button>
      </div>
    </>
  );
}
