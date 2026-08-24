import { sb } from './supabase';
import type { Profile } from './types';

// Usta Lig ve üzerinde (tier_index >= bu değer) rehber tamamlama tek başına yetmiyor: terfi
// ayrıca son 2 hafta üst üste haftalık quiz başarısı istiyor, art arda kaçırılan haftalar ise
// lig düşürüyor. 0-3 arası ligler bundan etkilenmez.
export const LEAGUE_STREAK_FLOOR_TIER = 4;
const SUCCESS_RATIO = 0.6;
export const SUCCESS_STREAK_NEEDED = 2;
const MISS_STREAK_DEMOTE_AT = 3;

type HistoryStreakRow = { week_number: number; quiz_score: number; quiz_total: number; frozen: boolean };

// Sırayla, watermark'tan (league_streak_week_number) currentWeekNumber'a kadar her haftayı işler
// — tıpkı kullanıcı o haftalarda siteye girmiş gibi terfi/düşüş uygular. Uzun süre girilmemiş
// olsa bile dönüşte tüm kaçırılan haftalar tek seferde, sırayla değerlendirilir. Sonuç
// değişmediyse ekstra bir profiles update atmadan aynı profile referansını döndürür.
export async function evaluateLeagueStreak(profile: Profile, currentWeekNumber: number): Promise<Profile> {
  if (profile.league_tier < LEAGUE_STREAK_FLOOR_TIER) return profile;
  if (!currentWeekNumber || currentWeekNumber <= profile.league_streak_week_number) return profile;

  const { data: historyRows } = await sb
    .from('history')
    .select('week_number, quiz_score, quiz_total, frozen')
    .eq('user_id', profile.id)
    .gt('week_number', profile.league_streak_week_number)
    .lte('week_number', currentWeekNumber);
  const byWeek = new Map<number, HistoryStreakRow>((historyRows || []).map((r: HistoryStreakRow) => [r.week_number, r]));

  const { data: progressRows } = await sb
    .from('league_progress')
    .select('tier_index, completed')
    .eq('user_id', profile.id);
  const completedTiers = new Set((progressRows || []).filter((r) => r.completed).map((r) => r.tier_index));

  const { data: topLeagueRows } = await sb.from('leagues').select('tier_index').order('tier_index', { ascending: false }).limit(1);
  const maxTier = topLeagueRows && topLeagueRows[0] ? topLeagueRows[0].tier_index : profile.league_tier;

  let tier = profile.league_tier;
  let successStreak = profile.league_success_streak;
  let missStreak = profile.league_miss_streak;
  let watermark = profile.league_streak_week_number;

  for (let w = profile.league_streak_week_number + 1; w <= currentWeekNumber; w++) {
    const row = byWeek.get(w);
    // Aktif hafta (henüz kapanmamış) için hâlâ history satırı yoksa dur — o hafta için karar
    // vermek erken, kullanıcının hâlâ oynama şansı var.
    if (w === currentWeekNumber && !row) break;
    watermark = w;

    if (row && row.frozen) continue; // dondurulan hafta nötr: sayaçları etkilemez

    const success = !!row && row.quiz_total > 0 && row.quiz_score / row.quiz_total >= SUCCESS_RATIO;
    if (success) {
      successStreak += 1;
      missStreak = 0;
    } else {
      missStreak += 1;
      successStreak = 0;
      if (missStreak >= MISS_STREAK_DEMOTE_AT && tier > LEAGUE_STREAK_FLOOR_TIER) tier -= 1;
    }

    if (successStreak >= SUCCESS_STREAK_NEEDED && tier < maxTier && completedTiers.has(tier)) {
      tier += 1;
      successStreak = 0;
      missStreak = 0;
    }
  }

  const unchanged =
    watermark === profile.league_streak_week_number &&
    tier === profile.league_tier &&
    successStreak === profile.league_success_streak &&
    missStreak === profile.league_miss_streak;
  if (unchanged) return profile;

  const updated = {
    league_tier: tier,
    league_success_streak: successStreak,
    league_miss_streak: missStreak,
    league_streak_week_number: watermark,
  };
  await sb.from('profiles').update(updated).eq('id', profile.id);
  return { ...profile, ...updated };
}
