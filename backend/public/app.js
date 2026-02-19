const queueKey = "doglog_event_queue_v1";

const syncBtn = document.getElementById("syncBtn");
const syncStatus = document.getElementById("syncStatus");
const queueCountNav = document.getElementById("queueCountNav");
const winsCount = document.getElementById("winsCount");
const workCount = document.getElementById("workCount");
const summaryBars = document.getElementById("summaryBars");
const toast = document.getElementById("toast");

const negativeBehaviourGrid = document.getElementById("negativeBehaviourGrid");
const negativeBehaviourOverlay = document.getElementById("negativeBehaviourOverlay");
const negativeBehaviourClose = document.getElementById("negativeBehaviourClose");
const selectedNegativeBehaviourLabel = document.getElementById("selectedNegativeBehaviour");
const negativeContextForm = document.getElementById("negativeContextForm");
const negativeLocationInput = document.getElementById("negativeLocationInput");
const negativeSeveritySelect = document.getElementById("negativeSeveritySelect");
const negativeArousalSelect = document.getElementById("negativeArousalSelect");
const negativeContextNotes = document.getElementById("negativeContextNotes");

const negativeBehaviours = [
  "Pulling on leash",
  "Jumping on guests",
  "Barking at visitors",
  "Counter surfing",
  "Resource guarding",
  "Ignoring recall",
];

let selectedNegativeBehaviour = "";
let toastTimer = null;

syncBtn?.addEventListener("click", syncEvents);
negativeBehaviourGrid?.addEventListener("click", handleNegativeBehaviourTap);
negativeContextForm?.addEventListener("submit", handleNegativeSubmit);
negativeBehaviourClose?.addEventListener("click", closeNegativeBehaviourPopover);
negativeBehaviourOverlay?.addEventListener("click", (event) => {
  if (event.target === negativeBehaviourOverlay) {
    closeNegativeBehaviourPopover();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeNegativeBehaviourPopover();
  }
});

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
  renderBehaviourButtons();
  refreshQueueUI();
  await refreshFromServer();
  if (navigator.onLine) {
    syncEvents();
  }
}

async function refreshFromServer() {
  await loadEvents();
}

function renderBehaviourButtons() {
  if (negativeBehaviourGrid) {
    negativeBehaviourGrid.innerHTML = negativeBehaviours
      .map(
        (behaviour) =>
          `<button class="behavior-action-btn is-negative" type="button" data-behaviour="${escapeAttr(behaviour)}">${escapeHtml(behaviour)}</button>`,
      )
      .join("");
  }
}

function handleNegativeBehaviourTap(event) {
  const button = event.target.closest("button[data-behaviour]");
  if (!button) {
    return;
  }
  const behaviour = button.dataset.behaviour;
  if (!behaviour) {
    return;
  }

  selectedNegativeBehaviour = behaviour;
  if (selectedNegativeBehaviourLabel) {
    selectedNegativeBehaviourLabel.textContent = behaviour;
  }
  openNegativeBehaviourPopover();
}

function openNegativeBehaviourPopover() {
  if (!negativeBehaviourOverlay) {
    return;
  }

  if (negativeContextForm) {
    negativeContextForm.reset();
  }
  if (negativeSeveritySelect) {
    negativeSeveritySelect.value = "3";
  }
  if (negativeArousalSelect) {
    negativeArousalSelect.value = "medium";
  }

  negativeBehaviourOverlay.hidden = false;
  document.body.style.overflow = "hidden";
  window.requestAnimationFrame(() => {
    negativeLocationInput?.focus();
  });
}

function closeNegativeBehaviourPopover() {
  if (!negativeBehaviourOverlay || negativeBehaviourOverlay.hidden) {
    return;
  }
  negativeBehaviourOverlay.hidden = true;
  document.body.style.overflow = "";
}

function handleNegativeSubmit(event) {
  event.preventDefault();
  if (!selectedNegativeBehaviour) {
    showToast("Choose a negative behavior first");
    return;
  }

  const location = negativeLocationInput?.value.trim() || "";
  const notes = negativeContextNotes?.value.trim() || "";
  const severity = Number.parseInt(negativeSeveritySelect?.value || "3", 10);
  const arousalLevel = String(negativeArousalSelect?.value || "medium");

  queueEvent("negative", {
    behaviour: selectedNegativeBehaviour,
    notes,
    intensity: Number.isFinite(severity) ? severity : 3,
    tags: [arousalLevel],
    context: {
      source: "behaviour_logging_page",
      location,
      arousal_level: arousalLevel,
      severity_label: severityLabel(severity),
    },
    toastMessage: `${selectedNegativeBehaviour} logged`,
  });

  closeNegativeBehaviourPopover();
}

function queueEvent(valence, options = {}) {
  const behaviourLabel =
    typeof options.behaviour === "string" && options.behaviour.trim()
      ? options.behaviour.trim()
      : null;
  const customNotes =
    typeof options.notes === "string" && options.notes.trim() ? options.notes.trim() : null;

  const noteParts = [];
  if (behaviourLabel) {
    noteParts.push(behaviourLabel);
  }
  if (customNotes) {
    noteParts.push(customNotes);
  }

  const notes = noteParts.length > 0 ? noteParts.join(" • ") : null;
  const intensity = Number.isInteger(options.intensity) ? options.intensity : 3;

  const tagSet = new Set();
  if (Array.isArray(options.tags)) {
    for (const tag of options.tags) {
      const normalized = String(tag || "").trim().toLowerCase();
      if (normalized) {
        tagSet.add(normalized);
      }
    }
  }
  if (behaviourLabel) {
    tagSet.add(behaviourLabel.toLowerCase());
  }

  const context =
    typeof options.context === "object" && options.context !== null
      ? { ...options.context }
      : {};
  if (!context.source) {
    context.source = "quick_log_home";
  }
  if (behaviourLabel) {
    context.behaviour = behaviourLabel;
  }

  const queue = readQueue();
  queue.push({
    client_event_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    valence,
    intensity,
    tags: Array.from(tagSet),
    notes,
    context,
  });

  writeQueue(queue);
  refreshQueueUI(options.toastMessage || `${capitalize(valence)} logged`);
  showToast(options.toastMessage || `${capitalize(valence)} logged`);
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
  } catch {
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
    const response = await fetch("/v1/events?limit=120");
    if (!response.ok) {
      throw new Error("failed to load events");
    }
    const payload = await response.json();
    const events = Array.isArray(payload.events) ? payload.events : [];
    renderSummary(events);
  } catch {
    showToast("Could not refresh events");
  }
}

function renderSummary(events) {
  const today = startOfDay(new Date());
  const todayEvents = events.filter((event) => startOfDay(new Date(event.occurred_at)) === today);
  const wins = todayEvents.filter((event) => event.valence === "positive").length;
  const work = todayEvents.filter((event) => event.valence === "negative").length;

  if (winsCount) {
    winsCount.textContent = String(wins);
  }
  if (workCount) {
    workCount.textContent = String(work);
  }

  renderBars(todayEvents);
}

function renderBars(events) {
  if (!summaryBars) {
    return;
  }

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

function refreshQueueUI(text) {
  const queue = readQueue();
  if (syncStatus) {
    syncStatus.textContent = text || `Queue: ${queue.length}`;
  }
  if (queueCountNav) {
    queueCountNav.textContent = String(queue.length);
    queueCountNav.style.display = queue.length > 0 ? "grid" : "none";
  }
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

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function severityLabel(severity) {
  if (severity <= 2) {
    return "low";
  }
  if (severity >= 4) {
    return "high";
  }
  return "medium";
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
