-- Demo seed for sleep statistics charts (previous week)
-- Target user/baby from request:
-- user_id: ac2f3904-a339-4413-8535-a0c9d32230a0
-- baby_id: 108f426f-208d-4c92-948a-1457a398ab2f
--
-- What it does:
-- 1) Calculates previous week bounds (Mon 00:00 .. next Mon 00:00) in UTC.
-- 2) Removes existing sleep activities for this baby in that week (idempotent re-run).
-- 3) Inserts realistic sleep sessions with day/night blocks and wake gaps
--    so all charts (alerts, trend, wake-ups, clock, timeline) are visible.

BEGIN;

WITH bounds AS (
  SELECT
    (date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 day') AS week_start_utc,
    date_trunc('week', now() AT TIME ZONE 'UTC') AS week_end_utc
)
DELETE FROM public.activities a
USING bounds b
WHERE a.user_id = 'ac2f3904-a339-4413-8535-a0c9d32230a0'
  AND a.baby_id = '108f426f-208d-4c92-948a-1457a398ab2f'
  AND a.type = 'sleep'
  AND a.start_time >= b.week_start_utc
  AND a.start_time < b.week_end_utc;

WITH bounds AS (
  SELECT (date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 day')::timestamp AS ws
), seed(day_idx, start_hhmm, end_hhmm, comment) AS (
  VALUES
    -- Monday
    (0, '00:40', '03:10', 'ночной сон'),
    (0, '03:25', '06:20', 'ночной сон'),
    (0, '09:55', '11:20', 'дневной сон 1'),
    (0, '14:50', '16:05', 'дневной сон 2'),
    (0, '20:55', '23:59', 'ночной сон старт'),

    -- Tuesday
    (1, '00:00', '02:45', 'ночной сон продолжение'),
    (1, '03:05', '06:35', 'ночной сон'),
    (1, '10:10', '11:35', 'дневной сон 1'),
    (1, '15:25', '16:30', 'дневной сон 2'),
    (1, '21:10', '23:59', 'ночной сон старт'),

    -- Wednesday (intentionally lower total + more wake-ups)
    (2, '00:00', '01:55', 'ночной сон фрагмент 1'),
    (2, '02:15', '03:45', 'ночной сон фрагмент 2'),
    (2, '04:05', '05:30', 'ночной сон фрагмент 3'),
    (2, '11:10', '12:10', 'дневной сон 1'),
    (2, '16:10', '16:50', 'дневной сон 2'),
    (2, '21:35', '23:40', 'ночной сон старт'),

    -- Thursday
    (3, '00:05', '03:35', 'ночной сон'),
    (3, '03:55', '06:50', 'ночной сон'),
    (3, '09:50', '11:40', 'дневной сон 1'),
    (3, '15:05', '16:25', 'дневной сон 2'),
    (3, '21:00', '23:59', 'ночной сон старт'),

    -- Friday
    (4, '00:00', '03:20', 'ночной сон'),
    (4, '03:45', '07:05', 'ночной сон'),
    (4, '10:20', '11:55', 'дневной сон 1'),
    (4, '15:30', '16:55', 'дневной сон 2'),
    (4, '21:20', '23:59', 'ночной сон старт'),

    -- Saturday
    (5, '00:00', '04:10', 'ночной сон'),
    (5, '04:25', '07:15', 'ночной сон'),
    (5, '10:45', '12:25', 'дневной сон 1'),
    (5, '16:00', '17:20', 'дневной сон 2'),
    (5, '21:10', '23:59', 'ночной сон старт'),

    -- Sunday
    (6, '00:00', '03:30', 'ночной сон'),
    (6, '03:50', '06:45', 'ночной сон'),
    (6, '10:05', '11:40', 'дневной сон 1'),
    (6, '15:20', '16:50', 'дневной сон 2'),
    (6, '21:00', '23:59', 'ночной сон старт')
)
INSERT INTO public.activities (
  user_id,
  baby_id,
  type,
  start_time,
  end_time,
  comment,
  created_at,
  updated_at
)
SELECT
  'ac2f3904-a339-4413-8535-a0c9d32230a0'::uuid,
  '108f426f-208d-4c92-948a-1457a398ab2f'::uuid,
  'sleep',
  (b.ws + make_interval(days => s.day_idx) + (s.start_hhmm || ':00')::time),
  (b.ws + make_interval(days => s.day_idx) + (s.end_hhmm || ':00')::time),
  s.comment,
  now(),
  now()
FROM seed s
CROSS JOIN bounds b;

COMMIT;
