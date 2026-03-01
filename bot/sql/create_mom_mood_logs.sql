create table if not exists public.mom_mood_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  mood text not null,
  created_at timestamptz not null default now(),
  unique(user_id, date)
);

create index if not exists idx_mom_mood_logs_user_date on public.mom_mood_logs(user_id, date desc);
