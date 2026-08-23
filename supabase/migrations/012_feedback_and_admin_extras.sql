-- Adds: user feedback/suggestions board, an admin-only RPC to list
-- marketing-consent users with their real email (auth.users isn't
-- directly queryable from the client), admin delete rights on leagues
-- (for the new tier-management panel), and a short tagline per league
-- tier (e.g. "AI gündemini sıkı takip eden" for the top tier).
-- Idempotent — safe to re-run.

create table if not exists public.feedback (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  category text not null default 'general' check (category in ('general', 'content_suggestion')),
  message text not null,
  status text not null default 'new' check (status in ('new', 'reviewed', 'resolved')),
  created_at timestamptz default now()
);

alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own" on public.feedback for insert with check (auth.uid() = user_id);

drop policy if exists "feedback_select_own_or_admin" on public.feedback;
create policy "feedback_select_own_or_admin" on public.feedback for select using (
  auth.uid() = user_id
  or exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
);

drop policy if exists "feedback_update_admin" on public.feedback;
create policy "feedback_update_admin" on public.feedback for update using (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
);

alter table public.leagues add column if not exists tagline text;

drop policy if exists "leagues_admin_delete" on public.leagues;
create policy "leagues_admin_delete" on public.leagues for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
);

-- Admin-only: list users who opted into marketing/update emails, with their
-- real email address (joins auth.users, which the client can never query
-- directly). Raises if the caller isn't an admin.
create or replace function public.admin_marketing_consent_users()
returns table(username text, email text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'not authorized';
  end if;
  return query
    select p.username, u.email, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.marketing_consent = true
    order by p.created_at desc;
end;
$$;

grant execute on function public.admin_marketing_consent_users() to authenticated;
