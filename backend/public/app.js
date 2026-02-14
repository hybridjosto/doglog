const queueKey = "doglog_event_queue_v1";

const positiveBtn = document.getElementById("positiveBtn");
const negativeBtn = document.getElementById("negativeBtn");
const syncBtn = document.getElementById("syncBtn");
const syncStatus = document.getElementById("syncStatus");
const queueCountNav = document.getElementById("queueCountNav");
const winsCount = document.getElementById("winsCount");
const workCount = document.getElementById("workCount");
const summaryBars = document.getElementById("summaryBars");
const nextStepsList = document.getElementById("nextStepsList");
const taskCount = document.getElementById("taskCount");
const activeGoalTitle = document.getElementById("activeGoalTitle");
const activeGoalProgressText = document.getElementById("activeGoalProgressText");
const activeGoalMastery = document.getElementById("activeGoalMastery");
const activeGoalProgressBar = document.getElementById("activeGoalProgressBar");
const activeGoalHint = document.getElementById("activeGoalHint");
const retryAiBtn = document.getElementById("retryAiBtn");
const suggestedGoalCard = document.getElementById("suggestedGoalCard");
const suggestedGoalSource = document.getElementById("suggestedGoalSource");
const suggestedGoalTitle = document.getElementById("suggestedGoalTitle");
const suggestedGoalNotice = document.getElementById("suggestedGoalNotice");
const toast = document.getElementById("toast");

let hasPendingGoalRefreshHint = false;
let activeGoalId = null;

positiveBtn?.addEventListener("click", () => queueEvent("positive"));
negativeBtn?.addEventListener("click", () => queueEvent("negative"));
syncBtn?.addEventListener("click", syncEvents);
nextStepsList?.addEventListener("click", handleStepAction);
retryAiBtn?.addEventListener("click", retryAiGeneration);

window.addEventListener("online", () => {
  syncEvents();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshFromServer();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

boot();

async function boot() {
  refreshQueueUI();
  consumeGoalStatusHint();
  await refreshFromServer();
  if (navigator.onLine) {
    syncEvents();
  }
}

async function refreshFromServer() {
  await Promise.all([loadEvents(), loadGoals(), loadSuggestedGoal()]);
}

function queueEvent(valence) {
  const queue = readQueue();
  queue.push({
    client_event_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    valence,
    intensity: 3,
    tags: [],
    notes: null,
    context: { source: "quick_log_home" },
  });

  writeQueue(queue);
  refreshQueueUI(`${capitalize(valence)} logged`);
  showToast(`${capitalize(valence)} logged`);
  if (navigator.onLine) {
    syncEvents();
  }
}

async function syncEvents() {
  const queue = readQueue();
  if (queue.length === 0) {
    refreshQueueUI("Queue: 0");
    return;
  }

  try {
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.textContent = "Syncing...";
    }
    const response = await fetch("/v1/events/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: queue }),
    });
    if (!response.ok) {
      throw new Error(`sync failed: ${response.status}`);
    }

    writeQueue([]);
    refreshQueueUI(`Synced ${queue.length}`);
    showToast(`Synced ${queue.length} logs`);
    await loadEvents();
  } catch (_error) {
    refreshQueueUI(`Offline queue: ${queue.length}`);
    showToast("Offline. Queue preserved.");
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.textContent = "Sync Queue";
    }
  }
}

async function loadEvents() {
  try {
    const response = await fetch("/v1/events?limit=80");
    if (!response.ok) {
      throw new Error("failed to load events");
    }
    const payload = await response.json();
    const events = Array.isArray(payload.events) ? payload.events : [];
    renderSummary(events);
  } catch (_error) {
    showToast("Could not refresh events");
  }
}

function renderSummary(events) {
  const today = startOfDay(new Date());
  const todayEvents = events.filter((event) => startOfDay(new Date(event.occurred_at)) === today);
  const wins = todayEvents.filter((event) => event.valence === "positive").length;
  const work = todayEvents.filter((event) => event.valence === "negative").length;

  winsCount.textContent = String(wins);
  workCount.textContent = String(work);
  renderBars(todayEvents);
}

function renderBars(events) {
  const slots = [
    { label: "8 AM", hour: 8 },
    { label: "11 AM", hour: 11 },
    { label: "2 PM", hour: 14 },
    { label: "5 PM", hour: 17 },
    { label: "NOW", hour: new Date().getHours() },
  ];

  const counts = slots.map((slot) =>
    events.filter((event) => new Date(event.occurred_at).getHours() <= slot.hour).length,
  );
  const max = Math.max(1, ...counts);

  summaryBars.innerHTML = slots
    .map((slot, idx) => {
      const pct = Math.max(8, Math.round((counts[idx] / max) * 100));
      return `
        <div class="bar-col">
          <div class="bar-shell"><div class="bar-fill" style="height:${pct}%"></div></div>
          <span class="bar-label">${slot.label}</span>
        </div>
      `;
    })
    .join("");
}

async function loadGoals() {
  try {
    const response = await fetch("/v1/goals");
    if (!response.ok) {
      throw new Error("failed to load goals");
    }
    const payload = await response.json();
    const goals = Array.isArray(payload.goals) ? payload.goals : [];
    const activeGoal = goals.find((goal) => goal.status === "active") || null;
    renderActiveGoal(activeGoal);
    renderNextSteps(activeGoal);
  } catch (_error) {
    renderActiveGoal(null);
    renderNextSteps(null);
    showToast("Could not refresh goals");
  }
}

async function loadSuggestedGoal() {
  try {
    const response = await fetch("/v1/goals/suggested");
    if (!response.ok) {
      throw new Error("failed suggested goal");
    }
    const payload = await response.json();
    renderSuggestedGoal(payload);
  } catch (_error) {
    if (suggestedGoalCard) {
      suggestedGoalCard.hidden = true;
    }
  }
}

function renderSuggestedGoal(payload) {
  if (!suggestedGoalCard) {
    return;
  }
  const goal = payload?.suggested_goal;
  if (!goal) {
    suggestedGoalCard.hidden = true;
    return;
  }
  suggestedGoalCard.hidden = false;
  suggestedGoalTitle.textContent = goal.title || "Suggested goal";
  suggestedGoalSource.textContent = String(payload?.source || "fallback");
  suggestedGoalNotice.textContent = payload?.notice || "";
}

function renderActiveGoal(goal) {
  if (!goal) {
    activeGoalId = null;
    activeGoalTitle.textContent = "No active goal yet";
    activeGoalProgressText.textContent = "0% Completed";
    activeGoalMastery.textContent = "Mastery Level 0";
    activeGoalProgressBar.style.width = "0%";
    activeGoalHint.textContent =
      "Create and activate your first goal in Goal Studio to get a daily roadmap.";
    retryAiBtn.hidden = true;
    return;
  }
  activeGoalId = goal.id;
  const steps = Array.isArray(goal.steps) ? goal.steps : [];
  const done = steps.filter((step) => step.status === "done").length;
  const progress = steps.length > 0 ? Math.round((done / steps.length) * 100) : 0;
  const mastery = Math.min(5, Math.max(1, Math.ceil(progress / 20)));

  activeGoalTitle.textContent = goal.title || "Active goal";
  activeGoalProgressText.textContent = `${progress}% Completed`;
  activeGoalMastery.textContent = `Mastery Level ${mastery}`;
  activeGoalProgressBar.style.width = `${progress}%`;
  activeGoalHint.textContent =
    steps.length > 0
      ? "Track passes and needs work. A step completes at 3 consecutive passes."
      : "No steps yet. Generate AI steps or add manual steps in Goal Studio.";
  retryAiBtn.hidden = steps.length > 0;
}

function renderNextSteps(goal) {
  if (!goal || !Array.isArray(goal.steps) || goal.steps.length === 0) {
    taskCount.textContent = "0 Tasks";
    nextStepsList.innerHTML = `<p class="empty-copy">${
      hasPendingGoalRefreshHint
        ? "AI steps are generating. Pull to refresh or wait a moment."
        : "No steps yet. Generate steps from your goal page."
    }</p>`;
    return;
  }

  const steps = [...goal.steps].sort((a, b) => {
    const left = Number.isFinite(a?.step_order) ? a.step_order : 0;
    const right = Number.isFinite(b?.step_order) ? b.step_order : 0;
    return left - right;
  });
  taskCount.textContent = `${steps.length} Tasks`;
  nextStepsList.innerHTML = steps
    .map(
      (step) => `
      <article class="step-card ${step.status === "done" ? "is-done" : ""}">
        <div class="step-main">
          <p class="step-title">${escapeHtml(step.title || "Step")}</p>
          <p class="step-meta">${escapeHtml(
            step.success_criteria || "Complete task successfully",
          )}</p>
          <p class="step-meta">${step.estimated_minutes || 10} mins • ${
            step.consecutive_passes || 0
          }/3 streak</p>
          <p class="step-meta">${
            step.pass_count || 0
          } pass • ${step.needs_work_count || 0} needs work</p>
        </div>
        <div class="attempt-actions">
          <button class="attempt-btn pass-btn" data-step-id="${step.id}" data-action="attempt" data-outcome="pass"${
            step.status === "done" ? " disabled" : ""
          }>Pass</button>
          <button class="attempt-btn work-btn" data-step-id="${step.id}" data-action="attempt" data-outcome="needs_work"${
            step.status === "done" ? " disabled" : ""
          }>Needs Work</button>
          <button class="attempt-btn undo-btn" data-step-id="${step.id}" data-action="undo"${
            (step.pass_count || 0) + (step.needs_work_count || 0) === 0
              ? " disabled"
              : ""
          }>Undo</button>
        </div>
      </article>
    `,
    )
    .join("");
  hasPendingGoalRefreshHint = false;
}

function setStepButtonsDisabled(stepId, disabled) {
  const buttons = nextStepsList?.querySelectorAll(`button[data-step-id="${stepId}"]`) || [];
  for (const button of buttons) {
    button.disabled = disabled;
  }
}

async function handleStepAction(event) {
  const button = event.target.closest("button[data-step-id][data-action]");
  if (!button) {
    return;
  }
  const stepId = button.getAttribute("data-step-id");
  const action = button.getAttribute("data-action");
  if (!stepId || !action) {
    return;
  }

  setStepButtonsDisabled(stepId, true);
  try {
    let response;
    if (action === "attempt") {
      const outcome = button.getAttribute("data-outcome");
      if (!outcome) {
        return;
      }
      response = await fetch(`/v1/goal-steps/${stepId}/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
    } else if (action === "undo") {
      response = await fetch(`/v1/goal-steps/${stepId}/attempt/undo`, {
        method: "POST",
      });
    } else {
      return;
    }

    if (!response.ok) {
      throw new Error("step action failed");
    }

    const payload = await response.json();
    if (action === "undo") {
      const undone = payload?.undone_outcome === "pass" ? "pass" : "needs work";
      showToast(`Undid ${undone}`);
    } else if (payload?.step?.status === "done") {
      showToast("Step mastered (3/3)");
    } else {
      const outcome = button.getAttribute("data-outcome");
      showToast(outcome === "pass" ? "Pass recorded" : "Needs work recorded");
    }
    await loadGoals();
  } catch (_error) {
    showToast(action === "undo" ? "Could not undo attempt" : "Could not record attempt");
  } finally {
    setStepButtonsDisabled(stepId, false);
  }
}

async function retryAiGeneration() {
  if (!activeGoalId || !retryAiBtn) {
    return;
  }
  retryAiBtn.disabled = true;
  const previousLabel = retryAiBtn.textContent;
  retryAiBtn.textContent = "Retrying...";
  try {
    const response = await fetch(`/v1/goals/${activeGoalId}/generate-steps`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("retry failed");
    }
    const payload = await response.json();
    showToast(payload?.notice || "AI steps generated");
    await loadGoals();
  } catch {
    showToast("AI retry failed");
  } finally {
    retryAiBtn.disabled = false;
    retryAiBtn.textContent = previousLabel;
  }
}

function refreshQueueUI(text) {
  const queue = readQueue();
  syncStatus.textContent = text || `Queue: ${queue.length}`;
  queueCountNav.textContent = String(queue.length);
  queueCountNav.style.display = queue.length > 0 ? "grid" : "none";
}

function readQueue() {
  try {
    const raw = localStorage.getItem(queueKey);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(events) {
  localStorage.setItem(queueKey, JSON.stringify(events));
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let toastTimer = null;
function showToast(message) {
  if (!toast) {
    return;
  }
  toast.textContent = message;
  toast.classList.add("show");
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 1800);
}

function consumeGoalStatusHint() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("goal_sync")) {
    hasPendingGoalRefreshHint = true;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("goal_sync");
    history.replaceState({}, "", nextUrl.pathname + nextUrl.search + nextUrl.hash);
  }

  const rawStatus = sessionStorage.getItem("doglog_goal_ai_status");
  if (!rawStatus) {
    return;
  }
  sessionStorage.removeItem("doglog_goal_ai_status");
  try {
    const status = JSON.parse(rawStatus);
    if (status?.notice) {
      showToast(String(status.notice));
    }
    if (status?.mode === "error") {
      hasPendingGoalRefreshHint = false;
    }
  } catch {
    // ignore malformed status payloads
  }
}
