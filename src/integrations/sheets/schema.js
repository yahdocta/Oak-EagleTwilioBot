function toIsoTimestamp(value = new Date()) {
  return value.toISOString();
}

function toSheetRow(outcome) {
  return [
    outcome.timestamp_utc || toIsoTimestamp(),
    outcome.lead_id || "",
    outcome.lead_name || "",
    outcome.lead_phone || "",
    outcome.call_sid || "",
    outcome.call_status || "",
    outcome.answer_type || "unknown",
    outcome.interest_intent || "unknown",
    outcome.preferred_phone || "",
    String(outcome.intent_confidence ?? ""),
    String(outcome.retry_count ?? 0),
    outcome.notes || ""
  ];
}

module.exports = {
  toSheetRow,
  toIsoTimestamp
};
