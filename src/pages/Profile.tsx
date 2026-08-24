import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb } from '../lib/supabase';
import { evaluateLeagueStreak, LEAGUE_STREAK_FLOOR_TIER, SUCCESS_STREAK_NEEDED } from '../lib/leagueStreak';
import type { HistoryRow, League, Profile as ProfileType } from '../lib/types';

const AVATAR_OPTIONS = ['🙂', '🦊', '🐙', '🐼', '🦉', '🐳', '🦁', '🐸', '🤖', '👾', '🦄', '🐢'];

const LEVEL_TITLES = [
  { min: 0, name: 'Çırak' },
  { min: 100, name: 'Pratisyen' },
  { min: 250, name: 'Kıdemli Pratisyen' },
  { min: 450, name: 'Uzman' },
  { min: 700, name: 'Stratejist' },
  { min: 1000, name: 'Risk + AI Mimarı' },
];
function levelFor(xp: number) {
  let idx = 0;
  for (let i = 0; i < LEVEL_TITLES.length; i++) if (xp >= LEVEL_TITLES[i].min) idx = i;
  return { level: idx + 1, name: LEVEL_TITLES[idx].name, floor: LEVEL_TITLES[idx].min, next: LEVEL_TITLES[idx + 1] as { min: number; name: string } | undefined };
}

const BADGE_DEFS: { id: string; label: string; check: (p: ProfileType, h: HistoryRow[]) => boolean }[] = [
  { id: 'ilk-hafta', label: 'İlk Hafta', check: (_p, h) => h.length >= 1 },
  { id: 'seri-3', label: '3 Hafta Seri', check: (p) => p.streak >= 3 },
  { id: 'seri-5', label: '5 Hafta Seri', check: (p) => p.streak >= 5 },
  { id: 'seri-10', label: '10 Hafta Seri', check: (p) => p.streak >= 10 },
  { id: 'mukemmel', label: 'Mükemmel Skor', check: (_p, h) => h.some((x) => x.quiz_total > 0 && x.quiz_score === x.quiz_total) },
  { id: 'on-hafta', label: '10 Hafta Tamamlandı', check: (_p, h) => h.length >= 10 },
  { id: 'kumarbaz', label: 'Kumarbaz', check: (_p, h) => h.some((x) => x.risk_won) },
  { id: 'boss-avcisi', label: 'Boss Avcısı', check: (_p, h) => h.some((x) => x.boss_cleared) },
];

export default function Profile() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<ProfileType | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);

  const [avatarDraft, setAvatarDraft] = useState('');
  const [usernameDraft, setUsernameDraft] = useState('');
  const [avatarError, setAvatarError] = useState('');
  const [avatarOk, setAvatarOk] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameOk, setUsernameOk] = useState('');

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!session) return;
    sb.from('profiles').select('*').eq('id', session.user.id).single().then(async ({ data }) => {
      if (!data) { setProfile(data); return; }
      setAvatarDraft(data.avatar); setUsernameDraft(data.username);
      const { data: weekRows } = await sb.from('weeks').select('week_number').order('week_number', { ascending: false }).limit(1);
      const currentWeekNumber = weekRows && weekRows[0] ? weekRows[0].week_number : 0;
      setProfile(currentWeekNumber ? await evaluateLeagueStreak(data, currentWeekNumber) : data);
    });
    sb.from('history').select('*').eq('user_id', session.user.id).then(({ data }) => setHistory(data || []));
    sb.from('leagues').select('*').order('tier_index', { ascending: true }).then(({ data }) => setLeagues((data as League[]) || []));
  }, [session]);

  async function saveAvatar(a: string) {
    setAvatarError(''); setAvatarOk('');
    setAvatarDraft(a);
    const { error } = await sb.from('profiles').update({ avatar: a }).eq('id', profile!.id);
    if (error) { setAvatarError('Kaydedilemedi: ' + error.message); return; }
    setProfile((p) => (p ? { ...p, avatar: a } : p));
    setAvatarOk('Avatar güncellendi.');
  }

  async function saveUsername() {
    setUsernameError(''); setUsernameOk('');
    if (!usernameDraft.trim()) { setUsernameError('Kullanıcı adı boş olamaz.'); return; }
    const { error } = await sb.from('profiles').update({ username: usernameDraft.trim() }).eq('id', profile!.id);
    if (error) {
      setUsernameError(error.message.includes('duplicate') ? 'Bu kullanıcı adı zaten alınmış.' : 'Kaydedilemedi: ' + error.message);
      return;
    }
    setProfile((p) => (p ? { ...p, username: usernameDraft.trim() } : p));
    setUsernameOk('Kullanıcı adı güncellendi.');
  }

  if (loading) return <div className="root toppad"><p className="panel-sub">Yükleniyor…</p></div>;

  if (!session) {
    return (
      <div className="root toppad">
        <h1 style={{ textAlign: 'center' }}>Profil</h1>
        <div className="panel">
          <p className="panel-sub">Profilini görmek için önce giriş yapmalısın.</p>
          <Link to="/" className="btn" style={{ textDecoration: 'none', display: 'inline-block' }}>Giriş Sayfasına Git</Link>
        </div>
      </div>
    );
  }

  if (!profile) return <div className="root toppad"><p className="panel-sub">Profil yükleniyor…</p></div>;

  const lvl = levelFor(profile.total_xp);
  const xpSpan = lvl.next ? lvl.next.min - lvl.floor : 1;
  const xpPct = lvl.next ? Math.min(100, Math.round(((profile.total_xp - lvl.floor) / xpSpan) * 100)) : 100;
  const myLeague = leagues.find((l) => l.tier_index === profile.league_tier);

  return (
    <div className="root toppad">
      <div className="eyebrow" style={{ textAlign: 'center' }}>AI Takip Defteri</div>
      <h1 style={{ textAlign: 'center' }}>Profil</h1>

      <div className="panel" style={{ textAlign: 'center' }}>
        <div className="avatar-hero">{avatarDraft}</div>
        <p className="panel-title">{profile.username}</p>
        <p className="panel-sub">Seviye {lvl.level} · {lvl.name}</p>
        <div className="avatar-grid">
          {AVATAR_OPTIONS.map((a) => (
            <button key={a} className={'avatar-opt' + (avatarDraft === a ? ' selected' : '')} onClick={() => saveAvatar(a)}>{a}</button>
          ))}
        </div>
        {avatarError && <div className="error-box">{avatarError}</div>}
        {avatarOk && <div className="ok-box">{avatarOk}</div>}

        <div style={{ textAlign: 'left', marginTop: 18 }}>
          <label className="field-label">Kullanıcı Adı</label>
          <input type="text" value={usernameDraft} onChange={(e) => setUsernameDraft(e.target.value)} />
          <button className="btn" onClick={saveUsername} disabled={usernameDraft.trim() === profile.username}>Kaydet</button>
          {usernameError && <div className="error-box">{usernameError}</div>}
          {usernameOk && <div className="ok-box">{usernameOk}</div>}
        </div>
      </div>

      {myLeague && (
        <div className="panel">
          <p className="panel-title">🏅 {myLeague.name}</p>
          {myLeague.promote_threshold ? (
            <p className="panel-sub">Bir sonraki lige terfi etmek için rehberdeki tüm üniteleri ve bitirme sınavını tamamla.</p>
          ) : (
            <p className="panel-sub">En üst ligdesin.</p>
          )}
          {myLeague.tier_index >= LEAGUE_STREAK_FLOOR_TIER && myLeague.promote_threshold && (
            profile.league_miss_streak > 0 ? (
              <p className="panel-sub">⚠️ Art arda {profile.league_miss_streak} hafta kaçırdın/başarısız oldun — devam edersen lig düşersin.</p>
            ) : (
              <p className="panel-sub">Terfi için 2 haftalık başarı serisi: {profile.league_success_streak}/{SUCCESS_STREAK_NEEDED}</p>
            )
          )}
        </div>
      )}

      <div className="stat-strip grid2">
        <div className="stat-cell">
          <div className="stat-label">Toplam XP</div>
          <div className="stat-value">{profile.total_xp}</div>
          <div className="xp-track"><div className="xp-fill" style={{ width: xpPct + '%' }} /></div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Aktif Seri</div>
          <div className="stat-value">{profile.streak} hafta</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Tamamlanan Hafta</div>
          <div className="stat-value">{history.length}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Dondurma Hakkı</div>
          <div className="stat-value">❄ {profile.freezes || 0}</div>
        </div>
      </div>

      <div className="panel">
        <p className="panel-title">Rozet Duvarı</p>
        <div className="badge-wall">
          {BADGE_DEFS.map((b) => (
            <div key={b.id} className={'badge' + (b.check(profile, history) ? ' earned' : '')}>
              <span className="badge-dot" />{b.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
