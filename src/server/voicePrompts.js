const { getLeadCityFromAddress, normalizeLeadCity } = require("../campaigns/leadCity");

const OUTBOUND_INTRO_PROMPT =
  "Hi this is Kevin from Oak and Eagle, are you interested in selling your land?";
const OUTBOUND_INTRO_CITY_PREFIX_PROMPT =
  "Hi this is Kevin from Oak and Eagle, are you interested in selling your land in";
const CONTACT_REQUEST_PROMPT = "Great, what is the best phone number to reach you?";
const GOODBYE_PROMPT = "Thanks for your time. Have a great day.";
const INTENT_RETRY_PROMPT =
  "Sorry, I did not catch that. Are you interested in selling your land, yes or no?";
const CONTACT_RETRY_PROMPT =
  "I could not capture the number clearly. Please say the best phone number to reach you.";
const CONTACT_SUCCESS_PROMPT = "Thank you, we will be in touch soon.";

function getOutboundIntroCity(context = {}) {
  const city = normalizeLeadCity(context.lead_city);
  if (city) {
    return city;
  }

  const cityFromAddress = getLeadCityFromAddress(context.lead_address);
  if (cityFromAddress) {
    return cityFromAddress;
  }

  return normalizeLeadCity(context.lead_address);
}

function buildOutboundIntroPrompt(contextOrLeadCity) {
  const city =
    typeof contextOrLeadCity === "object"
      ? getOutboundIntroCity(contextOrLeadCity)
      : normalizeLeadCity(contextOrLeadCity);
  if (!city) {
    return OUTBOUND_INTRO_PROMPT;
  }

  return `Hi this is Kevin from Oak and Eagle, are you interested in selling your land in ${city}?`;
}

function buildVoicePrompts(config) {
  return [
    OUTBOUND_INTRO_PROMPT,
    OUTBOUND_INTRO_CITY_PREFIX_PROMPT,
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
  OUTBOUND_INTRO_CITY_PREFIX_PROMPT,
  buildOutboundIntroPrompt,
  getOutboundIntroCity,
  CONTACT_REQUEST_PROMPT,
  GOODBYE_PROMPT,
  INTENT_RETRY_PROMPT,
  CONTACT_RETRY_PROMPT,
  CONTACT_SUCCESS_PROMPT,
  buildVoicePrompts
};
