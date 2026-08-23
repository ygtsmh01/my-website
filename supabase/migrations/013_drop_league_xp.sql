-- league_xp'yi tamamen kaldırıyoruz: terfi artık yalnızca lig rehberini
-- (akademi + bitirme sınavı) bitirmekle tetikleniyor, ayrı bir puan havuzu
-- yok. Haftalık quiz ve Canlı Yarışma da artık league_xp'ye dokunmuyor.
-- Kod tarafındaki değişiklik deploy edilip doğrulandıktan SONRA çalıştır.

alter table public.profiles drop column if exists league_xp;
