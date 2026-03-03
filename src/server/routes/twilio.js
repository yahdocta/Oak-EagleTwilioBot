const express = require("express");
const { twiml } = require("twilio");
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

function createTwilioRouter({ sheetsAdapter, elevenLabsTts, promptAudioUrls }) {
  const router = express.Router();
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

    if (context.answer_type === "machine") {
      addSpeech(voiceResponse, config.twilio.voicemailText, { config, promptAudioUrls });
      voiceResponse.hangup();
      await sheetsAdapter.appendCallOutcome({
        ...context,
        interest_intent: "unknown",
        notes: "voicemail"
      });
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

    if (parsed.intent === "yes") {
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
      addSpeech(voiceResponse, GOODBYE_PROMPT, { config, promptAudioUrls });
      voiceResponse.hangup();
      await sheetsAdapter.appendCallOutcome({
        ...context,
        interest_intent: "no",
        intent_confidence: parsed.confidence,
        notes: "not_interested"
      });
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

    addSpeech(voiceResponse, GOODBYE_PROMPT, { config, promptAudioUrls });
    voiceResponse.hangup();
    await sheetsAdapter.appendCallOutcome({
      ...context,
      interest_intent: "unknown",
      intent_confidence: parsed.confidence,
      notes: "unclear_intent"
    });
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

    addSpeech(voiceResponse, CONTACT_SUCCESS_PROMPT, { config, promptAudioUrls });
    voiceResponse.hangup();

    await sheetsAdapter.appendCallOutcome({
      ...context,
      interest_intent: "yes",
      preferred_phone: parsedPhone.phoneNormalized || "",
      intent_confidence: parsedPhone.confidence,
      notes: parsedPhone.phoneNormalized ? "preferred_phone_captured" : "preferred_phone_unclear"
    });
    return respondTwiml(res, voiceResponse);
    })
  );

  async function statusHandler(req, res) {
    const context = collectCallContext(req);
    await sheetsAdapter.appendCallOutcome({
      ...context,
      notes: "status_callback"
    });
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
