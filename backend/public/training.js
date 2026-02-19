const queueKey = "doglog_event_queue_v1";

const trainingRefreshBtn = document.getElementById("trainingRefreshBtn");
const trainingGoalPill = document.getElementById("trainingGoalPill");
const trainingGoalTitle = document.getElementById("trainingGoalTitle");
const trainingGoalMeta = document.getElementById("trainingGoalMeta");
const trainingTaskCount = document.getElementById("trainingTaskCount");
const trainingStepsList = document.getElementById("trainingStepsList");
const queueCountNav = document.getElementById("queueCountNav");
const toast = document.getElementById("toast");

let activeGoal = null;
let toastTimer = null;
let runningTimerStepId = null;
let timerIntervalId = null;
const startedAtMsByStep = new Map();
const elapsedSecondsByStep = new Map();
const readyToSaveByStep = new Set();

trainingRefreshBtn?.addEventListener("click", loadActiveGoal);
trainingStepsList?.addEventListener("click", handleStepAction);
window.addEventListener("online", loadActiveGoal);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshQueueBadge();
    loadActiveGoal();
  }
});

boot();

function boot() {
  refreshQueueBadge();
  loadActiveGoal();
}

async function loadActiveGoal() {
  try {
    setRefreshingState(true);
    const response = await fetch("/v1/goals");
    if (!response.ok) {
      throw new Error("failed to load goals");
    }

    const payload = await response.json();
    const goals = Array.isArray(payload.goals) ? payload.goals : [];
    activeGoal = goals.find((goal) => goal.status === "active") || null;
    pruneTimerState(activeGoal);
    renderActiveGoal(activeGoal);
    renderSteps(activeGoal);
  } catch {
    activeGoal = null;
    stopTimerTicker();
    runningTimerStepId = null;
    renderActiveGoal(null);
    if (trainingStepsList) {
      trainingStepsList.innerHTML = `<p class="empty-copy">Training data unavailable right now.</p>`;
    }
    showToast("Could not load training goal");
  } finally {
    setRefreshingState(false);
  }
}

function renderActiveGoal(goal) {
  if (!trainingGoalTitle || !trainingGoalMeta || !trainingGoalPill) {
    return;
  }

  if (!goal) {
    trainingGoalPill.textContent = "None";
    trainingGoalTitle.textContent = "No active goal yet";
    trainingGoalMeta.textContent = "Activate a goal to start logging attempts.";
    return;
  }

  const steps = Array.isArray(goal.steps) ? goal.steps : [];
  const done = steps.filter((step) => step.status === "done").length;
  const progress = steps.length > 0 ? Math.round((done / steps.length) * 100) : 0;

  trainingGoalPill.textContent = "Active";
  trainingGoalTitle.textContent = goal.title || "Active goal";
  trainingGoalMeta.textContent = `${progress}% complete • ${steps.length} steps`;
}

function renderSteps(goal) {
  if (!trainingStepsList || !trainingTaskCount) {
    return;
  }

  if (!goal || !Array.isArray(goal.steps) || goal.steps.length === 0) {
    trainingTaskCount.textContent = "0 Tasks";
    trainingStepsList.innerHTML = `<p class="empty-copy">No active goal steps yet.</p>`;
    return;
  }

  const steps = [...goal.steps].sort((a, b) => {
    const left = Number.isFinite(a?.step_order) ? a.step_order : 0;
    const right = Number.isFinite(b?.step_order) ? b.step_order : 0;
    return left - right;
  });

  trainingTaskCount.textContent = `${steps.length} Tasks`;
  trainingStepsList.innerHTML = steps
    .map((step) => {
      const stepId = String(step.id || "");
      const isRunning = runningTimerStepId === stepId;
      const elapsedSeconds = getStepElapsedSeconds(stepId);
      const startDisabled = !!runningTimerStepId && !isRunning;
      const stopDisabled = !isRunning;
      const resultDisabled = false;
      const undoDisabled = (step.pass_count || 0) + (step.needs_work_count || 0) === 0;

      return `
        <article class="step-card">
          <div class="step-main">
            <p class="step-title">${escapeHtml(step.title || "Step")}</p>
            <p class="step-meta">${escapeHtml(step.success_criteria || "Complete task successfully")}</p>
            <p class="step-meta">${step.estimated_minutes || 10} mins • ${step.consecutive_passes || 0}/3 streak</p>
            <p class="step-meta">${step.pass_count || 0} pass • ${step.needs_work_count || 0} needs work</p>
            <div class="timer-row">
              <span class="timer-label">Timer</span>
              <span class="timer-display" data-timer-display="${stepId}">${formatDuration(elapsedSeconds)}</span>
              <button class="attempt-btn timer-btn" data-step-id="${stepId}" data-action="start_timer"${startDisabled ? " disabled" : ""}>Start</button>
              <button class="attempt-btn timer-btn" data-step-id="${stepId}" data-action="stop_timer"${stopDisabled ? " disabled" : ""}>Stop</button>
            </div>
            <input
              class="attempt-note"
              type="text"
              data-note-input="${stepId}"
              placeholder="Optional note"
            />
          </div>
          <div class="attempt-actions training-result-actions">
            <button class="attempt-btn pass-btn" data-step-id="${stepId}" data-action="attempt" data-outcome="pass"${resultDisabled ? " disabled" : ""}>Pass</button>
            <button class="attempt-btn work-btn" data-step-id="${stepId}" data-action="attempt" data-outcome="needs_work"${resultDisabled ? " disabled" : ""}>Needs Work</button>
            <button class="attempt-btn neutral-btn" data-step-id="${stepId}" data-action="attempt" data-outcome="neutral"${resultDisabled ? " disabled" : ""}>Neutral</button>
            <button class="attempt-btn undo-btn" data-step-id="${stepId}" data-action="undo"${undoDisabled ? " disabled" : ""}>Undo</button>
          </div>
        </article>
      `;
    })
    .join("");

  updateTimerDisplays();
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

  if (action === "start_timer") {
    startTimer(stepId);
    return;
  }

  if (action === "stop_timer") {
    stopTimer(stepId);
    return;
  }

  try {
    let response;
    if (action === "attempt") {
      const outcome = button.getAttribute("data-outcome");
      if (!outcome) {
        return;
      }
      if (!readyToSaveByStep.has(stepId)) {
        showToast("Start and stop timer before saving attempt");
        return;
      }

      const noteInput = trainingStepsList?.querySelector(`[data-note-input="${stepId}"]`);
      const note = noteInput instanceof HTMLInputElement ? noteInput.value.trim() : "";
      const durationSeconds = getStepElapsedSeconds(stepId);

      response = await fetch(`/v1/goal-steps/${stepId}/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome,
          duration_seconds: durationSeconds,
          note,
        }),
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
      const undone = payload?.undone_outcome || "attempt";
      showToast(`Undid ${undone.replace("_", " ")}`);
    } else if (payload?.step?.status === "done") {
      showToast("Step mastered (3/3)");
    } else {
      const outcome = button.getAttribute("data-outcome");
      if (outcome === "pass") {
        showToast("Pass recorded");
      } else if (outcome === "needs_work") {
        showToast("Needs work recorded");
      } else {
        showToast("Neutral recorded");
      }
    }

    readyToSaveByStep.delete(stepId);
    elapsedSecondsByStep.delete(stepId);
    startedAtMsByStep.delete(stepId);
    if (runningTimerStepId === stepId) {
      runningTimerStepId = null;
      stopTimerTicker();
    }

    await loadActiveGoal();
  } catch {
    showToast(action === "undo" ? "Could not undo attempt" : "Could not record attempt");
  } finally {
    // no-op: keep buttons interactive to avoid sticky disabled states
  }
}

function startTimer(stepId) {
  if (runningTimerStepId && runningTimerStepId !== stepId) {
    showToast("Only one timer can run at a time");
    return;
  }

  runningTimerStepId = stepId;
  startedAtMsByStep.set(stepId, Date.now());
  elapsedSecondsByStep.set(stepId, 0);
  readyToSaveByStep.delete(stepId);
  startTimerTicker();
  updateTimerDisplays();
  renderSteps(activeGoal);
}

function stopTimer(stepId) {
  if (runningTimerStepId !== stepId) {
    showToast("Start timer first");
    return;
  }

  const startedAtMs = startedAtMsByStep.get(stepId);
  if (!startedAtMs) {
    return;
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  elapsedSecondsByStep.set(stepId, elapsedSeconds);
  startedAtMsByStep.delete(stepId);
  runningTimerStepId = null;
  readyToSaveByStep.add(stepId);
  stopTimerTicker();
  renderSteps(activeGoal);
}

function startTimerTicker() {
  if (timerIntervalId) {
    return;
  }
  timerIntervalId = window.setInterval(() => {
    updateTimerDisplays();
  }, 1000);
}

function stopTimerTicker() {
  if (!timerIntervalId) {
    return;
  }
  window.clearInterval(timerIntervalId);
  timerIntervalId = null;
}

function updateTimerDisplays() {
  const displays = trainingStepsList?.querySelectorAll("[data-timer-display]") || [];
  for (const display of displays) {
    const stepId = display.getAttribute("data-timer-display") || "";
    display.textContent = formatDuration(getStepElapsedSeconds(stepId));
  }
}

function getStepElapsedSeconds(stepId) {
  if (runningTimerStepId === stepId) {
    const startedAtMs = startedAtMsByStep.get(stepId);
    if (!startedAtMs) {
      return 0;
    }
    return Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  }
  return elapsedSecondsByStep.get(stepId) || 0;
}

function setRefreshingState(isRefreshing) {
  if (!trainingRefreshBtn) {
    return;
  }
  trainingRefreshBtn.disabled = isRefreshing;
  trainingRefreshBtn.textContent = isRefreshing ? "Refreshing..." : "Refresh";
}

function pruneTimerState(goal) {
  const stepIds = new Set(
    Array.isArray(goal?.steps) ? goal.steps.map((step) => String(step.id || "")) : [],
  );

  for (const key of startedAtMsByStep.keys()) {
    if (!stepIds.has(key)) {
      startedAtMsByStep.delete(key);
    }
  }
  for (const key of elapsedSecondsByStep.keys()) {
    if (!stepIds.has(key)) {
      elapsedSecondsByStep.delete(key);
    }
  }
  for (const key of [...readyToSaveByStep]) {
    if (!stepIds.has(key)) {
      readyToSaveByStep.delete(key);
    }
  }

  if (runningTimerStepId && !stepIds.has(runningTimerStepId)) {
    runningTimerStepId = null;
    stopTimerTicker();
  }
}

function formatDuration(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = (totalSeconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function refreshQueueBadge() {
  if (!queueCountNav) {
    return;
  }
  const queue = readQueue();
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
