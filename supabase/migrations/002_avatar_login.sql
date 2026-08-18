-- Avatar seçimi + kullanıcı adı VEYA e-posta ile giriş
-- Supabase SQL Editor'de çalıştır.

alter table public.profiles add column if not exists avatar text not null default '🙂';

-- Kullanıcı adı girildiyse e-postasını bulan, e-posta girildiyse aynen döndüren fonksiyon.
-- Giriş ekranında tek bir alan (kullanıcı adı ya da e-posta) yeterli olsun diye kullanılıyor.
create or replace function public.email_for_login(identifier text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  found_email text;
begin
  if identifier like '%@%' then
    return identifier;
  end if;
  select u.email into found_email
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(p.username) = lower(identifier);
  return found_email;
end;
$$;

grant execute on function public.email_for_login(text) to anon, authenticated;

-- Trigger'ı avatarı da kaydedecek şekilde güncelle
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, marketing_consent, avatar)
  values (
    new.id,
    new.raw_user_meta_data->>'username',
    coalesce((new.raw_user_meta_data->>'marketing_consent')::boolean, false),
    coalesce(new.raw_user_meta_data->>'avatar', '🙂')
  );
  return new;
end;
$$ language plpgsql security definer;
