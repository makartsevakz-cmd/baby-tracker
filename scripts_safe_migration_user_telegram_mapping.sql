-- Безопасная миграция для привязки Telegram -> auth.users
-- Цель:
-- 1) Нормализовать данные в public.user_telegram_mapping
-- 2) Заполнить auth_user_id (uuid) там, где это возможно
-- 3) Удалить дубли, чтобы можно было добавить уникальные ограничения
--
-- Рекомендация: сначала выполнить блок «ПРЕДПРОСМОТР», затем «ПРИМЕНЕНИЕ».

-- =========================================================
-- ПРЕДПРОСМОТР (без изменений)
-- =========================================================

-- Строки без привязки к auth.users
select *
from public.user_telegram_mapping
where auth_user_id is null
order by updated_at desc nulls last;

-- Потенциальные дубли по chat_id
select chat_id, count(*)
from public.user_telegram_mapping
group by chat_id
having count(*) > 1
order by count(*) desc;

-- Потенциальные дубли по auth_user_id
select auth_user_id, count(*)
from public.user_telegram_mapping
where auth_user_id is not null
group by auth_user_id
having count(*) > 1
order by count(*) desc;

-- =========================================================
-- ПРИМЕНЕНИЕ (изменяет данные)
-- =========================================================

begin;

-- 0) Резервная копия таблицы перед миграцией
create table if not exists public.user_telegram_mapping_backup_20260212 as
select * from public.user_telegram_mapping;

-- 1) Проставляем chat_id, если он пустой (для личных чатов Telegram chat_id = user_id)
update public.user_telegram_mapping
set chat_id = user_id,
    updated_at = now()
where chat_id is null;

-- 2) Заполняем auth_user_id по auth.users.user_metadata.telegram_id
--    Сопоставление только там, где auth_user_id ещё null.
update public.user_telegram_mapping m
set auth_user_id = u.id,
    updated_at = now()
from auth.users u
where m.auth_user_id is null
  and (u.raw_user_meta_data ->> 'telegram_id') is not null
  and (u.raw_user_meta_data ->> 'telegram_id') ~ '^[0-9]+$'
  and m.user_id = ((u.raw_user_meta_data ->> 'telegram_id')::bigint);

-- 3) Удаляем дубли по user_id (оставляем самую актуальную строку,
--    приоритет у строк с заполненным auth_user_id)
with ranked as (
  select
    ctid,
    row_number() over (
      partition by user_id
      order by
        (auth_user_id is not null) desc,
        updated_at desc nulls last,
        created_at desc nulls last
    ) as rn
  from public.user_telegram_mapping
)
delete from public.user_telegram_mapping t
using ranked r
where t.ctid = r.ctid
  and r.rn > 1;

-- 4) Удаляем дубли по chat_id (тот же принцип приоритета)
with ranked as (
  select
    ctid,
    row_number() over (
      partition by chat_id
      order by
        (auth_user_id is not null) desc,
        updated_at desc nulls last,
        created_at desc nulls last
    ) as rn
  from public.user_telegram_mapping
)
delete from public.user_telegram_mapping t
using ranked r
where t.ctid = r.ctid
  and r.rn > 1;

-- 5) Удаляем дубли по auth_user_id (для not null)
with ranked as (
  select
    ctid,
    row_number() over (
      partition by auth_user_id
      order by
        updated_at desc nulls last,
        created_at desc nulls last
    ) as rn
  from public.user_telegram_mapping
  where auth_user_id is not null
)
delete from public.user_telegram_mapping t
using ranked r
where t.ctid = r.ctid
  and r.rn > 1;

commit;

-- =========================================================
-- ПОСТ-ПРОВЕРКИ
-- =========================================================

-- Проверяем, что дублей больше нет
select 'dup_chat_id' as check_name, count(*) as duplicate_groups
from (
  select chat_id
  from public.user_telegram_mapping
  group by chat_id
  having count(*) > 1
) s
union all
select 'dup_auth_user_id' as check_name, count(*) as duplicate_groups
from (
  select auth_user_id
  from public.user_telegram_mapping
  where auth_user_id is not null
  group by auth_user_id
  having count(*) > 1
) s;

-- Сколько строк осталось без auth_user_id
select count(*) as rows_without_auth_user_id
from public.user_telegram_mapping
where auth_user_id is null;

-- =========================================================
-- ИНДЕКСЫ/ОГРАНИЧЕНИЯ (запускать после успешных пост-проверок)
-- =========================================================

-- Важно: если таблица большая и прод-нагрузка высокая, создавайте индексы в окно низкой нагрузки.
create unique index if not exists ux_user_telegram_mapping_chat_id
  on public.user_telegram_mapping(chat_id);

create index if not exists ix_user_telegram_mapping_auth_user_id
  on public.user_telegram_mapping(auth_user_id);

-- Опционально: включайте только когда точно не осталось null и процесс миграции завершён.
-- alter table public.user_telegram_mapping
--   alter column auth_user_id set not null;
