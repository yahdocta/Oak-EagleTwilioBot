const { google } = require("googleapis");
const { toSheetRow } = require("./schema");
const { logger } = require("../../utils/logger");

const SHEETS_SCOPE = ["https://www.googleapis.com/auth/spreadsheets"];
const MAX_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(task, logContext) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      logger.warn("sheets.append.retry", {
        ...logContext,
        attempt,
        error: error.message
      });
      if (attempt < MAX_ATTEMPTS) {
        await sleep(250 * 2 ** (attempt - 1));
      }
    }
  }
  const wrapped = new Error("Failed to append call outcome to Google Sheets.");
  wrapped.code = "SHEETS_APPEND_FAILED";
  wrapped.cause = lastError;
  throw wrapped;
}

function createSheetsAdapter(config) {
  const auth = new google.auth.GoogleAuth({
    keyFile: config.sheets.serviceAccountJsonPath,
    scopes: SHEETS_SCOPE
  });
  const sheets = google.sheets({ version: "v4", auth });

  async function appendCallOutcome(outcome) {
    const values = [toSheetRow(outcome)];
    const range = `${config.sheets.sheetName}!A:L`;
    return withRetry(
      async () =>
        sheets.spreadsheets.values.append({
          spreadsheetId: config.sheets.spreadsheetId,
          range,
          valueInputOption: "RAW",
          requestBody: { values }
        }),
      {
        spreadsheetId: config.sheets.spreadsheetId,
        sheetName: config.sheets.sheetName
      }
    );
  }

  return {
    appendCallOutcome
  };
}

module.exports = {
  createSheetsAdapter
};
