# Doglog Data Model (Simple v1)

This model assumes:
- one person (you)
- one dog
- private app over Tailscale

No households, users, or dog tables.

## Storage choice

- Primary database: PostgreSQL 16+
- Rationale: reliable constraints, JSON support, and strong indexing

## Core entities

### `behavior_events`

Fast one-tap event log for positive/negative behavior.

- `id uuid pk`
- `occurred_at timestamptz not null`
- `valence behavior_valence not null` (`positive`, `negative`)
- `intensity smallint not null default 3` (1-5)
- `context jsonb not null default '{}'` (trigger, location label, leash setup, distance)
- `notes text`
- `source event_source not null default 'manual'` (`manual`, `imported`, `ai_inferred`)
- `client_event_id text not null unique` (device-generated id for idempotent sync)
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

### `event_tags`

Normalized tags for filtering and metrics.

- `event_id uuid fk -> behavior_events.id`
- `tag text not null`
- primary key `(event_id, tag)`

### `goals`

High-level goals (example: "Loose leash for 20 mins").

- `id uuid pk`
- `title text not null`
- `description text`
- `status goal_status not null` (`draft`, `active`, `paused`, `achieved`, `archived`)
- `priority smallint not null default 3` (1-5)
- `target_date date`
- `success_criteria text`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

### `goal_steps`

AI-generated or manual micro-steps for each goal.

- `id uuid pk`
- `goal_id uuid fk -> goals.id`
- `parent_step_id uuid fk -> goal_steps.id`
- `title text not null`
- `details text`
- `success_criteria text`
- `step_order integer not null`
- `status step_status not null` (`pending`, `in_progress`, `done`, `skipped`)
- `scheduled_for date`
- `estimated_minutes integer`
- `pass_count integer not null default 0`
- `needs_work_count integer not null default 0`
- `consecutive_passes integer not null default 0`
- `ai_generated boolean not null default false`
- `completion_notes text`
- `completed_at timestamptz`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

### `goal_attempts`

Tracks each subtask attempt outcome for auditability.

- `id uuid pk`
- `goal_step_id uuid fk -> goal_steps.id`
- `outcome text` (`pass`, `needs_work`, `neutral`)
- `duration_seconds integer not null default 0`
- `note text`
- `created_at timestamptz not null`

### `goal_step_events`

Links behavior events to the step they support.

- `goal_step_id uuid fk -> goal_steps.id`
- `event_id uuid fk -> behavior_events.id`
- primary key `(goal_step_id, event_id)`

### `ai_runs`

Provider-agnostic audit trail for LLM calls.

- `id uuid pk`
- `goal_id uuid fk -> goals.id`
- `provider text not null` (example: `openai`, `ollama`)
- `model text not null`
- `purpose ai_purpose not null` (`goal_breakdown`, `step_refinement`, `daily_coach`)
- `input_summary text not null`
- `request_payload jsonb not null`
- `response_payload jsonb`
- `status ai_run_status not null` (`queued`, `success`, `failed`)
- `error_message text`
- `started_at timestamptz not null`
- `completed_at timestamptz`
- `estimated_cost_usd numeric(10,4)`

### `daily_metrics`

Daily rollups for fast dashboard rendering.

- `id uuid pk`
- `date date not null unique`
- `positive_count integer not null default 0`
- `negative_count integer not null default 0`
- `avg_intensity numeric(4,2)`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

## Offline sync contract

Frontend keeps an IndexedDB queue and sends batched upserts.

- `client_event_id` is generated on device and never changes
- server upsert key: `client_event_id`
- retries are safe and idempotent

Required payload for sync:

- `client_event_id`
- `occurred_at`
- `valence`
- `intensity`
- `tags[]`
- `context`
- `notes`

## Initial API mapping

- `POST /v1/events/batch` -> upsert events + tags
- `GET /v1/events` -> filter by date/tag/valence
- `POST /v1/goals`
- `PATCH /v1/goals/:id/activate`
- `PATCH /v1/goals/:id/status`
- `GET /v1/goals/suggested`
- `POST /v1/goals/:id/generate-steps`
- `PATCH /v1/goal-steps/:id`
- `POST /v1/goal-steps/:id/attempt`
- `GET /v1/dashboard/daily?from=&to=`

## Cloud-to-local LLM migration

No schema changes needed to switch providers.

- provider and model live in `ai_runs`
- parsed output still writes to `goal_steps`
