const stateUrl = "/campaigns/ui/state";
const uploadUrl = "/campaigns/ui/upload";
const startUrl = "/campaigns/ui/start";
const endUrl = "/campaigns/ui/end";

const elements = {
  uploadForm: document.querySelector("#uploadForm"),
  controlForm: document.querySelector("#controlForm"),
  csvInput: document.querySelector("#csvInput"),
  fileName: document.querySelector("#fileName"),
  uploadedFile: document.querySelector("#uploadedFile"),
  statusValue: document.querySelector("#statusValue"),
  leadCount: document.querySelector("#leadCount"),
  activeCalls: document.querySelector("#activeCalls"),
  campaignId: document.querySelector("#campaignId"),
  campaignInput: document.querySelector("#campaignInput"),
  startButton: document.querySelector("#startButton"),
  endButton: document.querySelector("#endButton"),
  refreshButton: document.querySelector("#refreshButton"),
  summaryText: document.querySelector("#summaryText"),
  activityLog: document.querySelector("#activityLog"),
  toast: document.querySelector("#toast")
};

let toastTimer = null;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 3600);
}

function formatStatus(status) {
  return status ? status[0].toUpperCase() + status.slice(1) : "Unknown";
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestamp));
}

function summarizeMeta(meta) {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  return Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ");
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

function renderSummary(state) {
  if (!state.summary) {
    if (state.uploadedCsv) {
      elements.summaryText.textContent = "Ready to start.";
      return;
    }
    elements.summaryText.textContent = "Upload a CSV, then start a campaign.";
    return;
  }

  const skippedCount = state.summary.skippedCount || 0;
  elements.summaryText.textContent = [
    `${state.summary.totalLeads} leads`,
    `${state.summary.successCount} calls created`,
    `${state.summary.failureCount} failed`,
    `${skippedCount} skipped`
  ].join(" | ");
}

function renderActivity(activity) {
  elements.activityLog.innerHTML = "";

  if (!activity || activity.length === 0) {
    const item = document.createElement("li");
    const time = document.createElement("span");
    const level = document.createElement("span");
    const message = document.createElement("span");
    time.className = "time";
    level.className = "level info";
    time.textContent = "Now";
    level.textContent = "Info";
    message.textContent = "No activity yet.";
    item.append(time, level, message);
    elements.activityLog.appendChild(item);
    return;
  }

  activity.forEach((entry) => {
    const item = document.createElement("li");
    const meta = summarizeMeta(entry.meta);
    const level = entry.level || "info";

    const timeNode = document.createElement("span");
    timeNode.className = "time";
    timeNode.textContent = formatTime(entry.timestamp);

    const levelNode = document.createElement("span");
    levelNode.className = `level ${level}`;
    levelNode.textContent = level;

    const messageNode = document.createElement("span");
    messageNode.className = "message";
    messageNode.textContent = entry.message;

    if (meta) {
      const metaNode = document.createElement("span");
      metaNode.className = "meta";
      metaNode.textContent = meta;
      messageNode.appendChild(metaNode);
    }

    item.append(timeNode, levelNode, messageNode);
    elements.activityLog.appendChild(item);
  });
}

function renderState(state) {
  const isBusy = state.status === "running" || state.status === "stopping";
  elements.statusValue.textContent = formatStatus(state.status);
  elements.leadCount.textContent = state.uploadedLeadCount || 0;
  elements.activeCalls.textContent = state.activeCallCount || 0;
  elements.campaignId.textContent = state.campaignId || "None";
  elements.startButton.disabled = isBusy || !state.uploadedCsv;
  elements.endButton.disabled = !isBusy;
  elements.uploadedFile.textContent = state.uploadedCsv
    ? `Uploaded: ${state.uploadedCsv.name}`
    : "No CSV uploaded yet.";
  renderSummary(state);
  renderActivity(state.activity);
}

async function refreshState() {
  const response = await fetch(stateUrl);
  const state = await readJson(response);
  renderState(state);
  return state;
}

elements.csvInput.addEventListener("change", () => {
  elements.fileName.textContent = elements.csvInput.files[0]?.name || "Choose a CSV file";
});

elements.uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = elements.csvInput.files[0];
  if (!file) {
    showToast("Choose a CSV file first.");
    return;
  }

  const formData = new FormData();
  formData.append("csv", file);

  try {
    elements.uploadForm.querySelector("button").disabled = true;
    const response = await fetch(uploadUrl, { method: "POST", body: formData });
    renderState(await readJson(response));
    showToast("CSV uploaded.");
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.uploadForm.querySelector("button").disabled = false;
  }
});

elements.controlForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const response = await fetch(startUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId: elements.campaignInput.value.trim() })
    });
    renderState(await readJson(response));
    showToast("Campaign started.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.endButton.addEventListener("click", async () => {
  try {
    const response = await fetch(endUrl, { method: "POST" });
    renderState(await readJson(response));
    showToast("Campaign end requested.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.refreshButton.addEventListener("click", () => {
  refreshState().catch((error) => showToast(error.message));
});

refreshState().catch((error) => showToast(error.message));
setInterval(() => {
  refreshState().catch(() => {});
}, 2500);
