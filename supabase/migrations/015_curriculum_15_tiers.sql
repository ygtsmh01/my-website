-- Eski 6 kademeli, haber-temelli lig isimlendirmesini (Bronz..Şampiyonlar)
-- gerçek bir "sıfırdan ileri seviyeye" YZ okuryazarlığı yolculuğunu anlatan
-- 15 kademelik bir ünvan merdivenine geçiriyoruz (Gözlemci..Vizyoner).
-- tier_index sabit kalıyor (0-5 yeniden adlandırılıyor, 6-14 yeni ekleniyor),
-- bu yüzden mevcut kullanıcıların league_tier / league_progress kayıtları
-- hiç dokunulmadan doğru yeni isme karşılık geliyor.

update public.leagues set name = 'Gözlemci', tagline = 'Yapay Zekaya Giriş' where tier_index = 0;
update public.leagues set name = 'Meraklı', tagline = 'Sohbet Asistanları' where tier_index = 1;
update public.leagues set name = 'Kâşif', tagline = 'LLM Temelleri' where tier_index = 2;
update public.leagues set name = 'Deneyci', tagline = 'Prompt Yazımı I' where tier_index = 3;
update public.leagues set name = 'Kullanıcı', tagline = 'Prompt Yazımı II' where tier_index = 4;
-- Artık en üst kademe değil, bu yüzden promote_threshold null'dan gerçek bir
-- sayıya güncelleniyor (aşağıdaki artan örüntünün devamı).
update public.leagues set name = 'Yorumcu', tagline = 'Metin Ötesi Üretken YZ', promote_threshold = 350 where tier_index = 5;

insert into public.leagues (tier_index, name, tagline, promote_threshold, weekly_multiplier) values
  (6, 'Uygulayıcı', 'YZ ile Üretkenlik', 460, 2.8),
  (7, 'Yetkin Kullanıcı', 'Sorumlu YZ', 590, 3.1),
  (8, 'İleri Uygulayıcı', 'YZ Araç Ekosistemi', 740, 3.4),
  (9, 'Analist', 'Ajanlar & Otomasyon', 910, 3.7),
  (10, 'Sistemci', 'RAG & Kendi Verinle YZ', 1100, 4.0),
  (11, 'Danışman', 'YZ ve İş Dünyası', 1310, 4.3),
  (12, 'Öncü', 'Modellerin İçi', 1540, 4.6),
  (13, 'Otorite', 'Güvenlik, Hizalama, Etik', 1790, 4.9),
  (14, 'Vizyoner', 'Geleceği Okumak', null, 5.2)
on conflict (tier_index) do nothing;
