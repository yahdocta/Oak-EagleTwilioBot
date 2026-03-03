const fs = require("fs");
const { parse } = require("csv-parse/sync");

const REQUIRED_COLUMNS = ["lead_id", "lead_name", "lead_phone"];

function assertColumns(headers) {
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required column(s): ${missing.join(", ")}`);
  }
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
  return records.map((record) => ({
    lead_id: String(record.lead_id || "").trim(),
    lead_name: String(record.lead_name || "").trim(),
    lead_phone: String(record.lead_phone || "").trim()
  }));
}

module.exports = {
  parseLeadsCsv
};
