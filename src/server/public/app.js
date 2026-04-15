const stateUrl = "/campaigns/ui/state";
const systemStatusUrl = "/system/status";
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
  tunnelStatus: document.querySelector("#tunnelStatus"),
  tunnelDetail: document.querySelector("#tunnelDetail"),
  campaignInput: document.querySelector("#campaignInput"),
  loopEnabled: document.querySelector("#loopEnabled"),
  loopIntervalHours: document.querySelector("#loopIntervalHours"),
  startButton: document.querySelector("#startButton"),
  endButton: document.querySelector("#endButton"),
  refreshButton: document.querySelector("#refreshButton"),
  summaryText: document.querySelector("#summaryText"),
  recurringSummary: document.querySelector("#recurringSummary"),
  recurringLeadList: document.querySelector("#recurringLeadList"),
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

function formatTunnelStatus(status) {
  return String(status || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  const pendingLeadCount = state.summary.pendingLeadCount ?? state.pendingLeadCount ?? 0;
  elements.summaryText.textContent = [
    `${state.summary.totalLeads} leads`,
    `${state.summary.successCount} calls created`,
    `${state.summary.failureCount} failed`,
    `${skippedCount} skipped`,
    `${pendingLeadCount} pending`
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

function formatLeadStatus(status) {
  return String(status || "ready")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderRecurringCalls(leads) {
  elements.recurringLeadList.innerHTML = "";

  if (!leads || leads.length === 0) {
    elements.recurringSummary.textContent = "No leads uploaded.";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "empty-cell";
    cell.textContent = "Upload a CSV to see the recurring call list.";
    row.appendChild(cell);
    elements.recurringLeadList.appendChild(row);
    return;
  }

  const pendingCount = leads.filter((lead) => lead.isPending).length;
  const activeCount = leads.filter((lead) => lead.isActive).length;
  elements.recurringSummary.textContent = `${pendingCount} pending | ${activeCount} active`;

  leads.forEach((lead) => {
    const row = document.createElement("tr");

    const leadCell = document.createElement("td");
    const leadName = document.createElement("strong");
    const leadId = document.createElement("span");
    leadName.textContent = lead.leadName || "Unnamed lead";
    leadId.textContent = lead.leadId ? `ID ${lead.leadId}` : "No ID";
    leadCell.append(leadName, leadId);

    const phoneCell = document.createElement("td");
    phoneCell.textContent = lead.leadPhone || "No phone";

    const statusCell = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = `status-badge ${lead.status || "ready"}`;
    statusBadge.textContent = formatLeadStatus(lead.status);
    statusCell.appendChild(statusBadge);

    const callStatusCell = document.createElement("td");
    callStatusCell.textContent = lead.lastCallStatus || "None";

    const intentCell = document.createElement("td");
    intentCell.textContent = lead.lastIntent || "None";

    const roundCell = document.createElement("td");
    roundCell.textContent = lead.round || 0;

    const callSidCell = document.createElement("td");
    callSidCell.className = "sid-cell";
    callSidCell.textContent = lead.callSid || "None";

    row.append(
      leadCell,
      phoneCell,
      statusCell,
      callStatusCell,
      intentCell,
      roundCell,
      callSidCell
    );
    elements.recurringLeadList.appendChild(row);
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
  renderRecurringCalls(state.recurringCallList);
  renderActivity(state.activity);
}

function renderTunnelStatus(systemStatus) {
  const tunnel = systemStatus.cloudflareTunnel || {};
  const status = tunnel.status || "unknown";
  elements.tunnelStatus.textContent = formatTunnelStatus(status);
  elements.tunnelStatus.dataset.status = status;

  if (tunnel.status === "running" && tunnel.pid) {
    elements.tunnelDetail.textContent = `PID ${tunnel.pid}`;
    return;
  }

  if (tunnel.lastError) {
    elements.tunnelDetail.textContent = tunnel.lastError;
    return;
  }

  if (tunnel.lastMessage) {
    elements.tunnelDetail.textContent = tunnel.lastMessage;
    return;
  }

  elements.tunnelDetail.textContent = tunnel.enabled ? "Waiting for tunnel..." : "Auto-start disabled";
}

async function refreshState() {
  const response = await fetch(stateUrl);
  const state = await readJson(response);
  renderState(state);
  return state;
}

async function refreshSystemStatus() {
  const response = await fetch(systemStatusUrl);
  const systemStatus = await readJson(response);
  renderTunnelStatus(systemStatus);
  return systemStatus;
}

async function refreshDashboard() {
  await Promise.all([refreshState(), refreshSystemStatus()]);
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
      body: JSON.stringify({
        campaignId: elements.campaignInput.value.trim(),
        loopEnabled: elements.loopEnabled.checked,
        loopIntervalHours: elements.loopIntervalHours.value
      })
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
  refreshDashboard().catch((error) => showToast(error.message));
});

refreshDashboard().catch((error) => showToast(error.message));
setInterval(() => {
  refreshDashboard().catch(() => {});
}, 2500);
