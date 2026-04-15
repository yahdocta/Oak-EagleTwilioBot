const INVALID_CITY_VALUES = new Set([
  "n/a",
  "na",
  "none",
  "null",
  "unknown",
  "undefined",
  "-"
]);

function normalizeLeadCity(value) {
  const city = String(value || "").replace(/\s+/g, " ").trim();
  if (!city) {
    return "";
  }

  const normalized = city.toLowerCase();
  if (INVALID_CITY_VALUES.has(normalized)) {
    return "";
  }

  if (!/[a-z]/i.test(city) || /\d/.test(city)) {
    return "";
  }

  if (!/^[a-z][a-z .'-]*$/i.test(city)) {
    return "";
  }

  return city;
}

function getLeadCity(record) {
  const cityColumns = [
    "lead_city",
    "city",
    "property_city",
    "situs_city",
    "site_city",
    "mailing_city"
  ];

  for (const column of cityColumns) {
    const city = normalizeLeadCity(record[column]);
    if (city) {
      return city;
    }
  }

  return "";
}

function getLeadCityFromAddress(address) {
  const parts = String(address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    return "";
  }

  return normalizeLeadCity(parts[1]);
}

module.exports = {
  getLeadCityFromAddress,
  getLeadCity,
  normalizeLeadCity
};
