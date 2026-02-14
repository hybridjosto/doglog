import express from "express";
import { readFile } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";
import toml from "toml";

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
const promptsPath =
  process.env.PROMPTS_FILE ||
  path.join(__dirname, "..", "config", "prompts.toml");

const defaultPrompts = {
  generate_steps: {
    system:
      "You are a dog training assistant. Be specific, safe, and incremental.",
    user_template: `
Return only JSON. Create 4-7 practical training steps for this dog goal.
Each step must have:
- title (string)
- details (string)
- success_criteria (string)
- estimated_minutes (number, 5-30)

Goal title: {{goal_title}}
Goal description: {{goal_description}}
Success criteria: {{goal_success_criteria}}
    `.trim(),
  },
  suggest_goal: {
    system: "You select one practical focus goal for a dog training session.",
    user_template: `
Return only JSON with a single key: goal_id.
Choose the best next training goal from this list for today's focus.
Prefer goals with status active or paused, and avoid archived goals.

Current active goal id: {{active_goal_id}}
Goals: {{goals_json}}
    `.trim(),
  },
};

let prompts = defaultPrompts;

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
              'success_criteria', s.success_criteria,
              'step_order', s.step_order,
              'status', s.status,
              'scheduled_for', s.scheduled_for,
              'estimated_minutes', s.estimated_minutes,
              'pass_count', s.pass_count,
              'needs_work_count', s.needs_work_count,
              'consecutive_passes', s.consecutive_passes,
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
  const { title, description, priority, target_date, success_criteria, steps, status } =
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
            success_criteria:
              String(step?.success_criteria || "").trim().slice(0, 240) || null,
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
        values ($1, $2, coalesce($3, 3), $4, $5, $6::goal_status)
        returning *
      `,
      [
        String(title).trim(),
        description ? String(description).trim() : null,
        Number.isInteger(priority) ? priority : null,
        target_date || null,
        success_criteria ? String(success_criteria).trim() : null,
        isGoalStatus(status) ? status : "draft",
      ],
    );

    const goal = result.rows[0];
    const insertedSteps = [];
    let stepOrder = 0;
    for (const step of stepItems) {
      const stepResult = await client.query(
        `
        insert into goal_steps (
          goal_id, title, details, success_criteria, step_order, status, estimated_minutes, ai_generated
        )
        values ($1, $2, $3, $4, $5, 'pending', $6, false)
        returning id, title, details, success_criteria, step_order, status, estimated_minutes, pass_count, needs_work_count, consecutive_passes, ai_generated
      `,
        [
          goal.id,
          step.title,
          step.details,
          step.success_criteria,
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

    await pool.query(
      `
      update goals
      set description = coalesce($2, description),
          success_criteria = coalesce($3, success_criteria)
      where id = $1
    `,
      [
        goalId,
        generation.refinedDescription || null,
        generation.goalSuccessCriteria || null,
      ],
    );

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
          goal_id, title, details, success_criteria, step_order, status, scheduled_for, estimated_minutes, ai_generated
        )
        values ($1, $2, $3, $4, $5, 'pending', $6, $7, true)
        returning id, title, details, success_criteria, step_order, status, scheduled_for, estimated_minutes, pass_count, needs_work_count, consecutive_passes, ai_generated
      `,
        [
          goalId,
          step.title,
          step.details || null,
          step.success_criteria || null,
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

app.patch("/v1/goals/:id/activate", async (req, res) => {
  const goalId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const targetGoal = await client.query("select * from goals where id = $1", [goalId]);
    if (targetGoal.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "goal not found" });
    }

    await client.query(
      "update goals set status = 'paused' where id <> $1 and status = 'active'",
      [goalId],
    );
    const result = await client.query(
      "update goals set status = 'active' where id = $1 returning *",
      [goalId],
    );
    await client.query("commit");
    return res.json({ goal: result.rows[0] });
  } catch (error) {
    await client.query("rollback");
    return res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.patch("/v1/goals/:id/status", async (req, res) => {
  const goalId = req.params.id;
  const status = req.body?.status ? String(req.body.status) : null;
  if (!isGoalStatus(status)) {
    return res.status(400).json({ error: "valid status is required" });
  }
  if (status === "active") {
    return res
      .status(400)
      .json({ error: "use /v1/goals/:id/activate to enforce one active goal" });
  }
  try {
    const result = await pool.query(
      "update goals set status = $2::goal_status where id = $1 returning *",
      [goalId, status],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "goal not found" });
    }
    return res.json({ goal: result.rows[0] });
  } catch (error) {
    return res.status(400).json({ error: error.message });
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

app.post("/v1/goal-steps/:id/attempt", async (req, res) => {
  const stepId = req.params.id;
  const outcome = req.body?.outcome ? String(req.body.outcome) : null;
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;
  if (!["pass", "needs_work"].includes(outcome)) {
    return res.status(400).json({ error: "outcome must be pass or needs_work" });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const stepResult = await client.query(
      "select * from goal_steps where id = $1 for update",
      [stepId],
    );
    if (stepResult.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "goal step not found" });
    }

    const step = stepResult.rows[0];
    if (step.status === "done") {
      await client.query("commit");
      return res.json({ step, unchanged: true });
    }

    await client.query(
      "insert into goal_attempts (goal_step_id, outcome, note) values ($1, $2, $3)",
      [stepId, outcome, note],
    );

    const isPass = outcome === "pass";
    const nextConsecutive = isPass ? step.consecutive_passes + 1 : 0;
    const nextStatus = nextConsecutive >= 3 ? "done" : "in_progress";

    const updated = await client.query(
      `
      update goal_steps
      set pass_count = pass_count + $2,
          needs_work_count = needs_work_count + $3,
          consecutive_passes = $4,
          status = $5::step_status,
          completed_at = case when $5::step_status = 'done' then now() else completed_at end
      where id = $1
      returning *
    `,
      [
        stepId,
        isPass ? 1 : 0,
        isPass ? 0 : 1,
        nextConsecutive,
        nextStatus,
      ],
    );

    await client.query("commit");
    return res.json({ step: updated.rows[0] });
  } catch (error) {
    await client.query("rollback");
    return res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post("/v1/goal-steps/:id/attempt/undo", async (req, res) => {
  const stepId = req.params.id;
  const client = await pool.connect();

  try {
    await client.query("begin");
    const stepResult = await client.query(
      "select * from goal_steps where id = $1 for update",
      [stepId],
    );
    if (stepResult.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "goal step not found" });
    }

    const removedAttempt = await client.query(
      `
      with last_attempt as (
        select id, outcome
        from goal_attempts
        where goal_step_id = $1
        order by created_at desc, id desc
        limit 1
      )
      delete from goal_attempts
      where id in (select id from last_attempt)
      returning outcome
    `,
      [stepId],
    );

    if (removedAttempt.rowCount === 0) {
      await client.query("rollback");
      return res.status(409).json({ error: "no attempts to undo" });
    }

    const attemptsResult = await client.query(
      `
      select outcome
      from goal_attempts
      where goal_step_id = $1
      order by created_at asc, id asc
    `,
      [stepId],
    );

    const attempts = attemptsResult.rows;
    let passCount = 0;
    let needsWorkCount = 0;
    for (const attempt of attempts) {
      if (attempt.outcome === "pass") {
        passCount += 1;
      } else {
        needsWorkCount += 1;
      }
    }

    let consecutivePasses = 0;
    for (let index = attempts.length - 1; index >= 0; index -= 1) {
      if (attempts[index].outcome === "pass") {
        consecutivePasses += 1;
      } else {
        break;
      }
    }

    const nextStatus =
      attempts.length === 0
        ? "pending"
        : consecutivePasses >= 3
          ? "done"
          : "in_progress";

    const updated = await client.query(
      `
      update goal_steps
      set pass_count = $2,
          needs_work_count = $3,
          consecutive_passes = $4,
          status = $5::step_status,
          completed_at = case
            when $5::step_status = 'done' then coalesce(completed_at, now())
            else null
          end
      where id = $1
      returning *
    `,
      [stepId, passCount, needsWorkCount, consecutivePasses, nextStatus],
    );

    await client.query("commit");
    return res.json({
      step: updated.rows[0],
      undone_outcome: removedAttempt.rows[0].outcome,
    });
  } catch (error) {
    await client.query("rollback");
    return res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get("/v1/goals/suggested", async (_req, res) => {
  try {
    const goals = await pool.query(
      `
      select *
      from goals
      where status <> 'archived'
      order by updated_at desc
    `,
    );
    if (goals.rowCount === 0) {
      return res.json({ suggested_goal: null, source: "fallback_recent" });
    }

    const activeGoal = goals.rows.find((goal) => goal.status === "active") || null;
    const recentTrainableGoal =
      goals.rows.find((goal) => !["achieved", "archived"].includes(goal.status)) ||
      goals.rows[0];
    const defaultSuggestedGoal = activeGoal || recentTrainableGoal;
    const defaultSource = activeGoal ? "fallback_last_active" : "fallback_recent";

    const cachedSuggestion = await getTodaysSuggestedGoal();
    if (cachedSuggestion) {
      const cachedGoal =
        goals.rows.find((goal) => goal.id === cachedSuggestion.goal_id) || null;
      if (cachedGoal && !["achieved", "archived"].includes(cachedGoal.status)) {
        return res.json({
          suggested_goal: cachedGoal,
          source: cachedSuggestion.source,
          notice: cachedSuggestion.notice,
        });
      }
      return res.json({
        suggested_goal: defaultSuggestedGoal,
        source: defaultSource,
        notice: cachedSuggestion.notice || null,
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      await saveTodaysSuggestedGoal({
        goalId: defaultSuggestedGoal?.id || null,
        source: defaultSource,
        notice: "AI suggestion unavailable. Showing last active goal.",
      });
      return res.json({
        suggested_goal: defaultSuggestedGoal,
        source: defaultSource,
        notice: "AI suggestion unavailable. Showing last active goal.",
      });
    }

    const suggested = await suggestGoalWithAI(goals.rows, activeGoal);
    if (!suggested) {
      await saveTodaysSuggestedGoal({
        goalId: defaultSuggestedGoal?.id || null,
        source: defaultSource,
        notice: "AI suggestion unavailable. Showing last active goal.",
      });
      return res.json({
        suggested_goal: defaultSuggestedGoal,
        source: defaultSource,
        notice: "AI suggestion unavailable. Showing last active goal.",
      });
    }

    await saveTodaysSuggestedGoal({
      goalId: suggested.id,
      source: "ai",
      notice: null,
    });
    return res.json({ suggested_goal: suggested, source: "ai" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

startServer();

async function generateGoalSteps(goal) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      steps: fallbackSteps(goal),
      generationMode: "fallback",
      provider: "fallback",
      model: "deterministic-fallback",
      notice: "Cloud AI key missing. Fallback plan generated.",
      refinedDescription:
        "SMART fallback plan generated from the goal title with measurable milestones.",
      goalSuccessCriteria:
        "Complete all milestones with consistent pass outcomes over multiple sessions.",
    };
  }

  try {
    const prompt = renderPrompt(prompts.generate_steps.user_template, {
      goal_title: goal.title || "",
      goal_description: goal.description || "",
      goal_success_criteria: goal.success_criteria || "",
    });

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
            content: prompts.generate_steps.system,
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
    const milestones = Array.isArray(parsed.milestones)
      ? parsed.milestones
      : parsed.steps;
    if (!Array.isArray(milestones) || milestones.length === 0) {
      throw new Error("openai response missing milestones array");
    }

    return {
      steps: milestones.map((step) => ({
        title: String(step.title || "Training step").slice(0, 120),
        details: String(step.details || "").slice(0, 500),
        success_criteria: String(step.success_criteria || "").slice(0, 240),
        estimated_minutes: clampMinutes(step.estimated_minutes),
      })),
      generationMode: "cloud",
      provider: "openai",
      model,
      notice: null,
      refinedDescription: String(parsed.refined_goal || "").slice(0, 500) || null,
      goalSuccessCriteria:
        String(parsed.goal_success_criteria || "").slice(0, 240) || null,
    };
  } catch (_error) {
    return {
      steps: fallbackSteps(goal),
      generationMode: "fallback",
      provider: "fallback",
      model: "deterministic-fallback",
      notice: "Cloud AI unavailable. Fallback plan generated.",
      refinedDescription:
        "SMART fallback plan generated from the goal title with measurable milestones.",
      goalSuccessCriteria:
        "Complete all milestones with consistent pass outcomes over multiple sessions.",
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
        success_criteria: "Complete 10 minutes with 3 or fewer leash pulls.",
        estimated_minutes: 10,
      },
      {
        title: "Reinforce check-ins",
        details:
          "Reward voluntary eye contact with high-value treats every few steps.",
        success_criteria: "Get at least 8 voluntary check-ins in one walk.",
        estimated_minutes: 12,
      },
      {
        title: "Short focused reps",
        details:
          "Practice 3 x 5-minute loose-leash blocks in low-distraction areas.",
        success_criteria: "Complete all 3 reps without continuous pulling.",
        estimated_minutes: 15,
      },
      {
        title: "Increase distraction gradually",
        details:
          "Add one harder environment and keep reinforcement rate high at first.",
        success_criteria: "Maintain loose leash for 60% of the harder route.",
        estimated_minutes: 20,
      },
      {
        title: "Proof and review",
        details:
          "Run two normal walks and compare positive vs negative event counts.",
        success_criteria:
          "Log at least 2 more positive events than negative in each walk.",
        estimated_minutes: 20,
      },
    ];
  }

  return [
    {
      title: "Define success cues",
      details: "Write the exact behavior marker and reward timing for this goal.",
      success_criteria: "Owner can describe marker and reward timing in one sentence.",
      estimated_minutes: 10,
    },
    {
      title: "Run low-distraction reps",
      details: "Practice short repetitions in a quiet environment and log outcomes.",
      success_criteria: "Achieve at least 70% successful reps in one session.",
      estimated_minutes: 12,
    },
    {
      title: "Increase difficulty one step",
      details: "Add one variable: distance, duration, or distraction level.",
      success_criteria: "Maintain previous success rate after increasing one variable.",
      estimated_minutes: 15,
    },
    {
      title: "Track consistency",
      details: "Aim for two consecutive sessions with >80% successful reps.",
      success_criteria: "Complete two sessions in a row above 80% success.",
      estimated_minutes: 10,
    },
    {
      title: "Generalize behavior",
      details: "Repeat in a new location and keep reward value high initially.",
      success_criteria: "Replicate baseline success in one new environment.",
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

function isGoalStatus(status) {
  return ["draft", "active", "paused", "achieved", "archived"].includes(status);
}

async function suggestGoalWithAI(goals, activeGoal) {
  try {
    const prompt = renderPrompt(prompts.suggest_goal.user_template, {
      active_goal_id: activeGoal?.id || "none",
      goals_json: JSON.stringify(
        goals.map((goal) => ({
          id: goal.id,
          title: goal.title,
          status: goal.status,
          updated_at: goal.updated_at,
        })),
      ),
    });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: prompts.suggest_goal.system,
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }
    const parsed = JSON.parse(content);
    const selected = goals.find((goal) => goal.id === parsed.goal_id);
    if (!selected || ["achieved", "archived"].includes(selected.status)) {
      return null;
    }
    return selected;
  } catch {
    return null;
  }
}

async function startServer() {
  try {
    await loadPromptConfig();
    await ensureSchemaCompatibility();
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`doglog prototype listening on ${port}`);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("failed to start server:", error);
    process.exit(1);
  }
}

async function ensureSchemaCompatibility() {
  const client = await pool.connect();
  try {
    await client.query("begin");

    await client.query(`
      alter table goal_steps
      add column if not exists success_criteria text
    `);
    await client.query(`
      alter table goal_steps
      add column if not exists pass_count integer not null default 0
    `);
    await client.query(`
      alter table goal_steps
      add column if not exists needs_work_count integer not null default 0
    `);
    await client.query(`
      alter table goal_steps
      add column if not exists consecutive_passes integer not null default 0
    `);

    await client.query(`
      create table if not exists goal_attempts (
        id uuid primary key default gen_random_uuid(),
        goal_step_id uuid not null references goal_steps(id) on delete cascade,
        outcome text not null check (outcome in ('pass', 'needs_work')),
        note text,
        created_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create table if not exists goal_suggestions (
        suggestion_date date primary key,
        goal_id uuid references goals(id) on delete set null,
        source text not null,
        notice text,
        created_at timestamptz not null default now()
      )
    `);

    await client.query(`
      create index if not exists idx_goals_status_updated
      on goals (status, updated_at desc)
    `);
    await client.query(`
      create index if not exists idx_goal_attempts_step_time
      on goal_attempts (goal_step_id, created_at desc)
    `);
    await client.query(`
      create index if not exists idx_goal_suggestions_goal
      on goal_suggestions (goal_id)
    `);

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function getTodaysSuggestedGoal() {
  const result = await pool.query(
    `
      select goal_id, source, notice
      from goal_suggestions
      where suggestion_date = current_date
      limit 1
    `,
  );
  return result.rows[0] || null;
}

async function saveTodaysSuggestedGoal({ goalId, source, notice }) {
  await pool.query(
    `
      insert into goal_suggestions (suggestion_date, goal_id, source, notice)
      values (current_date, $1, $2, $3)
      on conflict (suggestion_date)
      do update set
        goal_id = excluded.goal_id,
        source = excluded.source,
        notice = excluded.notice
    `,
    [goalId, source, notice],
  );
}

async function loadPromptConfig() {
  try {
    const raw = await readFile(promptsPath, "utf8");
    const parsed = toml.parse(raw);
    prompts = {
      generate_steps: {
        ...defaultPrompts.generate_steps,
        ...(parsed.generate_steps || {}),
      },
      suggest_goal: {
        ...defaultPrompts.suggest_goal,
        ...(parsed.suggest_goal || {}),
      },
    };
    // eslint-disable-next-line no-console
    console.log(`loaded prompt config from ${promptsPath}`);
  } catch (error) {
    prompts = defaultPrompts;
    // eslint-disable-next-line no-console
    console.warn(
      `prompt config not loaded (${promptsPath}), using defaults: ${error.message}`,
    );
  }
}

function renderPrompt(template, variables) {
  let result = template || "";
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return result;
}
