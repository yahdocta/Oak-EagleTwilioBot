const fs = require("fs");
const { parse } = require("csv-parse/sync");

const OUTPUT_COLUMNS = [
  "lead_id",
  "lead_name",
  "lead_phone",
  "lead_address",
  "lead_city"
];
const REQUIRED_COLUMNS = [
  "lead_id",
  "lead_name",
  "lead_phone",
  "status"
];
const CLOSED_STATUSES = new Set(["logged", "declined", "removed"]);

function assertRecurringExportColumns(headers) {
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`Recurring export CSV is missing required column(s): ${missing.join(", ")}`);
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function shouldKeepRecord(record) {
  const status = normalizeText(record.status).toLowerCase();
  return !CLOSED_STATUSES.has(status);
}

function escapeCsvValue(value) {
  const text = String(value || "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function serializeCsv(records) {
  const lines = [OUTPUT_COLUMNS.join(",")];
  for (const record of records) {
    lines.push(OUTPUT_COLUMNS.map((column) => escapeCsvValue(record[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function convertRecurringExportRecords(records) {
  return records
    .filter(shouldKeepRecord)
    .map((record) => ({
      lead_id: normalizeText(record.lead_id),
      lead_name: normalizeText(record.lead_name),
      lead_phone: normalizeText(record.lead_phone),
      lead_address: normalizeText(record.lead_address),
      lead_city: normalizeText(record.lead_city)
    }))
    .filter((record) => record.lead_id && record.lead_name && record.lead_phone);
}

function convertRecurringExportCsv(source) {
  const records = parse(source, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  if (records.length === 0) {
    return serializeCsv([]);
  }

  assertRecurringExportColumns(Object.keys(records[0]));
  return serializeCsv(convertRecurringExportRecords(records));
}

function convertRecurringExportCsvFile(csvPath) {
  const converted = convertRecurringExportCsv(fs.readFileSync(csvPath, "utf8"));
  fs.writeFileSync(csvPath, converted, "utf8");
}

module.exports = {
  convertRecurringExportCsv,
  convertRecurringExportCsvFile
};
