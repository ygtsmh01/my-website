import { useEffect, useRef, useState } from 'react';
import { sb } from '../lib/supabase';
import TimerRing from '../components/TimerRing';
import { useTheme } from '../lib/ThemeContext';
import type { League, LeagueProgress, Profile, Week } from '../lib/types';

const BOSS_EVERY = 5;
const SPEED_SECONDS = 90;
const AVATAR_OPTIONS = ['🙂', '🦊', '🐙', '🐼', '🦉', '🐳', '🦁', '🐸', '🤖', '👾', '🦄', '🐢'];
const ONBOARDING_KEY = 'aitakip_onboarding_seen_v1';
const SWIPE_THRESHOLD = 45;
const ONBOARDING_SLIDES = [
  { emoji: '🎮', title: 'Haftalık Oyun', text: 'Her hafta yeni kaynaklar gelir. Okuyup soru soru ilerleyen sınavı çöz, XP kazan.' },
  { emoji: '🏅', title: 'Lig Sistemi', text: 'Sabit rehberini tamamla, haftalık quizlerle puan topla, ligini yükselt.' },
  { emoji: '⚡', title: 'Canlı Yarışma', text: "Arkadaşlarınla oda kur ya da düello yap, gerçek zamanlı yarış." },
  { emoji: '☰', title: 'Her An Kılavuza Dön', text: 'Sol üstteki menüden Profil, Sıralama, Geçmiş ve Kılavuz sayfalarına ulaşabilirsin.' },
];

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

function applyLeagueDelta(tier: number, xp: number, delta: number, leagues: League[], completedTiers: Set<number>) {
  let t = tier, x = xp + delta;
  while (x < 0 && t > 0) { t -= 1; x = 0; }
  if (x < 0) x = 0;
  // Promotion requires BOTH crossing the XP threshold AND having completed the current tier's guide —
  // XP can keep accumulating past the threshold, but the tier only advances once the guide is done.
  while (
    t < leagues.length - 1 && leagues[t] && leagues[t].promote_threshold != null &&
    x >= (leagues[t].promote_threshold as number) && completedTiers.has(t)
  ) {
    x -= leagues[t].promote_threshold as number;
    t += 1;
  }
  return { tier: t, xp: x };
}

// Extra per-week stages that follow the main quiz, run inside the same focused stepper card.
type ExtraStage = 'number' | 'risk' | 'boss';

export default function Game() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const { theme, toggleTheme } = useTheme();

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [avatarInput, setAvatarInput] = useState(AVATAR_OPTIONS[0]);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [currentWeek, setCurrentWeek] = useState<Week | null>(null);
  const [alreadyDone, setAlreadyDone] = useState(false);

  const [checkedReads, setCheckedReads] = useState<Record<number, boolean>>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizStepIndex, setQuizStepIndex] = useState(0);
  const [weekClosed, setWeekClosed] = useState(false);
  const [lastGain, setLastGain] = useState<number | null>(null);
  const [lastCritical, setLastCritical] = useState(false);
  const [lastFreezeEarned, setLastFreezeEarned] = useState(false);
  const [lastStreakBonus, setLastStreakBonus] = useState(0);
  const [numberGuess, setNumberGuess] = useState('');
  const [numberSubmitted, setNumberSubmitted] = useState(false);
  const [numberCorrectDisplay, setNumberCorrectDisplay] = useState(false);
  const [riskChoice, setRiskChoice] = useState<'bet' | 'skip' | null>(null);
  const [riskAnswer, setRiskAnswer] = useState<number | null>(null);
  const [bossAnswer, setBossAnswer] = useState<number | null>(null);
  const [extraStepIndex, setExtraStepIndex] = useState(0);
  const [speedActive, setSpeedActive] = useState(false);
  const [speedTimeLeft, setSpeedTimeLeft] = useState(SPEED_SECONDS);
  const [speedResult, setSpeedResult] = useState<boolean | null>(null);
  const [lastRiskResult, setLastRiskResult] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [sessionXp, setSessionXp] = useState(0);
  const [readBonusGranted, setReadBonusGranted] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const [leagues, setLeagues] = useState<League[]>([]);
  const [leagueProgress, setLeagueProgress] = useState<LeagueProgress | null>(null);
  const [activeTab, setActiveTab] = useState<'week' | 'guide'>('week');
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  const [curriculumAnswers, setCurriculumAnswers] = useState<Record<number, number>>({});
  const [curriculumStepIndex, setCurriculumStepIndex] = useState(0);
  const [guideTestModeOpen, setGuideTestModeOpen] = useState(false);
  const [curriculumSaving, setCurriculumSaving] = useState(false);
  const [weeklyReplayActive, setWeeklyReplayActive] = useState(false);
  const [replayQuizAnswers, setReplayQuizAnswers] = useState<Record<number, number>>({});
  const [replayQuizStepIndex, setReplayQuizStepIndex] = useState(0);
  const [lastPromotion, setLastPromotion] = useState<string | null>(null);
  const [completedTiers, setCompletedTiers] = useState<Set<number>>(new Set());

  const weekSectionRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setLoadingAuth(false); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    refreshProfile();
    sb.from('weeks').select('*').order('week_number', { ascending: false }).limit(1)
      .then(({ data }) => setCurrentWeek(data && data[0] ? data[0] : null));
    sb.from('leagues').select('*').order('tier_index', { ascending: true })
      .then(({ data }) => setLeagues(data || []));
  }, [session]);

  useEffect(() => {
    if (profile && currentWeek) setAlreadyDone(profile.last_week_number >= currentWeek.week_number);
  }, [profile, currentWeek]);

  useEffect(() => {
    if (!profile) { setLeagueProgress(null); return; }
    sb.from('league_progress').select('*').eq('user_id', profile.id).eq('tier_index', profile.league_tier).maybeSingle()
      .then(({ data }) => setLeagueProgress(data));
  }, [profile?.id, profile?.league_tier]);

  // Full set of tiers this user has completed the guide for — needed to gate league promotion
  // (crossing the XP threshold alone is not enough, see applyLeagueDelta).
  useEffect(() => {
    if (!profile) { setCompletedTiers(new Set()); return; }
    sb.from('league_progress').select('tier_index, completed').eq('user_id', profile.id).eq('completed', true)
      .then(({ data }) => setCompletedTiers(new Set(((data as any[]) || []).map((r) => r.tier_index))));
  }, [profile?.id]);

  useEffect(() => {
    if (!profile) return;
    if (!localStorage.getItem(ONBOARDING_KEY)) setOnboardingStep(0);
  }, [profile?.id]);

  useEffect(() => {
    setSessionXp(0);
    setReadBonusGranted(false);
    setExtraStepIndex(0);
  }, [currentWeek?.week_number]);

  useEffect(() => {
    if (!speedActive || speedTimeLeft <= 0) return;
    const t = setTimeout(() => setSpeedTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [speedActive, speedTimeLeft]);

  useEffect(() => {
    if (speedActive && speedTimeLeft <= 0 && speedResult === null) {
      setSpeedActive(false);
      setSpeedResult(false);
    }
  }, [speedActive, speedTimeLeft, speedResult]);

  useEffect(() => {
    if (showSources) weekSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showSources]);

  async function refreshProfile() {
    const { data: sessionData } = await sb.auth.getSession();
    const uid = sessionData.session && sessionData.session.user.id;
    if (!uid) return;
    const { data: p } = await sb.from('profiles').select('*').eq('id', uid).single();
    setProfile(p);
  }

  async function register() {
    setAuthBusy(true); setAuthError(''); setAuthNotice('');
    if (!emailInput.trim() || !usernameInput.trim() || !passwordInput) {
      setAuthError('E-posta, kullanıcı adı ve şifre gerekli.'); setAuthBusy(false); return;
    }
    const { error } = await sb.auth.signUp({
      email: emailInput.trim(),
      password: passwordInput,
      options: { data: { username: usernameInput.trim(), marketing_consent: marketingConsent, avatar: avatarInput } },
    });
    if (error) {
      setAuthError('Kayıt başarısız: ' + error.message);
    } else {
      setAuthNotice('Kayıt alındı! E-postana gelen onay linkine tıkladıktan sonra giriş yapabilirsin.');
    }
    setAuthBusy(false);
  }

  async function login() {
    setAuthBusy(true); setAuthError(''); setAuthNotice('');
    if (!loginIdentifier.trim() || !passwordInput) {
      setAuthError('Kullanıcı adı/e-posta ve şifre gerekli.'); setAuthBusy(false); return;
    }
    const { data: resolvedEmail, error: lookupError } = await sb.rpc('email_for_login', { identifier: loginIdentifier.trim() });
    if (lookupError || !resolvedEmail) {
      setAuthError('Kullanıcı bulunamadı.'); setAuthBusy(false); return;
    }
    const { error } = await sb.auth.signInWithPassword({ email: resolvedEmail, password: passwordInput });
    if (error) setAuthError('Giriş başarısız: ' + error.message);
    setAuthBusy(false);
  }

  function closeOnboarding() {
    localStorage.setItem(ONBOARDING_KEY, '1');
    setOnboardingStep(null);
  }
  function onboardingNext() {
    setOnboardingStep((s) => {
      if (s === null) return s;
      if (s < ONBOARDING_SLIDES.length - 1) return s + 1;
      closeOnboarding();
      return s;
    });
  }
  function onboardingBack() {
    setOnboardingStep((s) => (s === null || s === 0 ? s : s - 1));
  }
  function onOnboardingTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onOnboardingTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    if (delta < 0) onboardingNext();
    else onboardingBack();
  }

  function startSpeedRound() {
    setSpeedActive(true);
    setSpeedTimeLeft(SPEED_SECONDS);
    setSpeedResult(null);
  }

  async function grantXp(delta: number) {
    let newXp = profile!.total_xp;
    setProfile((p) => { if (!p) return p; newXp = Math.max(0, p.total_xp + delta); return { ...p, total_xp: newXp }; });
    setSessionXp((s) => s + delta);
    await sb.from('profiles').update({ total_xp: newXp }).eq('id', profile!.id);
  }

  function selectQuizAnswer(qIdx: number, optIdx: number) {
    if (quizAnswers[qIdx] !== undefined) return;
    setQuizAnswers((prev) => ({ ...prev, [qIdx]: optIdx }));
    const q = currentWeek!.quiz[qIdx];
    if (optIdx === q.correct_index) grantXp(q.bonus ? 20 : 10);
    if (speedActive) {
      setTimeout(() => {
        const allAnswered = currentWeek!.quiz.every((_, i) => (i === qIdx ? true : quizAnswers[i] !== undefined));
        if (allAnswered && speedTimeLeft > 0) { setSpeedActive(false); setSpeedResult(true); }
      }, 0);
    }
  }

  function startWeeklyReplay() {
    setReplayQuizAnswers({});
    setReplayQuizStepIndex(0);
    setWeeklyReplayActive(true);
  }

  function selectReplayQuizAnswer(qIdx: number, optIdx: number) {
    if (replayQuizAnswers[qIdx] !== undefined) return;
    setReplayQuizAnswers((prev) => ({ ...prev, [qIdx]: optIdx }));
    const q = currentWeek!.quiz[qIdx];
    if (optIdx === q.correct_index) grantXp(Math.round((q.bonus ? 20 : 10) / 2));
  }

  function selectBossAnswer(oi: number) {
    if (bossAnswer !== null) return;
    setBossAnswer(oi);
    if (currentWeek?.boss_question && oi === currentWeek.boss_question.correct_index) grantXp(30);
  }

  function selectRiskAnswer(oi: number) {
    if (riskAnswer !== null || !currentWeek?.risk_question) return;
    setRiskAnswer(oi);
    const won = oi === currentWeek.risk_question.correct_index;
    const betAmount = Math.max(10, Math.round(sessionXp / 2));
    grantXp(won ? betAmount : -betAmount);
    setLastRiskResult(won);
  }

  function submitNumberGuess() {
    if (weekClosed || numberSubmitted || !numberGuess.trim() || !currentWeek?.number_challenge) return;
    const g = parseFloat(numberGuess);
    const nc = currentWeek.number_challenge;
    const correct = !isNaN(g) && Math.abs(g - nc.correct_value) <= (nc.tolerance || 0);
    setNumberSubmitted(true);
    setNumberCorrectDisplay(correct);
    if (correct) grantXp(15);
  }

  async function closeWeek() {
    if (!currentWeek || !profile) return;
    if (riskChoice === 'bet' && riskAnswer === null) return;
    setSaving(true);

    const quizTotal = currentWeek.quiz.length;
    const quizScore = currentWeek.quiz.reduce((acc, q, i) => acc + (quizAnswers[i] === q.correct_index ? 1 : 0), 0);
    const bossCleared = !!(currentWeek.is_boss && currentWeek.boss_question && bossAnswer === currentWeek.boss_question.correct_index);

    let completionBonus = 20;
    if (profile.streak > 0) completionBonus += 20;
    const isCritical = Math.random() < 0.2;
    if (isCritical) completionBonus = Math.round(completionBonus * 1.5);

    const nextStreak = profile.streak + 1;
    const earnedFreeze = nextStreak > 0 && nextStreak % 3 === 0;
    const streakBonus = earnedFreeze ? 50 : 0;

    const totalWeekXp = sessionXp + completionBonus + streakBonus;

    const { error: histErr } = await sb.from('history').insert({
      user_id: profile.id,
      week_number: currentWeek.week_number,
      xp_earned: totalWeekXp,
      quiz_score: quizScore,
      quiz_total: quizTotal,
      week_theme: currentWeek.week_theme,
      critical: isCritical,
      risk_won: lastRiskResult,
      boss_cleared: bossCleared,
      frozen: false,
    });
    if (!histErr) {
      const myLeague = leagues.find((l) => l.tier_index === profile.league_tier);
      const mult = myLeague ? Number(myLeague.weekly_multiplier) : 1;
      const leagueGain = Math.round(totalWeekXp * mult * 1.0);
      const { tier: newTier, xp: newLeagueXp } = applyLeagueDelta(profile.league_tier, profile.league_xp || 0, leagueGain, leagues, completedTiers);
      if (newTier > profile.league_tier) {
        const promotedTo = leagues.find((l) => l.tier_index === newTier);
        setLastPromotion(promotedTo ? promotedTo.name : null);
      }
      await sb.from('profiles').update({
        total_xp: profile.total_xp + completionBonus + streakBonus,
        streak: nextStreak,
        last_week_number: currentWeek.week_number,
        freezes: (profile.freezes || 0) + (earnedFreeze ? 1 : 0),
        league_tier: newTier,
        league_xp: newLeagueXp,
      }).eq('id', profile.id);
    }

    setLastGain(totalWeekXp);
    setLastCritical(isCritical);
    setLastFreezeEarned(earnedFreeze);
    setLastStreakBonus(streakBonus);
    setWeekClosed(true);
    setSaving(false);
    refreshProfile();
  }

  async function useFreeze() {
    if (!profile || !currentWeek || (profile.freezes || 0) <= 0) return;
    setSaving(true);
    const { error: histErr } = await sb.from('history').insert({
      user_id: profile.id, week_number: currentWeek.week_number, xp_earned: 0,
      quiz_score: 0, quiz_total: 0, week_theme: currentWeek.week_theme, frozen: true,
    });
    if (!histErr) {
      await sb.from('profiles').update({
        last_week_number: currentWeek.week_number,
        freezes: profile.freezes - 1,
      }).eq('id', profile.id);
    }
    setSaving(false);
    refreshProfile();
  }

  function selectCurriculumAnswer(qIdx: number, optIdx: number) {
    if (curriculumAnswers[qIdx] !== undefined) return;
    setCurriculumAnswers((prev) => ({ ...prev, [qIdx]: optIdx }));
  }

  async function finishCurriculum(myLeague: League | undefined, isReplay: boolean) {
    if (!profile || !myLeague || !myLeague.content) return;
    setCurriculumSaving(true);
    const quiz = myLeague.content.quiz || [];
    const score = quiz.reduce((acc, q, i) => acc + (curriculumAnswers[i] === q.correct_index ? 1 : 0), 0);
    const fullBonus = myLeague.promote_threshold ? Math.round(myLeague.promote_threshold * 0.4) : 150;
    const completionBonus = isReplay ? Math.round(fullBonus / 2) : fullBonus;

    const { error: progErr } = await sb.from('league_progress').upsert({
      user_id: profile.id, tier_index: myLeague.tier_index, completed: true,
      quiz_score: score, quiz_total: quiz.length, completed_at: new Date().toISOString(),
    }, { onConflict: 'user_id,tier_index' });
    if (!progErr) {
      // The guide we just upserted as completed needs to count immediately for the promotion
      // gate — it may not have round-tripped into `completedTiers` state yet.
      const localCompleted = new Set(completedTiers);
      localCompleted.add(myLeague.tier_index);
      const { tier: newTier, xp: newLeagueXp } = applyLeagueDelta(profile.league_tier, profile.league_xp || 0, completionBonus, leagues, localCompleted);
      if (newTier > profile.league_tier) {
        const promotedTo = leagues.find((l) => l.tier_index === newTier);
        setLastPromotion(promotedTo ? promotedTo.name : null);
      }
      const newTotalXp = Math.max(0, profile.total_xp + completionBonus);
      await sb.from('profiles').update({ total_xp: newTotalXp, league_tier: newTier, league_xp: newLeagueXp }).eq('id', profile.id);
      setProfile((p) => (p ? { ...p, total_xp: newTotalXp, league_tier: newTier, league_xp: newLeagueXp } : p));
      setLeagueProgress({ user_id: profile.id, tier_index: myLeague.tier_index, completed: true, quiz_score: score, quiz_total: quiz.length, completed_at: new Date().toISOString() });
      setCompletedTiers(localCompleted);
    }
    setCurriculumSaving(false);
    setCurriculumAnswers({});
    setCurriculumStepIndex(0);
    setGuideTestModeOpen(false);
    refreshProfile();
  }

  if (loadingAuth) return <div className="root"><p className="panel-sub">Yükleniyor…</p></div>;

  if (!session) {
    return (
      <div className="root">
        <div className="ledger-head" style={{ paddingLeft: 0 }}>
          <div><div className="eyebrow">AI Takip Defteri</div><h1>Giriş</h1></div>
          <button className="btn ghost" onClick={toggleTheme}>{theme === 'dark' ? '☀ Aydınlık' : '🌙 Karanlık'}</button>
        </div>
        <div className="panel">
          <div className="tabs">
            <button className={authMode === 'login' ? 'btn secondary' : 'btn ghost'} onClick={() => { setAuthMode('login'); setAuthError(''); setAuthNotice(''); }}>Giriş Yap</button>
            <button className={authMode === 'register' ? 'btn secondary' : 'btn ghost'} onClick={() => { setAuthMode('register'); setAuthError(''); setAuthNotice(''); }}>Kayıt Ol</button>
          </div>
          {authMode === 'login' ? (
            <>
              <label className="field-label">Kullanıcı Adı veya E-posta</label>
              <input type="text" value={loginIdentifier} onChange={(e) => setLoginIdentifier(e.target.value)} placeholder="kullanici_adin ya da sen@ornek.com" />
            </>
          ) : (
            <>
              <label className="field-label">E-posta</label>
              <input type="text" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="sen@ornek.com" />
              <label className="field-label">Kullanıcı Adı</label>
              <input type="text" value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} placeholder="sıralama tablosunda görünecek isim" />
              <label className="field-label">Avatar Seç</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {AVATAR_OPTIONS.map((a) => (
                  <button key={a} type="button" onClick={() => setAvatarInput(a)}
                    className="btn ghost" style={{ fontSize: 20, padding: '6px 10px', marginTop: 0, borderColor: avatarInput === a ? 'var(--brass)' : 'var(--hairline)' }}>
                    {a}
                  </button>
                ))}
              </div>
            </>
          )}
          <label className="field-label">Şifre</label>
          <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} />
          {authMode === 'register' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--paper-dim)', marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} />
              Yeni haftalık kaynaklar yayınlandığında ve önemli hatırlatmalarda bana e-posta gönderin (isteğe bağlı).
            </label>
          )}
          {authMode === 'login' ? (
            <button className="btn" onClick={login} disabled={authBusy}>Giriş Yap</button>
          ) : (
            <button className="btn" onClick={register} disabled={authBusy}>Kayıt Ol</button>
          )}
          {authError && <div className="error-box">{authError}</div>}
          {authNotice && <div className="ok-box">{authNotice}</div>}
        </div>
      </div>
    );
  }

  if (!profile) return <div className="root"><p className="panel-sub">Profil yükleniyor…</p></div>;

  const showWeek = currentWeek && !alreadyDone;
  const myLeague = leagues.find((l) => l.tier_index === profile.league_tier);
  const leaguePct = myLeague && myLeague.promote_threshold ? Math.min(100, Math.round(((profile.league_xp || 0) / myLeague.promote_threshold) * 100)) : 100;
  const curriculumDone = leagueProgress && leagueProgress.completed;

  // Ordered list of extra per-week stages that continue the same focused stepper card
  // after the main quiz — number challenge, then risk question, then boss question.
  const extraStages: ExtraStage[] = [];
  if (currentWeek?.number_challenge) extraStages.push('number');
  if (currentWeek?.risk_question) extraStages.push('risk');
  if (currentWeek?.is_boss && currentWeek?.boss_question) extraStages.push('boss');

  function isExtraStageDone(stage: ExtraStage): boolean {
    if (stage === 'number') return numberSubmitted;
    if (stage === 'risk') return riskChoice === 'skip' || (riskChoice === 'bet' && riskAnswer !== null);
    return bossAnswer !== null;
  }
  const extraStagesAllDone = extraStages.every(isExtraStageDone);

  return (
    <div className="root">
      {onboardingStep !== null && (
        <div className="onboarding-overlay">
          <div className="onboarding-card" onTouchStart={onOnboardingTouchStart} onTouchEnd={onOnboardingTouchEnd}>
            <div className="onboarding-emoji">{ONBOARDING_SLIDES[onboardingStep].emoji}</div>
            <p className="onboarding-title">{ONBOARDING_SLIDES[onboardingStep].title}</p>
            <p className="onboarding-text">{ONBOARDING_SLIDES[onboardingStep].text}</p>
            <div className="onboarding-dots">
              {ONBOARDING_SLIDES.map((_, i) => <span key={i} className={'onboarding-dot' + (i === onboardingStep ? ' active' : '')} />)}
            </div>
            <div className="onboarding-actions">
              <button className="btn ghost" onClick={closeOnboarding}>Atla</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost" onClick={onboardingBack} disabled={onboardingStep === 0}>◀ Geri</button>
                {onboardingStep < ONBOARDING_SLIDES.length - 1 ? (
                  <button className="btn secondary" onClick={onboardingNext}>İleri</button>
                ) : (
                  <button className="btn secondary" onClick={closeOnboarding}>Başla</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {lastPromotion && (
        <div className="promotion-overlay">
          <div className="promotion-card">
            <div className="promotion-emoji">🏆</div>
            <p className="promotion-title">Terfi ettin!</p>
            <p className="promotion-text">Yeni ligin: <strong>{lastPromotion}</strong></p>
            <button className="btn secondary" onClick={() => setLastPromotion(null)}>Harika!</button>
          </div>
        </div>
      )}

      <div className="ledger-head">
        <div>
          <div className="eyebrow">{profile.avatar || '🙂'} {profile.username}</div>
          <h1>{currentWeek ? (currentWeek.week_label || formatWeekRange(currentWeek.created_at)) : 'AI Takip Defteri'}</h1>
        </div>
        <div style={{ textAlign: 'right' }}>
          <button className="btn ghost" onClick={() => setOnboardingStep(0)}>❔ Nasıl Kullanılır</button>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat-cell">
          <div className="stat-label">Toplam XP</div>
          <div className="stat-value">{profile.total_xp}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Aktif Seri</div>
          <div className="stat-value">{profile.streak} hafta</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Dondurma Hakkı</div>
          <div className="stat-value">❄ {profile.freezes || 0}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Lig</div>
          <div className="stat-value" style={{ fontSize: 13 }}>{myLeague ? myLeague.name : '—'}</div>
        </div>
      </div>

      {myLeague && (
        <div className="panel static-curriculum">
          <span className="tag static">🏅 LİG SEVİYEN</span>
          <p className="panel-title" style={{ marginBottom: myLeague.tagline ? 2 : undefined }}>{myLeague.name}</p>
          {myLeague.tagline && <p className="one-liner" style={{ marginTop: 0, marginBottom: 8 }}>{myLeague.tagline}</p>}
          {myLeague.promote_threshold ? (
            <>
              <p className="panel-sub">{profile.league_xp || 0} / {myLeague.promote_threshold} lig puanı</p>
              <div className="xp-track"><div className="xp-fill" style={{ width: leaguePct + '%' }} /></div>
            </>
          ) : (
            <p className="panel-sub">En üst ligdesin.</p>
          )}
        </div>
      )}

      <div className="tabs">
        <button className={activeTab === 'week' ? 'btn secondary' : 'btn ghost'} onClick={() => setActiveTab('week')}>🗞️ Bu Hafta</button>
        <button className={activeTab === 'guide' ? 'btn secondary' : 'btn ghost'} onClick={() => setActiveTab('guide')}>
          📖 {myLeague ? myLeague.name : 'Lig'} Rehberi
        </button>
      </div>

      {activeTab === 'guide' && (() => {
        if (!myLeague || !myLeague.content) {
          return (
            <div className="panel static-curriculum">
              <p className="panel-sub">Bu lig için henüz rehber içeriği yok.</p>
            </div>
          );
        }
        const cq = myLeague.content.quiz || [];
        const cStepQ = cq[curriculumStepIndex];
        const cAnswered = cStepQ && curriculumAnswers[curriculumStepIndex] !== undefined;
        const cAllAnswered = cq.length > 0 && cq.every((_, i) => curriculumAnswers[i] !== undefined);

        const testModeStage = (
          <>
            {cStepQ && !cAllAnswered && (
              <div className="quiz-stage" style={{ marginTop: 14 }}>
                <div className="quiz-progress">Soru {curriculumStepIndex + 1} / {cq.length}</div>
                {cAnswered && (
                  <div className={'feedback-banner ' + (curriculumAnswers[curriculumStepIndex] === cStepQ.correct_index ? 'correct' : 'wrong')}>
                    {curriculumAnswers[curriculumStepIndex] === cStepQ.correct_index ? '🎉 Harika, doğru bildin!' : '💥 Olmadı, bir dahakine!'}
                  </div>
                )}
                <div className="quiz-card">
                  <div className="quiz-q">
                    {cStepQ.type === 'tf' && <span className="tag tf">DOĞRU/YANLIŞ</span>}
                    <div>{cStepQ.question}</div>
                  </div>
                  {cStepQ.options.map((opt, oi) => {
                    let cls = 'quiz-opt opt-' + oi;
                    if (cAnswered && oi === cStepQ.correct_index) cls += ' correct';
                    else if (cAnswered && oi === curriculumAnswers[curriculumStepIndex]) cls += ' wrong';
                    return <button key={oi} className={cls} disabled={cAnswered} onClick={() => selectCurriculumAnswer(curriculumStepIndex, oi)}>{opt}</button>;
                  })}
                  {cAnswered && <div className="quiz-explain">{cStepQ.explanation}</div>}
                </div>
                {cAnswered && (
                  <button className="btn secondary" onClick={() => setCurriculumStepIndex((i) => i + 1)}>
                    {curriculumStepIndex + 1 < cq.length ? 'Sonraki Soru' : 'Devam Et'}
                  </button>
                )}
              </div>
            )}
            {cAllAnswered && (
              <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => finishCurriculum(myLeague, !!curriculumDone)} disabled={curriculumSaving}>
                {curriculumSaving ? 'Kaydediliyor…' : 'Rehberi Bitir'}
              </button>
            )}
          </>
        );

        return (
          <>
            <div className="panel static-curriculum">
              <span className="tag static">📘 SABİT REHBER{curriculumDone ? ' · TEKRAR (yarı XP)' : ''}</span>
              <p className="panel-title">{myLeague.name} Rehberi</p>
              {myLeague.content.must_reads && myLeague.content.must_reads.map((mr, i) => (
                <div className="read-row" key={i}>
                  <div>
                    {mr.url ? <a href={mr.url} target="_blank" rel="noopener noreferrer">{mr.title}</a> : <strong>{mr.title}</strong>}
                    <div className="one-liner">{mr.summary}</div>
                  </div>
                </div>
              ))}

              {curriculumDone && !cAllAnswered && curriculumStepIndex === 0 && Object.keys(curriculumAnswers).length === 0 && (
                <p className="panel-sub" style={{ margin: '10px 0' }}>Rehber tamamlandı ✓ ({leagueProgress!.quiz_score}/{leagueProgress!.quiz_total})</p>
              )}

              {cq.length > 0 && !cAllAnswered && (
                <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => setGuideTestModeOpen(true)}>
                  ✅ Özetleri Okudum, Kendimi Test Et
                </button>
              )}

              {cq.length === 0 && curriculumDone && (
                <p className="panel-sub" style={{ marginTop: 10 }}>Rehber tamamlandı ✓</p>
              )}
            </div>

            {guideTestModeOpen && (
              <div className="speed-overlay">
                <button className="overlay-close-btn" onClick={() => setGuideTestModeOpen(false)} aria-label="Kapat">✕ Kapat</button>
                <div className="speed-overlay-panel">
                  <div className="panel quiz-stage">
                    <span className="tag static">📘 SABİT REHBER · TEST MODU</span>
                    <p className="panel-title" style={{ textAlign: 'center' }}>{myLeague.name} Rehberi Sınavı</p>
                    {testModeStage}
                  </div>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {activeTab === 'week' && (
        <>
          {!currentWeek && (
            <div className="panel">
              <p className="panel-title">Henüz hafta yayınlanmadı</p>
              <p className="panel-sub">Admin bu haftanın kaynaklarını yükleyince burada görünecek.</p>
            </div>
          )}

          {currentWeek && alreadyDone && (() => {
            const rq = replayQuizStepIndex < currentWeek.quiz.length ? currentWeek.quiz[replayQuizStepIndex] : null;
            const rAnswered = !!rq && replayQuizAnswers[replayQuizStepIndex] !== undefined;
            const rAllAnswered = currentWeek.quiz.every((_, i) => replayQuizAnswers[i] !== undefined);
            return (
              <div className="panel">
                <span className="tag fresh">🗞️ GÜNCEL · BU HAFTA</span>
                <p className="panel-title">{(currentWeek.week_label || formatWeekRange(currentWeek.created_at))} tamamlandı ✓</p>
                <p className="panel-sub">Bir sonraki hafta admin tarafından yayınlandığında burada görünecek. Kaynakları ve özetleri Geçmiş sayfasından tekrar okuyabilirsin.</p>
                {!weeklyReplayActive ? (
                  <button className="btn ghost" onClick={startWeeklyReplay}>🔁 Soruları Tekrar Çöz (yarı XP)</button>
                ) : rAllAnswered ? (
                  <p className="panel-sub" style={{ marginTop: 10 }}>Tekrar tamamladın! XP zaten hesabına işlendi. <button className="btn ghost" onClick={startWeeklyReplay}>Tekrar Başlat</button></p>
                ) : rq && (
                  <div className="quiz-stage" style={{ marginTop: 14 }}>
                    <div className="quiz-progress">Soru {replayQuizStepIndex + 1} / {currentWeek.quiz.length}</div>
                    {rAnswered && (
                      <div className={'feedback-banner ' + (replayQuizAnswers[replayQuizStepIndex] === rq.correct_index ? 'correct' : 'wrong')}>
                        {replayQuizAnswers[replayQuizStepIndex] === rq.correct_index ? '🎉 Doğru!' : '💥 Olmadı.'}
                      </div>
                    )}
                    <div className="quiz-card">
                      <div className="quiz-q">
                        {rq.type === 'tf' && <span className="tag tf">DOĞRU/YANLIŞ</span>}
                        <div>{rq.question}</div>
                      </div>
                      {rq.options.map((opt, oi) => {
                        let cls = 'quiz-opt opt-' + oi;
                        if (rAnswered && oi === rq.correct_index) cls += ' correct';
                        else if (rAnswered && oi === replayQuizAnswers[replayQuizStepIndex]) cls += ' wrong';
                        return <button key={oi} className={cls} disabled={rAnswered} onClick={() => selectReplayQuizAnswer(replayQuizStepIndex, oi)}>{opt}</button>;
                      })}
                      {rAnswered && <div className="quiz-explain">{rq.explanation}</div>}
                    </div>
                    {rAnswered && (
                      <button className="btn secondary" onClick={() => setReplayQuizStepIndex((i) => i + 1)}>
                        {replayQuizStepIndex + 1 < currentWeek.quiz.length ? 'Sonraki Soru' : 'Devam Et'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {currentWeek && currentWeek.is_boss && (
            <div className="panel boss">
              <p className="panel-title">👑 BOSS HAFTASI</p>
              <p className="panel-sub">Bu hafta her şey daha zor ve daha ödüllü. Kaynakları dikkatlice oku.</p>
            </div>
          )}

          {currentWeek && (
            <div className="panel" ref={weekSectionRef}>
              <span className="tag fresh">🗞️ GÜNCEL · BU HAFTA</span>
              <p className="panel-title">{currentWeek.week_theme || 'Bu haftanın okumaları'}</p>
              <button className="btn ghost" onClick={() => setShowSources((v) => !v)}>
                {showSources ? 'Kaynakları Gizle' : `📚 Kaynakları Göster (${currentWeek.must_reads.length})`}
              </button>
              {showSources && currentWeek.must_reads.map((mr, i) => (
                <div className="read-row" key={i} style={{ marginTop: 10 }}>
                  <input type="checkbox" checked={!!checkedReads[i]} disabled={weekClosed || alreadyDone}
                    onChange={() => {
                      setCheckedReads((prev) => {
                        const next = { ...prev, [i]: !prev[i] };
                        const allNow = currentWeek.must_reads.every((_, idx) => next[idx]);
                        if (allNow && !readBonusGranted) { setReadBonusGranted(true); grantXp(15); }
                        return next;
                      });
                    }} />
                  <div>
                    {mr.url ? <a href={mr.url} target="_blank" rel="noopener noreferrer">{mr.title}</a> : <strong>{mr.title}</strong>}
                    <div className="one-liner">{mr.summary}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showWeek && (profile.freezes || 0) > 0 && (
            <div className="panel">
              <button className="btn ghost" onClick={useFreeze} disabled={saving}>❄ Bu Haftayı Dondur ({profile.freezes} hak kaldı, seri bozulmaz)</button>
            </div>
          )}

          {showWeek && (() => {
            const totalQ = currentWeek!.quiz.length;
            const allQuizAnswered = currentWeek!.quiz.every((_, i) => quizAnswers[i] !== undefined);
            const stepQ = currentWeek!.quiz[quizStepIndex];
            const stepAnswered = stepQ && quizAnswers[quizStepIndex] !== undefined;
            const currentExtra = allQuizAnswered && !weekClosed ? extraStages[extraStepIndex] : undefined;
            const readyToClose = allQuizAnswered && extraStagesAllDone;

            const quizStagePanel = (
              <div className="panel quiz-stage">
                <p className="panel-sub" style={{ textAlign: 'center', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '.06em', fontFamily: 'var(--mono)', fontSize: 11 }}>
                  Bu haftanın sınavı{currentWeek!.week_label ? ` · ${currentWeek!.week_label}` : ''}
                </p>
                <p className="panel-title" style={{ textAlign: 'center' }}>Sınav · {currentWeek!.must_reads[stepQ.source_index] ? currentWeek!.must_reads[stepQ.source_index].title : ''}</p>
                <div className="quiz-progress">Soru {quizStepIndex + 1} / {totalQ} · +{sessionXp} XP</div>
                <div className="xp-track" style={{ marginBottom: 14 }}>
                  <div className="xp-fill" style={{ width: Math.round((Object.keys(quizAnswers).length / totalQ) * 100) + '%' }} />
                </div>
                {stepAnswered && (
                  <div className={'feedback-banner ' + (quizAnswers[quizStepIndex] === stepQ.correct_index ? 'correct' : 'wrong')}>
                    {quizAnswers[quizStepIndex] === stepQ.correct_index ? '🎉 Harika, doğru bildin!' : '💥 Olmadı, bir dahakine!'}
                  </div>
                )}
                <div className="quiz-card">
                  <div className="quiz-q">
                    {stepQ.type === 'tf' && <span className="tag tf">DOĞRU/YANLIŞ</span>}
                    {stepQ.bonus && <span className="tag bonus">BONUS · +20 XP · Cevap özetlerde yok, kaynağı okuman gerekir</span>}
                    <div>{stepQ.question}</div>
                  </div>
                  {stepQ.options.map((opt, oi) => {
                    let cls = 'quiz-opt opt-' + oi;
                    if (stepAnswered && oi === stepQ.correct_index) cls += ' correct';
                    else if (stepAnswered && oi === quizAnswers[quizStepIndex]) cls += ' wrong';
                    return <button key={oi} className={cls} disabled={stepAnswered} onClick={() => selectQuizAnswer(quizStepIndex, oi)}>{opt}</button>;
                  })}
                  {stepAnswered && <div className="quiz-explain">{stepQ.explanation}</div>}
                </div>
                {stepAnswered && (
                  <button className="btn secondary" onClick={() => setQuizStepIndex((i) => i + 1)}>
                    {quizStepIndex + 1 < totalQ ? 'Sonraki Soru' : 'Devam Et'}
                  </button>
                )}
              </div>
            );

            // The extra stages (number challenge, risk, boss) render inside the same focused
            // card flow that the main quiz uses, one at a time, driven by extraStepIndex.
            const numberStagePanel = currentWeek!.number_challenge && (
              <div className="panel quiz-stage">
                <div className="quiz-progress">Sayı Tahmini</div>
                <p className="panel-title" style={{ textAlign: 'center' }}>🔢 Sayı Tahmini</p>
                <div className="quiz-card">
                  <div className="quiz-q"><div>{currentWeek!.number_challenge.question}</div></div>
                  <input type="number" value={numberGuess} disabled={weekClosed || numberSubmitted}
                    onChange={(e) => setNumberGuess(e.target.value)} placeholder="Tahminin…" />
                  {!numberSubmitted && !weekClosed && (
                    <button className="btn secondary" onClick={submitNumberGuess} disabled={!numberGuess.trim()}>Tahmin Et</button>
                  )}
                  {numberSubmitted && (
                    <div className={'feedback-banner ' + (numberCorrectDisplay ? 'correct' : 'wrong')}>
                      {numberCorrectDisplay ? '🎉 Doğru tahmin!' : `Yanlış. Doğru cevap: ${currentWeek!.number_challenge.correct_value} (±${currentWeek!.number_challenge.tolerance}).`} {currentWeek!.number_challenge.explanation}
                    </div>
                  )}
                </div>
                {currentWeek!.must_reads[currentWeek!.number_challenge.source_index] && (
                  <div className="read-row" style={{ marginTop: 10 }}>
                    <div>
                      <strong>{currentWeek!.must_reads[currentWeek!.number_challenge.source_index].title}</strong>
                      <div className="one-liner">{currentWeek!.must_reads[currentWeek!.number_challenge.source_index].summary}</div>
                    </div>
                  </div>
                )}
                {numberSubmitted && (
                  <button className="btn secondary" onClick={() => setExtraStepIndex((i) => i + 1)}>Devam Et</button>
                )}
              </div>
            );

            const riskStagePanel = currentWeek!.risk_question && (
              <div className="panel quiz-stage">
                <div className="quiz-progress">Çift Yap ya da Kaybet</div>
                <p className="panel-title" style={{ textAlign: 'center' }}>🎲 Çift Yap ya da Kaybet</p>
                <p className="panel-sub">Bu hafta oyun içinde kazandığın XP'nin yarısını bahse yatır. Soruyu cevaplar cevaplamaz sonuç anında belli olur, XP hemen işlenir.</p>
                {riskChoice === null && !weekClosed && (
                  <div className="risk-choice-row">
                    <button className="btn danger" onClick={() => setRiskChoice('bet')}>Bahse Gir</button>
                    <button className="btn ghost" onClick={() => setRiskChoice('skip')}>Riske Girme</button>
                  </div>
                )}
                {riskChoice === 'bet' && (
                  <div className="quiz-card">
                    <div className="quiz-q"><span className="tag risk">RİSK SORUSU</span><div>{currentWeek!.risk_question.question}</div></div>
                    {currentWeek!.risk_question.options.map((opt, oi) => {
                      const answered = riskAnswer !== null;
                      let cls = 'quiz-opt opt-' + oi;
                      if (answered && oi === currentWeek!.risk_question!.correct_index) cls += ' correct';
                      else if (answered && oi === riskAnswer) cls += ' wrong';
                      return <button key={oi} className={cls} disabled={answered || weekClosed} onClick={() => selectRiskAnswer(oi)}>{opt}</button>;
                    })}
                    {riskAnswer !== null && <div className="quiz-explain">{currentWeek!.risk_question.explanation}</div>}
                  </div>
                )}
                {riskChoice === 'skip' && <p className="one-liner">Riske girmedin, bahis mekaniği bu hafta devre dışı.</p>}
                {(riskChoice === 'skip' || (riskChoice === 'bet' && riskAnswer !== null)) && (
                  <button className="btn secondary" onClick={() => setExtraStepIndex((i) => i + 1)}>Devam Et</button>
                )}
              </div>
            );

            const bossStagePanel = currentWeek!.boss_question && (
              <div className="panel boss quiz-stage">
                <div className="quiz-progress">Boss Sorusu</div>
                <p className="panel-title" style={{ textAlign: 'center' }}>👑 Boss Sorusu · +30 XP</p>
                <div className="quiz-card">
                  <div className="quiz-q"><span className="tag boss">SENTEZ SORUSU</span><div>{currentWeek!.boss_question.question}</div></div>
                  {currentWeek!.boss_question.options.map((opt, oi) => {
                    const answered = bossAnswer !== null;
                    let cls = 'quiz-opt opt-' + oi;
                    if (answered && oi === currentWeek!.boss_question!.correct_index) cls += ' correct';
                    else if (answered && oi === bossAnswer) cls += ' wrong';
                    return <button key={oi} className={cls} disabled={answered || weekClosed} onClick={() => selectBossAnswer(oi)}>{opt}</button>;
                  })}
                  {bossAnswer !== null && <div className="quiz-explain">{currentWeek!.boss_question.explanation}</div>}
                </div>
                {bossAnswer !== null && (
                  <button className="btn secondary" onClick={() => setExtraStepIndex((i) => i + 1)}>Devam Et</button>
                )}
              </div>
            );

            function extraStagePanelFor(stage: ExtraStage) {
              if (stage === 'number') return numberStagePanel;
              if (stage === 'risk') return riskStagePanel;
              return bossStagePanel;
            }

            return (
              <>
                {!speedActive && !weekClosed && !allQuizAnswered && speedResult === null && (
                  <div className="panel">
                    <p className="panel-title">⏱ Hız Turu</p>
                    <p className="panel-sub">{SPEED_SECONDS} saniyede tüm quiz sorularını bitirirsen +30 XP bonus kazanırsın. Tek deneme hakkın var. BONUS etiketli soruların cevabı özetlerde yok — kaynağı önceden okumuş olman gerekir.</p>
                    <button className="btn secondary" onClick={startSpeedRound}>Hız Turunu Başlat</button>
                  </div>
                )}

                {speedActive ? (
                  <div className="speed-overlay">
                    <div className="speed-overlay-timer">
                      <TimerRing seconds={speedTimeLeft} total={SPEED_SECONDS} size={56} />
                      <span>HIZ TURU — tüm soruları bitir, +30 XP kazan</span>
                    </div>
                    <div className="speed-overlay-panel">
                      {!weekClosed && !allQuizAnswered && stepQ && quizStagePanel}
                    </div>
                  </div>
                ) : (
                  !weekClosed && !allQuizAnswered && stepQ && quizStagePanel
                )}

                {!weekClosed && currentExtra && extraStagePanelFor(currentExtra)}

                {weekClosed && (
                  <div className="panel">
                    <p className="panel-title">Sınav Özeti</p>
                    {currentWeek!.quiz.map((q, qi) => (
                      <div className="quiz-card" key={qi}>
                        <div className="quiz-q">
                          {q.type === 'tf' && <span className="tag tf">DOĞRU/YANLIŞ</span>}
                          {q.bonus && <span className="tag bonus">BONUS · +20 XP</span>}
                          <div>{q.question}</div>
                        </div>
                        {q.options.map((opt, oi) => {
                          let cls = 'quiz-opt opt-' + oi;
                          if (oi === q.correct_index) cls += ' correct';
                          else if (oi === quizAnswers[qi]) cls += ' wrong';
                          return <button key={oi} className={cls} disabled>{opt}</button>;
                        })}
                        <div className="quiz-explain">{q.explanation}</div>
                      </div>
                    ))}
                  </div>
                )}

                {(readyToClose || weekClosed) && (
                  <div className="panel">
                    {!weekClosed ? (
                      <>
                        <button className="btn secondary" onClick={closeWeek} disabled={saving || (riskChoice === 'bet' && riskAnswer === null)}>
                          {saving ? 'Kaydediliyor…' : 'Haftayı Bitir ve Bonus Al'}
                        </button>
                        <p className="panel-sub" style={{ marginTop: 8 }}>Sorulardan kazandığın XP zaten hesabına işlendi ({sessionXp} XP). Bu buton sadece bitirme bonusunu ekler ve seriyi ilerletir.</p>
                      </>
                    ) : (
                      <div>
                        <div className="closed-stamp">ONAYLANDI · +{lastGain} XP</div>
                        {lastCritical && <div className="critical-tag">⚡ KRİTİK BAŞARI! 1.5× bonus uygulandı</div>}
                        {lastFreezeEarned && <div className="critical-tag">❄ Yeni dondurma hakkı kazandın!</div>}
                        {lastStreakBonus > 0 && <div className="critical-tag">🔥 3 haftalık seri bonusu: +{lastStreakBonus} XP</div>}
                        {lastRiskResult === true && <div className="critical-tag">🎲 Bahsi kazandın!</div>}
                        {lastRiskResult === false && <div className="critical-tag">🎲 Bahsi kaybettin.</div>}
                        {speedResult === true && <div className="critical-tag">⏱ Hız turu bonusu kazandın!</div>}
                        <p className="panel-sub" style={{ marginTop: 10 }}>Gelecek hafta admin yeni içerik yayınladığında burada görünecek.</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
