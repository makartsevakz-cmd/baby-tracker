-- Добавляет поддержку пользовательского типа активности `custom` в таблице public.activities.
-- Скрипт безопасен для повторного запуска.

begin;

-- 1) Если колонка activities.type имеет enum-тип, добавляем значение custom.
do $$
declare
  enum_type_name text;
begin
  select t.typname
  into enum_type_name
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname = 'activities'
    and a.attname = 'type'
    and t.typtype = 'e'
  limit 1;

  if enum_type_name is not null then
    execute format('alter type %I add value if not exists ''custom''', enum_type_name);
  end if;
end
$$;

-- 2) Если используется CHECK-ограничение на type и в нём нет custom,
--    заменяем распространённые варианты ограничений.
alter table public.activities
  drop constraint if exists activities_type_check,
  drop constraint if exists activity_type_check,
  drop constraint if exists check_activity_type;

alter table public.activities
  add constraint activities_type_check
  check (
    type in (
      'breastfeeding',
      'bottle',
      'sleep',
      'bath',
      'walk',
      'activity',
      'custom',
      'diaper',
      'medicine',
      'burp'
    )
  );

commit;
