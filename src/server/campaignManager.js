const path = require("path");
const { parseLeadsCsv } = require("../campaigns/csvLeads");
const { createTwilioClient, startCampaign } = require("../campaigns/startCampaign");

const MAX_ACTIVITY_ITEMS = 300;
const DEFAULT_LOOP_INTERVAL_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

function makeCampaignId() {
  return `campaign-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function toPublicFile(filePath) {
  return {
    name: path.basename(filePath)
  };
}

class CampaignManager {
  constructor({ config, twilioClientFactory = createTwilioClient, sleep = null }) {
    this.config = config;
    this.twilioClientFactory = twilioClientFactory;
    this.sleep = sleep;
    this.status = "idle";
    this.currentCampaignId = null;
    this.uploadedCsvPath = null;
    this.uploadedLeadCount = null;
    this.uploadedLeads = [];
    this.activeCalls = new Map();
    this.pendingLeadIds = new Set();
    this.leadStatuses = new Map();
    this.activity = [];
    this.summary = null;
    this.stopRequested = false;
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
  }

  log(level, message, meta = {}) {
    this.activity.unshift({
      timestamp: new Date().toISOString(),
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

    if (!this.uploadedCsvPath) {
      throw new Error("Upload a CSV before starting a campaign.");
    }

    const loopEnabled = Boolean(options.loopEnabled);
    const loopIntervalHours = normalizeLoopIntervalHours(options.loopIntervalHours);

    this.status = "running";
    this.currentCampaignId = campaignId || makeCampaignId();
    this.summary = null;
    this.stopRequested = false;
    this.activeCalls.clear();
    this.pendingLeadIds = new Set(this.uploadedLeads.map((lead) => lead.lead_id));
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

  async stop() {
    if (this.status !== "running" && this.status !== "stopping") {
      throw new Error("No campaign is currently running.");
    }

    this.stopRequested = true;
    this.status = "stopping";
    this.clearLoopWait();
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
        callSid: outcome.call_sid
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
        callSid: outcome.call_sid
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
        callSid: outcome.call_sid
      });
    }

    this.log("info", "Lead kept for next loop", {
      campaignId: outcome.campaign_id,
      leadId,
      callSid: outcome.call_sid,
      callStatus: outcome.call_status,
      interestIntent: outcome.interest_intent,
      pendingLeadCount: this.pendingLeadIds.size
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
      round: existing.round || 0,
      ...updates,
      updatedAt: new Date().toISOString()
    });
  }

  getRecurringCallList() {
    return this.uploadedLeads.map((lead) => {
      const status = this.leadStatuses.get(lead.lead_id) || {};
      return {
        leadId: lead.lead_id,
        leadName: lead.lead_name,
        leadPhone: lead.lead_phone,
        status: status.status || "ready",
        lastCallStatus: status.lastCallStatus || "",
        lastIntent: status.lastIntent || "",
        callSid: status.callSid || "",
        round: status.round || 0,
        isPending: this.pendingLeadIds.has(lead.lead_id),
        isActive: Array.from(this.activeCalls.values()).some(
          (activeLead) => activeLead.lead_id === lead.lead_id
        ),
        updatedAt: status.updatedAt || ""
      };
    });
  }

  getState() {
    return {
      status: this.status,
      campaignId: this.currentCampaignId,
      uploadedCsv: this.uploadedCsvPath ? toPublicFile(this.uploadedCsvPath) : null,
      uploadedLeadCount: this.uploadedLeadCount,
      activeCallCount: this.activeCalls.size,
      pendingLeadCount: this.pendingLeadIds.size,
      stopRequested: this.stopRequested,
      loopEnabled: this.loopEnabled,
      loopIntervalHours: this.loopIntervalHours,
      loopRound: this.loopRound,
      removedInterestedCount: this.removedInterestedCount,
      removedNotInterestedCount: this.removedNotInterestedCount,
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

module.exports = {
  CampaignManager
};
