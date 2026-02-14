const queueKey = "doglog_event_queue_v1";

const historyEventList = document.getElementById("historyEventList");
const historyCount = document.getElementById("historyCount");
const historyTitle = document.getElementById("historyTitle");
const historyRefreshBtn = document.getElementById("historyRefreshBtn");
const queueCountNav = document.getElementById("queueCountNav");
const filterButtons = Array.from(document.querySelectorAll("button[data-filter]"));

let currentFilter = "all";

historyRefreshBtn?.addEventListener("click", loadEvents);
filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    if (!filter || filter === currentFilter) {
      return;
    }
    currentFilter = filter;
    updateFilterUI();
    loadEvents();
  });
});

window.addEventListener("online", loadEvents);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshQueueBadge();
    loadEvents();
  }
});

boot();

function boot() {
  updateFilterUI();
  refreshQueueBadge();
  loadEvents();
}

async function loadEvents() {
  if (!historyEventList) {
    return;
  }

  const query =
    currentFilter === "all" ? "/v1/events?limit=200" : `/v1/events?limit=200&valence=${currentFilter}`;

  try {
    if (historyRefreshBtn) {
      historyRefreshBtn.disabled = true;
      historyRefreshBtn.textContent = "Refreshing...";
    }

    const response = await fetch(query);
    if (!response.ok) {
      throw new Error("failed to load history");
    }

    const payload = await response.json();
    const events = Array.isArray(payload.events) ? payload.events : [];
    renderEvents(events);
  } catch (_error) {
    historyEventList.innerHTML = `<p class="empty-copy">History unavailable right now.</p>`;
    if (historyCount) {
      historyCount.textContent = "0";
    }
  } finally {
    if (historyRefreshBtn) {
      historyRefreshBtn.disabled = false;
      historyRefreshBtn.textContent = "Refresh";
    }
  }
}

function renderEvents(events) {
  if (!historyEventList) {
    return;
  }

  if (historyCount) {
    historyCount.textContent = String(events.length);
  }
  if (historyTitle) {
    historyTitle.textContent = filterLabel(currentFilter);
  }

  if (events.length === 0) {
    historyEventList.innerHTML = `<p class="empty-copy">No logs yet for this view.</p>`;
    return;
  }

  historyEventList.innerHTML = events
    .map((event) => {
      const type = event.valence === "positive" ? "Good Girl" : "Needs Work";
      const loggedAt = new Date(event.occurred_at);
      const dateText = loggedAt.toLocaleDateString([], {
        month: "short",
        day: "numeric",
      });
      const timeText = loggedAt.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
      const behaviourNote =
        typeof event.context?.behaviour === "string" ? event.context.behaviour : "";
      const note = event.notes || behaviourNote || "Quick log entry";
      return `
        <article class="event-card">
          <div class="event-top">
            <p class="event-type">${escapeHtml(type)}</p>
            <p class="event-time">${escapeHtml(dateText)} at ${escapeHtml(timeText)}</p>
          </div>
          <p class="event-note">${escapeHtml(note)}</p>
        </article>
      `;
    })
    .join("");
}

function updateFilterUI() {
  filterButtons.forEach((button) => {
    const isActive = button.dataset.filter === currentFilter;
    button.classList.toggle("is-active", isActive);
  });
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

function filterLabel(filter) {
  if (filter === "positive") {
    return "Wins";
  }
  if (filter === "negative") {
    return "Needs Work";
  }
  return "All Logs";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
