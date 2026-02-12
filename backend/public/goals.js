const goalNameInput = document.getElementById("goalName");
const addStepBtn = document.getElementById("addStepBtn");
const stepList = document.getElementById("stepList");
const saveGoalBtn = document.getElementById("saveGoalBtn");
const previewGoalTitle = document.getElementById("previewGoalTitle");
const previewMilestone = document.getElementById("previewMilestone");
const previewProgress = document.getElementById("previewProgress");
const previewProgressBar = document.getElementById("previewProgressBar");
const toast = document.getElementById("toast");

const steps = [];

goalNameInput.addEventListener("input", renderPreview);
addStepBtn.addEventListener("click", () => {
  addStep({ title: "", estimated_minutes: 10 });
});
saveGoalBtn.addEventListener("click", saveGoal);

bootstrap();

function bootstrap() {
  addStep({ title: "Eye contact for 3 seconds", estimated_minutes: 2 });
  addStep({ title: "", estimated_minutes: 5 });
}

function addStep(step) {
  steps.push({
    id: crypto.randomUUID(),
    title: step.title || "",
    estimated_minutes: step.estimated_minutes || 10,
  });
  renderSteps();
  renderPreview();
}

function renderSteps() {
  stepList.innerHTML = steps
    .map((step, index) => {
      return `
        <article class="step-row">
          <div class="step-index">${index + 1}</div>
          <div class="step-fields">
            <input
              data-step-id="${step.id}"
              data-field="title"
              type="text"
              placeholder="Add next milestone..."
              value="${escapeHtml(step.title)}"
            />
            <div class="step-meta">
              <span class="chip">Easy</span>
              <input
                class="step-time"
                data-step-id="${step.id}"
                data-field="estimated_minutes"
                type="number"
                min="1"
                max="60"
                value="${step.estimated_minutes}"
                title="Minutes"
              />
              <span class="chip">mins</span>
            </div>
          </div>
          <button class="step-remove" data-remove-id="${step.id}" type="button" aria-label="Remove step">
            -
          </button>
        </article>
      `;
    })
    .join("");

  for (const input of stepList.querySelectorAll("input[data-step-id]")) {
    input.addEventListener("input", (event) => {
      const target = event.currentTarget;
      const stepId = target.getAttribute("data-step-id");
      const field = target.getAttribute("data-field");
      const step = steps.find((item) => item.id === stepId);
      if (!step || !field) {
        return;
      }
      if (field === "estimated_minutes") {
        step.estimated_minutes = clampMinutes(target.value);
      } else {
        step.title = target.value;
      }
      renderPreview();
    });
  }

  for (const button of stepList.querySelectorAll("button[data-remove-id]")) {
    button.addEventListener("click", () => {
      const removeId = button.getAttribute("data-remove-id");
      const idx = steps.findIndex((item) => item.id === removeId);
      if (idx >= 0) {
        steps.splice(idx, 1);
        renderSteps();
        renderPreview();
      }
    });
  }
}

function renderPreview() {
  const title = goalNameInput.value.trim();
  const filledSteps = steps.filter((step) => step.title.trim().length > 0);
  previewGoalTitle.textContent = title || "New Skill Goal";
  previewMilestone.textContent = `Milestone 1 of ${Math.max(1, filledSteps.length)}`;
  previewProgress.textContent = "0%";
  previewProgressBar.style.width = "0%";
}

async function saveGoal() {
  const title = goalNameInput.value.trim();
  if (!title) {
    showToast("Goal title is required");
    goalNameInput.focus();
    return;
  }

  const validSteps = steps
    .filter((step) => step.title.trim().length > 0)
    .map((step) => ({
      title: step.title.trim(),
      estimated_minutes: clampMinutes(step.estimated_minutes),
    }));

  saveGoalBtn.disabled = true;
  saveGoalBtn.textContent = "Saving...";
  try {
    const createResponse = await fetch("/v1/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: validSteps.length > 0 ? `${validSteps.length} planned steps` : null,
        steps: validSteps,
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

    showToast("Goal saved");
    saveGoalBtn.textContent = "Generating AI steps...";
    const generateResponse = await fetch(`/v1/goals/${goalId}/generate-steps`, {
      method: "POST",
    });
    if (!generateResponse.ok) {
      sessionStorage.setItem(
        "doglog_goal_ai_status",
        JSON.stringify({
          mode: "error",
          notice: "Goal saved, but AI generation failed. You can retry from Home.",
        }),
      );
      showToast("Goal saved, AI generation failed");
      window.setTimeout(() => {
        window.location.href = "/?goal_sync=1";
      }, 900);
      return;
    }

    const generatePayload = await generateResponse.json();
    const generationMode = generatePayload?.generation_mode || "fallback";
    const generationNotice =
      generatePayload?.notice ||
      (generationMode === "cloud"
        ? "Goal + AI steps ready."
        : "Goal saved with fallback steps.");

    sessionStorage.setItem(
      "doglog_goal_ai_status",
      JSON.stringify({ mode: generationMode, notice: generationNotice }),
    );

    showToast(
      generationMode === "cloud"
        ? "Goal + AI steps ready"
        : "Fallback steps ready",
    );
    window.setTimeout(() => {
      window.location.href = "/?goal_sync=1";
    }, 900);
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

function clampMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 10;
  }
  return Math.max(1, Math.min(60, Math.round(n)));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
