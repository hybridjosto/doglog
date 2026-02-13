const activeList = document.getElementById("activeList");
const pausedList = document.getElementById("pausedList");
const draftList = document.getElementById("draftList");
const achievedList = document.getElementById("achievedList");
const archivedList = document.getElementById("archivedList");
const toast = document.getElementById("toast");

document.addEventListener("click", handleActionClick);

boot();

async function boot() {
  await loadGoals();
}

async function loadGoals() {
  try {
    const response = await fetch("/v1/goals");
    if (!response.ok) {
      throw new Error("failed to load");
    }
    const payload = await response.json();
    const goals = Array.isArray(payload.goals) ? payload.goals : [];
    renderGroup(activeList, goals.filter((goal) => goal.status === "active"));
    renderGroup(pausedList, goals.filter((goal) => goal.status === "paused"));
    renderGroup(draftList, goals.filter((goal) => goal.status === "draft"));
    renderGroup(achievedList, goals.filter((goal) => goal.status === "achieved"));
    renderGroup(archivedList, goals.filter((goal) => goal.status === "archived"));
  } catch {
    showToast("Could not load goal library");
  }
}

function renderGroup(container, goals) {
  if (goals.length === 0) {
    container.innerHTML = '<p class="empty">No goals in this section.</p>';
    return;
  }

  container.innerHTML = goals
    .map((goal) => {
      const steps = Array.isArray(goal.steps) ? goal.steps : [];
      const done = steps.filter((step) => step.status === "done").length;
      const pct = steps.length > 0 ? Math.round((done / steps.length) * 100) : 0;
      return `
        <article class="card">
          <h3 class="title">${escapeHtml(goal.title)}</h3>
          <p class="meta">${pct}% complete • ${steps.length} steps</p>
          <div class="actions">
            <button class="btn primary" data-action="activate" data-goal-id="${goal.id}">Activate</button>
            <button class="btn" data-action="pause" data-goal-id="${goal.id}">Pause</button>
            <button class="btn" data-action="archive" data-goal-id="${goal.id}">Archive</button>
            <a class="btn" href="/goals.html?goal_id=${goal.id}">Open</a>
          </div>
        </article>
      `;
    })
    .join("");
}

async function handleActionClick(event) {
  const button = event.target.closest("button[data-action][data-goal-id]");
  if (!button) {
    return;
  }

  const action = button.getAttribute("data-action");
  const goalId = button.getAttribute("data-goal-id");
  if (!action || !goalId) {
    return;
  }

  button.disabled = true;
  try {
    if (action === "activate") {
      await fetch(`/v1/goals/${goalId}/activate`, { method: "PATCH" });
      showToast("Goal activated");
    } else if (action === "pause") {
      await fetch(`/v1/goals/${goalId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      });
      showToast("Goal paused");
    } else if (action === "archive") {
      await fetch(`/v1/goals/${goalId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      showToast("Goal archived");
    }
    await loadGoals();
  } catch {
    showToast("Action failed");
  } finally {
    button.disabled = false;
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
  }, 1400);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
