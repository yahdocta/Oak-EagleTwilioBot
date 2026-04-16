const assert = require("node:assert/strict");
const fs = require("fs");
const test = require("node:test");

const { parseLeadsCsv } = require("../src/campaigns/csvLeads");
const { convertRecurringExportCsvFile } = require("../src/campaigns/recurringExportCsv");
const { makeTempDir, writeTempFile } = require("./helpers");

test("convertRecurringExportCsvFile keeps dialable recurring export rows", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "recurring-export.csv",
    [
      "lead_id,lead_name,lead_phone,lead_address,lead_city,status,last_call_status,last_intent,call_sid,round,is_pending,is_active,completed_at,preferred_phone,call_transcript,updated_at",
      'lead-1,Ada Lovelace,+15550000001,"123 Oak St, Boston, MA",Boston,waiting_next_loop,no-answer,unknown,CA-missed,1,true,false,2026-04-15T12:30:00.000Z,,Intent: no answer,2026-04-15T12:31:00.000Z',
      "lead-2,Grace Hopper,+15550000002,456 Pine St,Arlington,logged,completed,yes,CA-logged,1,false,false,2026-04-15T12:32:00.000Z,+15550009999,Preferred phone: 555 000 9999,2026-04-15T12:33:00.000Z",
      "lead-3,Katherine Johnson,+15550000003,789 Maple St,Hampton,declined,completed,no,CA-declined,1,false,false,2026-04-15T12:34:00.000Z,,Intent: no,2026-04-15T12:35:00.000Z",
      "lead-4,Dorothy Vaughan,+15550000004,321 Cedar St,Newport News,retrying,call-create-failed,unknown,,0,true,false,,,,2026-04-15T12:36:00.000Z"
    ].join("\n") + "\n"
  );

  convertRecurringExportCsvFile(csvPath);

  assert.deepEqual(parseLeadsCsv(csvPath), [
    {
      lead_id: "lead-1",
      lead_name: "Ada Lovelace",
      lead_phone: "+15550000001",
      lead_address: "123 Oak St, Boston, MA",
      lead_city: "Boston"
    },
    {
      lead_id: "lead-4",
      lead_name: "Dorothy Vaughan",
      lead_phone: "+15550000004",
      lead_address: "321 Cedar St",
      lead_city: "Newport News"
    }
  ]);

  assert.equal(
    fs.readFileSync(csvPath, "utf8"),
    [
      "lead_id,lead_name,lead_phone,lead_address,lead_city",
      'lead-1,Ada Lovelace,+15550000001,"123 Oak St, Boston, MA",Boston',
      "lead-4,Dorothy Vaughan,+15550000004,321 Cedar St,Newport News",
      ""
    ].join("\n")
  );
});
