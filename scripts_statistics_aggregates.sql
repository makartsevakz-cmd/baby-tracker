-- ============================================================
-- Агрегаты статистики для Baby Diary
-- Идемпотентный и безопасный скрипт для production.
-- ============================================================

begin;

-- 1) Таблица дневных агрегатов по типу активности.
create table if not exists public.daily_activity_stats (
  user_id uuid not null,
  activity_date date not null,
  activity_type text not null,
  total_count integer not null default 0,
  total_duration_minutes numeric(12,2) not null default 0,
  left_duration_minutes numeric(12,2) not null default 0,
  right_duration_minutes numeric(12,2) not null default 0,
  bottle_volume_ml numeric(12,2) not null default 0,
  diaper_wet_count integer not null default 0,
  diaper_dirty_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint daily_activity_stats_pk primary key (user_id, activity_date, activity_type)
);

create index if not exists idx_daily_activity_stats_user_date
  on public.daily_activity_stats (user_id, activity_date);

create index if not exists idx_daily_activity_stats_type
  on public.daily_activity_stats (activity_type);

-- 2) Таблица метрик интервалов (по типу метрики) за день.
create table if not exists public.activity_interval_stats (
  user_id uuid not null,
  activity_date date not null,
  metric_code text not null,
  interval_count integer not null default 0,
  avg_interval_minutes numeric(12,2),
  min_interval_minutes numeric(12,2),
  max_interval_minutes numeric(12,2),
  updated_at timestamptz not null default now(),
  constraint activity_interval_stats_pk primary key (user_id, activity_date, metric_code)
);

create index if not exists idx_activity_interval_stats_user_date
  on public.activity_interval_stats (user_id, activity_date);

-- 3) Функция пересчёта дневного агрегата для одной даты и одного типа.
create or replace function public.recompute_daily_activity_stats(
  p_user_id uuid,
  p_date date,
  p_activity_type text
)
returns void
language plpgsql
as $$
declare
  v_count integer := 0;
  v_total_minutes numeric(12,2) := 0;
  v_left_minutes numeric(12,2) := 0;
  v_right_minutes numeric(12,2) := 0;
  v_bottle_ml numeric(12,2) := 0;
  v_wet integer := 0;
  v_dirty integer := 0;
begin
  with src as (
    select *
    from public.activities a
    where a.user_id = p_user_id
      and a.type = p_activity_type
      and a.start_time >= p_date::timestamp
      and a.start_time < (p_date::timestamp + interval '1 day')
  )
  select
    count(*)::integer,
    coalesce(sum(
      case
        when src.end_time is not null and src.start_time is not null
          then extract(epoch from (src.end_time - src.start_time)) / 60.0
        when src.type = 'breastfeeding'
          then coalesce(src.left_duration, 0) + coalesce(src.right_duration, 0)
        else 0
      end
    ), 0)::numeric(12,2),
    coalesce(sum(case when src.type = 'breastfeeding' then coalesce(src.left_duration, 0) else 0 end), 0)::numeric(12,2),
    coalesce(sum(case when src.type = 'breastfeeding' then coalesce(src.right_duration, 0) else 0 end), 0)::numeric(12,2),
    coalesce(sum(case when src.type = 'bottle' then coalesce(src.amount, 0) else 0 end), 0)::numeric(12,2),
    coalesce(sum(case when src.type = 'diaper' and src.diaper_type = 'wet' then 1 else 0 end), 0)::integer,
    coalesce(sum(case when src.type = 'diaper' and src.diaper_type = 'dirty' then 1 else 0 end), 0)::integer
  into
    v_count,
    v_total_minutes,
    v_left_minutes,
    v_right_minutes,
    v_bottle_ml,
    v_wet,
    v_dirty
  from src;

  if v_count = 0 then
    delete from public.daily_activity_stats
    where user_id = p_user_id
      and activity_date = p_date
      and activity_type = p_activity_type;
  else
    insert into public.daily_activity_stats (
      user_id,
      activity_date,
      activity_type,
      total_count,
      total_duration_minutes,
      left_duration_minutes,
      right_duration_minutes,
      bottle_volume_ml,
      diaper_wet_count,
      diaper_dirty_count,
      updated_at
    )
    values (
      p_user_id,
      p_date,
      p_activity_type,
      v_count,
      v_total_minutes,
      v_left_minutes,
      v_right_minutes,
      v_bottle_ml,
      v_wet,
      v_dirty,
      now()
    )
    on conflict (user_id, activity_date, activity_type)
    do update set
      total_count = excluded.total_count,
      total_duration_minutes = excluded.total_duration_minutes,
      left_duration_minutes = excluded.left_duration_minutes,
      right_duration_minutes = excluded.right_duration_minutes,
      bottle_volume_ml = excluded.bottle_volume_ml,
      diaper_wet_count = excluded.diaper_wet_count,
      diaper_dirty_count = excluded.diaper_dirty_count,
      updated_at = now();
  end if;
end;
$$;

-- 4) Функция пересчёта интервалов между кормлениями по дню.
create or replace function public.recompute_feeding_interval_stats(
  p_user_id uuid,
  p_date date
)
returns void
language plpgsql
as $$
declare
  v_count integer := 0;
  v_avg numeric(12,2);
  v_min numeric(12,2);
  v_max numeric(12,2);
begin
  with feedings as (
    select
      a.start_time,
      coalesce(
        a.end_time,
        case
          when a.type = 'breastfeeding'
            then a.start_time + make_interval(mins => (coalesce(a.left_duration, 0) + coalesce(a.right_duration, 0))::int)
          else a.start_time
        end
      ) as normalized_end_time
    from public.activities a
    where a.user_id = p_user_id
      and a.type in ('breastfeeding', 'bottle')
      and a.start_time >= p_date::timestamp
      and a.start_time < (p_date::timestamp + interval '1 day')
  ), intervals as (
    select
      extract(epoch from (start_time - lag(normalized_end_time) over(order by start_time))) / 60.0 as diff_minutes
    from feedings
  )
  select
    count(*) filter (where diff_minutes >= 0)::integer,
    avg(diff_minutes) filter (where diff_minutes >= 0)::numeric(12,2),
    min(diff_minutes) filter (where diff_minutes >= 0)::numeric(12,2),
    max(diff_minutes) filter (where diff_minutes >= 0)::numeric(12,2)
  into v_count, v_avg, v_min, v_max
  from intervals;

  if coalesce(v_count, 0) = 0 then
    delete from public.activity_interval_stats
    where user_id = p_user_id
      and activity_date = p_date
      and metric_code = 'feeding_interval';
  else
    insert into public.activity_interval_stats (
      user_id,
      activity_date,
      metric_code,
      interval_count,
      avg_interval_minutes,
      min_interval_minutes,
      max_interval_minutes,
      updated_at
    )
    values (
      p_user_id,
      p_date,
      'feeding_interval',
      v_count,
      v_avg,
      v_min,
      v_max,
      now()
    )
    on conflict (user_id, activity_date, metric_code)
    do update set
      interval_count = excluded.interval_count,
      avg_interval_minutes = excluded.avg_interval_minutes,
      min_interval_minutes = excluded.min_interval_minutes,
      max_interval_minutes = excluded.max_interval_minutes,
      updated_at = now();
  end if;
end;
$$;

-- 5) Триггер: пересчитывает затронутые даты при insert/update/delete.
create or replace function public.trg_recompute_statistics_from_activities()
returns trigger
language plpgsql
as $$
declare
  v_old_date date;
  v_new_date date;
  v_old_user uuid;
  v_new_user uuid;
begin
  v_old_date := case when tg_op in ('UPDATE', 'DELETE') and old.start_time is not null then old.start_time::date else null end;
  v_new_date := case when tg_op in ('UPDATE', 'INSERT') and new.start_time is not null then new.start_time::date else null end;
  v_old_user := case when tg_op in ('UPDATE', 'DELETE') then old.user_id else null end;
  v_new_user := case when tg_op in ('UPDATE', 'INSERT') then new.user_id else null end;

  if tg_op in ('UPDATE', 'DELETE') and v_old_date is not null and v_old_user is not null then
    perform public.recompute_daily_activity_stats(v_old_user, v_old_date, old.type);
    perform public.recompute_feeding_interval_stats(v_old_user, v_old_date);
  end if;

  if tg_op in ('UPDATE', 'INSERT') and v_new_date is not null and v_new_user is not null then
    perform public.recompute_daily_activity_stats(v_new_user, v_new_date, new.type);
    perform public.recompute_feeding_interval_stats(v_new_user, v_new_date);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_activities_recompute_statistics on public.activities;

create trigger trg_activities_recompute_statistics
after insert or update or delete on public.activities
for each row
execute function public.trg_recompute_statistics_from_activities();

commit;
