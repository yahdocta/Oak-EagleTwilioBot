const twilio = require("twilio");
const pLimit = require("p-limit");
const { parseLeadsCsv } = require("./csvLeads");
const { logger } = require("../utils/logger");

function createTwilioClient(config) {
  return twilio(config.twilio.accountSid, config.twilio.authToken);
}

async function startCampaign(csvPath, options) {
  const { config, campaignId, twilioClient = createTwilioClient(config) } = options;
  const limit = pLimit(config.batch.maxConcurrency);
  const leads = parseLeadsCsv(csvPath);

  const results = await Promise.all(
    leads.map((lead) =>
      limit(async () => {
        try {
          const call = await twilioClient.calls.create({
            to: lead.lead_phone,
            from: config.twilio.fromNumber,
            machineDetection: config.twilio.amdMode,
            url: `${config.urls.publicBase}twilio/voice/outbound?lead_id=${encodeURIComponent(
              lead.lead_id
            )}&lead_name=${encodeURIComponent(lead.lead_name)}&lead_phone=${encodeURIComponent(
              lead.lead_phone
            )}&campaign_id=${encodeURIComponent(campaignId || "")}`,
            statusCallback: config.urls.statusCallback,
            statusCallbackMethod: "POST"
          });

          return { ok: true, lead, callSid: call.sid };
        } catch (error) {
          logger.error("campaign.call_create_failed", {
            campaignId,
            leadId: lead.lead_id,
            message: error.message
          });
          return { ok: false, lead, error: error.message };
        }
      })
    )
  );

  const successCount = results.filter((result) => result.ok).length;
  const failureCount = results.length - successCount;

  return {
    campaignId,
    totalLeads: leads.length,
    successCount,
    failureCount,
    results
  };
}

module.exports = {
  startCampaign,
  createTwilioClient
};
