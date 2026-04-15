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
      preferred_phone: "+15557654321",
      interest_intent: "yes",
      call_status: "completed",
      timestamp_utc: "2026-04-15T00:00:00.000Z"
    }),
    [
      "Ada Lovelace",
      "+15551234567",
      "+15557654321",
      "yes",
      "completed",
      "2026-04-15T00:00:00.000Z"
    ]
  );
});

test("toSheetRow generates an ISO timestamp when one is not provided", () => {
  const row = toSheetRow({});

  assert.equal(row.length, 6);
  assert.match(row[5], /^\d{4}-\d{2}-\d{2}T/);
});

test("toIsoTimestamp accepts an explicit Date", () => {
  assert.equal(toIsoTimestamp(new Date("2026-04-15T12:34:56.000Z")), "2026-04-15T12:34:56.000Z");
});
