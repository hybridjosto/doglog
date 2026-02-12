import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const app = express();
const port = Number.parseInt(process.env.PORT || "8080", 10);
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://doglog:doglog@db:5432/doglog",
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/v1/events/batch", async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  if (events.length === 0) {
    return res.status(400).json({ error: "events must be a non-empty array" });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");

    const saved = [];
    for (const event of events) {
      if (!event.client_event_id || !event.valence || !event.occurred_at) {
        throw new Error("event requires client_event_id, valence, occurred_at");
      }

      const intensity = Number.isInteger(event.intensity) ? event.intensity : 3;
      const upsertEvent = await client.query(
        `
        insert into behavior_events (
          client_event_id, occurred_at, valence, intensity, context, notes, source
        )
        values ($1, $2, $3, $4, $5::jsonb, $6, coalesce($7, 'manual'::event_source))
        on conflict (client_event_id) do update
          set occurred_at = excluded.occurred_at,
              valence = excluded.valence,
              intensity = excluded.intensity,
              context = excluded.context,
              notes = excluded.notes,
              source = excluded.source
        returning id, client_event_id, occurred_at, valence, intensity, context, notes
      `,
        [
          event.client_event_id,
          event.occurred_at,
          event.valence,
          intensity,
          JSON.stringify(event.context || {}),
          event.notes || null,
          event.source || null,
        ],
      );

      const row = upsertEvent.rows[0];
      const tags = Array.isArray(event.tags)
        ? event.tags
            .map((tag) => String(tag).trim().toLowerCase())
            .filter((tag) => tag.length > 0)
        : [];

      await client.query("delete from event_tags where event_id = $1", [row.id]);
      for (const tag of tags) {
        await client.query(
          "insert into event_tags (event_id, tag) values ($1, $2) on conflict do nothing",
          [row.id, tag],
        );
      }

      saved.push({ ...row, tags });
    }

    await client.query("commit");
    return res.json({ saved_count: saved.length, events: saved });
  } catch (error) {
    await client.query("rollback");
    return res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get("/v1/events", async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  const valence = req.query.valence ? String(req.query.valence) : null;
  const tag = req.query.tag ? String(req.query.tag).toLowerCase() : null;
  const limit = Math.min(Number.parseInt(String(req.query.limit || "50"), 10), 200);

  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return res.status(400).json({ error: "invalid from/to timestamp" });
  }

  const params = [];
  const where = [];
  let join = "";

  if (from) {
    params.push(from.toISOString());
    where.push(`e.occurred_at >= $${params.length}`);
  }
  if (to) {
    params.push(to.toISOString());
    where.push(`e.occurred_at <= $${params.length}`);
  }
  if (valence) {
    params.push(valence);
    where.push(`e.valence = $${params.length}::behavior_valence`);
  }
  if (tag) {
    params.push(tag);
    join = "join event_tags filter_tags on filter_tags.event_id = e.id";
    where.push(`filter_tags.tag = $${params.length}`);
  }

  params.push(limit);
  const whereClause = where.length > 0 ? `where ${where.join(" and ")}` : "";

  const query = `
    select
      e.id,
      e.client_event_id,
      e.occurred_at,
      e.valence,
      e.intensity,
      e.context,
      e.notes,
      e.source,
      e.created_at,
      coalesce(
        array_agg(distinct t.tag) filter (where t.tag is not null),
        '{}'
      ) as tags
    from behavior_events e
    ${join}
    left join event_tags t on t.event_id = e.id
    ${whereClause}
    group by e.id
    order by e.occurred_at desc
    limit $${params.length}
  `;

  try {
    const result = await pool.query(query, params);
    return res.json({ events: result.rows });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/v1/goals", async (_req, res) => {
  try {
    const goals = await pool.query(
      `
      select
        g.id,
        g.title,
        g.description,
        g.status,
        g.priority,
        g.target_date,
        g.success_criteria,
        g.created_at,
        g.updated_at,
        coalesce(
          json_agg(
            json_build_object(
              'id', s.id,
              'title', s.title,
              'details', s.details,
              'step_order', s.step_order,
              'status', s.status,
              'scheduled_for', s.scheduled_for,
              'estimated_minutes', s.estimated_minutes,
              'ai_generated', s.ai_generated
            )
            order by s.step_order asc
          ) filter (where s.id is not null),
          '[]'::json
        ) as steps
      from goals g
      left join goal_steps s on s.goal_id = g.id
      group by g.id
      order by g.created_at desc
    `,
    );
    res.json({ goals: goals.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/v1/goals", async (req, res) => {
  const { title, description, priority, target_date, success_criteria, steps } =
    req.body || {};
  if (!title || String(title).trim().length === 0) {
    return res.status(400).json({ error: "title is required" });
  }

  const stepItems = Array.isArray(steps)
    ? steps
        .map((step) => {
          const stepTitle = String(step?.title || "").trim();
          if (!stepTitle) {
            return null;
          }
          return {
            title: stepTitle.slice(0, 120),
            details: String(step?.details || "").trim().slice(0, 500) || null,
            estimated_minutes: clampMinutes(step?.estimated_minutes ?? 10),
          };
        })
        .filter(Boolean)
    : [];

  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `
        insert into goals (title, description, priority, target_date, success_criteria, status)
        values ($1, $2, coalesce($3, 3), $4, $5, 'active')
        returning *
      `,
      [
        String(title).trim(),
        description ? String(description).trim() : null,
        Number.isInteger(priority) ? priority : null,
        target_date || null,
        success_criteria ? String(success_criteria).trim() : null,
      ],
    );

    const goal = result.rows[0];
    const insertedSteps = [];
    let stepOrder = 0;
    for (const step of stepItems) {
      const stepResult = await client.query(
        `
        insert into goal_steps (
          goal_id, title, details, step_order, status, estimated_minutes, ai_generated
        )
        values ($1, $2, $3, $4, 'pending', $5, false)
        returning id, title, details, step_order, status, estimated_minutes, ai_generated
      `,
        [
          goal.id,
          step.title,
          step.details,
          stepOrder++,
          step.estimated_minutes,
        ],
      );
      insertedSteps.push(stepResult.rows[0]);
    }

    await client.query("commit");
    return res.status(201).json({ goal, steps: insertedSteps });
  } catch (error) {
    await client.query("rollback");
    return res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post("/v1/goals/:id/generate-steps", async (req, res) => {
  const goalId = req.params.id;

  try {
    const goalResult = await pool.query("select * from goals where id = $1", [goalId]);
    if (goalResult.rowCount === 0) {
      return res.status(404).json({ error: "goal not found" });
    }
    const goal = goalResult.rows[0];

    const aiRun = await pool.query(
      `
      insert into ai_runs (goal_id, provider, model, purpose, input_summary, request_payload, status)
      values ($1, $2, $3, 'goal_breakdown', $4, $5::jsonb, 'queued')
      returning id
    `,
      [
        goalId,
        process.env.OPENAI_API_KEY ? "openai" : "fallback",
        model,
        `Break down goal: ${goal.title}`,
        JSON.stringify({ title: goal.title, description: goal.description }),
      ],
    );

    const aiRunId = aiRun.rows[0].id;
    const generation = await generateGoalSteps(goal);
    const steps = generation.steps;

    const orderResult = await pool.query(
      "select coalesce(max(step_order), -1) as current_max from goal_steps where goal_id = $1",
      [goalId],
    );
    let order = Number(orderResult.rows[0].current_max) + 1;

    const inserted = [];
    for (const step of steps) {
      const row = await pool.query(
        `
        insert into goal_steps (
          goal_id, title, details, step_order, status, scheduled_for, estimated_minutes, ai_generated
        )
        values ($1, $2, $3, $4, 'pending', $5, $6, true)
        returning id, title, details, step_order, status, scheduled_for, estimated_minutes, ai_generated
      `,
        [
          goalId,
          step.title,
          step.details || null,
          order++,
          step.scheduled_for || null,
          step.estimated_minutes || null,
        ],
      );
      inserted.push(row.rows[0]);
    }

    await pool.query(
      `
      update ai_runs
      set status = 'success', response_payload = $2::jsonb, completed_at = now()
      where id = $1
    `,
      [
        aiRunId,
        JSON.stringify({
          steps: inserted,
          generation_mode: generation.generationMode,
          provider: generation.provider,
          model: generation.model,
          notice: generation.notice || null,
        }),
      ],
    );

    return res.json({
      steps: inserted,
      generation_mode: generation.generationMode,
      provider: generation.provider,
      model: generation.model,
      notice: generation.notice || null,
    });
  } catch (error) {
    try {
      await pool.query(
        `
        update ai_runs
        set status = 'failed', error_message = $2, completed_at = now()
        where goal_id = $1 and status = 'queued'
      `,
        [goalId, error.message],
      );
    } catch {
      // swallow secondary DB update failures
    }
    return res.status(500).json({ error: error.message });
  }
});

app.patch("/v1/goal-steps/:id", async (req, res) => {
  const stepId = req.params.id;
  const status = req.body?.status ? String(req.body.status) : null;
  const completionNotes = req.body?.completion_notes
    ? String(req.body.completion_notes)
    : null;

  if (!status) {
    return res.status(400).json({ error: "status is required" });
  }

  try {
    const result = await pool.query(
      `
      update goal_steps
      set status = $2::step_status,
          completion_notes = coalesce($3, completion_notes),
          completed_at = case when $2::step_status = 'done' then now() else completed_at end
      where id = $1
      returning *
    `,
      [stepId, status, completionNotes],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "goal step not found" });
    }
    return res.json({ step: result.rows[0] });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`doglog prototype listening on ${port}`);
});

async function generateGoalSteps(goal) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      steps: fallbackSteps(goal),
      generationMode: "fallback",
      provider: "fallback",
      model: "deterministic-fallback",
      notice: "Cloud AI key missing. Fallback plan generated.",
    };
  }

  try {
    const prompt = `
Return only JSON. Create 4-7 practical training steps for this dog goal.
Each step must have:
- title (string)
- details (string)
- estimated_minutes (number, 5-30)

Goal title: ${goal.title}
Goal description: ${goal.description || ""}
Success criteria: ${goal.success_criteria || ""}
    `.trim();

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a dog training assistant. Be specific, safe, and incremental.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`openai error: ${response.status}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("openai returned empty content");
    }

    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error("openai response missing steps array");
    }

    return {
      steps: parsed.steps.map((step) => ({
        title: String(step.title || "Training step").slice(0, 120),
        details: String(step.details || "").slice(0, 500),
        estimated_minutes: clampMinutes(step.estimated_minutes),
      })),
      generationMode: "cloud",
      provider: "openai",
      model,
      notice: null,
    };
  } catch (_error) {
    return {
      steps: fallbackSteps(goal),
      generationMode: "fallback",
      provider: "fallback",
      model: "deterministic-fallback",
      notice: "Cloud AI unavailable. Fallback plan generated.",
    };
  }
}

function fallbackSteps(goal) {
  const title = goal.title.toLowerCase();
  const includesLooseLeash = title.includes("leash") || title.includes("walk");

  if (includesLooseLeash) {
    return [
      {
        title: "Set baseline walk",
        details:
          "Do a 10-minute walk at easy distance and log every pull or check-in.",
        estimated_minutes: 10,
      },
      {
        title: "Reinforce check-ins",
        details:
          "Reward voluntary eye contact with high-value treats every few steps.",
        estimated_minutes: 12,
      },
      {
        title: "Short focused reps",
        details:
          "Practice 3 x 5-minute loose-leash blocks in low-distraction areas.",
        estimated_minutes: 15,
      },
      {
        title: "Increase distraction gradually",
        details:
          "Add one harder environment and keep reinforcement rate high at first.",
        estimated_minutes: 20,
      },
      {
        title: "Proof and review",
        details:
          "Run two normal walks and compare positive vs negative event counts.",
        estimated_minutes: 20,
      },
    ];
  }

  return [
    {
      title: "Define success cues",
      details: "Write the exact behavior marker and reward timing for this goal.",
      estimated_minutes: 10,
    },
    {
      title: "Run low-distraction reps",
      details: "Practice short repetitions in a quiet environment and log outcomes.",
      estimated_minutes: 12,
    },
    {
      title: "Increase difficulty one step",
      details: "Add one variable: distance, duration, or distraction level.",
      estimated_minutes: 15,
    },
    {
      title: "Track consistency",
      details: "Aim for two consecutive sessions with >80% successful reps.",
      estimated_minutes: 10,
    },
    {
      title: "Generalize behavior",
      details: "Repeat in a new location and keep reward value high initially.",
      estimated_minutes: 20,
    },
  ];
}

function clampMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 10;
  }
  return Math.min(30, Math.max(5, Math.round(n)));
}
