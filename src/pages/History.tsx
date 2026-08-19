import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb } from '../lib/supabase';
import type { HistoryRow, Profile, Week } from '../lib/types';

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
function formatWeekRange(createdAt?: string | null) {
  if (!createdAt) return '';
  const start = new Date(createdAt);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const sd = start.getDate(), ed = end.getDate();
  const sm = TR_MONTHS[start.getMonth()], em = TR_MONTHS[end.getMonth()];
  return sm === em ? `${sd}-${ed} ${sm}` : `${sd} ${sm} - ${ed} ${em}`;
}

type WeekListItem = Pick<Week, 'week_number' | 'created_at' | 'week_theme' | 'week_label' | 'quiz'>;
type WeekDateInfo = { created_at: string; week_label: string | null };

export default function History() {
  const [theme] = useState(() => localStorage.getItem('aitakip_theme') || 'dark');
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [allWeeks, setAllWeeks] = useState<WeekListItem[]>([]);
  const [weekDates, setWeekDates] = useState<Record<number, WeekDateInfo>>({});
  const [loading, setLoading] = useState(true);
  const [pastWeekContents, setPastWeekContents] = useState<Record<number, Week>>({});
  const [expandedPastWeek, setExpandedPastWeek] = useState<number | null>(null);

  const [missedWeek, setMissedWeek] = useState<Week | null>(null);
  const [missedAnswers, setMissedAnswers] = useState<Record<number, number>>({});
  const [missedStepIndex, setMissedStepIndex] = useState(0);
  const [missedDone, setMissedDone] = useState(false);
  const [missedGain, setMissedGain] = useState(0);

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!session) return;
    refreshHistory();
    sb.from('profiles').select('*').eq('id', session.user.id).single().then(({ data }) => setProfile(data));
    sb.from('weeks').select('week_number, created_at, week_theme, week_label, quiz').order('week_number', { ascending: false })
      .then(({ data }) => {
        setAllWeeks((data as WeekListItem[]) || []);
        const map: Record<number, WeekDateInfo> = {};
        (data || []).forEach((w: any) => { map[w.week_number] = { created_at: w.created_at, week_label: w.week_label ?? null }; });
        setWeekDates(map);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function refreshHistory() {
    const { data } = await sb.from('history').select('*').eq('user_id', session.user.id).order('week_number', { ascending: false });
    setHistory(data || []);
  }

  async function togglePastWeek(weekNumber: number) {
    if (expandedPastWeek === weekNumber) { setExpandedPastWeek(null); return; }
    setExpandedPastWeek(weekNumber);
    if (pastWeekContents[weekNumber]) return;
    const { data } = await sb.from('weeks').select('*').eq('week_number', weekNumber).single();
    if (data) setPastWeekContents((prev) => ({ ...prev, [weekNumber]: data }));
  }

  function startMissedWeek(w: Week) {
    setMissedWeek(w);
    setMissedAnswers({});
    setMissedStepIndex(0);
    setMissedDone(false);
    setMissedGain(0);
  }

  function selectMissedAnswer(qIdx: number, optIdx: number) {
    if (missedAnswers[qIdx] !== undefined) return;
    setMissedAnswers((prev) => ({ ...prev, [qIdx]: optIdx }));
  }

  async function finishMissedWeek() {
    if (!missedWeek || !profile) return;
    const quiz = missedWeek.quiz || [];
    const score = quiz.reduce((acc, q, i) => acc + (missedAnswers[i] === q.correct_index ? 1 : 0), 0);
    const gain = quiz.reduce((acc, q, i) => {
      if (missedAnswers[i] !== q.correct_index) return acc;
      return acc + Math.round((q.bonus ? 20 : 10) / 2);
    }, 0);
    const newXp = Math.max(0, profile.total_xp + gain);
    await sb.from('profiles').update({ total_xp: newXp }).eq('id', profile.id);
    await sb.from('history').insert({
      user_id: profile.id, week_number: missedWeek.week_number, xp_earned: gain,
      quiz_score: score, quiz_total: quiz.length, week_theme: missedWeek.week_theme,
      critical: false, risk_won: null, boss_cleared: false, frozen: false,
    });
    setProfile((p) => (p ? { ...p, total_xp: newXp } : p));
    setMissedGain(gain);
    setMissedDone(true);
    refreshHistory();
  }

  const doneWeekNumbers = new Set(history.map((h) => h.week_number));
  const missedWeeksList = allWeeks.filter((w) => !doneWeekNumbers.has(w.week_number) && w.quiz && w.quiz.length > 0);

  if (loading) return <div className="root toppad"><p className="panel-sub">Yükleniyor…</p></div>;

  if (!session) {
    return (
      <div className="root toppad">
        <h1 style={{ textAlign: 'center' }}>Geçmiş</h1>
        <div className="panel">
          <p className="panel-sub">Geçmişini görmek için önce giriş yapmalısın.</p>
          <Link to="/" style={{ color: 'var(--azure)' }}>Giriş sayfasına git</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="root toppad">
      <div className="eyebrow" style={{ textAlign: 'center' }}>AI Takip Defteri</div>
      <h1 style={{ textAlign: 'center' }}>📚 Geçmiş Haftalar</h1>

      {missedWeeksList.length > 0 && (
        <div className="panel">
          <span className="tag missed">KAÇIRILAN HAFTALAR</span>
          <p className="panel-title">Kaçırdığın Haftalar</p>
          <p className="panel-sub">Katılmadan önce yayınlanmış haftalar. Sorularını çözebilirsin, ama yarı XP verir.</p>
          {!missedWeek ? (
            missedWeeksList.map((w) => (
              <div className="history-row" key={w.week_number}>
                <span className="hw">{w.week_label || formatWeekRange(w.created_at)}</span>
                <button className="btn secondary" onClick={() => startMissedWeek(w as Week)}>Çöz (yarı XP)</button>
              </div>
            ))
          ) : !missedDone ? (
            (() => {
              const mq = missedWeek.quiz[missedStepIndex];
              const mAnswered = mq && missedAnswers[missedStepIndex] !== undefined;
              const mAllAnswered = missedWeek.quiz.every((_, i) => missedAnswers[i] !== undefined);
              return (
                <div>
                  <button className="btn" onClick={() => setMissedWeek(null)} style={{ marginBottom: 14 }}>← Listeye Dön</button>
                  <p className="panel-sub">{missedWeek.week_label || formatWeekRange(missedWeek.created_at)}</p>
                  {!mAllAnswered && mq && (
                    <div>
                      <div className="quiz-progress">Soru {missedStepIndex + 1} / {missedWeek.quiz.length}</div>
                      {mAnswered && (
                        <div className={'feedback-banner ' + (missedAnswers[missedStepIndex] === mq.correct_index ? 'correct' : 'wrong')}>
                          {missedAnswers[missedStepIndex] === mq.correct_index ? '🎉 Doğru!' : '💥 Olmadı.'}
                        </div>
                      )}
                      <div className="quiz-card">
                        <div className="quiz-q">
                          {mq.type === 'tf' && <span className="tag tf">DOĞRU/YANLIŞ</span>}
                          <div>{mq.question}</div>
                        </div>
                        {mq.options.map((opt, oi) => {
                          let cls = 'quiz-opt';
                          if (mAnswered && oi === mq.correct_index) cls += ' correct';
                          else if (mAnswered && oi === missedAnswers[missedStepIndex]) cls += ' wrong';
                          return <button key={oi} className={cls} disabled={mAnswered} onClick={() => selectMissedAnswer(missedStepIndex, oi)}>{opt}</button>;
                        })}
                        {mAnswered && <div className="quiz-explain">{mq.explanation}</div>}
                      </div>
                      {mAnswered && (
                        <button className="btn secondary" onClick={() => setMissedStepIndex((i) => i + 1)}>
                          {missedStepIndex + 1 < missedWeek.quiz.length ? 'Sonraki Soru' : 'Devam Et'}
                        </button>
                      )}
                    </div>
                  )}
                  {mAllAnswered && (
                    <button className="btn secondary" onClick={finishMissedWeek}>Bitir ve XP Al</button>
                  )}
                </div>
              );
            })()
          ) : (
            <div>
              <p className="panel-sub">✓ Tamamlandı, +{missedGain} XP kazandın.</p>
              <button className="btn" onClick={() => setMissedWeek(null)}>Listeye Dön</button>
            </div>
          )}
        </div>
      )}

      <div className="panel">
        {history.length === 0 && <p className="empty-hint">Henüz kayıt yok.</p>}
        {history.map((h) => (
          <div key={h.week_number}>
            <div className="history-row">
              <span className="hw">
                {weekDates[h.week_number] ? (weekDates[h.week_number].week_label || formatWeekRange(weekDates[h.week_number].created_at)) : `Hafta ${h.week_number}`}
                {!h.frozen && (
                  <button className="btn" style={{ marginLeft: 10 }} onClick={() => togglePastWeek(h.week_number)}>
                    {expandedPastWeek === h.week_number ? 'Gizle' : 'Kaynakları Gör'}
                  </button>
                )}
              </span>
              <span>
                {h.frozen ? '❄ Donduruldu' : `${h.quiz_score}/${h.quiz_total} · +${h.xp_earned} XP${h.critical ? ' ⚡' : ''}${h.boss_cleared ? ' 👑' : ''}`}
              </span>
            </div>
            {expandedPastWeek === h.week_number && (
              <div className="past-week-content">
                {!pastWeekContents[h.week_number] ? (
                  <p className="panel-sub">Yükleniyor…</p>
                ) : (
                  <>
                    <p className="panel-sub" style={{ marginBottom: 8 }}>{pastWeekContents[h.week_number].week_theme}</p>
                    {pastWeekContents[h.week_number].must_reads.map((mr, i) => (
                      <div className="read-row" key={i}>
                        {mr.url ? <a href={mr.url} target="_blank" rel="noopener noreferrer">{mr.title}</a> : <strong>{mr.title}</strong>}
                        <div className="one-liner">{mr.summary}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
