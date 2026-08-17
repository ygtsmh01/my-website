-- Canlı yarışma katılımcılarının katılım anındaki lig seviyesini kaydet
-- (odadaki en düşük ligli kişiye göre XP ayarlamak için).
alter table public.live_participants add column if not exists league_tier int not null default 0;
