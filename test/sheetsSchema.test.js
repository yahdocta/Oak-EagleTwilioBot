const assert = require("node:assert/strict");
const test = require("node:test");

const { toIntentionCategory, toIsoTimestamp, toSheetRow } = require("../src/integrations/sheets/schema");

test("toIntentionCategory maps supported terminal values and defaults to no", () => {
  assert.equal(toIntentionCategory("yes"), "yes");
  assert.equal(toIntentionCategory("YES"), "yes");
  assert.equal(toIntentionCategory("v/f"), "v/f");
  assert.equal(toIntentionCategory("unknown"), "no");
  assert.equal(toIntentionCategory(undefined), "no");
});

test("toSheetRow preserves sheet column order and fills empty values", () => {
  assert.deepEqual(
    toSheetRow({
      lead_name: "Ada Lovelace",
      lead_phone: "+15551234567",
      lead_address: "123 Oak St",
      preferred_phone: "+15557654321",
      call_transcript: "Intent: yes\nPreferred phone: 555 765 4321",
      interest_intent: "yes",
      call_status: "completed",
      timestamp_utc: "2026-04-15T00:00:00.000Z"
    }),
    [
      "Ada Lovelace",
      "+15551234567",
      "123 Oak St",
      "+15557654321",
      "yes",
      "completed",
      "2026-04-15T00:00:00.000Z",
      "Intent: yes\nPreferred phone: 555 765 4321"
    ]
  );
});

test("toSheetRow generates an ISO timestamp when one is not provided", () => {
  const row = toSheetRow({});

  assert.equal(row.length, 8);
  assert.match(row[6], /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(row[7], "");
});

test("toIsoTimestamp accepts an explicit Date", () => {
  assert.equal(toIsoTimestamp(new Date("2026-04-15T12:34:56.000Z")), "2026-04-15T12:34:56.000Z");
});
