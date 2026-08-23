import { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import type { Feedback } from '../lib/types';
import AdminGuard from '../components/AdminGuard';

type SubTab = 'feedback' | 'marketing';

function AdminUsersContent() {
  const [subTab, setSubTab] = useState<SubTab>('feedback');

  // Geri bildirimler
  const [feedbackRows, setFeedbackRows] = useState<Feedback[]>([]);
  const [feedbackUsernames, setFeedbackUsernames] = useState<Record<string, string>>({});
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackVersion, setFeedbackVersion] = useState(0);

  // Pazarlama izni olan kullanıcılar
  const [marketingRows, setMarketingRows] = useState<{ username: string; email: string; created_at: string }[] | null>(null);
  const [marketingError, setMarketingError] = useState('');
  const [marketingLoading, setMarketingLoading] = useState(false);

  useEffect(() => {
    setFeedbackError('');
    sb.from('feedback').select('*').order('created_at', { ascending: false }).then(async ({ data, error }) => {
      if (error) { setFeedbackError('Geri bildirimler yüklenemedi: ' + error.message); return; }
      const rows = (data as Feedback[]) || [];
      setFeedbackRows(rows);
      const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
      if (userIds.length === 0) { setFeedbackUsernames({}); return; }
      const { data: profs } = await sb.from('profiles').select('id, username').in('id', userIds);
      const map: Record<string, string> = {};
      for (const p of (profs as { id: string; username: string }[]) || []) map[p.id] = p.username;
      setFeedbackUsernames(map);
    });
  }, [feedbackVersion]);

  async function updateFeedbackStatus(row: Feedback, status: Feedback['status']) {
    setFeedbackError('');
    const prevRows = feedbackRows;
    setFeedbackRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, status } : r)));
    const { error } = await sb.from('feedback').update({ status }).eq('id', row.id);
    if (error) { setFeedbackError('Durum güncellenemedi: ' + error.message); setFeedbackRows(prevRows); }
  }

  async function loadMarketingConsent() {
    setMarketingError(''); setMarketingLoading(true);
    const { data, error } = await sb.rpc('admin_marketing_consent_users');
    setMarketingLoading(false);
    if (error) { setMarketingError('Yüklenemedi: ' + error.message); return; }
    setMarketingRows((data as { username: string; email: string; created_at: string }[]) || []);
  }

  return (
    <div className="root wide">
      <div className="eyebrow" style={{ paddingLeft: 46 }}>AI Takip Defteri</div>
      <h1 style={{ paddingLeft: 46 }}>Kullanıcılar &amp; Geri Bildirim</h1>

      <div className="tabs">
        <button className={subTab === 'feedback' ? 'btn secondary' : 'btn ghost'} onClick={() => setSubTab('feedback')}>Geri Bildirimler</button>
        <button className={subTab === 'marketing' ? 'btn secondary' : 'btn ghost'} onClick={() => setSubTab('marketing')}>Pazarlama İzni</button>
      </div>

      {subTab === 'feedback' && (
        <div className="panel">
          <p className="panel-title">Geri Bildirimler</p>
          <p className="panel-sub">Kullanıcıların gönderdiği genel geri bildirimler ve kaynak/rehber önerileri.</p>
          {feedbackError && <div className="error-box">{feedbackError}</div>}
          {feedbackRows.length === 0 && !feedbackError && <p className="panel-sub">Henüz geri bildirim yok.</p>}
          {feedbackRows.map((f) => (
            <div key={f.id} style={{ border: '1px solid var(--hairline)', padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span>
                  <span className="field-label" style={{ display: 'inline', marginRight: 8 }}>
                    {f.category === 'content_suggestion' ? 'Kaynak-Rehber Önerisi' : 'Genel'}
                  </span>
                  {feedbackUsernames[f.user_id] || f.user_id} · {new Date(f.created_at).toLocaleDateString('tr-TR')}
                </span>
                <select value={f.status} onChange={(e) => updateFeedbackStatus(f, e.target.value as Feedback['status'])}
                  style={{ background: 'var(--ink)', border: '1px solid var(--hairline)', color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '12.5px', padding: '8px' }}>
                  <option value="new">Yeni</option>
                  <option value="reviewed">İncelendi</option>
                  <option value="resolved">Çözüldü</option>
                </select>
              </div>
              <p style={{ marginTop: 8 }}>{f.message}</p>
            </div>
          ))}
          <button className="btn ghost" onClick={() => setFeedbackVersion((v) => v + 1)}>Yenile</button>
        </div>
      )}

      {subTab === 'marketing' && (
        <div className="panel">
          <p className="panel-title">Pazarlama İzni Olan Kullanıcılar</p>
          <p className="panel-sub">Pazarlama/güncelleme e-postalarına izin veren kullanıcıların listesi.</p>
          <button className="btn ghost" onClick={loadMarketingConsent} disabled={marketingLoading}>
            {marketingLoading ? 'Yükleniyor…' : 'Listele'}
          </button>
          {marketingError && <div className="error-box">{marketingError}</div>}
          {marketingRows && marketingRows.length === 0 && <p className="panel-sub" style={{ marginTop: 10 }}>İzin veren kullanıcı yok.</p>}
          {marketingRows && marketingRows.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {marketingRows.map((r) => (
                <div className="week-row" key={r.email}>
                  <span>{r.username} · {r.email}</span>
                  <span>{new Date(r.created_at).toLocaleDateString('tr-TR')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminUsers() {
  return (
    <AdminGuard>
      <AdminUsersContent />
    </AdminGuard>
  );
}
