-- Canlı yarışmada son katılımcı kalıp diğerleri ayrılırsa, o kişi kendi
-- odasını 'finished' yapabilsin diye update yetkisini host dışına da genişlet.
drop policy if exists "live_rooms_update_host" on public.live_rooms;
create policy "live_rooms_update_participant" on public.live_rooms for update using (
  exists (select 1 from public.live_participants where room_id = live_rooms.id and user_id = auth.uid())
);
