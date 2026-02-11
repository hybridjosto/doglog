const queueKey = "doglog_event_queue_v1";

const positiveBtn = document.getElementById("positiveBtn");
const negativeBtn = document.getElementById("negativeBtn");
const intensityInput = document.getElementById("intensity");
const intensityValue = document.getElementById("intensityValue");
const tagsInput = document.getElementById("tags");
const notesInput = document.getElementById("notes");
const syncBtn = document.getElementById("syncBtn");
const syncStatus = document.getElementById("syncStatus");
const queueCount = document.getElementById("queueCount");
const todayPositive = document.getElementById("todayPositive");
const todayNegative = document.getElementById("todayNegative");
const goalForm = document.getElementById("goalForm");
const goalTitleInput = document.getElementById("goalTitle");
const goalDescriptionInput = document.getElementById("goalDescription");
const goalList = document.getElementById("goalList");
const eventList = document.getElementById("eventList");
const toast = document.getElementById("toast");

intensityInput.addEventListener("input", () => {
  intensityValue.textContent = intensityInput.value;
});

positiveBtn.addEventListener("click", () => queueEvent("positive"));
negativeBtn.addEventListener("click", () => queueEvent("negative"));
syncBtn.addEventListener("click", syncEvents);
goalForm.addEventListener("submit", createGoal);

window.addEventListener("online", () => {
  syncEvents();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // no-op if service worker cannot register
  });
}

boot();

async function boot() {
  refreshQueueLabel();
  await Promise.all([loadGoals(), loadEvents()]);
  if (navigator.onLine) {
    syncEvents();
  }
}

function queueEvent(valence) {
  const queue = readQueue();
  const event = {
    client_event_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    valence,
    intensity: Number.parseInt(intensityInput.value, 10),
    tags: tagsInput.value
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
    notes: notesInput.value.trim() || null,
    context: {},
  };

  queue.push(event);
  writeQueue(queue);
  notesInput.value = "";
  refreshQueueLabel(`${capitalize(valence)} queued`);
  showToast(`${capitalize(valence)} event queued`);

  if (navigator.onLine) {
    syncEvents();
  }
}

async function syncEvents() {
  const queue = readQueue();
  if (queue.length === 0) {
    refreshQueueLabel("Queue: 0");
    return;
  }

  try {
    syncBtn.disabled = true;
    const response = await fetch("/v1/events/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: queue }),
    });
    if (!response.ok) {
      throw new Error(`Sync failed: ${response.status}`);
    }

    writeQueue([]);
    refreshQueueLabel(`Synced ${queue.length}`);
    showToast(`Synced ${queue.length} event${queue.length === 1 ? "" : "s"}`);
    await loadEvents();
  } catch (_error) {
    refreshQueueLabel(`Offline queue: ${queue.length}`);
    showToast("Still offline. Queue kept locally.");
  } finally {
    syncBtn.disabled = false;
  }
}

async function loadEvents() {
  try {
    const response = await fetch("/v1/events?limit=15");
    if (!response.ok) {
      throw new Error("unable to load events");
    }
    const payload = await response.json();
    const events = payload.events || [];
    renderEvents(events);
    renderDailyStats(events);
  } catch (_error) {
    eventList.innerHTML = `<p class="meta">Events unavailable right now.</p>`;
  }
}

function renderEvents(events) {
  if (events.length === 0) {
    eventList.innerHTML = `<p class="meta">No events yet.</p>`;
    return;
  }

  eventList.innerHTML = events
    .map((event) => {
      const date = new Date(event.occurred_at).toLocaleString();
      const tags = Array.isArray(event.tags) ? event.tags.join(", ") : "";
      return `
        <article class="event-card">
          <h3>${event.valence === "positive" ? "Positive" : "Negative"} (${event.intensity}/5)</h3>
          <p class="meta">${date}</p>
          <p class="meta">${event.notes || "No notes"}</p>
          <div class="pill-row">
            ${
              tags
                ? tags
                    .split(", ")
                    .map((item) => `<span class="pill">${escapeHtml(item)}</span>`)
                    .join("")
                : '<span class="pill">No tags</span>'
            }
          </div>
        </article>
      `;
    })
    .join("");
}

async function createGoal(evt) {
  evt.preventDefault();
  const title = goalTitleInput.value.trim();
  if (!title) {
    return;
  }

  const payload = {
    title,
    description: goalDescriptionInput.value.trim() || null,
  };

  try {
    const response = await fetch("/v1/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("unable to create goal");
    }
    goalForm.reset();
    await loadGoals();
  } catch (_error) {
    // keeping UI quiet for prototype
  }
}

async function loadGoals() {
  try {
    const response = await fetch("/v1/goals");
    if (!response.ok) {
      throw new Error("unable to load goals");
    }
    const payload = await response.json();
    renderGoals(payload.goals || []);
  } catch (_error) {
    goalList.innerHTML = `<p class="meta">Goals unavailable right now.</p>`;
  }
}

function renderGoals(goals) {
  if (goals.length === 0) {
    goalList.innerHTML = `<p class="meta">No goals yet.</p>`;
    return;
  }

  goalList.innerHTML = goals
    .map((goal) => {
      const steps = Array.isArray(goal.steps) ? goal.steps : [];
      const stepHtml =
        steps.length === 0
          ? `<p class="meta">No steps yet.</p>`
          : `<div class="step-list">
            ${steps
              .map(
                (step) => `
              <div class="step-item ${step.status === "done" ? "step-done" : ""}">
                <div>
                  <strong>${escapeHtml(step.title)}</strong>
                  <p class="meta">${step.status} • ${step.estimated_minutes || 10}m</p>
                </div>
                ${
                  step.status !== "done"
                    ? `<button data-step-id="${step.id}" class="done-btn">Done</button>`
                    : `<span class="meta">Done</span>`
                }
              </div>
            `,
              )
              .join("")}
          </div>`;

      return `
        <article class="goal-card">
          <h3>${escapeHtml(goal.title)}</h3>
          <p class="meta">${escapeHtml(goal.description || "No description")}</p>
          <p class="meta">Status: ${goal.status}</p>
          <div class="row">
            <button data-goal-id="${goal.id}" class="primary-btn generate-btn">Generate Steps</button>
          </div>
          ${stepHtml}
        </article>
      `;
    })
    .join("");

  for (const button of goalList.querySelectorAll(".generate-btn")) {
    button.addEventListener("click", async () => {
      const goalId = button.getAttribute("data-goal-id");
      if (!goalId) {
        return;
      }
      button.textContent = "Generating...";
      button.disabled = true;
      try {
        await fetch(`/v1/goals/${goalId}/generate-steps`, { method: "POST" });
        showToast("Goal steps generated");
        await loadGoals();
      } finally {
        button.disabled = false;
      }
    });
  }

  for (const button of goalList.querySelectorAll(".done-btn")) {
    button.addEventListener("click", async () => {
      const stepId = button.getAttribute("data-step-id");
      if (!stepId) {
        return;
      }
      await fetch(`/v1/goal-steps/${stepId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      showToast("Step marked done");
      await loadGoals();
    });
  }
}

function readQueue() {
  try {
    const raw = localStorage.getItem(queueKey);
    return raw ? JSON.parse(raw) : [];
  } catch (_error) {
    return [];
  }
}

function writeQueue(events) {
  localStorage.setItem(queueKey, JSON.stringify(events));
}

function refreshQueueLabel(text) {
  const queue = readQueue();
  syncStatus.textContent = text || `Queue: ${queue.length}`;
  queueCount.textContent = String(queue.length);
}

function capitalize(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderDailyStats(events) {
  const today = new Date();
  const todayKey = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).toISOString();

  let positive = 0;
  let negative = 0;
  for (const event of events) {
    const eventDate = new Date(event.occurred_at);
    const eventKey = new Date(
      eventDate.getFullYear(),
      eventDate.getMonth(),
      eventDate.getDate(),
    ).toISOString();

    if (eventKey !== todayKey) {
      continue;
    }
    if (event.valence === "positive") {
      positive += 1;
    } else if (event.valence === "negative") {
      negative += 1;
    }
  }

  todayPositive.textContent = String(positive);
  todayNegative.textContent = String(negative);
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
