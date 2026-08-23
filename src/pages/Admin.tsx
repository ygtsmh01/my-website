import { useState } from 'react';
import { Link } from 'react-router-dom';
import AdminGuard from '../components/AdminGuard';

export const APIKEY_SESSION_KEY = 'aitakip_admin_apikey';

function AdminHome() {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem(APIKEY_SESSION_KEY) || '');
  const [keyDraft, setKeyDraft] = useState('');

  function saveKey() {
    if (!keyDraft.trim()) return;
    sessionStorage.setItem(APIKEY_SESSION_KEY, keyDraft.trim());
    setApiKey(keyDraft.trim());
    setKeyDraft('');
  }

  return (
    <div className="root wide">
      <div className="eyebrow" style={{ paddingLeft: 46 }}>AI Takip Defteri</div>
      <h1 style={{ paddingLeft: 46 }}>Admin Paneli</h1>

      {!apiKey ? (
        <div className="panel">
          <p className="panel-title">Anthropic API Anahtarı</p>
          <p className="panel-sub">Bu anahtar sadece bu tarayıcı sekmesinde, sayfa kapanana kadar bellekte tutulur (sessionStorage). Veritabanına hiç gitmez.</p>
          <input type="password" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="sk-ant-..." />
          <button className="btn" onClick={saveKey} disabled={!keyDraft.trim()}>Kaydet</button>
        </div>
      ) : (
        <div className="panel">
          <p className="panel-title">Anthropic API Anahtarı</p>
          <p className="panel-sub">Anahtar girildi ✓ — "Haftalık İçerik" ve "Lig Yönetimi" sayfalarında kullanılabilir.</p>
          <button className="btn ghost" onClick={() => { sessionStorage.removeItem(APIKEY_SESSION_KEY); setApiKey(''); }}>Anahtarı Kaldır</button>
        </div>
      )}

      <div className="panel">
        <p className="panel-title">Yönetim Sayfaları</p>
        <p className="panel-sub" style={{ marginBottom: 10 }}>Hızlı erişim.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Link to="/admin/haftalik-icerik">🗞️ Haftalık İçerik</Link>
          <Link to="/admin/lig-yonetimi">🏅 Lig Yönetimi</Link>
          <Link to="/admin/kullanicilar">💬 Kullanıcılar &amp; Geri Bildirim</Link>
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  return (
    <AdminGuard>
      <AdminHome />
    </AdminGuard>
  );
}
