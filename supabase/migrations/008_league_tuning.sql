-- Lig terfi eşiklerini düşürüp atlamayı kolaylaştırır.
update public.leagues set promote_threshold = 60 where tier_index = 0;
update public.leagues set promote_threshold = 90 where tier_index = 1;
update public.leagues set promote_threshold = 130 where tier_index = 2;
update public.leagues set promote_threshold = 190 where tier_index = 3;
update public.leagues set promote_threshold = 260 where tier_index = 4;
-- tier 5 (Şampiyonlar Ligi) zaten null (terfi yok), dokunulmuyor.
