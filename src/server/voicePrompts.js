const { normalizeLeadCity } = require("../campaigns/leadCity");

const OUTBOUND_INTRO_PROMPT =
  "Hi this is Kevin from Oak and Eagle, are you interested in selling your land?";
const CONTACT_REQUEST_PROMPT = "Great, what is the best phone number to reach you?";
const GOODBYE_PROMPT = "Thanks for your time. Have a great day.";
const INTENT_RETRY_PROMPT =
  "Sorry, I did not catch that. Are you interested in selling your land, yes or no?";
const CONTACT_RETRY_PROMPT =
  "I could not capture the number clearly. Please say the best phone number to reach you.";
const CONTACT_SUCCESS_PROMPT = "Thank you, we will be in touch soon.";

function buildOutboundIntroPrompt(leadCity) {
  const city = normalizeLeadCity(leadCity);
  if (!city) {
    return OUTBOUND_INTRO_PROMPT;
  }

  return `Hi this is Kevin from Oak and Eagle, are you interested in selling your land in ${city}?`;
}

function buildVoicePrompts(config) {
  return [
    OUTBOUND_INTRO_PROMPT,
    CONTACT_REQUEST_PROMPT,
    GOODBYE_PROMPT,
    INTENT_RETRY_PROMPT,
    CONTACT_RETRY_PROMPT,
    CONTACT_SUCCESS_PROMPT,
    config.twilio.voicemailText
  ];
}

module.exports = {
  OUTBOUND_INTRO_PROMPT,
  buildOutboundIntroPrompt,
  CONTACT_REQUEST_PROMPT,
  GOODBYE_PROMPT,
  INTENT_RETRY_PROMPT,
  CONTACT_RETRY_PROMPT,
  CONTACT_SUCCESS_PROMPT,
  buildVoicePrompts
};
