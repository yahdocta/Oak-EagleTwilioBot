const assert = require("node:assert/strict");
const fs = require("fs");
const test = require("node:test");

const { convertDealMachineCsvFile } = require("../src/campaigns/dealMachineCsv");
const { parseLeadsCsv } = require("../src/campaigns/csvLeads");
const { makeTempDir, writeTempFile } = require("./helpers");

test("convertDealMachineCsvFile maps DealMachine contacts to campaign leads", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "dealmachine.csv",
    [
      "contact_id,associated_property_address_full,first_name,last_name,phone_1,phone_2,phone_3",
      '150186385122,"Eliot Ln, Albrightsville, Pa 18210",Mark,Migliaccio,Wireless Excluded,8565474260,8565475464',
      '150154528216,"Petrarch Trl, Albrightsville, Pa 18210",Michael,Lendle,7184183859,Wireless Excluded,Wireless Excluded',
      '150131190701,"Byron Ln, Albrightsville, Pa 18210",Toni,Barresi,Wireless Excluded,,'
    ].join("\n") + "\n"
  );

  convertDealMachineCsvFile(csvPath);

  assert.deepEqual(parseLeadsCsv(csvPath), [
    {
      lead_id: "150186385122",
      lead_name: "Mark Migliaccio",
      lead_phone: "+18565474260",
      lead_address: "Eliot Ln, Albrightsville, Pa 18210",
      lead_city: "Albrightsville"
    },
    {
      lead_id: "150154528216",
      lead_name: "Michael Lendle",
      lead_phone: "+17184183859",
      lead_address: "Petrarch Trl, Albrightsville, Pa 18210",
      lead_city: "Albrightsville"
    }
  ]);

  assert.match(
    fs.readFileSync(csvPath, "utf8"),
    /^lead_id,first_name,last_name,lead_phone,lead_address,lead_city\n/
  );
});
