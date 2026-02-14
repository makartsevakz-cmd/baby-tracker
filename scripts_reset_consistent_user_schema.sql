-- ВНИМАНИЕ: скрипт удаляет данные приложения (pre-production reset).
-- Цель:
-- 1) Сделать user_id консистентным UUID (auth.users.id) во всех таблицах.
-- 2) Нормализовать user_telegram_mapping: user_id=UUID пользователя, chat_id=BIGINT Telegram.
-- 3) Гарантировать заполнение user_profiles и sent_notifications.user_id.

begin;

-- -------------------------------------------------------------------
-- 0) Полная очистка данных приложения (по вашему запросу)
-- -------------------------------------------------------------------
truncate table
  public.sent_notifications,
  public.notifications,
  public.activities,
  public.growth_records,
  public.reminders,
  public.device_tokens,
  public.babies,
  public.user_telegram_mapping,
  public.user_profiles
restart identity cascade;

-- -------------------------------------------------------------------
-- 1) user_profiles: профиль на каждого auth пользователя
-- -------------------------------------------------------------------
-- В SQL Editor Supabase нельзя менять тип колонки, если на неё ссылается RLS policy.
-- Поэтому не делаем ALTER TYPE, а пересоздаём таблицу целиком.
drop table if exists public.user_profiles cascade;

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name varchar,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Создание/обновление профиля при регистрации пользователя.
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

drop trigger if exists on_auth_user_created_user_profile on auth.users;
create trigger on_auth_user_created_user_profile
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();

-- Синхронизация профилей для существующих auth.users
insert into public.user_profiles (id, full_name)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
on conflict (id) do update
  set full_name = excluded.full_name,
      updated_at = now();

-- -------------------------------------------------------------------
-- 2) user_telegram_mapping: единая схема
-- -------------------------------------------------------------------
drop table if exists public.user_telegram_mapping;

create table public.user_telegram_mapping (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint not null,
  username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_user_telegram_mapping_chat_id
  on public.user_telegram_mapping(chat_id);

-- -------------------------------------------------------------------
-- 3) sent_notifications: user_id обязателен и это UUID auth.users.id
-- -------------------------------------------------------------------
drop table if exists public.sent_notifications cascade;

create table public.sent_notifications (
  id bigserial primary key,
  dedupe_key text not null,
  notification_id bigint not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sent_at timestamptz not null default now(),
  scheduled_time timestamptz
);

-- Дедупликация уже используется в коде; гарантируем уникальность dedupe_key.
create unique index if not exists ux_sent_notifications_dedupe_key
  on public.sent_notifications(dedupe_key);

commit;
