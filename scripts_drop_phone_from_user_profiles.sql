-- Применять ПОСЛЕ scripts_reset_consistent_user_schema.sql, если он уже был выполнен.
-- Скрипт удаляет phone из user_profiles и обновляет функцию автосоздания профиля.

begin;

-- 1) Обновляем функцию без phone
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        updated_at = now();

  return new;
end;
$$;

-- 2) Удаляем колонку phone (если уже удалена — ошибок не будет)
alter table public.user_profiles
  drop column if exists phone;

-- 3) Синхронизируем full_name для существующих пользователей
insert into public.user_profiles (id, full_name)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
on conflict (id) do update
  set full_name = excluded.full_name,
      updated_at = now();

commit;
