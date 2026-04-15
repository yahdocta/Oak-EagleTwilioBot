const fs = require("fs");
const { parse } = require("csv-parse/sync");
const { getLeadCityFromAddress } = require("./leadCity");

const OUTPUT_COLUMNS = [
  "lead_id",
  "first_name",
  "last_name",
  "lead_phone",
  "lead_address",
  "lead_city"
];
const REQUIRED_COLUMNS = [
  "contact_id",
  "first_name",
  "last_name",
  "associated_property_address_full"
];
const PHONE_COLUMNS = ["phone_1", "phone_2", "phone_3"];

function assertDealMachineColumns(headers) {
  const missing = REQUIRED_COLUMNS.concat(PHONE_COLUMNS).filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`DealMachine CSV is missing required column(s): ${missing.join(", ")}`);
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePhone(value) {
  const phone = normalizeText(value);
  if (!phone || phone.toLowerCase() === "wireless excluded") {
    return "";
  }

  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (phone.startsWith("+") && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  return "";
}

function pickPhone(record) {
  for (const column of PHONE_COLUMNS) {
    const phone = normalizePhone(record[column]);
    if (phone) {
      return phone;
    }
  }
  return "";
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

function convertDealMachineRecords(records) {
  return records
    .map((record) => {
      const leadAddress = normalizeText(record.associated_property_address_full);
      return {
        lead_id: normalizeText(record.contact_id),
        first_name: normalizeText(record.first_name),
        last_name: normalizeText(record.last_name),
        lead_phone: pickPhone(record),
        lead_address: leadAddress,
        lead_city: getLeadCityFromAddress(leadAddress)
      };
    })
    .filter((record) => record.lead_id && record.lead_phone && (record.first_name || record.last_name));
}

function convertDealMachineCsv(source) {
  const records = parse(source, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  if (records.length === 0) {
    return serializeCsv([]);
  }

  assertDealMachineColumns(Object.keys(records[0]));
  return serializeCsv(convertDealMachineRecords(records));
}

function convertDealMachineCsvFile(csvPath) {
  const converted = convertDealMachineCsv(fs.readFileSync(csvPath, "utf8"));
  fs.writeFileSync(csvPath, converted, "utf8");
}

module.exports = {
  convertDealMachineCsv,
  convertDealMachineCsvFile
};
