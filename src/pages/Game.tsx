import { useEffect, useRef, useState } from 'react';
import { sb } from '../lib/supabase';
import TimerRing from '../components/TimerRing';
import { useTheme } from '../lib/ThemeContext';
import { evaluateLeagueStreak, LEAGUE_STREAK_FLOOR_TIER, SUCCESS_STREAK_NEEDED } from '../lib/leagueStreak';
import type { League, LeagueProgress, Profile, QuizQuestion, RiskOrBossQuestion, Week } from '../lib/types';

const BOSS_EVERY = 5;
const SPEED_SECONDS_PER_QUESTION = 15;
const AVATAR_OPTIONS = ['🙂', '🦊', '🐙', '🐼', '🦉', '🐳', '🦁', '🐸', '🤖', '👾', '🦄', '🐢'];
const ONBOARDING_KEY = 'aitakip_onboarding_seen_v1';
const SWIPE_THRESHOLD = 45;
const ONBOARDING_SLIDES = [
  { emoji: '🎮', title: 'Haftalık Oyun', text: 'Her hafta yeni kaynaklar gelir. Okuyup soru soru ilerleyen sınavı çöz, XP kazan.' },
  { emoji: '🏅', title: 'Lig Sistemi', text: 'Sabit rehberindeki tüm üniteleri ve bitirme sınavını tamamla, ligini yükselt.' },
  { emoji: '⚡', title: 'Canlı Yarışma', text: "Arkadaşlarınla oda kur ya da düello yap, gerçek zamanlı yarış." },
  { emoji: '☰', title: 'Her An Kılavuza Dön', text: 'Sol üstteki menüden Profil, Sıralama, Geçmiş ve Kılavuz sayfalarına ulaşabilirsin.' },
];

// Persists the in-progress weekly quiz/extra-stage answers to localStorage, keyed per user+week.
// Without this, a page reload wipes the in-memory answer guards (quizAnswers, numberSubmitted,
// riskAnswer, bossAnswer, readBonusGranted) that selectQuizAnswer/submitNumberGuess/etc. rely on
// to avoid re-granting XP for a question already credited this week — reopening the quiz after a
// reload would silently let the same correct answers pay out XP again, indefinitely.
const WEEK_PROGRESS_PREFIX = 'aitakip_week_progress_v1';
type WeekProgressSnapshot = {
  quizAnswers: Record<number, number>;
  quizStepIndex: number;
  checkedReads: Record<number, boolean>;
  readBonusGranted: boolean;
  numberGuess: string;
  numberSubmitted: boolean;
  numberCorrectDisplay: boolean;
  riskChoice: 'bet' | 'skip' | null;
  riskAnswer: number | null;
  lastRiskResult: boolean | null;
  bossAnswer: number | null;
  extraStepIndex: number;
  sessionXp: number;
  weekTestMode: 'none' | 'untimed' | 'timed';
};
function weekProgressKey(userId: string, weekNumber: number) {
  return `${WEEK_PROGRESS_PREFIX}:${userId}:${weekNumber}`;
}
function loadWeekProgress(userId: string, weekNumber: number): WeekProgressSnapshot | null {
  try {
    const raw = localStorage.getItem(weekProgressKey(userId, weekNumber));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveWeekProgress(userId: string, weekNumber: number, snapshot: WeekProgressSnapshot) {
  try {
    localStorage.setItem(weekProgressKey(userId, weekNumber), JSON.stringify(snapshot));
  } catch {
    // ignore (e.g. storage quota/private mode) — worst case, a reload loses local progress again
  }
}
function clearWeekProgress(userId: string, weekNumber: number) {
  localStorage.removeItem(weekProgressKey(userId, weekNumber));
}

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
  const [speedTimeLeft, setSpeedTimeLeft] = useState(0);
  const [speedResult, setSpeedResult] = useState<boolean | null>(null);
  // Tracks which mode the weekly test overlay is running in — persists across manual close/reopen,
  // unlike speedActive which only meaningfully means "actively running the timed round right now".
  const [weekTestMode, setWeekTestMode] = useState<'none' | 'untimed' | 'timed'>('none');
  const [weekTestOverlayOpen, setWeekTestOverlayOpen] = useState(false);
  const [weeklyReplayOverlayOpen, setWeeklyReplayOverlayOpen] = useState(false);
  const [lastRiskResult, setLastRiskResult] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [closeWeekError, setCloseWeekError] = useState('');
  const [sessionXp, setSessionXp] = useState(0);
  const [readBonusGranted, setReadBonusGranted] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const [leagues, setLeagues] = useState<League[]>([]);
  const [leagueProgress, setLeagueProgress] = useState<LeagueProgress | null>(null);
  const [activeTab, setActiveTab] = useState<'week' | 'guide'>('week');
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  // Lesson-path (academy) state for the league guide: lessonIndex is the currently open/active
  // lesson (0-based, into the grouped-by-source_index lessons array); passedLessons tracks which
  // lesson indices have cleared the 60% threshold this session; lessonAnswers holds in-progress
  // answers for the currently open lesson only (cleared on pass/retry/lesson switch).
  const [lessonIndex, setLessonIndex] = useState(0);
  const [passedLessons, setPassedLessons] = useState<Set<number>>(new Set());
  // Correct/total per lesson, recorded once that lesson is passed — used to sum the total
  // score/total across the whole sequence (lessons + capstone) for the league_progress row.
  const [lessonResults, setLessonResults] = useState<Record<number, { score: number; total: number }>>({});
  const [lessonAnswers, setLessonAnswers] = useState<Record<number, number>>({});
  const [lessonStepIndex, setLessonStepIndex] = useState(0);
  const [guideTestModeOpen, setGuideTestModeOpen] = useState(false);
  // Which lesson's must-read page is currently shown inline below the course path
  // (the current unlocked lesson, or a previously-passed one clicked for review).
  const [viewedLessonIndex, setViewedLessonIndex] = useState<number | null>(null);
  const [lessonFailInfo, setLessonFailInfo] = useState<{ score: number; total: number } | null>(null);
  const [lessonPassInfo, setLessonPassInfo] = useState<{ score: number; total: number; xp: number } | null>(null);
  const [capstoneAnswers, setCapstoneAnswers] = useState<Record<number, number>>({});
  const [capstoneStepIndex, setCapstoneStepIndex] = useState(0);
  const [capstoneOpen, setCapstoneOpen] = useState(false);
  const [curriculumSaving, setCurriculumSaving] = useState(false);
  const [weeklyReplayActive, setWeeklyReplayActive] = useState(false);
  const [replayQuizAnswers, setReplayQuizAnswers] = useState<Record<number, number>>({});
  const [replayQuizStepIndex, setReplayQuizStepIndex] = useState(0);
  const [lastPromotion, setLastPromotion] = useState<string | null>(null);

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

  // Resume the lesson-path where the player left off — lessonIndex only
  // lives in React state otherwise, so without this a logout/login (or any
  // remount) silently restarted the guide from lesson 0 even after passing
  // several lessons. Only applies while the guide is still in progress —
  // once completed, a fresh session intentionally starts any optional
  // half-XP replay back at lesson 0.
  useEffect(() => {
    if (leagueProgress && !leagueProgress.completed) {
      const idx = leagueProgress.current_lesson_index || 0;
      setLessonIndex(idx);
      setPassedLessons(new Set(Array.from({ length: idx }, (_, i) => i)));
    }
  }, [leagueProgress]);

  // "Kullanıcı" (tier_index 4) ve üzeri haftalık seri kuralını, hafta içeriği ve profil hazır
  // olduğunda (ya da bu haftanın quizi kapatılıp last_week_number ilerlediğinde) tembel biçimde
  // işler — terfi/düşüş burada olur.
  useEffect(() => {
    if (!profile || !currentWeek) return;
    evaluateLeagueStreak(profile, currentWeek.week_number).then((updated) => {
      if (updated !== profile) setProfile(updated);
    });
  }, [profile?.id, profile?.last_week_number, currentWeek?.week_number]);

  useEffect(() => {
    if (!profile) return;
    if (!localStorage.getItem(ONBOARDING_KEY)) setOnboardingStep(0);
  }, [profile?.id]);

  // Reset the lesson-path (academy) progress whenever the active league tier changes —
  // a fresh tier always starts from lesson 0 with nothing passed yet.
  useEffect(() => {
    setLessonIndex(0);
    setPassedLessons(new Set());
    setLessonResults({});
    setLessonAnswers({});
    setLessonStepIndex(0);
    setGuideTestModeOpen(false);
    setViewedLessonIndex(null);
    setLessonFailInfo(null);
    setCapstoneAnswers({});
    setCapstoneStepIndex(0);
    setCapstoneOpen(false);
  }, [profile?.league_tier]);

  // Restores this week's in-progress answers from localStorage (or resets to a clean slate for a
  // newly-published week) whenever the signed-in user or the active week changes. Only restores
  // while the week is still open — once last_week_number has caught up, there's nothing left to
  // resume (the save-effect below also clears storage at that point).
  useEffect(() => {
    if (!profile || !currentWeek) return;
    const done = profile.last_week_number >= currentWeek.week_number;
    const saved = !done ? loadWeekProgress(profile.id, currentWeek.week_number) : null;
    setQuizAnswers(saved?.quizAnswers ?? {});
    setQuizStepIndex(saved?.quizStepIndex ?? 0);
    setCheckedReads(saved?.checkedReads ?? {});
    setReadBonusGranted(saved?.readBonusGranted ?? false);
    setNumberGuess(saved?.numberGuess ?? '');
    setNumberSubmitted(saved?.numberSubmitted ?? false);
    setNumberCorrectDisplay(saved?.numberCorrectDisplay ?? false);
    setRiskChoice(saved?.riskChoice ?? null);
    setRiskAnswer(saved?.riskAnswer ?? null);
    setLastRiskResult(saved?.lastRiskResult ?? null);
    setBossAnswer(saved?.bossAnswer ?? null);
    setExtraStepIndex(saved?.extraStepIndex ?? 0);
    setSessionXp(saved?.sessionXp ?? 0);
    setWeekTestMode(saved?.weekTestMode ?? 'none');
    setWeekTestOverlayOpen(false);
    setWeeklyReplayOverlayOpen(false);
  }, [profile?.id, currentWeek?.week_number]);

  // Keeps the localStorage snapshot in sync as the user answers questions, so a reload resumes
  // instead of silently re-crediting XP for already-answered questions; cleared once the week is
  // actually closed (last_week_number catches up), since history is now the source of truth.
  useEffect(() => {
    if (!profile || !currentWeek) return;
    if (profile.last_week_number >= currentWeek.week_number) {
      clearWeekProgress(profile.id, currentWeek.week_number);
      return;
    }
    saveWeekProgress(profile.id, currentWeek.week_number, {
      quizAnswers, quizStepIndex, checkedReads, readBonusGranted,
      numberGuess, numberSubmitted, numberCorrectDisplay,
      riskChoice, riskAnswer, lastRiskResult, bossAnswer,
      extraStepIndex, sessionXp, weekTestMode,
    });
  }, [
    profile?.id, profile?.last_week_number, currentWeek?.week_number,
    quizAnswers, quizStepIndex, checkedReads, readBonusGranted,
    numberGuess, numberSubmitted, numberCorrectDisplay,
    riskChoice, riskAnswer, lastRiskResult, bossAnswer,
    extraStepIndex, sessionXp, weekTestMode,
  ]);

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

  // Timed round now covers the main quiz AND the extra stages (number/risk/boss) — it only
  // ends successfully once everything is answered, not just the main quiz (see SPEED_SECONDS_PER_QUESTION).
  useEffect(() => {
    if (!speedActive || speedTimeLeft <= 0 || !currentWeek) return;
    const allQuizDone = currentWeek.quiz.every((_, i) => quizAnswers[i] !== undefined);
    const numberDone = !currentWeek.number_challenge || numberSubmitted;
    const riskDone = !currentWeek.risk_question || riskChoice === 'skip' || (riskChoice === 'bet' && riskAnswer !== null);
    const bossDone = !(currentWeek.is_boss && currentWeek.boss_question) || bossAnswer !== null;
    if (allQuizDone && numberDone && riskDone && bossDone) {
      setSpeedActive(false);
      setSpeedResult(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speedActive, speedTimeLeft, quizAnswers, numberSubmitted, riskChoice, riskAnswer, bossAnswer, currentWeek]);

  useEffect(() => {
    if (showSources) weekSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showSources]);

  // Once the week is actually closed, drop back to the normal page view (the "Sınav Özeti" /
  // closing summary panel already renders outside the overlay, after this section).
  useEffect(() => {
    if (weekClosed) setWeekTestOverlayOpen(false);
  }, [weekClosed]);

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

  function computeSpeedSecondsForWeek(w: Week | null): number {
    if (!w) return 0;
    let count = w.quiz.length;
    if (w.number_challenge) count += 1;
    if (w.risk_question) count += 1;
    if (w.is_boss && w.boss_question) count += 1;
    return count * SPEED_SECONDS_PER_QUESTION;
  }

  function startSpeedRound() {
    setWeekTestMode('timed');
    setWeekTestOverlayOpen(true);
    setSpeedActive(true);
    setSpeedTimeLeft(computeSpeedSecondsForWeek(currentWeek));
    setSpeedResult(null);
  }

  function startUntimedWeekTest() {
    setWeekTestMode('untimed');
    setWeekTestOverlayOpen(true);
  }

  function resumeWeekTest() {
    setWeekTestOverlayOpen(true);
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
  }

  function startWeeklyReplay() {
    setReplayQuizAnswers({});
    setReplayQuizStepIndex(0);
    setWeeklyReplayActive(true);
    setWeeklyReplayOverlayOpen(true);
  }

  function resumeWeeklyReplay() {
    setWeeklyReplayOverlayOpen(true);
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
    setCloseWeekError('');

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
    if (histErr) {
      setCloseWeekError('Bu hafta zaten kaydedilmiş görünüyor. Sayfayı yenileyip tekrar dene.');
      setSaving(false);
      return;
    }
    await sb.from('profiles').update({
      total_xp: profile.total_xp + completionBonus + streakBonus,
      streak: nextStreak,
      last_week_number: currentWeek.week_number,
      freezes: (profile.freezes || 0) + (earnedFreeze ? 1 : 0),
    }).eq('id', profile.id);

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

  // Groups a league's flat quiz array into one lesson per distinct source_index, in ascending
  // source_index order — lesson i's must_read is myLeague.content.must_reads[lessons[i].sourceIndex].
  function groupLessons(quiz: QuizQuestion[]): { sourceIndex: number; questions: QuizQuestion[] }[] {
    const bySource = new Map<number, QuizQuestion[]>();
    for (const q of quiz) {
      if (!bySource.has(q.source_index)) bySource.set(q.source_index, []);
      bySource.get(q.source_index)!.push(q);
    }
    return Array.from(bySource.keys()).sort((a, b) => a - b).map((k) => ({ sourceIndex: k, questions: bySource.get(k)! }));
  }

  function selectLessonAnswer(qIdx: number, optIdx: number) {
    if (lessonAnswers[qIdx] !== undefined) return;
    setLessonAnswers((prev) => ({ ...prev, [qIdx]: optIdx }));
  }

  function retryLesson() {
    setLessonAnswers({});
    setLessonStepIndex(0);
    setLessonFailInfo(null);
  }

  // Evaluates the currently open lesson against the 60% pass threshold. On pass, grants a small
  // per-lesson Toplam XP amount (80% of fullBonus split across all lessons, halved again on
  // replay) and advances to the next lesson — a bragging-rights reward only, it does not affect
  // league standing (see finishCurriculum for the promotion rule). On fail, leaves lessonIndex
  // untouched and surfaces a retry prompt.
  async function evaluateLesson(lesson: QuizQuestion[], myLeague: League, totalLessons: number, isReplay: boolean) {
    const total = lesson.length;
    const score = lesson.reduce((acc, q, i) => acc + (lessonAnswers[i] === q.correct_index ? 1 : 0), 0);
    const passed = total > 0 && score / total >= 0.6;
    if (!passed) {
      // Overlay stays open — the result card (pop-up feel) replaces the quiz
      // stage inside it instead of closing and showing a message behind it.
      setLessonFailInfo({ score, total });
      return;
    }
    const fullBonus = myLeague.promote_threshold ? Math.round(myLeague.promote_threshold * 0.4) : 150;
    const perLessonXp = Math.round((fullBonus * 0.8) / Math.max(1, totalLessons));
    const grantedXp = isReplay ? Math.round(perLessonXp / 2) : perLessonXp;
    await grantXp(grantedXp);
    setLessonResults((prev) => ({ ...prev, [lessonIndex]: { score, total } }));
    setPassedLessons((prev) => new Set(prev).add(lessonIndex));
    setLessonFailInfo(null);
    // lessonIndex/viewedLessonIndex/overlay stay put here so the celebratory
    // result card shows in place of the quiz — continueAfterLessonPass
    // (triggered by the card's "Devam Et" button) closes the overlay and advances.
    setLessonPassInfo({ score, total, xp: grantedXp });
    // Persist the resume point immediately (not deferred to "Devam Et") so a
    // logout right after passing still resumes past this lesson, not before it.
    if (profile && !isReplay) {
      void sb.from('league_progress').upsert({
        user_id: profile.id, tier_index: myLeague.tier_index, current_lesson_index: lessonIndex + 1,
      }, { onConflict: 'user_id,tier_index' });
    }
  }

  function continueAfterLessonPass() {
    setLessonAnswers({});
    setLessonStepIndex(0);
    setViewedLessonIndex(null);
    setLessonIndex((i) => i + 1);
    setLessonPassInfo(null);
    setGuideTestModeOpen(false);
  }

  function selectCapstoneAnswer(qIdx: number, optIdx: number) {
    if (capstoneAnswers[qIdx] !== undefined) return;
    setCapstoneAnswers((prev) => ({ ...prev, [qIdx]: optIdx }));
  }

  // Finishes the tier: fires once the capstone is fully answered (or immediately, when there is
  // no capstone, once every lesson is passed). quiz_score/quiz_total reflect the sum across every
  // lesson attempt that passed plus the capstone, matching the "total across the whole sequence"
  // requirement. Grants the remaining 20% of fullBonus as Toplam XP (the other 80% was already
  // paid out per-lesson in evaluateLesson) and — this is the ONLY way league_tier changes anywhere
  // in the app — promotes straight to the next tier, full stop. No points pool, no threshold: the
  // guide is the entire promotion mechanic. Replays (isReplay, only reachable at the top league,
  // where there's no next tier to promote into) skip promotion.
  async function finishCurriculum(myLeague: League | undefined, isReplay: boolean, capstone: RiskOrBossQuestion[]) {
    if (!profile || !myLeague || !myLeague.content) return;
    setCurriculumSaving(true);
    const capstoneTotal = capstone.length;
    const capstoneScore = capstone.reduce((acc, q, i) => acc + (capstoneAnswers[i] === q.correct_index ? 1 : 0), 0);
    const lessonScoreSum = Object.values(lessonResults).reduce((a, r) => a + r.score, 0);
    const lessonTotalSum = Object.values(lessonResults).reduce((a, r) => a + r.total, 0);
    const score = lessonScoreSum + capstoneScore;
    const total = lessonTotalSum + capstoneTotal;
    const fullBonus = myLeague.promote_threshold ? Math.round(myLeague.promote_threshold * 0.4) : 150;
    const capstoneBonus = Math.round(fullBonus * 0.2);
    const completionBonus = isReplay ? Math.round(capstoneBonus / 2) : capstoneBonus;

    const { error: progErr } = await sb.from('league_progress').upsert({
      user_id: profile.id, tier_index: myLeague.tier_index, completed: true,
      quiz_score: score, quiz_total: total, completed_at: new Date().toISOString(),
    }, { onConflict: 'user_id,tier_index' });
    if (!progErr) {
      const newTotalXp = Math.max(0, profile.total_xp + completionBonus);
      const isMaxTier = myLeague.tier_index >= leagues.length - 1;
      // "Kullanıcı" (LEAGUE_STREAK_FLOOR_TIER) ve üstü rehberi bitirmek tek başına yetmez — son 2
      // hafta üst üste %60+ haftalık quiz serisi de gerekir. Seri henüz tamamlanmadıysa
      // league_progress.completed=true kaydedilir ama terfi ertelenir; evaluateLeagueStreak seri
      // tamamlanınca otomatik terfi ettirir.
      const gatedByStreak = myLeague.tier_index >= LEAGUE_STREAK_FLOOR_TIER;
      const streakReady = profile.league_success_streak >= SUCCESS_STREAK_NEEDED;
      const canPromote = !isReplay && !isMaxTier && (!gatedByStreak || streakReady);
      const newTier = canPromote ? myLeague.tier_index + 1 : profile.league_tier;
      const profileUpdate: Partial<Profile> = { total_xp: newTotalXp, league_tier: newTier };
      if (newTier > profile.league_tier) {
        const promotedTo = leagues.find((l) => l.tier_index === newTier);
        setLastPromotion(promotedTo ? promotedTo.name : null);
        if (gatedByStreak) {
          profileUpdate.league_success_streak = 0;
          profileUpdate.league_miss_streak = 0;
        }
      }
      await sb.from('profiles').update(profileUpdate).eq('id', profile.id);
      setProfile((p) => (p ? { ...p, ...profileUpdate } : p));
      setLeagueProgress({ user_id: profile.id, tier_index: myLeague.tier_index, completed: true, quiz_score: score, quiz_total: total, completed_at: new Date().toISOString(), current_lesson_index: lessonIndex });
    }
    setCurriculumSaving(false);
    setCapstoneAnswers({});
    setCapstoneStepIndex(0);
    setCapstoneOpen(false);
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
  const curriculumDone = leagueProgress && leagueProgress.completed;
  // Unit-completion progress for the league guide — shown at the top of the page regardless of
  // which tab is active. There is no points pool driving promotion: finishing every unit plus the
  // capstone (see finishCurriculum) is itself what promotes to the next tier, so this bar tracks
  // "how far through this tier's academy am I" directly.
  const guideLessons = myLeague && myLeague.content ? groupLessons(myLeague.content.quiz || []) : [];
  const guideTotalLessons = guideLessons.length;
  const guideHasCapstone = !!(myLeague && myLeague.content && myLeague.content.capstone && myLeague.content.capstone.length > 0);
  const guideTotalSteps = guideTotalLessons + (guideHasCapstone ? 1 : 0);
  const guideCompletedSteps = Math.min(guideTotalSteps, curriculumDone ? guideTotalSteps : passedLessons.size);
  const guidePct = guideTotalSteps > 0 ? Math.round((guideCompletedSteps / guideTotalSteps) * 100) : 0;

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
          {guideTotalSteps > 0 ? (
            <>
              <p className="panel-sub">{guideCompletedSteps}/{guideTotalSteps} ünite tamamlandı{guideHasCapstone ? ' (bitirme sınavı dahil)' : ''}</p>
              <div className="xp-track"><div className="xp-fill" style={{ width: guidePct + '%' }} /></div>
            </>
          ) : !myLeague.promote_threshold ? (
            <p className="panel-sub">En üst ligdesin.</p>
          ) : (
            <p className="panel-sub">Bu lig için henüz rehber içeriği yok.</p>
          )}
          {myLeague.tier_index >= LEAGUE_STREAK_FLOOR_TIER && myLeague.tier_index < leagues.length - 1 && (
            curriculumDone && profile.league_success_streak < SUCCESS_STREAK_NEEDED ? (
              <p className="one-liner" style={{ marginTop: 6 }}>
                Rehber tamam! Terfi için art arda 2 hafta %60+ haftalık quiz gerekiyor ({profile.league_success_streak}/{SUCCESS_STREAK_NEEDED}).
              </p>
            ) : profile.league_miss_streak > 0 ? (
              <p className="one-liner" style={{ marginTop: 6 }}>
                ⚠️ Art arda {profile.league_miss_streak} hafta kaçırdın/başarısız oldun — devam edersen lig düşersin.
              </p>
            ) : null
          )}
        </div>
      )}

      <div className="tabs">
        <button className={activeTab === 'week' ? 'btn secondary' : 'btn ghost'} onClick={() => setActiveTab('week')}>📡 Takip Et, Güncel Kal</button>
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
        const content = myLeague.content;
        const lessons = groupLessons(content.quiz || []);
        const totalLessons = lessons.length;
        // Backward compatibility: capstone is null/empty on older league content (or content whose
        // generation prompt hasn't been updated yet) — treat the tier as complete once every
        // lesson is passed instead of blocking on a capstone that will never arrive.
        const capstoneQuestions = content.capstone && content.capstone.length > 0 ? content.capstone : [];
        const hasCapstone = capstoneQuestions.length > 0;
        const allLessonsPassed = totalLessons === 0 || lessonIndex >= totalLessons;
        const currentLesson = lessonIndex < totalLessons ? lessons[lessonIndex] : null;
        const effectiveViewedIndex = viewedLessonIndex !== null ? viewedLessonIndex : (currentLesson ? lessonIndex : null);
        const viewedLesson = effectiveViewedIndex !== null && effectiveViewedIndex < totalLessons ? lessons[effectiveViewedIndex] : null;
        const viewedMustRead = viewedLesson ? content.must_reads[viewedLesson.sourceIndex] : null;
        const isViewingCurrentLesson = effectiveViewedIndex !== null && effectiveViewedIndex === lessonIndex;

        const lStepQ = currentLesson ? currentLesson.questions[lessonStepIndex] : undefined;
        const lAnswered = !!lStepQ && lessonAnswers[lessonStepIndex] !== undefined;
        const lAllAnswered = !!currentLesson && currentLesson.questions.length > 0 && currentLesson.questions.every((_, i) => lessonAnswers[i] !== undefined);

        const lessonTestStage = currentLesson && (
          <>
            {lStepQ && !lAllAnswered && (
              <div className="quiz-stage" style={{ marginTop: 14 }}>
                <div className="quiz-progress">Ders {lessonIndex + 1}/{totalLessons} · Soru {lessonStepIndex + 1} / {currentLesson.questions.length}</div>
                {lAnswered && (
                  <div className={'feedback-banner ' + (lessonAnswers[lessonStepIndex] === lStepQ.correct_index ? 'correct' : 'wrong')}>
                    {lessonAnswers[lessonStepIndex] === lStepQ.correct_index ? '🎉 Harika, doğru bildin!' : '💥 Olmadı, bir dahakine!'}
                  </div>
                )}
                <div className="quiz-card">
                  <div className="quiz-q">
                    {lStepQ.type === 'tf' && <span className="tag tf">DOĞRU/YANLIŞ</span>}
                    <div>{lStepQ.question}</div>
                  </div>
                  {lStepQ.options.map((opt, oi) => {
                    let cls = 'quiz-opt opt-' + oi;
                    if (lAnswered && oi === lStepQ.correct_index) cls += ' correct';
                    else if (lAnswered && oi === lessonAnswers[lessonStepIndex]) cls += ' wrong';
                    return <button key={oi} className={cls} disabled={lAnswered} onClick={() => selectLessonAnswer(lessonStepIndex, oi)}>{opt}</button>;
                  })}
                  {lAnswered && <div className="quiz-explain">{lStepQ.explanation}</div>}
                </div>
                {lAnswered && (
                  <button className="btn secondary" onClick={() => setLessonStepIndex((i) => i + 1)}>
                    {lessonStepIndex + 1 < currentLesson.questions.length ? 'Sonraki Soru' : 'Devam Et'}
                  </button>
                )}
              </div>
            )}
            {lAllAnswered && (
              <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => evaluateLesson(currentLesson.questions, myLeague!, totalLessons, !!curriculumDone)} disabled={curriculumSaving}>
                {curriculumSaving ? 'Kaydediliyor…' : 'Sonucu Gör'}
              </button>
            )}
          </>
        );

        const capStepQ = capstoneQuestions[capstoneStepIndex];
        const capAnswered = !!capStepQ && capstoneAnswers[capstoneStepIndex] !== undefined;
        const capAllAnswered = capstoneQuestions.length > 0 && capstoneQuestions.every((_, i) => capstoneAnswers[i] !== undefined);

        const capstoneTestStage = (
          <>
            {capStepQ && !capAllAnswered && (
              <div className="quiz-stage" style={{ marginTop: 14 }}>
                <div className="quiz-progress">🎓 Bitirme Sınavı · Soru {capstoneStepIndex + 1} / {capstoneQuestions.length}</div>
                {capAnswered && (
                  <div className={'feedback-banner ' + (capstoneAnswers[capstoneStepIndex] === capStepQ.correct_index ? 'correct' : 'wrong')}>
                    {capstoneAnswers[capstoneStepIndex] === capStepQ.correct_index ? '🎉 Harika, doğru bildin!' : '💥 Olmadı, bir dahakine!'}
                  </div>
                )}
                <div className="quiz-card">
                  <div className="quiz-q"><span className="tag boss">BİTİRME SORUSU</span><div>{capStepQ.question}</div></div>
                  {capStepQ.options.map((opt, oi) => {
                    let cls = 'quiz-opt opt-' + oi;
                    if (capAnswered && oi === capStepQ.correct_index) cls += ' correct';
                    else if (capAnswered && oi === capstoneAnswers[capstoneStepIndex]) cls += ' wrong';
                    return <button key={oi} className={cls} disabled={capAnswered} onClick={() => selectCapstoneAnswer(capstoneStepIndex, oi)}>{opt}</button>;
                  })}
                  {capAnswered && <div className="quiz-explain">{capStepQ.explanation}</div>}
                </div>
                {capAnswered && (
                  <button className="btn secondary" onClick={() => setCapstoneStepIndex((i) => i + 1)}>
                    {capstoneStepIndex + 1 < capstoneQuestions.length ? 'Sonraki Soru' : 'Devam Et'}
                  </button>
                )}
              </div>
            )}
            {capAllAnswered && (
              <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => finishCurriculum(myLeague, !!curriculumDone, capstoneQuestions)} disabled={curriculumSaving}>
                {curriculumSaving ? 'Kaydediliyor…' : 'Rehberi Bitir'}
              </button>
            )}
          </>
        );

        return (
          <>
            <div className="panel static-curriculum">
              <span className="tag static">📘 SABİT REHBER · AKADEMİ{curriculumDone ? ' · TEKRAR (yarı XP)' : ''}</span>
              <p className="panel-title">{myLeague.name} Rehberi</p>

              {curriculumDone && lessonIndex === 0 && passedLessons.size === 0 && !capstoneOpen && (
                <p className="panel-sub" style={{ margin: '10px 0' }}>Rehber tamamlandı ✓ ({leagueProgress!.quiz_score}/{leagueProgress!.quiz_total}) — istersen yarı XP için dersleri tekrar geç.</p>
              )}

              {totalLessons > 0 && (
                <div className="lesson-path">
                  {lessons.map((lg, i) => {
                    const status = i < lessonIndex ? 'passed' : i === lessonIndex ? 'current' : 'locked';
                    const title = content.must_reads[lg.sourceIndex] ? content.must_reads[lg.sourceIndex].title : `Ders ${i + 1}`;
                    const prevTitle = i > 0 && content.must_reads[lessons[i - 1].sourceIndex] ? content.must_reads[lessons[i - 1].sourceIndex].title : 'önceki ders';
                    return (
                      <button key={i} type="button" className={'lesson-row lesson-row-' + status}
                        disabled={status === 'locked'}
                        onClick={() => { if (status !== 'locked') setViewedLessonIndex(i); }}>
                        <span className="lesson-row-icon">{status === 'passed' ? '✓' : status === 'current' ? '🔓' : '🔒'}</span>
                        <span className="lesson-row-title">{title}</span>
                        {status === 'locked' && <span className="lesson-row-hint">Bu ders şu an kilitli, önce "{prevTitle}" dersini geç</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              {viewedLesson && viewedMustRead && (
                <div className="read-row" style={{ marginTop: 12 }}>
                  <div>
                    {viewedMustRead.url ? <a href={viewedMustRead.url} target="_blank" rel="noopener noreferrer">{viewedMustRead.title}</a> : <strong>{viewedMustRead.title}</strong>}
                    {viewedMustRead.url2 && <> · <a href={viewedMustRead.url2} target="_blank" rel="noopener noreferrer">İkinci Kaynak</a></>}
                    <div className="one-liner">{viewedMustRead.summary}</div>
                  </div>
                </div>
              )}

              {viewedLesson && isViewingCurrentLesson && (
                <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => setGuideTestModeOpen(true)}>
                  ✅ Özeti Okudum, Kendimi Test Et
                </button>
              )}

              {viewedLesson && !isViewingCurrentLesson && effectiveViewedIndex !== null && (
                <p className="panel-sub" style={{ marginTop: 10 }}>
                  Bu dersi geçtin ✓{lessonResults[effectiveViewedIndex] ? ` (${lessonResults[effectiveViewedIndex].score}/${lessonResults[effectiveViewedIndex].total})` : ''}
                </p>
              )}

              {allLessonsPassed && hasCapstone && (
                <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => setCapstoneOpen(true)}>
                  🎓 Bitirme Sınavına Gir
                </button>
              )}

              {allLessonsPassed && !hasCapstone && (
                <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => finishCurriculum(myLeague, !!curriculumDone, [])} disabled={curriculumSaving}>
                  {curriculumSaving ? 'Kaydediliyor…' : 'Rehberi Bitir'}
                </button>
              )}
            </div>

            {guideTestModeOpen && currentLesson && (
              <div className="speed-overlay">
                <button className="overlay-close-btn" onClick={() => setGuideTestModeOpen(false)} aria-label="Kapat">✕ Kapat</button>
                <div className="speed-overlay-panel">
                  <div className="panel quiz-stage">
                    {lessonPassInfo ? (
                      <div style={{ textAlign: 'center', padding: '16px 0' }}>
                        <div className="promotion-emoji">🎉</div>
                        <p className="promotion-title">Tebrikler, dersi geçtin!</p>
                        <p className="promotion-text">{lessonPassInfo.score}/{lessonPassInfo.total} doğru · +{lessonPassInfo.xp} XP kazandın</p>
                        <button className="btn secondary" style={{ width: '100%' }} onClick={continueAfterLessonPass}>Devam Et</button>
                      </div>
                    ) : lessonFailInfo ? (
                      <div style={{ textAlign: 'center', padding: '16px 0' }}>
                        <div className="promotion-emoji">💥</div>
                        <p className="promotion-title" style={{ color: 'var(--coral)' }}>Olmadı, bir dahakine!</p>
                        <p className="promotion-text">{lessonFailInfo.score}/{lessonFailInfo.total} doğru — özeti tekrar oku ve tekrar dene.</p>
                        <button className="btn danger" style={{ width: '100%' }} onClick={retryLesson}>Tekrar Dene</button>
                      </div>
                    ) : (
                      <>
                        <span className="tag static">📘 DERS {lessonIndex + 1} · TEST MODU</span>
                        <p className="panel-title" style={{ textAlign: 'center' }}>{content.must_reads[currentLesson.sourceIndex] ? content.must_reads[currentLesson.sourceIndex].title : ''}</p>
                        {lessonTestStage}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {capstoneOpen && (
              <div className="speed-overlay">
                <button className="overlay-close-btn" onClick={() => setCapstoneOpen(false)} aria-label="Kapat">✕ Kapat</button>
                <div className="speed-overlay-panel">
                  <div className="panel quiz-stage boss">
                    <span className="tag boss">🎓 BİTİRME SINAVI</span>
                    <p className="panel-title" style={{ textAlign: 'center' }}>{myLeague.name} Bitirme Sınavı</p>
                    {capstoneTestStage}
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
                ) : !weeklyReplayOverlayOpen ? (
                  <button className="btn ghost" onClick={resumeWeeklyReplay}>▶ Kaldığın Yerden Devam Et</button>
                ) : null}

                {weeklyReplayActive && !rAllAnswered && weeklyReplayOverlayOpen && rq && (
                  <div className="speed-overlay">
                    <button className="overlay-close-btn" onClick={() => setWeeklyReplayOverlayOpen(false)} aria-label="Kapat">✕ Kapat</button>
                    <div className="speed-overlay-panel">
                      <div className="panel quiz-stage">
                        <p className="panel-title" style={{ textAlign: 'center' }}>Tekrar Sınavı (yarı XP)</p>
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
                    </div>
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
              <p className="panel-title">{(currentWeek.week_label || formatWeekRange(currentWeek.created_at))} — Takip Et, Güncel Kal!</p>
              {currentWeek.week_theme && (
                <>
                  <p className="panel-sub" style={{ marginBottom: 2 }}>Bu haftanın öne çıkanlarının özeti:</p>
                  <p className="panel-sub">{currentWeek.week_theme}</p>
                </>
              )}
              <button className="btn ghost" onClick={() => setShowSources((v) => !v)}>
                {showSources ? 'Kaynakları Gizle' : `📚 Bu Haftaya Dair Kaynaklara Hemen Göz At (${currentWeek.must_reads.length})`}
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
            const speedSecondsForWeek = computeSpeedSecondsForWeek(currentWeek);
            const hasWeekTestProgress = Object.keys(quizAnswers).length > 0 || numberSubmitted || riskChoice !== null || bossAnswer !== null;

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
                {!weekClosed && !readyToClose && !weekTestOverlayOpen && (
                  <div className="panel">
                    {!hasWeekTestProgress ? (
                      <>
                        <p className="panel-title">🧠 Kendini Test Et</p>
                        <p className="panel-sub">İstersen süre baskısı olmadan kendi hızında, istersen hız turuyla ekstra XP bonusu için zamana karşı test ol.</p>
                        <div className="week-test-entry-row">
                          <button className="btn secondary" onClick={startUntimedWeekTest}>🧠 Kendini Test Et, Ne Kadar Güncelsin?</button>
                          <button className="btn danger" onClick={startSpeedRound}>⏱ Hız Turu ile Test Et, Daha Çok XP Kazan</button>
                        </div>
                        <p className="panel-sub" style={{ marginTop: 8 }}>Hız turunda {Math.round(speedSecondsForWeek)} saniyede tüm soruları (ekstra sorular dahil) bitirirsen +30 XP bonus kazanırsın. Tek deneme hakkın var.</p>
                      </>
                    ) : (
                      <button className="btn secondary" onClick={resumeWeekTest}>▶ Kaldığın Yerden Devam Et</button>
                    )}
                  </div>
                )}

                {weekTestOverlayOpen && !weekClosed && (
                  <div className="speed-overlay">
                    <button className="overlay-close-btn" onClick={() => setWeekTestOverlayOpen(false)} aria-label="Kapat">✕ Kapat</button>
                    {weekTestMode === 'timed' && (
                      <div className="speed-overlay-timer">
                        <TimerRing seconds={speedTimeLeft} total={speedSecondsForWeek} size={56} />
                        <span>HIZ TURU — tüm soruları bitir, +30 XP kazan</span>
                      </div>
                    )}
                    <div className="speed-overlay-panel">
                      {!allQuizAnswered && stepQ && quizStagePanel}
                      {allQuizAnswered && currentExtra && extraStagePanelFor(currentExtra)}
                      {readyToClose && (
                        <div className="panel">
                          <button className="btn secondary" onClick={closeWeek} disabled={saving || (riskChoice === 'bet' && riskAnswer === null)}>
                            {saving ? 'Kaydediliyor…' : 'Haftayı Bitir ve Bonus Al'}
                          </button>
                          <p className="panel-sub" style={{ marginTop: 8 }}>Sorulardan kazandığın XP zaten hesabına işlendi ({sessionXp} XP). Bu buton sadece bitirme bonusunu ekler ve seriyi ilerletir.</p>
                          {closeWeekError && <div className="error-box">{closeWeekError}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                )}

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

                {weekClosed && (
                  <div className="panel">
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
