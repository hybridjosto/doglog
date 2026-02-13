const goalNameInput = document.getElementById("goalName");
const setActiveGoalInput = document.getElementById("setActiveGoal");
const saveGoalBtn = document.getElementById("saveGoalBtn");
const previewGoalTitle = document.getElementById("previewGoalTitle");
const previewMilestone = document.getElementById("previewMilestone");
const previewProgress = document.getElementById("previewProgress");
const previewProgressBar = document.getElementById("previewProgressBar");
const toast = document.getElementById("toast");

goalNameInput.addEventListener("input", renderPreview);
saveGoalBtn.addEventListener("click", saveGoal);

renderPreview();

function renderPreview() {
  const title = goalNameInput.value.trim();
  previewGoalTitle.textContent = title || "New Skill Goal";
  previewMilestone.textContent =
    "AI will generate SMART milestones after save";
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
          notice: "Goal saved, but AI milestone generation failed. You can retry from Home.",
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
