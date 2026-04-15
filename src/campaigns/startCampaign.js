const twilio = require("twilio");
const pLimitImport = require("p-limit");
const pLimit = pLimitImport.default || pLimitImport;
const { parseLeadsCsv } = require("./csvLeads");
const { logger } = require("../utils/logger");

function createTwilioClient(config) {
  return twilio(config.twilio.accountSid, config.twilio.authToken);
}

function buildCallbackUrl(baseUrl, pathname, query) {
  const url = new URL(pathname, baseUrl);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).length > 0) {
      url.searchParams.append(key, String(value));
    }
  });
  return url.toString();
}

function appendQueryToUrl(urlString, query) {
  const url = new URL(urlString);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).length > 0) {
      url.searchParams.append(key, String(value));
    }
  });
  return url.toString();
}

async function startCampaign(csvPath, options) {
  const {
    config,
    campaignId,
    twilioClient = createTwilioClient(config),
    shouldStop = () => false,
    onEvent = () => {},
    leads: providedLeads = null
  } = options;
  const limit = pLimit(config.batch.maxConcurrency);
  const leads = providedLeads || parseLeadsCsv(csvPath);

  const results = await Promise.all(
    leads.map((lead, index) =>
      limit(async () => {
        if (shouldStop()) {
          const result = {
            ok: false,
            skipped: true,
            lead,
            error: "Campaign stopped before this lead was called."
          };
          await onEvent("campaign.lead_skipped", { campaignId, lead, index });
          return result;
        }

        try {
          await onEvent("campaign.call_creating", { campaignId, lead, index });
          const callbackQuery = {
            lead_id: lead.lead_id,
            lead_name: lead.lead_name,
            lead_phone: lead.lead_phone,
            lead_city: lead.lead_city,
            campaign_id: campaignId || ""
          };
          const call = await twilioClient.calls.create({
            to: lead.lead_phone,
            from: config.twilio.fromNumber,
            machineDetection: config.twilio.amdMode,
            asyncAmd: true,
            url: buildCallbackUrl(config.urls.publicBase, "/twilio/voice/outbound", callbackQuery),
            statusCallback: appendQueryToUrl(config.urls.statusCallback, callbackQuery),
            statusCallbackMethod: "POST",
            asyncAmdStatusCallback: buildCallbackUrl(
              config.urls.publicBase,
              "/twilio/voice/status",
              callbackQuery
            ),
            asyncAmdStatusCallbackMethod: "POST"
          });

          await onEvent("campaign.call_created", {
            campaignId,
            lead,
            index,
            callSid: call.sid
          });
          return { ok: true, lead, callSid: call.sid };
        } catch (error) {
          logger.error("campaign.call_create_failed", {
            campaignId,
            leadId: lead.lead_id,
            message: error.message
          });
          await onEvent("campaign.call_create_failed", {
            campaignId,
            lead,
            index,
            error: error.message
          });
          return { ok: false, lead, error: error.message };
        }
      })
    )
  );

  const successCount = results.filter((result) => result.ok).length;
  const skippedCount = results.filter((result) => result.skipped).length;
  const failureCount = results.length - successCount - skippedCount;

  const summary = {
    campaignId,
    totalLeads: leads.length,
    successCount,
    failureCount,
    results
  };

  if (skippedCount > 0) {
    summary.skippedCount = skippedCount;
  }

  return summary;
}

module.exports = {
  startCampaign,
  createTwilioClient
};
