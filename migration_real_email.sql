-- Gerçek e-posta ile kayıt + ayrı kullanıcı adı + pazarlama izni
-- Supabase SQL Editor'de çalıştır (ilk schema.sql'i zaten çalıştırdıktan sonra).

alter table public.profiles add column if not exists marketing_consent boolean not null default false;

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, marketing_consent)
  values (
    new.id,
    new.raw_user_meta_data->>'username',
    coalesce((new.raw_user_meta_data->>'marketing_consent')::boolean, false)
  );
  return new;
end;
$$ language plpgsql security definer;
