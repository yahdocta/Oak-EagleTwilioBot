const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const REQUIRED_ENV_KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "PUBLIC_BASE_URL",
  "TWILIO_STATUS_CALLBACK_URL",
  "PORT",
  "SHEETS_SPREADSHEET_ID",
  "SHEETS_SHEET_NAME",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "TWILIO_AMD_MODE",
  "TWILIO_VOICEMAIL_TEXT",
  "BATCH_MAX_CONCURRENCY",
  "INTENT_MAX_RETRIES"
];

function parsePositiveInt(rawValue, key) {
  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${key} must be a positive integer. Received "${rawValue}".`);
  }
  return parsedValue;
}

function parseUrl(rawValue, key) {
  let parsedUrl;
  try {
    parsedUrl = new URL(rawValue);
  } catch (error) {
    throw new Error(`${key} must be a valid URL. Received "${rawValue}".`);
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error(`${key} must use http or https protocol. Received "${rawValue}".`);
  }

  return parsedUrl;
}

function validateEnv(rawEnv) {
  const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !rawEnv[key] || !String(rawEnv[key]).trim());
  if (missingKeys.length > 0) {
    throw new Error(`Missing required environment variables: ${missingKeys.join(", ")}`);
  }
}

function loadConfig(rawEnv = process.env) {
  validateEnv(rawEnv);

  const publicBaseUrl = parseUrl(rawEnv.PUBLIC_BASE_URL, "PUBLIC_BASE_URL");
  const statusCallbackUrl = parseUrl(rawEnv.TWILIO_STATUS_CALLBACK_URL, "TWILIO_STATUS_CALLBACK_URL");
  if (!statusCallbackUrl.pathname || statusCallbackUrl.pathname === "/") {
    throw new Error(
      'TWILIO_STATUS_CALLBACK_URL must include a callback path, for example "/twilio/status".'
    );
  }

  const serviceAccountPath = path.resolve(rawEnv.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_JSON file was not found at "${serviceAccountPath}".`
    );
  }

  const port = parsePositiveInt(rawEnv.PORT, "PORT");
  const batchMaxConcurrency = parsePositiveInt(
    rawEnv.BATCH_MAX_CONCURRENCY,
    "BATCH_MAX_CONCURRENCY"
  );
  const intentMaxRetries = parsePositiveInt(rawEnv.INTENT_MAX_RETRIES, "INTENT_MAX_RETRIES");

  if (rawEnv.TWILIO_AMD_MODE !== "DetectMessageEnd") {
    throw new Error(
      `TWILIO_AMD_MODE must be "DetectMessageEnd". Received "${rawEnv.TWILIO_AMD_MODE}".`
    );
  }

  if (intentMaxRetries !== 2) {
    throw new Error(
      `INTENT_MAX_RETRIES must be set to 2 for this project phase. Received "${intentMaxRetries}".`
    );
  }

  return {
    twilio: {
      accountSid: rawEnv.TWILIO_ACCOUNT_SID,
      authToken: rawEnv.TWILIO_AUTH_TOKEN,
      fromNumber: rawEnv.TWILIO_FROM_NUMBER,
      amdMode: rawEnv.TWILIO_AMD_MODE,
      voicemailText: rawEnv.TWILIO_VOICEMAIL_TEXT,
      voice: rawEnv.TWILIO_VOICE || null
    },
    elevenLabs: {
      apiKey: rawEnv.ELEVENLABS_API_KEY || null,
      voiceId: rawEnv.ELEVENLABS_VOICE_ID || null,
      modelId: rawEnv.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5",
      outputFormat: rawEnv.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128",
      cacheDir: rawEnv.ELEVENLABS_CACHE_DIR || ".cache/elevenlabs"
    },
    urls: {
      publicBase: publicBaseUrl.toString(),
      statusCallback: statusCallbackUrl.toString()
    },
    server: {
      port
    },
    batch: {
      maxConcurrency: batchMaxConcurrency,
      intentMaxRetries
    },
    sheets: {
      spreadsheetId: rawEnv.SHEETS_SPREADSHEET_ID,
      sheetName: rawEnv.SHEETS_SHEET_NAME,
      serviceAccountJsonPath: serviceAccountPath
    }
  };
}

const config = loadConfig();

module.exports = {
  REQUIRED_ENV_KEYS,
  loadConfig,
  config
};
