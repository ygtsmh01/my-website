-- Adds a draft/review workflow for AI-generated weeks and league content.
-- Idempotent like 007 — safe to re-run.

-- weeks: draft/published status. Existing rows default to 'published' (they're already live).
alter table public.weeks add column if not exists status text not null default 'published';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'weeks_status_check'
  ) then
    alter table public.weeks add constraint weeks_status_check check (status in ('draft', 'published'));
  end if;
end $$;

-- leagues: separate draft_content column so an in-review AI draft never clobbers live content.
alter table public.leagues add column if not exists draft_content jsonb;

-- weeks RLS: non-admins only see published weeks; admins see everything (including drafts).
drop policy if exists "weeks_select_authenticated" on public.weeks;
create policy "weeks_select_authenticated" on public.weeks for select using (
  status = 'published'
  or exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
);

-- Allow admins to delete weeks — only used by the admin UI to discard unpublished drafts;
-- the UI itself only ever calls delete while status = 'draft', enforced here too so a
-- published week (which may have completed-history rows pointing at it) can never be
-- deleted through this policy.
drop policy if exists "weeks_delete_admin" on public.weeks;
create policy "weeks_delete_admin" on public.weeks for delete using (
  status = 'draft'
  and exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
);
