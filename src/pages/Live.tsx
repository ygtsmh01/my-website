import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb } from '../lib/supabase';
import TimerRing from '../components/TimerRing';
import type { League, LiveParticipant, LiveRoom, Profile } from '../lib/types';

const QUESTION_SECONDS = 15;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function generateCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
function applyLeagueDelta(tier: number, xp: number, delta: number, leagues: League[]) {
  let t = tier, x = xp + delta;
  while (x < 0 && t > 0) { t -= 1; x = 0; }
  if (x < 0) x = 0;
  while (t < leagues.length - 1 && leagues[t] && leagues[t].promote_threshold != null && x >= (leagues[t].promote_threshold as number)) {
    x -= leagues[t].promote_threshold as number;
    t += 1;
  }
  return { tier: t, xp: x };
}

export default function Live() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'menu' | 'room'>('menu');
  const [error, setError] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [duelBetChoice, setDuelBetChoice] = useState(0);
  const [betResult, setBetResult] = useState<{ outcome: string; amount: number } | null>(null);

  const [room, setRoom] = useState<LiveRoom | null>(null);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [myAnswer, setMyAnswer] = useState<{ optionIndex: number; correct: boolean; points: number; firstCorrect: boolean } | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [awardedBonus, setAwardedBonus] = useState<number | null>(null);
  const [leagueChange, setLeagueChange] = useState<any>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const roomRef = useRef<LiveRoom | null>(null);
  const advancingRef = useRef(false);
  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { advancingRef.current = false; }, [room?.current_question_index]);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
  }, []);

  const [leagues, setLeagues] = useState<League[]>([]);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    sb.from('profiles').select('*').eq('id', session.user.id).single().then(({ data }) => setProfile(data));
    sb.from('leagues').select('*').order('tier_index', { ascending: true }).then(({ data }) => setLeagues((data as League[]) || []));
  }, [session]);

  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 250);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!room) return;
    setMyAnswer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.current_question_index]);

  useEffect(() => {
    if (!room) return;
    const channel = sb.channel('room-' + room.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_rooms', filter: `id=eq.${room.id}` }, (payload: any) => {
        setRoom(payload.new);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_participants', filter: `room_id=eq.${room.id}` }, () => {
        refreshParticipants(room.id);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_answers', filter: `room_id=eq.${room.id}` }, () => {
        const r = roomRef.current;
        if (r) refreshAnsweredCount(r.id, r.current_question_index);
      })
      .subscribe();
    refreshParticipants(room.id);
    return () => { sb.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  useEffect(() => {
    if (!room) return;
    refreshAnsweredCount(room.id, room.current_question_index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, room?.current_question_index]);

  async function refreshAnsweredCount(roomId: string, qIdx: number) {
    const { count } = await sb.from('live_answers').select('*', { count: 'exact', head: true })
      .eq('room_id', roomId).eq('question_index', qIdx);
    setAnsweredCount(count || 0);
  }

  async function advanceQuestion() {
    const r = roomRef.current;
    if (!r || advancingRef.current) return;
    advancingRef.current = true;
    const nextIdx = r.current_question_index + 1;
    if (nextIdx >= r.questions.length) {
      await sb.from('live_rooms').update({ status: 'finished' }).eq('id', r.id);
    } else {
      await sb.from('live_rooms').update({ current_question_index: nextIdx, question_started_at: new Date().toISOString() }).eq('id', r.id);
    }
  }

  // Host: paces the game forward when the timer for the current question runs out (fallback).
  useEffect(() => {
    if (!room || !profile || room.host_id !== profile.id || room.status !== 'active' || !room.question_started_at) return;
    const startedAt = new Date(room.question_started_at).getTime();
    const remaining = QUESTION_SECONDS * 1000 - (Date.now() - startedAt);
    const t = setTimeout(() => { advanceQuestion(); }, Math.max(0, remaining));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.current_question_index, room?.status, room?.host_id, profile?.id]);

  // Host: advance immediately once everyone has answered, instead of waiting out the timer.
  useEffect(() => {
    if (!room || !profile || room.host_id !== profile.id || room.status !== 'active') return;
    if (participants.length > 0 && answeredCount >= participants.length) advanceQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeredCount, participants.length, room?.status, room?.current_question_index, room?.host_id, profile?.id]);

  // Award XP once when the game finishes, based on final rank (plus duel bet payout).
  useEffect(() => {
    if (!room || room.status !== 'finished' || !profile || participants.length === 0) return;
    const mine = participants.find((p) => p.user_id === profile.id);
    if (!mine || mine.xp_awarded) return;
    const ranked = [...participants].sort((a, b) => b.score - a.score);
    const rank = ranked.findIndex((p) => p.user_id === profile.id) + 1;
    const bonus = rank === 1 ? 30 : rank === 2 ? 20 : rank === 3 ? 10 : 5;

    let betDelta = 0;
    let betOutcome: string | null = null;
    if (room.mode === 'duel' && room.bet_amount > 0 && participants.length === 2) {
      const isTie = ranked[0].score === ranked[1].score;
      if (!isTie) {
        if (rank === 1) { betDelta = room.bet_amount; betOutcome = 'won'; }
        else { betDelta = -room.bet_amount; betOutcome = 'lost'; }
      } else {
        betOutcome = 'tie';
      }
    }

    const effectiveTier = Math.min(...participants.map((p) => p.league_tier || 0));
    const effectiveLeague = leagues.find((l) => l.tier_index === effectiveTier);
    const effectiveMult = effectiveLeague ? Number(effectiveLeague.weekly_multiplier) : 1;

    let leagueDelta = 0;
    if (rank === 1) leagueDelta = Math.round(15 * effectiveMult);
    if (betOutcome === 'lost') leagueDelta = -Math.round(20 * effectiveMult);

    (async () => {
      const finalXp = Math.max(0, profile.total_xp + bonus + betDelta);
      const { tier: newTier, xp: newLeagueXp } = applyLeagueDelta(profile.league_tier, profile.league_xp || 0, leagueDelta, leagues);
      await sb.from('profiles').update({ total_xp: finalXp, league_tier: newTier, league_xp: newLeagueXp }).eq('id', profile.id);
      await sb.from('live_participants').update({ xp_awarded: true }).eq('id', mine.id);
      setAwardedBonus(bonus);
      setBetResult(betOutcome ? { outcome: betOutcome, amount: room.bet_amount } : null);
      if (newTier < profile.league_tier) {
        setLeagueChange({
          direction: 'down',
          name: leagues.find((l) => l.tier_index === newTier)?.name,
          fromName: leagues.find((l) => l.tier_index === profile.league_tier)?.name,
          lost: Math.abs(leagueDelta),
        });
      } else if (newTier > profile.league_tier) {
        setLeagueChange({ direction: 'up', name: leagues.find((l) => l.tier_index === newTier)?.name });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status, participants, profile]);

  async function refreshParticipants(roomId: string) {
    const { data } = await sb.from('live_participants').select('*').eq('room_id', roomId).order('score', { ascending: false });
    setParticipants(data || []);
  }

  async function fetchQuestionPool() {
    const { data } = await sb.from('weeks').select('quiz');
    let all: any[] = [];
    (data || []).forEach((w: any) => {
      (w.quiz || []).forEach((q: any) => {
        all.push({ question: q.question, options: q.options, correct_index: q.correct_index, explanation: q.explanation });
      });
    });
    return shuffle(all);
  }

  async function createRoom(mode: 'room' | 'duel') {
    setError('');
    const pool = await fetchQuestionPool();
    if (pool.length < 4) { setError('Yeterli soru yok, önce birkaç hafta yayınlanmış olmalı.'); return; }
    const questions = pool.slice(0, Math.min(8, pool.length));
    const betAmount = mode === 'duel' ? duelBetChoice : 0;
    let lastError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateCode();
      const { data, error: insertError } = await sb.from('live_rooms')
        .insert({ code, mode, host_id: profile!.id, questions, status: 'waiting', bet_amount: betAmount, league_tier: profile!.league_tier })
        .select().single();
      if (!insertError && data) {
        const { error: partError } = await sb.from('live_participants').insert({ room_id: data.id, user_id: profile!.id, username: profile!.username, avatar: profile!.avatar, league_tier: profile!.league_tier });
        if (partError) { setError('Katılımcı eklenemedi: ' + partError.message); return; }
        setRoom(data);
        setView('room');
        return;
      }
      lastError = insertError;
      if (insertError && !String(insertError.message).toLowerCase().includes('duplicate')) break;
    }
    setError('Oda oluşturulamadı: ' + (lastError ? lastError.message : 'bilinmeyen hata'));
  }

  async function joinRoom() {
    setError('');
    const codeUp = joinCodeInput.trim().toUpperCase();
    if (!codeUp) return;
    const { data: r, error: findError } = await sb.from('live_rooms').select('*').eq('code', codeUp).single();
    if (findError || !r) { setError('Oda bulunamadı.'); return; }
    if (r.status !== 'waiting') { setError('Bu oda artık katılıma kapalı.'); return; }
    if (r.mode === 'duel') {
      const { count } = await sb.from('live_participants').select('*', { count: 'exact', head: true }).eq('room_id', r.id);
      if ((count || 0) >= 2) { setError('Düello odası dolu.'); return; }
    }
    const { error: joinError } = await sb.from('live_participants').insert({ room_id: r.id, user_id: profile!.id, username: profile!.username, avatar: profile!.avatar, league_tier: profile!.league_tier });
    if (joinError && !String(joinError.message).toLowerCase().includes('duplicate')) {
      setError('Katılamadın: ' + joinError.message); return;
    }
    setRoom(r);
    setView('room');
  }

  async function startGame() {
    await sb.from('live_rooms').update({ status: 'active', current_question_index: 0, question_started_at: new Date().toISOString() }).eq('id', room!.id);
  }

  async function submitAnswer(optionIndex: number) {
    if (myAnswer || !room) return;
    const q = room.questions[room.current_question_index];
    const correct = optionIndex === q.correct_index;
    const elapsedMs = Date.now() - new Date(room.question_started_at as string).getTime();
    const speedBonus = Math.max(0, Math.round(50 * (1 - elapsedMs / (QUESTION_SECONDS * 1000))));
    let firstCorrect = false;
    if (correct) {
      const { count } = await sb.from('live_answers').select('*', { count: 'exact', head: true })
        .eq('room_id', room.id).eq('question_index', room.current_question_index).eq('correct', true);
      firstCorrect = (count || 0) === 0;
    }
    const points = correct ? 100 + speedBonus + (firstCorrect ? 30 : 0) : 0;
    setMyAnswer({ optionIndex, correct, points, firstCorrect });
    const { error: ansError } = await sb.from('live_answers').insert({
      room_id: room.id, user_id: profile!.id, question_index: room.current_question_index,
      option_index: optionIndex, correct, points,
    });
    if (ansError) return;
    const mine = participants.find((p) => p.user_id === profile!.id);
    if (mine) await sb.from('live_participants').update({ score: mine.score + points }).eq('id', mine.id);
  }

  async function leaveRoom() {
    if (room && profile && room.status !== 'finished') {
      if (!window.confirm('Oyun bitmeden ayrılırsan 15 XP kaybedersin. Emin misin?')) return;
      const PENALTY = 15;
      await sb.from('profiles').update({ total_xp: Math.max(0, profile.total_xp - PENALTY) }).eq('id', profile.id);
      const mine = participants.find((p) => p.user_id === profile.id);
      if (mine) await sb.from('live_participants').delete().eq('id', mine.id);
      if (room.host_id === profile.id) {
        await sb.from('live_rooms').update({ status: 'finished' }).eq('id', room.id);
      }
    }
    setRoom(null);
    setParticipants([]);
    setMyAnswer(null);
    setAwardedBonus(null);
    setBetResult(null);
    setLeagueChange(null);
    setView('menu');
  }

  if (loading) return <div className="root wide"><p className="panel-sub">Yükleniyor…</p></div>;

  if (!session) {
    return (
      <div className="root wide">
        <div className="eyebrow">AI Takip Defteri</div>
        <h1>Canlı Yarışma</h1>
        <div className="panel">
          <p className="panel-sub">Canlı yarışmaya katılmak için önce ana sayfadan giriş yapmalısın.</p>
          <Link to="/" className="btn" style={{ textDecoration: 'none', display: 'inline-block' }}>Giriş Sayfasına Git</Link>
        </div>
      </div>
    );
  }

  if (!profile) return <div className="root wide"><p className="panel-sub">Profil yükleniyor…</p></div>;

  if (view === 'menu') {
    return (
      <div className="root wide">
        <div className="eyebrow" style={{ paddingLeft: 46 }}>AI Takip Defteri · {profile.avatar} {profile.username}</div>
        <h1 style={{ paddingLeft: 46 }}>Canlı Yarışma</h1>
        <p className="panel-sub">Ligin: <strong>{leagues.find((l) => l.tier_index === profile.league_tier)?.name || '—'}</strong>. Herkesle yarışabilirsin — odadaki en düşük ligli kişiye göre kazanılacak lig puanı ayarlanır.</p>

        <div className="mode-row">
          <div className="panel" onClick={() => createRoom('room')}>
            <p className="panel-title">🎮 Oda Aç</p>
            <p className="panel-sub">Herhangi bir arkadaşın koduyla katılsın. Geçmiş tüm haftaların sorularından karışık 8 soru.</p>
          </div>
          <div className="panel" style={{ cursor: 'default' }}>
            <p className="panel-title">⚔ Düello Başlat</p>
            <p className="panel-sub">Tek bir rakiple 1'e 1 yarış. Kaybeden, bahis miktarı kadar XP'sini kazanana kaptırır. Ayrıca kaybeden lig puanı da kaybeder — yeterince düşerse bir alt lige inebilirsin.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {[0, 25, 50, 100].map((v) => (
                <button key={v} className="btn ghost" onClick={() => setDuelBetChoice(v)}
                  style={{ borderColor: duelBetChoice === v ? 'var(--brass)' : 'var(--hairline)' }}>
                  {v === 0 ? 'Bahissiz' : v + ' XP'}
                </button>
              ))}
            </div>
            <button className="btn secondary" onClick={() => createRoom('duel')}>Düelloyu Başlat</button>
          </div>
        </div>

        <div className="panel">
          <p className="panel-title">Kod ile Katıl</p>
          <input type="text" value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value)} placeholder="ORNK5" maxLength={5} />
          <button className="btn secondary" onClick={joinRoom} disabled={!joinCodeInput.trim()}>Katıl</button>
        </div>

        {error && <div className="error-box">{error}</div>}
      </div>
    );
  }

  if (!room) return <div className="root wide"><p className="panel-sub">Oda yükleniyor…</p></div>;

  const isHost = room.host_id === profile.id;
  const ranked = [...participants].sort((a, b) => b.score - a.score);

  if (room.status === 'waiting') {
    return (
      <div className="root wide">
        <div className="top-bar-row"><button className="btn ghost" onClick={leaveRoom}>Odadan Ayrıl (-15 XP)</button></div>
        <div className="eyebrow">{room.mode === 'duel' ? 'Düello' : 'Canlı Oda'} · Bekleniyor</div>
        <h1>Oda Kodu</h1>
        <div className="panel">
          <div className="code-display">{room.code}</div>
          <p className="panel-sub" style={{ textAlign: 'center' }}>Bu kodu paylaş, katılanlar burada görünecek.</p>
          {room.mode === 'duel' && (
            <p className="panel-sub" style={{ textAlign: 'center' }}>
              {room.bet_amount > 0 ? `⚔ Bahis: ${room.bet_amount} XP — kaybeden bu kadar XP'sini kazanana kaptırır.` : 'Bahissiz düello.'}
            </p>
          )}
        </div>
        <div className="panel">
          <p className="panel-title">Katılımcılar ({participants.length})</p>
          {participants.map((p) => (
            <div className="participant-row" key={p.id}>
              <span>{p.avatar} {p.username}{p.user_id === room.host_id ? ' (host)' : ''}</span>
            </div>
          ))}
        </div>
        {isHost ? (
          <button className="btn secondary" onClick={startGame} disabled={participants.length < 2}>
            {participants.length < 2 ? 'En az 2 katılımcı gerekli' : 'Yarışmayı Başlat'}
          </button>
        ) : (
          <p className="panel-sub">Host'un başlatmasını bekliyorsun…</p>
        )}
      </div>
    );
  }

  if (room.status === 'active') {
    const q = room.questions[room.current_question_index];
    const startedAt = new Date(room.question_started_at as string).getTime();
    const remainingSec = Math.max(0, Math.ceil(QUESTION_SECONDS - (nowTick - startedAt) / 1000));
    return (
      <div className="root wide">
        <div className="top-bar-row"><button className="btn ghost" onClick={leaveRoom}>Odadan Ayrıl (-15 XP)</button></div>
        <div className="eyebrow">{room.mode === 'duel' ? 'Düello' : 'Canlı Oda'} · Soru {room.current_question_index + 1}/{room.questions.length}</div>
        <div style={{ textAlign: 'center', marginBottom: 14 }}><TimerRing seconds={remainingSec} total={QUESTION_SECONDS} size={64} /></div>
        <div className="quiz-card">
          <div className="quiz-q">{q.question}</div>
          {q.options.map((opt, oi) => {
            let cls = 'quiz-opt';
            if (myAnswer && oi === q.correct_index) cls += ' correct';
            else if (myAnswer && oi === myAnswer.optionIndex) cls += ' wrong';
            return <button key={oi} className={cls} disabled={!!myAnswer} onClick={() => submitAnswer(oi)}>{opt}</button>;
          })}
          {myAnswer && (
            <p className="panel-sub" style={{ marginTop: 10 }}>
              {myAnswer.correct
                ? `${myAnswer.firstCorrect ? '🥇 İlk doğru cevap! ' : ''}Doğru! +${myAnswer.points} puan.`
                : 'Yanlış, sıradaki soruyu bekle.'} {q.explanation}
            </p>
          )}
        </div>
        <div className="panel">
          <p className="panel-title">Canlı Sıralama</p>
          {ranked.map((p, i) => (
            <div className={'participant-row' + (p.user_id === profile.id ? ' me' : '')} key={p.id}>
              <span><span className="rank">#{i + 1}</span>{p.avatar} {p.username}</span>
              <span>{p.score} puan</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // finished
  return (
    <div className="root wide">
      <div className="top-bar-row"><button className="btn ghost" onClick={leaveRoom}>Ana Menüye Dön</button></div>
      <div className="eyebrow">{room.mode === 'duel' ? 'Düello' : 'Canlı Oda'} · Bitti</div>
      <h1>Final Sıralaması</h1>
      <div className="panel">
        {ranked.map((p, i) => (
          <div className={'participant-row' + (p.user_id === profile.id ? ' me' : '')} key={p.id}>
            <span><span className="rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1)}</span>{p.avatar} {p.username}</span>
            <span>{p.score} puan</span>
          </div>
        ))}
        {awardedBonus !== null && <p className="panel-sub" style={{ marginTop: 14 }}>+{awardedBonus} XP hesabına eklendi.</p>}
        {betResult && betResult.outcome === 'won' && <p className="panel-sub">⚔ Bahsi kazandın! Rakibinden +{betResult.amount} XP aldın.</p>}
        {betResult && betResult.outcome === 'lost' && <p className="panel-sub">⚔ Bahsi kaybettin, rakibine {betResult.amount} XP kaptırdın.</p>}
        {betResult && betResult.outcome === 'tie' && <p className="panel-sub">⚔ Berabere, bahis iade edildi.</p>}
        {leagueChange && leagueChange.direction === 'up' && <p className="panel-sub">🏆 Lig puanınla terfi ettin: {leagueChange.name}!</p>}
        {leagueChange && leagueChange.direction === 'down' && (
          <p className="panel-sub">📉 Bahsi kaybettiğin için {leagueChange.lost} lig puanı kaybettin ve {leagueChange.fromName} liginden {leagueChange.name} ligine düştün.</p>
        )}
      </div>
      <button className="btn secondary" onClick={leaveRoom}>Yeni Bir Yarışma Başlat</button>
    </div>
  );
}
