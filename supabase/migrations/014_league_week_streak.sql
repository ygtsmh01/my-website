-- Usta Lig (tier_index >= 4) ve üzeri için haftalık quiz seri kuralı: terfi artık rehber
-- tamamlanmasının yanında son 2 hafta üst üste %60+ başarı da istiyor; art arda kaçırılan
-- haftalar lig düşürüyor. Sayaçlar client tarafında src/lib/leagueStreak.ts'te işleniyor.

alter table public.profiles
  add column if not exists league_success_streak int not null default 0,
  add column if not exists league_miss_streak int not null default 0,
  add column if not exists league_streak_week_number int not null default 0;
