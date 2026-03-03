const express = require("express");
const { twiml } = require("twilio");
const twilioClientFactory = require("twilio");
const { config } = require("../../config");
const { logger } = require("../../utils/logger");
const { parseInterestIntent, parsePreferredPhone } = require("../../intent");
const {
  OUTBOUND_INTRO_PROMPT,
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
  const { gather, config, promptAudioUrls } = options;
  const target = gather || voiceResponse;
  const audioUrl = promptAudioUrls ? promptAudioUrls.get(text) : null;
  if (audioUrl) {
    target.play(audioUrl);
    return;
  }

  target.say({ voice: config.twilio.voice || undefined }, text);
}

const TERMINAL_CALL_STATUSES = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);
const callOutcomeState = new Map();
const finalizedCallSids = new Set();
const machineRedirectedCallSids = new Set();

function mergeCallOutcomeState(context, updates = {}) {
  if (!context.call_sid) {
    return;
  }

  const existing = callOutcomeState.get(context.call_sid) || {};
  callOutcomeState.set(context.call_sid, {
    lead_name: context.lead_name || existing.lead_name || "",
    lead_phone: context.lead_phone || existing.lead_phone || "",
    preferred_phone: existing.preferred_phone || "",
    interest_intent: existing.interest_intent || "no",
    ...existing,
    ...updates
  });
}

function toTerminalIntention(value, callStatus) {
  if (String(callStatus || "").toLowerCase() === "failed") {
    return "v/f";
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

function createTwilioRouter({ sheetsAdapter, elevenLabsTts, promptAudioUrls }) {
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
        mergeCallOutcomeState(context, { interest_intent: "v/f" });
        addSpeech(voiceResponse, config.twilio.voicemailText, { config, promptAudioUrls });
        voiceResponse.hangup();
        return respondTwiml(res, voiceResponse);
      }

      voiceResponse.pause({ length: 1 });
      const gather = voiceResponse.gather({
        input: "speech",
        speechTimeout: "auto",
        action: `/twilio/voice/intent?${buildQuery(context, { retry_count: 0 })}`,
        method: "POST",
        actionOnEmptyResult: true
      });
      addSpeech(voiceResponse, OUTBOUND_INTRO_PROMPT, {
        gather,
        config,
        promptAudioUrls
      });
      voiceResponse.redirect(
        { method: "POST" },
        `/twilio/voice/intent?${buildQuery(context, { retry_count: 0 })}`
      );
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
      mergeCallOutcomeState(context);

      if (parsed.intent === "yes") {
        mergeCallOutcomeState(context, { interest_intent: "yes" });
        const gather = voiceResponse.gather({
          input: "speech",
          speechTimeout: "auto",
          action: `/twilio/voice/contact?${buildQuery(context, {
            retry_count: 0,
            interest_intent: "yes",
            intent_confidence: parsed.confidence
          })}`,
          method: "POST",
          actionOnEmptyResult: true
        });
        addSpeech(voiceResponse, CONTACT_REQUEST_PROMPT, {
          gather,
          config,
          promptAudioUrls
        });
        voiceResponse.redirect(
          { method: "POST" },
          `/twilio/voice/contact?${buildQuery(context, {
            retry_count: 0,
            interest_intent: "yes",
            intent_confidence: parsed.confidence
          })}`
        );
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
        const gather = voiceResponse.gather({
          input: "speech",
          speechTimeout: "auto",
          action: `/twilio/voice/intent?${buildQuery(context, { retry_count: nextRetryCount })}`,
          method: "POST",
          actionOnEmptyResult: true
        });
        addSpeech(
          voiceResponse,
          INTENT_RETRY_PROMPT,
          { gather, config, promptAudioUrls }
        );
        voiceResponse.redirect(
          { method: "POST" },
          `/twilio/voice/intent?${buildQuery(context, { retry_count: nextRetryCount })}`
        );
        return respondTwiml(res, voiceResponse);
      }

      mergeCallOutcomeState(context, { interest_intent: "no" });
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
      mergeCallOutcomeState(context, { interest_intent: "yes" });

      if (!parsedPhone.phoneNormalized && context.retry_count < config.batch.intentMaxRetries) {
        const nextRetryCount = context.retry_count + 1;
        const gather = voiceResponse.gather({
          input: "speech",
          speechTimeout: "auto",
          action: `/twilio/voice/contact?${buildQuery(context, { retry_count: nextRetryCount })}`,
          method: "POST",
          actionOnEmptyResult: true
        });
        addSpeech(
          voiceResponse,
          CONTACT_RETRY_PROMPT,
          { gather, config, promptAudioUrls }
        );
        voiceResponse.redirect(
          { method: "POST" },
          `/twilio/voice/contact?${buildQuery(context, { retry_count: nextRetryCount })}`
        );
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
    mergeCallOutcomeState(context);

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
        mergeCallOutcomeState(context, { interest_intent: "no" });
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
    await sheetsAdapter.appendCallOutcome({
      lead_name: context.lead_name || (savedState && savedState.lead_name) || "",
      lead_phone: context.lead_phone || (savedState && savedState.lead_phone) || "",
      preferred_phone: (savedState && savedState.preferred_phone) || "",
      interest_intent: toTerminalIntention(savedState && savedState.interest_intent, context.call_status),
      timestamp_utc: new Date().toISOString()
    });
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
