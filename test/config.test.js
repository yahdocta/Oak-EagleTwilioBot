const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const bootDir = fs.mkdtempSync(path.join(os.tmpdir(), "oak-eagle-config-boot-"));
const bootServiceAccountPath = path.join(bootDir, "service-account.json");
fs.writeFileSync(bootServiceAccountPath, "{}", "utf8");
Object.assign(process.env, {
  TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
  TWILIO_AUTH_TOKEN: "auth-token",
  TWILIO_FROM_NUMBER: "+15550000000",
  PUBLIC_BASE_URL: "https://voice.example.test",
  TWILIO_STATUS_CALLBACK_URL: "https://hooks.example.test/twilio/status",
  PORT: "3000",
  SHEETS_SPREADSHEET_ID: "spreadsheet-id",
  SHEETS_SHEET_NAME: "Sheet1",
  GOOGLE_SERVICE_ACCOUNT_JSON: bootServiceAccountPath,
  TWILIO_AMD_MODE: "DetectMessageEnd",
  TWILIO_VOICEMAIL_TEXT: "Leave a message.",
  BATCH_MAX_CONCURRENCY: "3",
  INTENT_MAX_RETRIES: "2"
});

const { loadConfig } = require("../src/config");
const { makeTempDir, writeTempFile } = require("./helpers");

function baseEnv(overrides = {}) {
  const dir = makeTempDir();
  const serviceAccountPath = writeTempFile(dir, "service-account.json", "{}");

  return {
    TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
    TWILIO_AUTH_TOKEN: "auth-token",
    TWILIO_FROM_NUMBER: "+15550000000",
    PUBLIC_BASE_URL: "https://voice.example.test",
    TWILIO_STATUS_CALLBACK_URL: "https://hooks.example.test/twilio/status",
    PORT: "3000",
    SHEETS_SPREADSHEET_ID: "spreadsheet-id",
    SHEETS_SHEET_NAME: "Sheet1",
    GOOGLE_SERVICE_ACCOUNT_JSON: serviceAccountPath,
    TWILIO_AMD_MODE: "DetectMessageEnd",
    TWILIO_VOICEMAIL_TEXT: "Leave a message.",
    BATCH_MAX_CONCURRENCY: "3",
    INTENT_MAX_RETRIES: "2",
    ...overrides
  };
}

test("loadConfig returns normalized config for valid env", () => {
  const config = loadConfig(baseEnv());

  assert.equal(config.urls.publicBase, "https://voice.example.test/");
  assert.equal(config.urls.statusCallback, "https://hooks.example.test/twilio/status");
  assert.equal(config.batch.maxConcurrency, 3);
  assert.equal(config.batch.intentMaxRetries, 2);
  assert.deepEqual(config.cloudflare, {
    autoStart: true,
    command: "cloudflared",
    configPath: "~/.cloudflared/config.yml",
    tunnel: ""
  });
});

test("loadConfig rejects missing required values", () => {
  const env = baseEnv({ TWILIO_AUTH_TOKEN: " " });

  assert.throws(() => loadConfig(env), /Missing required environment variables: TWILIO_AUTH_TOKEN/);
});

test("loadConfig rejects invalid URLs and missing status callback path", () => {
  assert.throws(() => loadConfig(baseEnv({ PUBLIC_BASE_URL: "ftp://example.test" })), /http or https/);
  assert.throws(
    () => loadConfig(baseEnv({ TWILIO_STATUS_CALLBACK_URL: "https://hooks.example.test" })),
    /must include a callback path/
  );
});

test("loadConfig rejects missing service account files", () => {
  assert.throws(
    () => loadConfig(baseEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: "/tmp/does-not-exist-oak-eagle.json" })),
    /file was not found/
  );
});

test("loadConfig rejects invalid numeric and project-phase values", () => {
  assert.throws(() => loadConfig(baseEnv({ PORT: "0" })), /PORT must be a positive integer/);
  assert.throws(
    () => loadConfig(baseEnv({ BATCH_MAX_CONCURRENCY: "nope" })),
    /BATCH_MAX_CONCURRENCY must be a positive integer/
  );
  assert.throws(
    () => loadConfig(baseEnv({ TWILIO_AMD_MODE: "Enable" })),
    /TWILIO_AMD_MODE must be "DetectMessageEnd"/
  );
  assert.throws(
    () => loadConfig(baseEnv({ INTENT_MAX_RETRIES: "3" })),
    /INTENT_MAX_RETRIES must be set to 2/
  );
});

test("loadConfig supports Cloudflare tunnel startup overrides", () => {
  const config = loadConfig(
    baseEnv({
      CLOUDFLARED_AUTO_START: "false",
      CLOUDFLARED_COMMAND: "/usr/local/bin/cloudflared",
      CLOUDFLARED_CONFIG: "/etc/cloudflared/config.yml",
      CLOUDFLARED_TUNNEL: "oak-eagle-bot"
    })
  );

  assert.deepEqual(config.cloudflare, {
    autoStart: false,
    command: "/usr/local/bin/cloudflared",
    configPath: "/etc/cloudflared/config.yml",
    tunnel: "oak-eagle-bot"
  });
});
