const fs = require("fs");
const { parse } = require("csv-parse/sync");
const { getLeadCity } = require("./leadCity");

const REQUIRED_COLUMNS = ["lead_id", "lead_phone"];

function assertColumns(headers) {
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required column(s): ${missing.join(", ")}`);
  }

  const hasLeadName = headers.includes("lead_name");
  const hasFirstName = headers.includes("first_name");
  const hasLastName = headers.includes("last_name");
  if (!hasLeadName && (!hasFirstName || !hasLastName)) {
    throw new Error(
      'CSV must include "lead_name" or both "first_name" and "last_name" columns.'
    );
  }
}

function buildLeadName(record) {
  const leadName = String(record.lead_name || "").trim();
  if (leadName.length > 0) {
    return leadName;
  }

  const firstName = String(record.first_name || "").trim();
  const lastName = String(record.last_name || "").trim();
  return `${firstName} ${lastName}`.trim();
}

function parseLeadsCsv(csvPath) {
  const source = fs.readFileSync(csvPath, "utf8");
  const records = parse(source, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  if (records.length === 0) {
    return [];
  }

  assertColumns(Object.keys(records[0]));
  return records.map((record) => {
    const lead = {
      lead_id: String(record.lead_id || "").trim(),
      lead_name: buildLeadName(record),
      lead_phone: String(record.lead_phone || "").trim()
    };
    const leadCity = getLeadCity(record);
    if (leadCity) {
      lead.lead_city = leadCity;
    }
    return lead;
  });
}

module.exports = {
  parseLeadsCsv
};
