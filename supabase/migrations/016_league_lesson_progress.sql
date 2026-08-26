-- Ders (ünite) bazlı ilerleme oturuma değil veritabanına bağlansın: kullanıcı
-- bir ligin rehberinde birkaç ünite geçip çıkış yapıp tekrar girdiğinde,
-- lessonIndex sadece React state'inde tutulduğu için sıfırdan (1. üniteden)
-- başlıyordu. current_lesson_index bu ilerlemeyi kalıcı hale getiriyor.
alter table public.league_progress add column if not exists current_lesson_index int not null default 0;
