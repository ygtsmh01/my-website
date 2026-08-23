import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { sb } from '../lib/supabase';
import type { Profile } from '../lib/types';

// Shared session + profile + is_admin gate reused by every /admin/* page.
// Renders the exact same login-form / not-admin / loading states the
// original monolithic Admin.tsx used, and only renders `children` once the
// viewer is confirmed to be an admin.
export default function AdminGuard({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingAuth(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    sb.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data));
  }, [session]);

  async function login() {
    setAuthError('');
    if (!loginIdentifier.trim() || !passwordInput) { setAuthError('Kullanıcı adı/e-posta ve şifre gerekli.'); return; }
    const { data: resolvedEmail, error: lookupError } = await sb.rpc('email_for_login', { identifier: loginIdentifier.trim() });
    if (lookupError || !resolvedEmail) { setAuthError('Kullanıcı bulunamadı.'); return; }
    const { error } = await sb.auth.signInWithPassword({ email: resolvedEmail, password: passwordInput });
    if (error) setAuthError('Giriş başarısız: ' + error.message);
  }

  async function logout() {
    await sb.auth.signOut();
  }

  if (loadingAuth) return <div className="root wide"><p className="panel-sub">Yükleniyor…</p></div>;

  if (!session) {
    return (
      <div className="root wide">
        <div className="eyebrow">AI Takip Defteri</div>
        <h1>Admin Girişi</h1>
        <div className="panel">
          <label className="field-label">Kullanıcı Adı veya E-posta</label>
          <input type="text" value={loginIdentifier} onChange={(e) => setLoginIdentifier(e.target.value)} />
          <label className="field-label">Şifre</label>
          <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} />
          <button className="btn" onClick={login}>Giriş Yap</button>
          {authError && <div className="error-box">{authError}</div>}
          <p className="panel-sub" style={{ marginTop: 14 }}>Hesabın yoksa önce <Link to="/">ana sayfadan</Link> kayıt ol.</p>
        </div>
      </div>
    );
  }

  if (!profile) return <div className="root wide"><p className="panel-sub">Profil yükleniyor…</p></div>;

  if (!profile.is_admin) {
    return (
      <div className="root wide">
        <div className="eyebrow">AI Takip Defteri</div>
        <h1>Admin Girişi</h1>
        <div className="panel">
          <p className="panel-sub">Bu hesap ({profile.username}) admin yetkisine sahip değil.</p>
          <button className="btn ghost" onClick={logout}>Çıkış Yap</button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
