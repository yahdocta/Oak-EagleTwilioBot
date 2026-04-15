const path = require("path");
const { parseLeadsCsv } = require("../campaigns/csvLeads");
const { createTwilioClient, startCampaign } = require("../campaigns/startCampaign");

const MAX_ACTIVITY_ITEMS = 300;

function makeCampaignId() {
  return `campaign-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function toPublicFile(filePath) {
  return {
    name: path.basename(filePath)
  };
}

class CampaignManager {
  constructor({ config, twilioClientFactory = createTwilioClient }) {
    this.config = config;
    this.twilioClientFactory = twilioClientFactory;
    this.status = "idle";
    this.currentCampaignId = null;
    this.uploadedCsvPath = null;
    this.uploadedLeadCount = null;
    this.activeCalls = new Map();
    this.activity = [];
    this.summary = null;
    this.stopRequested = false;
    this.twilioClient = null;
    this.runPromise = null;
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
    this.summary = null;
    this.log("info", "CSV uploaded", {
      file: path.basename(csvPath),
      leadCount: leads.length
    });

    return this.getState();
  }

  start(campaignId = makeCampaignId()) {
    if (this.status === "running" || this.status === "stopping") {
      throw new Error("A campaign is already running.");
    }

    if (!this.uploadedCsvPath) {
      throw new Error("Upload a CSV before starting a campaign.");
    }

    this.status = "running";
    this.currentCampaignId = campaignId || makeCampaignId();
    this.summary = null;
    this.stopRequested = false;
    this.activeCalls.clear();
    this.twilioClient = this.twilioClientFactory(this.config);
    this.log("info", "Campaign started", {
      campaignId: this.currentCampaignId,
      file: path.basename(this.uploadedCsvPath)
    });

    this.runPromise = startCampaign(this.uploadedCsvPath, {
      config: this.config,
      campaignId: this.currentCampaignId,
      twilioClient: this.twilioClient,
      shouldStop: () => this.stopRequested,
      onEvent: async (eventName, event) => this.handleCampaignEvent(eventName, event)
    })
      .then((summary) => {
        this.summary = summary;
        this.status = this.stopRequested ? "stopped" : "completed";
        this.log("info", this.stopRequested ? "Campaign stopped" : "Campaign completed", {
          campaignId: this.currentCampaignId,
          totalLeads: summary.totalLeads,
          successCount: summary.successCount,
          failureCount: summary.failureCount,
          skippedCount: summary.skippedCount || 0
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
        this.runPromise = null;
      });

    return this.getState();
  }

  async stop() {
    if (this.status !== "running" && this.status !== "stopping") {
      throw new Error("No campaign is currently running.");
    }

    this.stopRequested = true;
    this.status = "stopping";
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
      this.log("warn", "Lead skipped", {
        campaignId: event.campaignId,
        leadId: lead.lead_id,
        leadName: lead.lead_name,
        phone: lead.lead_phone
      });
    }
  }

  getState() {
    return {
      status: this.status,
      campaignId: this.currentCampaignId,
      uploadedCsv: this.uploadedCsvPath ? toPublicFile(this.uploadedCsvPath) : null,
      uploadedLeadCount: this.uploadedLeadCount,
      activeCallCount: this.activeCalls.size,
      stopRequested: this.stopRequested,
      summary: this.summary,
      activity: this.activity
    };
  }
}

module.exports = {
  CampaignManager
};
