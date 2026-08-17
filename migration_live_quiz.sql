-- Canlı Yarışma (oda + düello modu)
-- Supabase SQL Editor'de çalıştır.

create table public.live_rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  mode text not null check (mode in ('room', 'duel')),
  host_id uuid references public.profiles(id) not null,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'finished')),
  questions jsonb not null,
  current_question_index int not null default -1,
  question_started_at timestamptz,
  created_at timestamptz default now()
);

create table public.live_participants (
  id bigserial primary key,
  room_id uuid references public.live_rooms(id) on delete cascade not null,
  user_id uuid references public.profiles(id) not null,
  username text not null,
  avatar text not null default '🙂',
  score int not null default 0,
  xp_awarded boolean not null default false,
  joined_at timestamptz default now(),
  unique(room_id, user_id)
);

create table public.live_answers (
  id bigserial primary key,
  room_id uuid references public.live_rooms(id) on delete cascade not null,
  user_id uuid references public.profiles(id) not null,
  question_index int not null,
  option_index int not null,
  correct boolean not null,
  points int not null default 0,
  answered_at timestamptz default now(),
  unique(room_id, user_id, question_index)
);

alter table public.live_rooms enable row level security;
alter table public.live_participants enable row level security;
alter table public.live_answers enable row level security;

create policy "live_rooms_select_all" on public.live_rooms for select using (true);
create policy "live_rooms_insert_own" on public.live_rooms for insert with check (auth.uid() = host_id);
create policy "live_rooms_update_host" on public.live_rooms for update using (auth.uid() = host_id);

create policy "live_participants_select_all" on public.live_participants for select using (true);
create policy "live_participants_insert_own" on public.live_participants for insert with check (auth.uid() = user_id);
create policy "live_participants_update_own" on public.live_participants for update using (auth.uid() = user_id);

create policy "live_answers_select_all" on public.live_answers for select using (true);
create policy "live_answers_insert_own" on public.live_answers for insert with check (auth.uid() = user_id);

-- Realtime yayınını aç (oda/katılımcı/cevap değişiklikleri anlık yayılsın)
alter publication supabase_realtime add table public.live_rooms;
alter publication supabase_realtime add table public.live_participants;
alter publication supabase_realtime add table public.live_answers;
