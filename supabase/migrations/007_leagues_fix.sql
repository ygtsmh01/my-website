-- migration_leagues.sql'in tekrar çalıştırılabilir (idempotent) hali.
-- "leagues" tablosu zaten varsa bile güvenle çalıştırabilirsin.

create table if not exists public.leagues (
  tier_index int primary key,
  name text not null,
  promote_threshold int,
  weekly_multiplier numeric not null default 1,
  content jsonb,
  created_at timestamptz default now()
);

insert into public.leagues (tier_index, name, promote_threshold, weekly_multiplier) values
  (0, 'Bronz Lig', 100, 1.0),
  (1, 'Gümüş Lig', 150, 1.15),
  (2, 'Altın Lig', 220, 1.3),
  (3, 'Elmas Lig', 320, 1.6),
  (4, 'Usta Lig', 450, 2.0),
  (5, 'Şampiyonlar Ligi', null, 2.5)
on conflict (tier_index) do nothing;

alter table public.profiles add column if not exists league_tier int not null default 0;
alter table public.profiles add column if not exists league_xp int not null default 0;

create table if not exists public.league_progress (
  user_id uuid references public.profiles(id) on delete cascade not null,
  tier_index int not null,
  completed boolean not null default false,
  quiz_score int default 0,
  quiz_total int default 0,
  completed_at timestamptz,
  primary key (user_id, tier_index)
);

alter table public.live_rooms add column if not exists league_tier int not null default 0;

alter table public.leagues enable row level security;
alter table public.league_progress enable row level security;

drop policy if exists "leagues_select_authenticated" on public.leagues;
create policy "leagues_select_authenticated" on public.leagues for select using (auth.role() = 'authenticated');

drop policy if exists "leagues_admin_insert" on public.leagues;
create policy "leagues_admin_insert" on public.leagues for insert with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

drop policy if exists "leagues_admin_update" on public.leagues;
create policy "leagues_admin_update" on public.leagues for update using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

drop policy if exists "league_progress_select_own" on public.league_progress;
create policy "league_progress_select_own" on public.league_progress for select using (auth.uid() = user_id);

drop policy if exists "league_progress_insert_own" on public.league_progress;
create policy "league_progress_insert_own" on public.league_progress for insert with check (auth.uid() = user_id);

drop policy if exists "league_progress_update_own" on public.league_progress;
create policy "league_progress_update_own" on public.league_progress for update using (auth.uid() = user_id);
