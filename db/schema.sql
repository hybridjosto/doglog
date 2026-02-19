-- Doglog schema v1 (PostgreSQL, single-user/single-dog)
-- Simplified model: no households, users, or dogs tables.

create extension if not exists pgcrypto;

create type behavior_valence as enum ('positive', 'negative');
create type event_source as enum ('manual', 'imported', 'ai_inferred');
create type goal_status as enum ('draft', 'active', 'paused', 'achieved', 'archived');
create type step_status as enum ('pending', 'in_progress', 'done', 'skipped');
create type ai_purpose as enum ('goal_breakdown', 'step_refinement', 'daily_coach');
create type ai_run_status as enum ('queued', 'success', 'failed');

create table behavior_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null,
  valence behavior_valence not null,
  intensity smallint not null default 3 check (intensity between 1 and 5),
  context jsonb not null default '{}'::jsonb,
  notes text,
  source event_source not null default 'manual',
  client_event_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table event_tags (
  event_id uuid not null references behavior_events(id) on delete cascade,
  tag text not null check (length(tag) > 0 and length(tag) <= 64),
  primary key (event_id, tag)
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status goal_status not null default 'draft',
  priority smallint not null default 3 check (priority between 1 and 5),
  target_date date,
  success_criteria text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table goal_steps (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  parent_step_id uuid references goal_steps(id) on delete set null,
  title text not null,
  details text,
  success_criteria text,
  step_order integer not null check (step_order >= 0),
  status step_status not null default 'pending',
  scheduled_for date,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  pass_count integer not null default 0 check (pass_count >= 0),
  needs_work_count integer not null default 0 check (needs_work_count >= 0),
  consecutive_passes integer not null default 0 check (consecutive_passes >= 0),
  ai_generated boolean not null default false,
  completion_notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table goal_step_events (
  goal_step_id uuid not null references goal_steps(id) on delete cascade,
  event_id uuid not null references behavior_events(id) on delete cascade,
  primary key (goal_step_id, event_id)
);

create table goal_attempts (
  id uuid primary key default gen_random_uuid(),
  goal_step_id uuid not null references goal_steps(id) on delete cascade,
  outcome text not null check (outcome in ('pass', 'needs_work', 'neutral')),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  note text,
  created_at timestamptz not null default now()
);

create table goal_suggestions (
  suggestion_date date primary key,
  goal_id uuid references goals(id) on delete set null,
  source text not null,
  notice text,
  created_at timestamptz not null default now()
);

create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid references goals(id) on delete set null,
  provider text not null,
  model text not null,
  purpose ai_purpose not null,
  input_summary text not null,
  request_payload jsonb not null,
  response_payload jsonb,
  status ai_run_status not null default 'queued',
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  estimated_cost_usd numeric(10,4),
  check (completed_at is null or completed_at >= started_at)
);

create table daily_metrics (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  positive_count integer not null default 0 check (positive_count >= 0),
  negative_count integer not null default 0 check (negative_count >= 0),
  avg_intensity numeric(4,2) check (avg_intensity is null or (avg_intensity >= 1 and avg_intensity <= 5)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for common app queries.
create index idx_behavior_events_time on behavior_events (occurred_at desc);
create index idx_behavior_events_valence_time on behavior_events (valence, occurred_at desc);
create index idx_event_tags_tag on event_tags (tag);
create index idx_goals_status on goals (status);
create index idx_goals_status_updated on goals (status, updated_at desc);
create index idx_goal_steps_goal_order on goal_steps (goal_id, step_order);
create index idx_goal_attempts_step_time on goal_attempts (goal_step_id, created_at desc);
create index idx_goal_suggestions_goal on goal_suggestions (goal_id);
create index idx_ai_runs_goal_time on ai_runs (goal_id, started_at desc);
create index idx_daily_metrics_date on daily_metrics (date desc);

-- Trigger to keep updated_at current.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_behavior_events_updated_at
before update on behavior_events
for each row execute function set_updated_at();

create trigger trg_goals_updated_at
before update on goals
for each row execute function set_updated_at();

create trigger trg_goal_steps_updated_at
before update on goal_steps
for each row execute function set_updated_at();

create trigger trg_daily_metrics_updated_at
before update on daily_metrics
for each row execute function set_updated_at();
