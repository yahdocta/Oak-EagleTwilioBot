function toIsoTimestamp(value = new Date()) {
  return value.toISOString();
}

function toIntentionCategory(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "yes") {
    return "yes";
  }
  if (normalized === "v/f") {
    return "v/f";
  }
  return "no";
}

function toSheetRow(outcome) {
  return [
    outcome.lead_name || "",
    outcome.lead_phone || "",
    outcome.preferred_phone || "",
    toIntentionCategory(outcome.interest_intent),
    outcome.call_status || "",
    outcome.timestamp_utc || toIsoTimestamp()
  ];
}

module.exports = {
  toSheetRow,
  toIsoTimestamp,
  toIntentionCategory
};
