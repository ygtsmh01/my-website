import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb } from '../lib/supabase';
import type { League, Profile } from '../lib/types';

type LbRow = Pick<Profile, 'id' | 'username' | 'avatar' | 'total_xp' | 'streak' | 'league_tier'>;

export default function Leaderboard() {
  const [session, setSession] = useState<any>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LbRow[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setMyId(data.session?.user.id || null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    sb.from('profiles').select('id, username, avatar, total_xp, streak, league_tier').order('total_xp', { ascending: false }).limit(100)
      .then(({ data }) => setLeaderboard(data || []));
    sb.from('leagues').select('tier_index, name').then(({ data }) => setLeagues((data as League[]) || []));
  }, [session]);

  if (loading) return <div className="root toppad"><p className="panel-sub">Yükleniyor…</p></div>;

  if (!session) {
    return (
      <div className="root toppad">
        <h1 style={{ textAlign: 'center' }}>Sıralama</h1>
        <div className="panel">
          <p className="panel-sub">Sıralamayı görmek için önce giriş yapmalısın.</p>
          <Link to="/" style={{ color: 'var(--azure)' }}>Giriş sayfasına git</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="root toppad">
      <div className="eyebrow" style={{ textAlign: 'center' }}>AI Takip Defteri</div>
      <h1 style={{ textAlign: 'center' }}>🏆 Sıralama Tablosu</h1>
      <div className="panel">
        {leaderboard.map((u, i) => (
          <div className={'lb-row' + (u.id === myId ? ' me' : '')} key={u.id}>
            <span><span className="rank">#{i + 1}</span><span className="hw">{u.avatar} {u.username}</span></span>
            <span style={{ textAlign: 'right' }}>
              <div>{u.total_xp} XP · {u.streak} seri</div>
              <div className="tier">{leagues.find((l) => l.tier_index === u.league_tier)?.name || ''}</div>
            </span>
          </div>
        ))}
        {leaderboard.length === 0 && <p className="panel-sub">Henüz kimse yok.</p>}
      </div>
    </div>
  );
}
