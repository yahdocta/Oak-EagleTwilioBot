const fs = require("fs");
const os = require("os");
const path = require("path");

function makeTempDir(prefix = "oak-eagle-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeTempFile(dir, filename, contents) {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function buildTestConfig(overrides = {}) {
  return {
    twilio: {
      accountSid: "AC00000000000000000000000000000000",
      authToken: "auth-token",
      fromNumber: "+15550000000",
      amdMode: "DetectMessageEnd",
      voicemailText: "Please call us back.",
      voice: null,
      ...(overrides.twilio || {})
    },
    urls: {
      publicBase: "https://voice.example.test/base/",
      statusCallback: "https://hooks.example.test/twilio/status",
      ...(overrides.urls || {})
    },
    batch: {
      maxConcurrency: 2,
      intentMaxRetries: 2,
      ...(overrides.batch || {})
    },
    sheets: {
      spreadsheetId: "spreadsheet-id",
      sheetName: "Sheet1",
      serviceAccountJsonPath: "/tmp/service-account.json",
      ...(overrides.sheets || {})
    },
    server: {
      port: 3000,
      ...(overrides.server || {})
    },
    elevenLabs: {
      apiKey: null,
      voiceId: null,
      modelId: "eleven_flash_v2_5",
      outputFormat: "mp3_44100_128",
      cacheDir: ".cache/elevenlabs",
      ...(overrides.elevenLabs || {})
    }
  };
}

module.exports = {
  buildTestConfig,
  makeTempDir,
  writeTempFile
};
