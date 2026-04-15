function normalizeLeadAddress(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getLeadAddress(record) {
  const addressColumns = [
    "lead_address",
    "address",
    "property_address",
    "situs_address",
    "site_address",
    "mailing_address"
  ];

  for (const column of addressColumns) {
    const address = normalizeLeadAddress(record[column]);
    if (address) {
      return address;
    }
  }
  return "";
}

module.exports = {
  getLeadAddress,
  normalizeLeadAddress
};
