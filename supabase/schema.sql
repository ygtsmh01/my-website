-- AI Takip Defteri — Supabase şeması
-- Supabase Dashboard > SQL Editor içine yapıştırıp "Run" ile çalıştır.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  total_xp int not null default 0,
  streak int not null default 0,
  freezes int not null default 0,
  last_week_number int not null default 0,
  is_admin boolean not null default false,
  created_at timestamptz default now()
);

create table public.history (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  week_number int not null,
  date date not null default current_date,
  xp_earned int not null default 0,
  quiz_score int default 0,
  quiz_total int default 0,
  week_theme text,
  critical boolean default false,
  risk_won boolean,
  boss_cleared boolean default false,
  frozen boolean default false,
  created_at timestamptz default now(),
  unique(user_id, week_number)
);

create table public.weeks (
  week_number int primary key,
  week_theme text,
  must_reads jsonb not null,
  quiz jsonb not null,
  number_challenge jsonb,
  matching jsonb,
  risk_question jsonb,
  boss_question jsonb,
  is_boss boolean default false,
  created_at timestamptz default now(),
  status text not null default 'published' check (status in ('draft', 'published'))
);

-- Yeni kullanıcı kayıt olunca otomatik profil satırı oluştur
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.history enable row level security;
alter table public.weeks enable row level security;

create policy "profiles_select_all" on public.profiles
  for select using (true);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "history_select_own" on public.history
  for select using (auth.uid() = user_id);
create policy "history_insert_own" on public.history
  for insert with check (auth.uid() = user_id);

create policy "weeks_select_authenticated" on public.weeks
  for select using (
    status = 'published'
    or exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
create policy "weeks_insert_admin" on public.weeks
  for insert with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
create policy "weeks_update_admin" on public.weeks
  for update using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
create policy "weeks_delete_admin" on public.weeks
  for delete using (
    status = 'draft'
    and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Kendi hesabını admin yapmak için: yukarıdaki şemayı çalıştırdıktan sonra
-- önce siteden normal şekilde kayıt ol, sonra AŞAĞIDAKİ satırı kendi
-- kullanıcı adınla değiştirip SQL Editor'de ayrıca çalıştır:
-- update public.profiles set is_admin = true where username = 'BURAYA_KULLANICI_ADIN';
