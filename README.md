# Doglog Prototype

MVP prototype for:
- one-tap behavior event logging
- goals and AI-generated goal steps
- private self-hosted deployment with Docker (for Raspberry Pi or Mac mini)

## Run

1. Optional: copy `.env.example` to `.env` and set `OPENAI_API_KEY` for cloud step generation.
2. Start:

```bash
docker compose up --build
```

3. Open:
- Local machine: `http://localhost:8080`
- Phone over Tailscale: `http://<tailscale-ip-of-host>:8080`

## Podman + Skate

If you store your key in Skate (`open-ai`), you can inject it inline:

```bash
OPENAI_API_KEY="$(skate get open-ai)" podman compose up --build
```

Or use the helper script:

```bash
./scripts/podman-up.sh
```

## API MVP

- `POST /v1/events/batch`
- `GET /v1/events`
- `GET /v1/goals`
- `POST /v1/goals`
- `PATCH /v1/goals/:id/activate`
- `PATCH /v1/goals/:id/status`
- `GET /v1/goals/suggested`
- `POST /v1/goals/:id/generate-steps`
- `PATCH /v1/goal-steps/:id`
- `POST /v1/goal-steps/:id/attempt`

## Notes

- If `OPENAI_API_KEY` is not set, step generation uses a deterministic local fallback.
- Database schema is initialized from `db/schema.sql` when Postgres data is created for the first time.
- To reset local data during prototype testing:

```bash
docker compose down -v
```
