-- Düello modunda bahis miktarı
alter table public.live_rooms add column if not exists bet_amount int not null default 0;
