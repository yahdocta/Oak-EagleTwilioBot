const fs = require("fs");
const path = require("path");
const { parseLeadsCsv } = require("../campaigns/csvLeads");
const { createTwilioClient, startCampaign } = require("../campaigns/startCampaign");

const MAX_ACTIVITY_ITEMS = 300;
const DEFAULT_LOOP_INTERVAL_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_RECURRING_EXPORT_DIR = path.resolve("campaign-inputs", "exports");
const RECURRING_CSV_COLUMNS = [
  "lead_id",
  "lead_name",
  "lead_phone",
  "lead_address",
  "lead_city",
  "status",
  "last_call_status",
  "last_intent",
  "call_sid",
  "round",
  "is_pending",
  "is_active",
  "completed_at",
  "preferred_phone",
  "call_transcript",
  "updated_at"
];

function makeCampaignId() {
  return `campaign-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function toPublicFile(filePath) {
  return {
    name: path.basename(filePath)
  };
}

function sanitizeExportName(value) {
  return (
    String(value || "recurring-calls")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "recurring-calls"
  );
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function serializeRowsToCsv(rows) {
  const lines = [
    RECURRING_CSV_COLUMNS.join(","),
    ...rows.map((row) => RECURRING_CSV_COLUMNS.map((column) => csvCell(row[column])).join(","))
  ];
  return `${lines.join("\n")}\n`;
}

class CampaignManager {
  constructor({
    config,
    twilioClientFactory = createTwilioClient,
    sleep = null,
    now = () => new Date(),
    setTimer = setTimeout,
    clearTimer = clearTimeout
  }) {
    this.config = config;
    this.twilioClientFactory = twilioClientFactory;
    this.sleep = sleep;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.status = "idle";
    this.currentCampaignId = null;
    this.uploadedCsvPath = null;
    this.uploadedLeadCount = null;
    this.uploadedLeads = [];
    this.activeCalls = new Map();
    this.pendingLeadIds = new Set();
    this.removedLeadIds = new Set();
    this.leadStatuses = new Map();
    this.activity = [];
    this.summary = null;
    this.stopRequested = false;
    this.isPaused = false;
    this.pauseResolve = null;
    this.twilioClient = null;
    this.runPromise = null;
    this.loopEnabled = false;
    this.loopIntervalHours = DEFAULT_LOOP_INTERVAL_HOURS;
    this.loopIntervalMs = DEFAULT_LOOP_INTERVAL_HOURS * HOUR_MS;
    this.loopRound = 0;
    this.removedInterestedCount = 0;
    this.removedNotInterestedCount = 0;
    this.intervalTimer = null;
    this.intervalResolve = null;
    this.scheduleTimer = null;
    this.scheduledStartAt = null;
    this.scheduledTimezone = null;
    this.scheduledCampaignId = null;
    this.scheduledOptions = null;
    this.lastRecurringCsv = null;
  }

  log(level, message, meta = {}) {
    this.activity.unshift({
      timestamp: this.now().toISOString(),
      level,
      message,
      meta
    });

    if (this.activity.length > MAX_ACTIVITY_ITEMS) {
      this.activity.length = MAX_ACTIVITY_ITEMS;
    }
  }

  setUploadedCsv(csvPath) {
    const leads = parseLeadsCsv(csvPath);
    this.uploadedCsvPath = csvPath;
    this.uploadedLeadCount = leads.length;
    this.uploadedLeads = leads;
    this.lastRecurringCsv = null;
    this.removedLeadIds.clear();
    this.leadStatuses = new Map(
      leads.map((lead) => [
        lead.lead_id,
        {
          status: "ready",
          lastCallStatus: "",
          lastIntent: "",
          callSid: "",
          round: 0,
          updatedAt: new Date().toISOString()
        }
      ])
    );
    this.summary = null;
    this.log("info", "CSV uploaded", {
      file: path.basename(csvPath),
      leadCount: leads.length
    });

    return this.getState();
  }

  start(campaignId = makeCampaignId(), options = {}) {
    if (this.status === "running" || this.status === "stopping") {
      throw new Error("A campaign is already running.");
    }

    if (this.status === "scheduled") {
      throw new Error("A campaign is already scheduled.");
    }

    if (!this.uploadedCsvPath) {
      throw new Error("Upload a CSV before starting a campaign.");
    }

    const loopEnabled = Boolean(options.loopEnabled);
    const loopIntervalHours = normalizeLoopIntervalHours(options.loopIntervalHours);
    const schedule = normalizeSchedule(options.scheduleStartAt, options.scheduleTimezone, this.now());

    if (schedule) {
      return this.schedule(campaignId, {
        loopEnabled,
        loopIntervalHours,
        scheduledStartAt: schedule.startAt,
        scheduledTimezone: schedule.timezone
      });
    }

    return this.startNow(campaignId, { loopEnabled, loopIntervalHours });
  }

  schedule(campaignId = makeCampaignId(), options) {
    this.clearScheduledTimer();

    this.status = "scheduled";
    this.currentCampaignId = campaignId || makeCampaignId();
    this.summary = null;
    this.stopRequested = false;
    this.isPaused = false;
    this.clearPauseWait();
    this.activeCalls.clear();
    this.pendingLeadIds = new Set(this.getCallableLeads().map((lead) => lead.lead_id));
    this.uploadedLeads.forEach((lead) => {
      this.setLeadStatus(lead.lead_id, {
        status: "scheduled",
        lastCallStatus: "",
        lastIntent: "",
        callSid: "",
        round: 0
      });
    });
    this.loopEnabled = options.loopEnabled;
    this.loopIntervalHours = options.loopIntervalHours;
    this.loopIntervalMs = this.loopIntervalHours * HOUR_MS;
    this.loopRound = 0;
    this.removedInterestedCount = 0;
    this.removedNotInterestedCount = 0;
    this.scheduledStartAt = options.scheduledStartAt.toISOString();
    this.scheduledTimezone = options.scheduledTimezone;
    this.scheduledCampaignId = this.currentCampaignId;
    this.scheduledOptions = {
      loopEnabled: this.loopEnabled,
      loopIntervalHours: this.loopIntervalHours
    };

    const delayMs = Math.max(0, options.scheduledStartAt.getTime() - this.now().getTime());
    this.scheduleTimer = this.setTimer(() => this.launchScheduledCampaign(), delayMs);
    if (this.scheduleTimer && typeof this.scheduleTimer.unref === "function") {
      this.scheduleTimer.unref();
    }

    this.log("info", "Campaign scheduled", {
      campaignId: this.currentCampaignId,
      file: path.basename(this.uploadedCsvPath),
      scheduledStartAt: this.scheduledStartAt,
      scheduledTimezone: this.scheduledTimezone,
      loopEnabled: this.loopEnabled,
      loopIntervalHours: this.loopEnabled ? this.loopIntervalHours : null
    });

    return this.getState();
  }

  launchScheduledCampaign() {
    if (this.status !== "scheduled") {
      return;
    }

    const campaignId = this.scheduledCampaignId || this.currentCampaignId || makeCampaignId();
    const options = this.scheduledOptions || {};
    this.scheduleTimer = null;
    this.scheduledStartAt = null;
    this.scheduledTimezone = null;
    this.scheduledCampaignId = null;
    this.scheduledOptions = null;

    try {
      this.startNow(campaignId, options);
    } catch (error) {
      this.status = "failed";
      this.log("error", "Scheduled campaign failed to start", {
        campaignId,
        error: error.message
      });
    }
  }

  startNow(campaignId = makeCampaignId(), options = {}) {
    const loopEnabled = Boolean(options.loopEnabled);
    const loopIntervalHours = normalizeLoopIntervalHours(options.loopIntervalHours);

    this.status = "running";
    this.currentCampaignId = campaignId || makeCampaignId();
    this.summary = null;
    this.stopRequested = false;
    this.isPaused = false;
    this.clearPauseWait();
    this.activeCalls.clear();
    this.pendingLeadIds = new Set(this.getCallableLeads().map((lead) => lead.lead_id));
    this.uploadedLeads.forEach((lead) => {
      this.setLeadStatus(lead.lead_id, {
        status: "pending",
        lastCallStatus: "",
        lastIntent: "",
        callSid: "",
        round: 0
      });
    });
    this.twilioClient = this.twilioClientFactory(this.config);
    this.loopEnabled = loopEnabled;
    this.loopIntervalHours = loopIntervalHours;
    this.loopIntervalMs = this.loopIntervalHours * HOUR_MS;
    this.loopRound = 0;
    this.removedInterestedCount = 0;
    this.removedNotInterestedCount = 0;
    this.log("info", "Campaign started", {
      campaignId: this.currentCampaignId,
      file: path.basename(this.uploadedCsvPath),
      loopEnabled: this.loopEnabled,
      loopIntervalHours: this.loopEnabled ? this.loopIntervalHours : null
    });

    this.runPromise = this.runCampaignLoop()
      .then((summary) => {
        this.summary = summary;
        this.status = this.stopRequested ? "stopped" : "completed";
        this.log("info", this.stopRequested ? "Campaign stopped" : "Campaign completed", {
          campaignId: this.currentCampaignId,
          totalLeads: summary.totalLeads,
          successCount: summary.successCount,
          failureCount: summary.failureCount,
          skippedCount: summary.skippedCount || 0,
          pendingLeadCount: summary.pendingLeadCount || 0
        });
      })
      .catch((error) => {
        this.status = "failed";
        this.summary = null;
        this.log("error", "Campaign failed", {
          campaignId: this.currentCampaignId,
          error: error.message
        });
      })
      .finally(() => {
        this.activeCalls.clear();
        this.isPaused = false;
        this.clearPauseWait();
        this.scheduledStartAt = null;
        this.scheduledTimezone = null;
        this.scheduledCampaignId = null;
        this.scheduledOptions = null;
        if (!this.loopEnabled) {
          this.pendingLeadIds.clear();
        }
        this.runPromise = null;
      });

    return this.getState();
  }

  async runCampaignLoop() {
    let lastSummary = {
      campaignId: this.currentCampaignId,
      totalLeads: this.uploadedLeads.length,
      successCount: 0,
      failureCount: 0,
      results: []
    };

    while (!this.stopRequested && this.pendingLeadIds.size > 0) {
      await this.waitWhilePaused();

      if (this.stopRequested) {
        break;
      }

      const activeLeadIds = new Set(
        Array.from(this.activeCalls.values()).map((lead) => lead.lead_id)
      );
      const leadsForRound = this.uploadedLeads.filter(
        (lead) => this.pendingLeadIds.has(lead.lead_id) && !activeLeadIds.has(lead.lead_id)
      );

      if (leadsForRound.length > 0) {
        this.loopRound += 1;
        this.log("info", this.loopEnabled ? "Campaign loop round started" : "Campaign dial started", {
          campaignId: this.currentCampaignId,
          round: this.loopRound,
          leadCount: leadsForRound.length,
          pendingLeadCount: this.pendingLeadIds.size
        });

        lastSummary = await startCampaign(this.uploadedCsvPath, {
          config: this.config,
          campaignId: this.currentCampaignId,
          twilioClient: this.twilioClient,
          shouldStop: () => this.stopRequested,
          waitIfPaused: () => this.waitWhilePaused(),
          onEvent: async (eventName, event) => this.handleCampaignEvent(eventName, event),
          leads: leadsForRound
        });
      }

      if (!this.loopEnabled || this.stopRequested || this.pendingLeadIds.size === 0) {
        break;
      }

      this.log("info", "Campaign waiting for next loop", {
        campaignId: this.currentCampaignId,
        intervalHours: this.loopIntervalHours,
        pendingLeadCount: this.pendingLeadIds.size,
        activeCallCount: this.activeCalls.size
      });
      await this.waitForLoopInterval(this.loopIntervalMs);
    }

    return {
      ...lastSummary,
      loopEnabled: this.loopEnabled,
      loopRound: this.loopRound,
      pendingLeadCount: this.loopEnabled ? this.pendingLeadIds.size : 0,
      removedInterestedCount: this.removedInterestedCount,
      removedNotInterestedCount: this.removedNotInterestedCount
    };
  }

  waitForLoopInterval(ms) {
    if (this.sleep) {
      return this.sleep(ms);
    }

    return new Promise((resolve) => {
      this.intervalResolve = resolve;
      this.intervalTimer = setTimeout(() => {
        this.intervalTimer = null;
        this.intervalResolve = null;
        resolve();
      }, ms);
      if (typeof this.intervalTimer.unref === "function") {
        this.intervalTimer.unref();
      }
    });
  }

  clearLoopWait() {
    if (this.intervalTimer) {
      clearTimeout(this.intervalTimer);
      this.intervalTimer = null;
    }

    if (this.intervalResolve) {
      const resolve = this.intervalResolve;
      this.intervalResolve = null;
      resolve();
    }
  }

  clearScheduledTimer() {
    if (this.scheduleTimer) {
      this.clearTimer(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  waitWhilePaused() {
    if (!this.isPaused || this.stopRequested) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.pauseResolve = resolve;
    });
  }

  clearPauseWait() {
    if (this.pauseResolve) {
      const resolve = this.pauseResolve;
      this.pauseResolve = null;
      resolve();
    }
  }

  togglePause() {
    if (this.status !== "running") {
      throw new Error("No campaign is currently running.");
    }

    if (this.isPaused) {
      this.isPaused = false;
      this.clearPauseWait();
      this.log("info", "Campaign resumed", {
        campaignId: this.currentCampaignId,
        pendingLeadCount: this.pendingLeadIds.size,
        activeCallCount: this.activeCalls.size
      });
      return this.getState();
    }

    this.isPaused = true;
    this.log("warn", "Campaign paused", {
      campaignId: this.currentCampaignId,
      pendingLeadCount: this.pendingLeadIds.size,
      activeCallCount: this.activeCalls.size
    });
    return this.getState();
  }

  async stop() {
    if (this.status === "scheduled") {
      const campaignId = this.currentCampaignId;
      this.clearScheduledTimer();
      this.status = "idle";
      this.stopRequested = false;
      this.currentCampaignId = null;
      this.scheduledStartAt = null;
      this.scheduledTimezone = null;
      this.scheduledCampaignId = null;
      this.scheduledOptions = null;
      this.pendingLeadIds.clear();
      this.uploadedLeads.forEach((lead) => {
        this.setLeadStatus(lead.lead_id, {
          status: "ready",
          lastCallStatus: "",
          lastIntent: "",
          callSid: "",
          round: 0
        });
      });
      this.log("warn", "Scheduled campaign cancelled", {
        campaignId
      });
      return this.getState();
    }

    if (this.status !== "running" && this.status !== "stopping") {
      throw new Error("No campaign is currently running.");
    }

    this.stopRequested = true;
    this.status = "stopping";
    this.isPaused = false;
    this.clearLoopWait();
    this.clearPauseWait();
    this.log("warn", "Campaign stop requested", {
      campaignId: this.currentCampaignId,
      activeCallCount: this.activeCalls.size
    });

    await Promise.allSettled(
      Array.from(this.activeCalls.keys()).map(async (callSid) => {
        try {
          await this.twilioClient.calls(callSid).update({ status: "completed" });
          this.log("info", "Active call ended", { campaignId: this.currentCampaignId, callSid });
        } catch (error) {
          this.log("error", "Could not end active call", {
            campaignId: this.currentCampaignId,
            callSid,
            error: error.message
          });
        }
      })
    );

    return this.getState();
  }

  handleCampaignEvent(eventName, event) {
    const lead = event.lead || {};
    if (eventName === "campaign.call_creating") {
      this.setLeadStatus(lead.lead_id, {
        status: "calling",
        round: this.loopRound
      });
      this.log("info", "Creating call", {
        campaignId: event.campaignId,
        leadId: lead.lead_id,
        leadName: lead.lead_name,
        phone: lead.lead_phone
      });
      return;
    }

    if (eventName === "campaign.call_created") {
      this.activeCalls.set(event.callSid, lead);
      this.setLeadStatus(lead.lead_id, {
        status: "active",
        callSid: event.callSid,
        round: this.loopRound
      });
      this.log("info", "Call created", {
        campaignId: event.campaignId,
        leadId: lead.lead_id,
        leadName: lead.lead_name,
        phone: lead.lead_phone,
        callSid: event.callSid
      });
      return;
    }

    if (eventName === "campaign.call_create_failed") {
      this.setLeadStatus(lead.lead_id, {
        status: this.loopEnabled ? "retrying" : "call_failed",
        lastCallStatus: "call-create-failed",
        lastIntent: "",
        round: this.loopRound
      });
      this.log("error", "Call creation failed", {
        campaignId: event.campaignId,
        leadId: lead.lead_id,
        leadName: lead.lead_name,
        phone: lead.lead_phone,
        error: event.error
      });
      return;
    }

    if (eventName === "campaign.lead_skipped") {
      this.setLeadStatus(lead.lead_id, {
        status: "skipped",
        round: this.loopRound
      });
      this.log("warn", "Lead skipped", {
        campaignId: event.campaignId,
        leadId: lead.lead_id,
        leadName: lead.lead_name,
        phone: lead.lead_phone
      });
    }
  }

  handleCallOutcome(outcome) {
    if (!outcome || outcome.campaign_id !== this.currentCampaignId) {
      return;
    }

    if (outcome.call_sid) {
      this.activeCalls.delete(outcome.call_sid);
    }

    const leadId = outcome.lead_id;
    const intent = String(outcome.interest_intent || "").toLowerCase();
    if (leadId && intent === "yes") {
      if (this.pendingLeadIds.delete(leadId)) {
        this.removedInterestedCount += 1;
      }
      this.setLeadStatus(leadId, {
        status: "logged",
        lastCallStatus: outcome.call_status,
        lastIntent: outcome.interest_intent,
        callSid: outcome.call_sid,
        callTranscript: outcome.call_transcript || "",
        preferredPhone: outcome.preferred_phone || "",
        completedAt: outcome.timestamp_utc || ""
      });
      if (this.pendingLeadIds.size === 0) {
        this.clearLoopWait();
      }
      this.log("info", "Logging lead", {
        campaignId: outcome.campaign_id,
        leadId,
        callSid: outcome.call_sid,
        pendingLeadCount: this.pendingLeadIds.size
      });
      return;
    }

    if (leadId && intent === "no") {
      if (this.pendingLeadIds.delete(leadId)) {
        this.removedNotInterestedCount += 1;
      }
      this.setLeadStatus(leadId, {
        status: "declined",
        lastCallStatus: outcome.call_status,
        lastIntent: outcome.interest_intent,
        callSid: outcome.call_sid,
        callTranscript: outcome.call_transcript || "",
        preferredPhone: outcome.preferred_phone || "",
        completedAt: outcome.timestamp_utc || ""
      });
      if (this.pendingLeadIds.size === 0) {
        this.clearLoopWait();
      }
      this.log("info", "Lead declined and removed", {
        campaignId: outcome.campaign_id,
        leadId,
        callSid: outcome.call_sid,
        pendingLeadCount: this.pendingLeadIds.size
      });
      return;
    }

    if (leadId) {
      this.setLeadStatus(leadId, {
        status: this.loopEnabled ? "waiting_next_loop" : "unresolved",
        lastCallStatus: outcome.call_status,
        lastIntent: outcome.interest_intent,
        callSid: outcome.call_sid,
        callTranscript: outcome.call_transcript || "",
        preferredPhone: outcome.preferred_phone || "",
        completedAt: outcome.timestamp_utc || ""
      });
    }

    this.log("info", this.loopEnabled ? "Lead kept for next loop" : "Lead unresolved after call", {
      campaignId: outcome.campaign_id,
      leadId,
      callSid: outcome.call_sid,
      callStatus: outcome.call_status,
      interestIntent: outcome.interest_intent,
      pendingLeadCount: this.loopEnabled ? this.pendingLeadIds.size : 0
    });
  }

  setLeadStatus(leadId, updates) {
    if (!leadId) {
      return;
    }

    const existing = this.leadStatuses.get(leadId) || {};
    this.leadStatuses.set(leadId, {
      status: existing.status || "ready",
      lastCallStatus: existing.lastCallStatus || "",
      lastIntent: existing.lastIntent || "",
      callSid: existing.callSid || "",
      callTranscript: existing.callTranscript || "",
      preferredPhone: existing.preferredPhone || "",
      completedAt: existing.completedAt || "",
      round: existing.round || 0,
      ...updates,
      updatedAt: this.now().toISOString()
    });
  }

  getCallableLeads() {
    return this.uploadedLeads.filter((lead) => !this.removedLeadIds.has(lead.lead_id));
  }

  removeRecurringLead(leadId) {
    const normalizedLeadId = String(leadId || "").trim();
    const lead = this.uploadedLeads.find((candidate) => candidate.lead_id === normalizedLeadId);
    if (!lead || this.removedLeadIds.has(normalizedLeadId)) {
      throw new Error("Lead was not found in the recurring call list.");
    }

    this.removedLeadIds.add(normalizedLeadId);
    this.pendingLeadIds.delete(normalizedLeadId);
    this.setLeadStatus(normalizedLeadId, {
      status: "removed",
      lastCallStatus: "",
      lastIntent: "",
      callSid: ""
    });
    if (this.pendingLeadIds.size === 0) {
      this.clearLoopWait();
    }
    this.log("warn", "Lead removed from recurring calls", {
      campaignId: this.currentCampaignId,
      leadId: normalizedLeadId,
      leadName: lead.lead_name,
      pendingLeadCount: this.pendingLeadIds.size
    });

    return this.getState();
  }

  getRecurringCallList() {
    return this.getCallableLeads().map((lead) => {
      const status = this.leadStatuses.get(lead.lead_id) || {};
      return {
        leadId: lead.lead_id,
        leadName: lead.lead_name,
        leadPhone: lead.lead_phone,
        leadAddress: lead.lead_address || "",
        leadCity: lead.lead_city || "",
        status: status.status || "ready",
        lastCallStatus: status.lastCallStatus || "",
        lastIntent: status.lastIntent || "",
        callSid: status.callSid || "",
        callTranscript: status.callTranscript || "",
        preferredPhone: status.preferredPhone || "",
        completedAt: status.completedAt || "",
        round: status.round || 0,
        isPending: this.pendingLeadIds.has(lead.lead_id),
        isActive: Array.from(this.activeCalls.values()).some(
          (activeLead) => activeLead.lead_id === lead.lead_id
        ),
        updatedAt: status.updatedAt || ""
      };
    });
  }

  saveRecurringCallListCsv(options = {}) {
    const outputDir = options.outputDir || DEFAULT_RECURRING_EXPORT_DIR;
    const createdAt = this.now().toISOString();
    const timestamp = createdAt.replace(/[:.]/g, "-");
    const campaignName = sanitizeExportName(this.currentCampaignId || "recurring-calls");
    const filename = `${campaignName}-recurring-calls-${timestamp}.csv`;
    const filePath = path.join(outputDir, filename);
    const rows = this.getRecurringCallList().map((lead) => ({
      lead_id: lead.leadId,
      lead_name: lead.leadName,
      lead_phone: lead.leadPhone,
      lead_address: lead.leadAddress,
      lead_city: lead.leadCity,
      status: lead.status,
      last_call_status: lead.lastCallStatus,
      last_intent: lead.lastIntent,
      call_sid: lead.callSid,
      round: lead.round,
      is_pending: lead.isPending,
      is_active: lead.isActive,
      completed_at: lead.completedAt,
      preferred_phone: lead.preferredPhone,
      call_transcript: lead.callTranscript,
      updated_at: lead.updatedAt
    }));

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(filePath, serializeRowsToCsv(rows), "utf8");

    this.lastRecurringCsv = {
      name: filename,
      path: filePath,
      count: rows.length,
      createdAt
    };
    this.log("info", "Recurring call list saved", {
      campaignId: this.currentCampaignId,
      file: filename,
      leadCount: rows.length
    });

    return this.lastRecurringCsv;
  }

  getState() {
    const visibleLeadCount = this.uploadedCsvPath ? this.getCallableLeads().length : this.uploadedLeadCount;
    return {
      status: this.status,
      campaignId: this.currentCampaignId,
      uploadedCsv: this.uploadedCsvPath ? toPublicFile(this.uploadedCsvPath) : null,
      uploadedLeadCount: visibleLeadCount,
      activeCallCount: this.activeCalls.size,
      pendingLeadCount: this.pendingLeadIds.size,
      stopRequested: this.stopRequested,
      isPaused: this.isPaused,
      loopEnabled: this.loopEnabled,
      loopIntervalHours: this.loopIntervalHours,
      loopRound: this.loopRound,
      scheduledStartAt: this.scheduledStartAt,
      scheduledTimezone: this.scheduledTimezone,
      removedInterestedCount: this.removedInterestedCount,
      removedNotInterestedCount: this.removedNotInterestedCount,
      lastRecurringCsv: this.lastRecurringCsv,
      recurringCallList: this.getRecurringCallList(),
      summary: this.summary,
      activity: this.activity
    };
  }
}

function normalizeLoopIntervalHours(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return DEFAULT_LOOP_INTERVAL_HOURS;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Loop interval must be a positive number of hours.");
  }
  return parsed;
}

function normalizeSchedule(scheduleStartAt, scheduleTimezone, now) {
  if (scheduleStartAt === undefined || scheduleStartAt === null || String(scheduleStartAt).trim() === "") {
    return null;
  }

  const timezone = String(scheduleTimezone || "").trim();
  if (!timezone) {
    throw new Error("Schedule time zone is required.");
  }

  assertValidTimeZone(timezone);
  const startAt = zonedDateTimeToDate(String(scheduleStartAt).trim(), timezone);
  if (startAt.getTime() <= now.getTime()) {
    throw new Error("Schedule time must be in the future.");
  }

  return { startAt, timezone };
}

function assertValidTimeZone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch (error) {
    throw new Error("Schedule time zone must be a valid IANA time zone.");
  }
}

function zonedDateTimeToDate(value, timezone) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) {
    throw new Error("Schedule time must use YYYY-MM-DDTHH:mm format.");
  }

  const parts = {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
    hour: Number.parseInt(match[4], 10),
    minute: Number.parseInt(match[5], 10),
    second: match[6] ? Number.parseInt(match[6], 10) : 0
  };

  if (!isValidDateTimeParts(parts)) {
    throw new Error("Schedule time must be a valid calendar date and time.");
  }

  const localMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  let utcMs = localMs;
  for (let index = 0; index < 4; index += 1) {
    utcMs = localMs - getTimeZoneOffsetMs(timezone, new Date(utcMs));
  }

  const candidate = new Date(utcMs);
  const roundTrip = getTimeZoneParts(timezone, candidate);
  if (
    roundTrip.year !== parts.year ||
    roundTrip.month !== parts.month ||
    roundTrip.day !== parts.day ||
    roundTrip.hour !== parts.hour ||
    roundTrip.minute !== parts.minute ||
    roundTrip.second !== parts.second
  ) {
    throw new Error("Schedule time is not valid in the selected time zone.");
  }

  return candidate;
}

function isValidDateTimeParts(parts) {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  );
  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day &&
    date.getUTCHours() === parts.hour &&
    date.getUTCMinutes() === parts.minute &&
    date.getUTCSeconds() === parts.second
  );
}

function getTimeZoneOffsetMs(timezone, date) {
  const parts = getTimeZoneParts(timezone, date);
  const zonedMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return zonedMs - date.getTime();
}

function getTimeZoneParts(timezone, date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  const hour = Number.parseInt(values.hour, 10);
  return {
    year: Number.parseInt(values.year, 10),
    month: Number.parseInt(values.month, 10),
    day: Number.parseInt(values.day, 10),
    hour: hour === 24 ? 0 : hour,
    minute: Number.parseInt(values.minute, 10),
    second: Number.parseInt(values.second, 10)
  };
}

module.exports = {
  CampaignManager,
  normalizeSchedule
};
