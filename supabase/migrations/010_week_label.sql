-- Adds a manually-editable display label for weeks, replacing the computed
-- date-range display (formatWeekRange) as the primary label when set.
-- Idempotent like 008/009 — safe to re-run.

alter table public.weeks add column if not exists week_label text;
