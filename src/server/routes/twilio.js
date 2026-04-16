const express = require("express");
const { twiml } = require("twilio");
const twilioClientFactory = require("twilio");
const { config } = require("../../config");
const { logger } = require("../../utils/logger");
const { parseInterestIntent, parsePreferredPhone } = require("../../intent");
const {
  buildOutboundIntroPrompt,
  getOutboundIntroCity,
  OUTBOUND_INTRO_CITY_PREFIX_PROMPT,
  CONTACT_REQUEST_PROMPT,
  GOODBYE_PROMPT,
  INTENT_RETRY_PROMPT,
  CONTACT_RETRY_PROMPT,
  CONTACT_SUCCESS_PROMPT
} = require("../voicePrompts");

function toAnswerType(answeredBy) {
  const value = String(answeredBy || "").toLowerCase();
  if (!value) {
    return "unknown";
  }
  if (value.includes("machine")) {
    return "machine";
  }
  if (value.includes("human")) {
    return "human";
  }
  return "unknown";
}

function collectCallContext(req) {
  const source = { ...req.query, ...req.body };
  return {
    lead_id: source.lead_id || "",
    lead_name: source.lead_name || "",
    lead_phone: source.lead_phone || "",
    lead_address: source.lead_address || source.address || "",
    lead_city: source.lead_city || source.city || "",
    campaign_id: source.campaign_id || "",
    call_sid: source.CallSid || source.call_sid || "",
    call_status: source.CallStatus || source.call_status || "",
    answer_type: toAnswerType(source.AnsweredBy || source.answered_by),
    retry_count: Number.parseInt(source.retry_count || "0", 10) || 0
  };
}

function respondTwiml(res, voiceResponse) {
  res.type("text/xml");
  res.send(voiceResponse.toString());
}

function buildQuery(context, overrides = {}) {
  const params = new URLSearchParams();
  const merged = { ...context, ...overrides };
  Object.entries(merged).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).length > 0) {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

function addSpeech(voiceResponse, text, options) {
  const { config, promptAudioUrls } = options;
  const audioUrl = promptAudioUrls ? promptAudioUrls.get(text) : null;
  if (audioUrl) {
    voiceResponse.play(audioUrl);
    return;
  }

  voiceResponse.say({ voice: config.twilio.voice || undefined }, text);
}

function addPromptThenGather(voiceResponse, promptText, gatherOptions, redirectUrl, speechOptions) {
  addSpeech(voiceResponse, promptText, speechOptions);
  voiceResponse.gather(gatherOptions);
  voiceResponse.redirect({ method: "POST" }, redirectUrl);
}

function addOutboundIntroThenGather(voiceResponse, context, gatherOptions, redirectUrl, speechOptions) {
  const city = getOutboundIntroCity(context);
  if (!city) {
    addPromptThenGather(
      voiceResponse,
      buildOutboundIntroPrompt(context),
      gatherOptions,
      redirectUrl,
      speechOptions
    );
    return context;
  }

  const contextWithCity = { ...context, lead_city: city };
  addSpeech(voiceResponse, OUTBOUND_INTRO_CITY_PREFIX_PROMPT, speechOptions);
  voiceResponse.say({ voice: speechOptions.config.twilio.voice || undefined }, `${city}?`);
  voiceResponse.gather(gatherOptions);
  voiceResponse.redirect({ method: "POST" }, redirectUrl);
  return contextWithCity;
}

const TERMINAL_CALL_STATUSES = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);
const UNANSWERED_CALL_STATUSES = new Set(["busy", "no-answer", "canceled"]);
const callOutcomeState = new Map();
const finalizedCallSids = new Set();
const machineRedirectedCallSids = new Set();

function mergeCallOutcomeState(context, updates = {}) {
  if (!context.call_sid) {
    return;
  }

  const existing = callOutcomeState.get(context.call_sid) || {};
  callOutcomeState.set(context.call_sid, {
    lead_id: context.lead_id || existing.lead_id || "",
    lead_name: context.lead_name || existing.lead_name || "",
    lead_phone: context.lead_phone || existing.lead_phone || "",
    lead_address: context.lead_address || existing.lead_address || "",
    lead_city: context.lead_city || existing.lead_city || "",
    campaign_id: context.campaign_id || existing.campaign_id || "",
    preferred_phone: existing.preferred_phone || "",
    interest_intent: existing.interest_intent || "unknown",
    machine_detected: existing.machine_detected || false,
    intent_speech_received: existing.intent_speech_received || false,
    contact_speech_received: existing.contact_speech_received || false,
    call_transcript: existing.call_transcript || "",
    ...existing,
    ...updates
  });
}

function appendCallTranscript(context, label, transcript) {
  const text = String(transcript || "").trim();
  if (!context.call_sid || !text) {
    return;
  }

  const existing = callOutcomeState.get(context.call_sid) || {};
  const entry = `${label}: ${text}`;
  mergeCallOutcomeState(context, {
    call_transcript: existing.call_transcript ? `${existing.call_transcript}\n${entry}` : entry
  });
}

function toTerminalIntention(value, callStatus) {
  const normalizedCallStatus = String(callStatus || "").toLowerCase();
  if (normalizedCallStatus === "failed") {
    return "v/f";
  }

  if (UNANSWERED_CALL_STATUSES.has(normalizedCallStatus)) {
    return "no";
  }

  const normalized = String(value || "").toLowerCase();
  if (normalized === "yes") {
    return "yes";
  }
  if (normalized === "v/f") {
    return "v/f";
  }
  return "no";
}

function toCampaignInterestIntent(value, callStatus) {
  const normalizedCallStatus = String(callStatus || "").toLowerCase();
  if (UNANSWERED_CALL_STATUSES.has(normalizedCallStatus)) {
    return "unknown";
  }
  if (normalizedCallStatus === "failed") {
    return "v/f";
  }

  return String(value || "unknown").toLowerCase();
}

function toFinalCallStatus(callStatus, machineDetected) {
  if (machineDetected) {
    return "voicemail";
  }
  return String(callStatus || "").toLowerCase();
}

function hasConfirmedInterest(savedState) {
  if (!savedState || String(savedState.interest_intent || "").toLowerCase() !== "yes") {
    return false;
  }

  return Boolean(savedState.preferred_phone || savedState.contact_speech_received);
}

function createTwilioRouter({ sheetsAdapter, elevenLabsTts, promptAudioUrls, campaignManager }) {
  const router = express.Router();
  const twilioClient = twilioClientFactory(config.twilio.accountSid, config.twilio.authToken);
  const withErrorHandling =
    (handler) =>
    (req, res, next) =>
      Promise.resolve(handler(req, res, next)).catch(next);

  router.get(
    "/voice/audio/:promptId.mp3",
    withErrorHandling(async (req, res) => {
      if (!elevenLabsTts || !elevenLabsTts.enabled) {
        return res.status(404).json({ error: "ElevenLabs voice is not enabled." });
      }

      const audio = await elevenLabsTts.getAudioByKey(req.params.promptId);
      if (!audio) {
        return res.status(404).json({ error: "Unknown prompt." });
      }

      res.set("Content-Type", "audio/mpeg");
      res.set("Cache-Control", "public, max-age=3600");
      return res.status(200).send(audio);
    })
  );

  router.post(
    "/voice/outbound",
    withErrorHandling(async (req, res) => {
      const context = collectCallContext(req);
      const voiceResponse = new twiml.VoiceResponse();
      mergeCallOutcomeState(context);

      if (context.answer_type === "machine") {
        mergeCallOutcomeState(context, { interest_intent: "v/f", machine_detected: true });
        addSpeech(voiceResponse, config.twilio.voicemailText, { config, promptAudioUrls });
        voiceResponse.hangup();
        return respondTwiml(res, voiceResponse);
      }

      voiceResponse.pause({ length: 1 });
      const introContext = { ...context, lead_city: getOutboundIntroCity(context) || context.lead_city };
      if (introContext.lead_city !== context.lead_city) {
        mergeCallOutcomeState(context, { lead_city: introContext.lead_city });
      }
      const actionUrl = `/twilio/voice/intent?${buildQuery(introContext, { retry_count: 0 })}`;
      addOutboundIntroThenGather(voiceResponse, introContext, {
        input: "speech",
        speechTimeout: "auto",
        action: actionUrl,
        method: "POST",
        actionOnEmptyResult: true
      }, actionUrl, {
        config,
        promptAudioUrls
      });
      return respondTwiml(res, voiceResponse);
    })
  );

  router.post(
    "/voice/intent",
    withErrorHandling(async (req, res) => {
      const context = collectCallContext(req);
      const transcript = req.body.SpeechResult || "";
      const parsed = parseInterestIntent(transcript);
      const voiceResponse = new twiml.VoiceResponse();
      mergeCallOutcomeState(context, { intent_speech_received: Boolean(transcript.trim()) });
      appendCallTranscript(context, "Intent", transcript);

      if (parsed.intent === "yes") {
        mergeCallOutcomeState(context, { interest_intent: "yes" });
        const actionUrl = `/twilio/voice/contact?${buildQuery(context, {
          retry_count: 0,
          interest_intent: "yes",
          intent_confidence: parsed.confidence
        })}`;
        addPromptThenGather(voiceResponse, CONTACT_REQUEST_PROMPT, {
          input: "speech",
          speechTimeout: "auto",
          action: actionUrl,
          method: "POST",
          actionOnEmptyResult: true
        }, actionUrl, {
          config,
          promptAudioUrls
        });
        return respondTwiml(res, voiceResponse);
      }

      if (parsed.intent === "no") {
        mergeCallOutcomeState(context, { interest_intent: "no" });
        addSpeech(voiceResponse, GOODBYE_PROMPT, { config, promptAudioUrls });
        voiceResponse.hangup();
        return respondTwiml(res, voiceResponse);
      }

      if (context.retry_count < config.batch.intentMaxRetries) {
        const nextRetryCount = context.retry_count + 1;
        const actionUrl = `/twilio/voice/intent?${buildQuery(context, { retry_count: nextRetryCount })}`;
        addPromptThenGather(voiceResponse, INTENT_RETRY_PROMPT, {
          input: "speech",
          speechTimeout: "auto",
          action: actionUrl,
          method: "POST",
          actionOnEmptyResult: true
        }, actionUrl, { config, promptAudioUrls });
        return respondTwiml(res, voiceResponse);
      }

      mergeCallOutcomeState(context, { interest_intent: "unknown" });
      addSpeech(voiceResponse, GOODBYE_PROMPT, { config, promptAudioUrls });
      voiceResponse.hangup();
      return respondTwiml(res, voiceResponse);
    })
  );

  router.post(
    "/voice/contact",
    withErrorHandling(async (req, res) => {
      const context = collectCallContext(req);
      const transcript = req.body.SpeechResult || "";
      const parsedPhone = parsePreferredPhone(transcript);
      const voiceResponse = new twiml.VoiceResponse();
      mergeCallOutcomeState(context, {
        interest_intent: "yes",
        contact_speech_received: Boolean(transcript.trim())
      });
      appendCallTranscript(context, "Preferred phone", transcript);

      if (!parsedPhone.phoneNormalized && context.retry_count < config.batch.intentMaxRetries) {
        const nextRetryCount = context.retry_count + 1;
        const actionUrl = `/twilio/voice/contact?${buildQuery(context, { retry_count: nextRetryCount })}`;
        addPromptThenGather(voiceResponse, CONTACT_RETRY_PROMPT, {
          input: "speech",
          speechTimeout: "auto",
          action: actionUrl,
          method: "POST",
          actionOnEmptyResult: true
        }, actionUrl, { config, promptAudioUrls });
        return respondTwiml(res, voiceResponse);
      }

      mergeCallOutcomeState(context, {
        interest_intent: "yes",
        preferred_phone: parsedPhone.phoneNormalized || ""
      });
      addSpeech(voiceResponse, CONTACT_SUCCESS_PROMPT, { config, promptAudioUrls });
      voiceResponse.hangup();
      return respondTwiml(res, voiceResponse);
    })
  );

  async function statusHandler(req, res) {
    const context = collectCallContext(req);
    mergeCallOutcomeState(context, context.answer_type === "machine" ? { machine_detected: true } : {});

    const status = String(context.call_status || "").toLowerCase();
    if (
      context.answer_type === "machine" &&
      context.call_sid &&
      !TERMINAL_CALL_STATUSES.has(status) &&
      !machineRedirectedCallSids.has(context.call_sid)
    ) {
      try {
        const voicemailResponse = new twiml.VoiceResponse();
        addSpeech(voicemailResponse, config.twilio.voicemailText, { config, promptAudioUrls });
        voicemailResponse.hangup();
        await twilioClient.calls(context.call_sid).update({
          twiml: voicemailResponse.toString()
        });
        machineRedirectedCallSids.add(context.call_sid);
        mergeCallOutcomeState(context, { interest_intent: "v/f", machine_detected: true });
        logger.info("twilio.machine_redirected_to_voicemail", {
          callSid: context.call_sid,
          callStatus: context.call_status
        });
      } catch (error) {
        logger.error("twilio.machine_redirect_failed", {
          callSid: context.call_sid,
          message: error.message
        });
      }
    }

    if (!TERMINAL_CALL_STATUSES.has(status)) {
      logger.info("twilio.status.ignored_non_terminal", {
        callSid: context.call_sid,
        callStatus: context.call_status
      });
      res.status(204).send();
      return;
    }

    if (context.call_sid && finalizedCallSids.has(context.call_sid)) {
      logger.info("twilio.status.ignored_duplicate_terminal", {
        callSid: context.call_sid,
        callStatus: context.call_status
      });
      res.status(204).send();
      return;
    }

    const savedState = context.call_sid ? callOutcomeState.get(context.call_sid) : null;
    const finalCallStatus = toFinalCallStatus(context.call_status || status, savedState && savedState.machine_detected);
    const campaignInterestIntent = toCampaignInterestIntent(
      savedState && savedState.interest_intent,
      context.call_status
    );
    const confirmedInterest = hasConfirmedInterest(savedState);
    const resolvedCampaignInterestIntent =
      campaignInterestIntent === "yes" && !confirmedInterest ? "unknown" : campaignInterestIntent;
    const finalInterestIntent = toTerminalIntention(
      resolvedCampaignInterestIntent,
      context.call_status
    );
    const outcome = {
      lead_id: context.lead_id || (savedState && savedState.lead_id) || "",
      lead_name: context.lead_name || (savedState && savedState.lead_name) || "",
      lead_phone: context.lead_phone || (savedState && savedState.lead_phone) || "",
      lead_address: context.lead_address || (savedState && savedState.lead_address) || "",
      campaign_id: context.campaign_id || (savedState && savedState.campaign_id) || "",
      call_sid: context.call_sid,
      preferred_phone: (savedState && savedState.preferred_phone) || "",
      call_transcript: (savedState && savedState.call_transcript) || "",
      interest_intent: finalInterestIntent,
      call_status: finalCallStatus,
      timestamp_utc: new Date().toISOString()
    };

    if (confirmedInterest && finalInterestIntent === "yes") {
      await sheetsAdapter.appendCallOutcome(outcome);
    }

    if (campaignManager && typeof campaignManager.handleCallOutcome === "function") {
      campaignManager.handleCallOutcome({
        ...outcome,
        interest_intent: resolvedCampaignInterestIntent
      });
    }

    if (context.call_sid) {
      finalizedCallSids.add(context.call_sid);
      machineRedirectedCallSids.delete(context.call_sid);
      callOutcomeState.delete(context.call_sid);
    }
    logger.info("twilio.status.received", {
      callSid: context.call_sid,
      callStatus: context.call_status
    });
    res.status(204).send();
  }

  router.post("/voice/status", withErrorHandling(statusHandler));
  router.post("/status", withErrorHandling(statusHandler));

  return router;
}

module.exports = {
  createTwilioRouter
};
