function toIsoTimestamp(value = new Date()) {
  return value.toISOString();
}

function toYesNoIntention(value) {
  return String(value || "").toLowerCase() === "yes" ? "yes" : "no";
}

function toSheetRow(outcome) {
  return [
    outcome.lead_name || "",
    outcome.lead_phone || "",
    outcome.preferred_phone || "",
    toYesNoIntention(outcome.interest_intent),
    outcome.timestamp_utc || toIsoTimestamp()
  ];
}

module.exports = {
  toSheetRow,
  toIsoTimestamp,
  toYesNoIntention
};
