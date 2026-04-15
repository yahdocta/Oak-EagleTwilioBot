const stateUrl = "/campaigns/ui/state";
const systemStatusUrl = "/system/status";
const uploadUrl = "/campaigns/ui/upload";
const startUrl = "/campaigns/ui/start";
const endUrl = "/campaigns/ui/end";
const pauseUrl = "/campaigns/ui/pause";
const recurringCsvSaveUrl = "/campaigns/ui/recurring-leads/save-csv";
const recurringLeadRemoveUrl = (leadId) =>
  `/campaigns/ui/recurring-leads/${encodeURIComponent(leadId)}/remove`;

const elements = {
  uploadForm: document.querySelector("#uploadForm"),
  controlForm: document.querySelector("#controlForm"),
  csvInput: document.querySelector("#csvInput"),
  dealMachineCsv: document.querySelector("#dealMachineCsv"),
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
  scheduleEnabled: document.querySelector("#scheduleEnabled"),
  scheduleStartAt: document.querySelector("#scheduleStartAt"),
  scheduleTimezone: document.querySelector("#scheduleTimezone"),
  startButton: document.querySelector("#startButton"),
  pauseButton: document.querySelector("#pauseButton"),
  endButton: document.querySelector("#endButton"),
  refreshButton: document.querySelector("#refreshButton"),
  summaryText: document.querySelector("#summaryText"),
  recurringSort: document.querySelector("#recurringSort"),
  saveRecurringCsvButton: document.querySelector("#saveRecurringCsvButton"),
  recurringSummary: document.querySelector("#recurringSummary"),
  recurringTableWrap: document.querySelector("#recurringTableWrap"),
  recurringResizeHandle: document.querySelector("#recurringResizeHandle"),
  recurringLeadList: document.querySelector("#recurringLeadList"),
  leadDetailDialog: document.querySelector("#leadDetailDialog"),
  leadDetailTitle: document.querySelector("#leadDetailTitle"),
  leadDetailMeta: document.querySelector("#leadDetailMeta"),
  leadDetailTranscript: document.querySelector("#leadDetailTranscript"),
  activityLog: document.querySelector("#activityLog"),
  toast: document.querySelector("#toast")
};

let toastTimer = null;
let recurringLeadsById = new Map();
let currentRecurringLeads = [];
const recurringTableHeight = {
  min: 220,
  max: 760,
  current: 360
};

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

function formatDateTime(timestamp, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setRecurringTableHeight(height) {
  const nextHeight = clamp(Math.round(height), recurringTableHeight.min, recurringTableHeight.max);
  recurringTableHeight.current = nextHeight;
  elements.recurringTableWrap.style.maxHeight = `${nextHeight}px`;
  elements.recurringResizeHandle.setAttribute("aria-valuenow", String(nextHeight));
}

function startRecurringResize(event) {
  event.preventDefault();
  const startY = event.clientY;
  const startHeight = elements.recurringTableWrap.getBoundingClientRect().height;
  elements.recurringResizeHandle.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing-recurring-calls");

  function moveResize(pointerEvent) {
    setRecurringTableHeight(startHeight + pointerEvent.clientY - startY);
  }

  function stopResize(pointerEvent) {
    if (elements.recurringResizeHandle.hasPointerCapture(pointerEvent.pointerId)) {
      elements.recurringResizeHandle.releasePointerCapture(pointerEvent.pointerId);
    }
    document.body.classList.remove("resizing-recurring-calls");
    window.removeEventListener("pointermove", moveResize);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
  }

  window.addEventListener("pointermove", moveResize);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
}

function renderSummary(state) {
  if (state.status === "scheduled" && state.scheduledStartAt) {
    const timezone = state.scheduledTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    elements.summaryText.textContent = `Scheduled for ${formatDateTime(
      state.scheduledStartAt,
      timezone
    )} ${timezone}.`;
    return;
  }

  if (!state.summary) {
    if (state.uploadedCsv) {
      elements.summaryText.textContent = `${state.uploadedLeadCount || 0} leads ready.`;
      return;
    }
    elements.summaryText.textContent = "Upload a CSV, then start a campaign.";
    return;
  }

  const skippedCount = state.summary.skippedCount || 0;
  const pendingLeadCount = state.summary.pendingLeadCount ?? state.pendingLeadCount ?? 0;
  const displayedLeadCount = state.uploadedLeadCount ?? state.summary.totalLeads;
  elements.summaryText.textContent = [
    `${displayedLeadCount} leads`,
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

function isCompletedCall(lead) {
  return lead.lastCallStatus === "completed";
}

function getLeadSortTime(lead) {
  const value = lead.completedAt || lead.updatedAt || "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getIntentSortPriority(lead) {
  const intent = String(lead.lastIntent || "").toLowerCase();
  const callStatus = String(lead.lastCallStatus || "").toLowerCase();
  const status = String(lead.status || "").toLowerCase();

  if (intent === "yes") {
    return 0;
  }

  if (intent === "no") {
    return 1;
  }

  if (intent === "v/f" || callStatus === "voicemail" || status === "voicemail") {
    return 2;
  }

  if (["failed", "no-answer", "busy", "canceled", "call-create-failed"].includes(callStatus)) {
    return 3;
  }

  return 4;
}

function sortRecurringLeads(leads) {
  const sortMode = elements.recurringSort.value;
  const sortedLeads = [...(leads || [])];

  if (sortMode === "time_desc") {
    sortedLeads.sort((left, right) => getLeadSortTime(right) - getLeadSortTime(left));
  }

  if (sortMode === "intent") {
    sortedLeads.sort((left, right) => {
      const priorityDifference = getIntentSortPriority(left) - getIntentSortPriority(right);
      if (priorityDifference !== 0) {
        return priorityDifference;
      }
      return getLeadSortTime(right) - getLeadSortTime(left);
    });
  }

  return sortedLeads;
}

function appendDetail(meta, label, value) {
  if (!value) {
    return;
  }

  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  meta.append(term, description);
}

function openLeadDetail(leadId) {
  const lead = recurringLeadsById.get(leadId);
  if (!lead || !isCompletedCall(lead)) {
    return;
  }

  elements.leadDetailTitle.textContent = `${lead.leadName || "Lead"} transcript`;
  elements.leadDetailMeta.innerHTML = "";
  appendDetail(elements.leadDetailMeta, "Lead ID", lead.leadId);
  appendDetail(elements.leadDetailMeta, "Phone", lead.leadPhone);
  appendDetail(elements.leadDetailMeta, "Address", lead.leadAddress);
  appendDetail(elements.leadDetailMeta, "Intent", lead.lastIntent || "Unknown");
  appendDetail(elements.leadDetailMeta, "Preferred phone", lead.preferredPhone);
  appendDetail(elements.leadDetailMeta, "Call SID", lead.callSid);
  appendDetail(elements.leadDetailMeta, "Completed", lead.completedAt);
  elements.leadDetailTranscript.textContent = lead.callTranscript || "No transcript captured.";
  elements.leadDetailDialog.showModal();
}

async function removeRecurringLead(leadId) {
  const response = await fetch(recurringLeadRemoveUrl(leadId), { method: "POST" });
  const state = await readJson(response);
  renderState(state);
  showToast("Lead removed from recurring calls.");
}

async function saveRecurringCsv() {
  const response = await fetch(recurringCsvSaveUrl, { method: "POST" });
  const payload = await readJson(response);
  renderState(payload.state);
  showToast(`Saved ${payload.savedCsv.name}.`);
}

function renderRecurringCalls(leads) {
  elements.recurringLeadList.innerHTML = "";
  currentRecurringLeads = leads || [];
  const sortedLeads = sortRecurringLeads(currentRecurringLeads);
  recurringLeadsById = new Map(currentRecurringLeads.map((lead) => [lead.leadId, lead]));

  if (!currentRecurringLeads || currentRecurringLeads.length === 0) {
    elements.recurringSummary.textContent = "No leads uploaded.";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.className = "empty-cell";
    cell.textContent = "Upload a CSV to see the recurring call list.";
    row.appendChild(cell);
    elements.recurringLeadList.appendChild(row);
    return;
  }

  const pendingCount = currentRecurringLeads.filter((lead) => lead.isPending).length;
  const activeCount = currentRecurringLeads.filter((lead) => lead.isActive).length;
  elements.recurringSummary.textContent = `${pendingCount} pending | ${activeCount} active`;

  sortedLeads.forEach((lead) => {
    const row = document.createElement("tr");
    const canOpenDetails = isCompletedCall(lead);
    if (canOpenDetails) {
      row.className = "clickable-row";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Open transcript for ${lead.leadName || lead.leadId}`);
      row.addEventListener("click", () => openLeadDetail(lead.leadId));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openLeadDetail(lead.leadId);
        }
      });
    }

    const leadCell = document.createElement("td");
    const leadName = document.createElement("strong");
    const leadId = document.createElement("span");
    leadName.textContent = lead.leadName || "Unnamed lead";
    leadId.textContent = lead.leadId ? `ID ${lead.leadId}` : "No ID";
    leadCell.append(leadName, leadId);

    const phoneCell = document.createElement("td");
    phoneCell.textContent = lead.leadPhone || "No phone";

    const addressCell = document.createElement("td");
    addressCell.textContent = lead.leadAddress || "No address";

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

    const actionCell = document.createElement("td");
    const transcriptButton = document.createElement("button");
    transcriptButton.type = "button";
    transcriptButton.className = "secondary table-action";
    transcriptButton.textContent = "Transcript";
    transcriptButton.disabled = !canOpenDetails;
    transcriptButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openLeadDetail(lead.leadId);
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "danger table-action";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      removeButton.disabled = true;
      try {
        await removeRecurringLead(lead.leadId);
      } catch (error) {
        removeButton.disabled = false;
        showToast(error.message);
      }
    });
    actionCell.append(transcriptButton, removeButton);

    row.append(
      leadCell,
      phoneCell,
      addressCell,
      statusCell,
      callStatusCell,
      intentCell,
      roundCell,
      callSidCell,
      actionCell
    );
    elements.recurringLeadList.appendChild(row);
  });
}

function renderState(state) {
  const isRunning = state.status === "running";
  const isScheduled = state.status === "scheduled";
  const isBusy = isRunning || state.status === "stopping" || isScheduled;
  elements.statusValue.textContent = formatStatus(state.status);
  elements.leadCount.textContent = state.uploadedLeadCount || 0;
  elements.activeCalls.textContent = state.activeCallCount || 0;
  elements.campaignId.textContent = state.campaignId || "None";
  elements.startButton.disabled = isBusy || !state.uploadedCsv;
  elements.pauseButton.disabled = !isRunning;
  elements.pauseButton.textContent = state.isPaused ? "Resume Campaign" : "Pause Campaign";
  elements.endButton.disabled = !isBusy;
  elements.saveRecurringCsvButton.disabled =
    !state.recurringCallList || state.recurringCallList.length === 0;
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

elements.scheduleEnabled.addEventListener("change", () => {
  elements.scheduleStartAt.required = elements.scheduleEnabled.checked;
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
  if (elements.dealMachineCsv.checked) {
    formData.append("dealMachineCsv", "true");
  }

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
        loopIntervalHours: elements.loopIntervalHours.value,
        scheduleStartAt: elements.scheduleEnabled.checked ? elements.scheduleStartAt.value : "",
        scheduleTimezone: elements.scheduleEnabled.checked ? elements.scheduleTimezone.value : ""
      })
    });
    const state = await readJson(response);
    renderState(state);
    showToast(state.status === "scheduled" ? "Campaign scheduled." : "Campaign started.");
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

elements.pauseButton.addEventListener("click", async () => {
  try {
    const response = await fetch(pauseUrl, { method: "POST" });
    const state = await readJson(response);
    renderState(state);
    showToast(state.isPaused ? "Campaign paused." : "Campaign resumed.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.refreshButton.addEventListener("click", () => {
  refreshDashboard().catch((error) => showToast(error.message));
});

elements.recurringSort.addEventListener("change", () => {
  renderRecurringCalls(currentRecurringLeads);
});

elements.saveRecurringCsvButton.addEventListener("click", async () => {
  elements.saveRecurringCsvButton.disabled = true;
  try {
    await saveRecurringCsv();
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.saveRecurringCsvButton.disabled = currentRecurringLeads.length === 0;
  }
});

elements.recurringResizeHandle.addEventListener("pointerdown", startRecurringResize);
setRecurringTableHeight(recurringTableHeight.current);

const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (
  browserTimezone &&
  Array.from(elements.scheduleTimezone.options).some((option) => option.value === browserTimezone)
) {
  elements.scheduleTimezone.value = browserTimezone;
}
elements.scheduleStartAt.required = elements.scheduleEnabled.checked;

refreshDashboard().catch((error) => showToast(error.message));
setInterval(() => {
  refreshDashboard().catch(() => {});
}, 2500);
