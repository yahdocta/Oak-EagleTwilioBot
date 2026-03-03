const { config } = require("../config");
const { createSheetsAdapter } = require("../integrations/sheets");
const { createElevenLabsTts } = require("../integrations/elevenlabs");

const sheetsAdapter = createSheetsAdapter(config);
const elevenLabsTts = createElevenLabsTts(config);

module.exports = {
  sheetsAdapter,
  elevenLabsTts
};
