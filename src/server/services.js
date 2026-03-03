const { config } = require("../config");
const { createSheetsAdapter } = require("../integrations/sheets");

const sheetsAdapter = createSheetsAdapter(config);

module.exports = {
  sheetsAdapter
};
