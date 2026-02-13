const goalNameInput = document.getElementById("goalName");
const setActiveGoalInput = document.getElementById("setActiveGoal");
const saveGoalBtn = document.getElementById("saveGoalBtn");
const previewGoalTitle = document.getElementById("previewGoalTitle");
const previewMilestone = document.getElementById("previewMilestone");
const previewProgress = document.getElementById("previewProgress");
const previewProgressBar = document.getElementById("previewProgressBar");
const activeGoalsList = document.getElementById("activeGoalsList");
const otherGoalsList = document.getElementById("otherGoalsList");
const goalDetailPanel = document.getElementById("goalDetailPanel");
const goalDetailTitle = document.getElementById("goalDetailTitle");
const goalDetailMeta = document.getElementById("goalDetailMeta");
const goalDetailSteps = document.getElementById("goalDetailSteps");
const closeGoalDetailBtn = document.getElementById("closeGoalDetailBtn");
const closeGoalDetailBtnBottom = document.getElementById("closeGoalDetailBtnBottom");
const toast = document.getElementById("toast");

let goals = [];

goalNameInput.addEventListener("input", renderPreview);
saveGoalBtn.addEventListener("click", saveGoal);
activeGoalsList.addEventListener("click", onGoalListClick);
otherGoalsList.addEventListener("click", onGoalListClick);
closeGoalDetailBtn.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeGoalDetail();
});
closeGoalDetailBtnBottom.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeGoalDetail();
});
goalDetailPanel.addEventListener("click", (event) => {
  if (event.target === goalDetailPanel) {
    closeGoalDetail();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && goalDetailPanel.classList.contains("open")) {
    closeGoalDetail();
  }
});

boot();

async function boot() {
  renderPreview();
  await loadGoalLibrary();
}

function renderPreview() {
  const title = goalNameInput.value.trim();
  previewGoalTitle.textContent = title || "New Skill Goal";
  previewMilestone.textContent =
    "AI will generate SMART milestones after save";
  previewProgress.textContent = "0%";
  previewProgressBar.style.width = "0%";
}

async function loadGoalLibrary() {
  try {
    const response = await fetch("/v1/goals");
    if (!response.ok) {
      throw new Error("failed to load goals");
    }
    const payload = await response.json();
    goals = Array.isArray(payload.goals) ? payload.goals : [];
    renderGoalLibrary();
  } catch {
    activeGoalsList.innerHTML = '<p class="helper-copy">Could not load goals.</p>';
    otherGoalsList.innerHTML = "";
  }
}

function renderGoalLibrary() {
  const activeGoals = goals.filter((goal) => goal.status === "active");
  const otherGoals = goals.filter((goal) => goal.status !== "active" && goal.status !== "archived");

  activeGoalsList.innerHTML =
    activeGoals.length === 0
      ? '<p class="helper-copy">No active goal selected.</p>'
      : activeGoals.map((goal) => renderGoalCard(goal, true)).join("");

  otherGoalsList.innerHTML =
    otherGoals.length === 0
      ? '<p class="helper-copy">No other goals yet.</p>'
      : otherGoals.map((goal) => renderGoalCard(goal, false)).join("");
}

function renderGoalCard(goal, isActive) {
  const steps = Array.isArray(goal.steps) ? goal.steps : [];
  const done = steps.filter((step) => step.status === "done").length;
  const pct = steps.length > 0 ? Math.round((done / steps.length) * 100) : 0;
  return `
    <article class="goal-library-card ${isActive ? "active" : ""}" data-goal-id="${goal.id}" data-action="view">
      <p class="goal-library-title">${escapeHtml(goal.title)}</p>
      <p class="goal-library-meta">${pct}% complete • ${steps.length} milestones</p>
      <div class="goal-library-actions">
        <button class="mini-btn" type="button" data-goal-id="${goal.id}" data-action="view">View Steps</button>
        ${
          isActive
            ? ""
            : `<button class="mini-btn primary" type="button" data-goal-id="${goal.id}" data-action="activate">Set Active</button>`
        }
      </div>
    </article>
  `;
}

async function onGoalListClick(event) {
  const actionEl = event.target.closest("[data-action][data-goal-id]");
  if (!actionEl) {
    return;
  }
  const action = actionEl.getAttribute("data-action");
  const goalId = actionEl.getAttribute("data-goal-id");
  if (!action || !goalId) {
    return;
  }

  if (action === "view") {
    const goal = goals.find((item) => item.id === goalId);
    if (goal) {
      openGoalDetail(goal);
    }
    return;
  }

  if (action === "activate") {
    await activateGoal(goalId, actionEl);
  }
}

async function activateGoal(goalId, element) {
  const button = element.closest("button");
  if (button) {
    button.disabled = true;
  }
  try {
    const response = await fetch(`/v1/goals/${goalId}/activate`, { method: "PATCH" });
    if (!response.ok) {
      throw new Error("activate failed");
    }
    showToast("Goal set active");
    await loadGoalLibrary();
  } catch {
    showToast("Could not activate goal");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

function openGoalDetail(goal) {
  const steps = Array.isArray(goal.steps) ? goal.steps : [];
  const done = steps.filter((step) => step.status === "done").length;
  const pct = steps.length > 0 ? Math.round((done / steps.length) * 100) : 0;
  goalDetailTitle.textContent = goal.title || "Goal details";
  goalDetailMeta.textContent = `${goal.status} • ${pct}% complete • ${steps.length} milestones`;

  goalDetailSteps.innerHTML =
    steps.length === 0
      ? '<p class="helper-copy">No generated milestones yet.</p>'
      : steps
          .map(
            (step, idx) => `
          <article class="detail-step">
            <h4>${idx + 1}. ${escapeHtml(step.title || "Milestone")}</h4>
            <p>${escapeHtml(step.details || "No detail provided")}</p>
            <p><strong>Measure:</strong> ${escapeHtml(step.success_criteria || "No metric")}</p>
            <p><strong>Duration:</strong> ${step.estimated_minutes || 10} mins • <strong>Status:</strong> ${escapeHtml(step.status || "pending")}</p>
          </article>
        `,
          )
          .join("");

  goalDetailPanel.classList.add("open");
  goalDetailPanel.setAttribute("aria-hidden", "false");
}

function closeGoalDetail() {
  goalDetailPanel.classList.remove("open");
  goalDetailPanel.setAttribute("aria-hidden", "true");
}

async function saveGoal() {
  const title = goalNameInput.value.trim();
  if (!title) {
    showToast("Goal title is required");
    goalNameInput.focus();
    return;
  }

  saveGoalBtn.disabled = true;
  saveGoalBtn.textContent = "Saving...";
  try {
    const createResponse = await fetch("/v1/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        status: "draft",
      }),
    });
    if (!createResponse.ok) {
      throw new Error("unable to save goal");
    }

    const createPayload = await createResponse.json();
    const goalId = createPayload?.goal?.id;
    if (!goalId) {
      throw new Error("goal saved but id missing");
    }

    if (setActiveGoalInput.checked) {
      saveGoalBtn.textContent = "Activating...";
      await fetch(`/v1/goals/${goalId}/activate`, { method: "PATCH" });
    }

    showToast("Goal saved");
    saveGoalBtn.textContent = "Analyzing with SMART AI...";
    const generateResponse = await fetch(`/v1/goals/${goalId}/generate-steps`, {
      method: "POST",
    });
    if (!generateResponse.ok) {
      sessionStorage.setItem(
        "doglog_goal_ai_status",
        JSON.stringify({
          mode: "error",
          notice:
            "Goal saved, but AI milestone generation failed. You can retry from Home.",
        }),
      );
      showToast("Goal saved, AI generation failed");
      await loadGoalLibrary();
      return;
    }

    const generatePayload = await generateResponse.json();
    const generationMode = generatePayload?.generation_mode || "fallback";
    const milestoneCount = Array.isArray(generatePayload?.steps)
      ? generatePayload.steps.length
      : 0;
    const generationNotice =
      generatePayload?.notice ||
      (generationMode === "cloud"
        ? `SMART milestones ready (${milestoneCount})`
        : `Fallback milestones ready (${milestoneCount})`);

    sessionStorage.setItem(
      "doglog_goal_ai_status",
      JSON.stringify({ mode: generationMode, notice: generationNotice }),
    );

    showToast(
      generationMode === "cloud"
        ? "SMART milestones generated"
        : "Fallback milestones generated",
    );

    goalNameInput.value = "";
    renderPreview();
    await loadGoalLibrary();
  } catch (_error) {
    showToast("Save failed. Check connection and retry.");
  } finally {
    saveGoalBtn.disabled = false;
    saveGoalBtn.textContent = "Save Training Goal";
  }
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
  }, 1600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
