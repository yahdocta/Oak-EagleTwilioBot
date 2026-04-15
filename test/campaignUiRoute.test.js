const assert = require("node:assert/strict");
const express = require("express");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const test = require("node:test");

const bootDir = fs.mkdtempSync(path.join(os.tmpdir(), "oak-eagle-campaign-ui-"));
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
  TWILIO_VOICEMAIL_TEXT: "Voicemail from Oak and Eagle.",
  BATCH_MAX_CONCURRENCY: "2",
  INTENT_MAX_RETRIES: "2"
});

const { createCampaignRouter } = require("../src/server/routes/campaigns");

async function withServer(t, manager) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use("/campaigns", createCampaignRouter({ manager }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

function makeManager(overrides = {}) {
  const calls = [];
  const state = {
    status: "idle",
    campaignId: null,
    uploadedCsv: null,
    uploadedLeadCount: null,
    activeCallCount: 0,
    pendingLeadCount: 0,
    stopRequested: false,
    summary: null,
    recurringCallList: [],
    activity: []
  };

  return {
    calls,
    getState: () => state,
    setUploadedCsv: (csvPath) => {
      calls.push({ method: "setUploadedCsv", csvPath, exists: fs.existsSync(csvPath) });
      state.uploadedCsv = { name: path.basename(csvPath) };
      state.uploadedLeadCount = 1;
      state.activity = [{ message: "CSV uploaded" }];
      return state;
    },
    start: (campaignId, options) => {
      calls.push({ method: "start", campaignId, options });
      state.status = "running";
      state.campaignId = campaignId;
      return state;
    },
    stop: async () => {
      calls.push({ method: "stop" });
      state.status = "stopping";
      state.stopRequested = true;
      return state;
    },
    ...overrides
  };
}

async function readJson(response) {
  return response.json();
}

test("campaign UI state route returns manager state", async (t) => {
  const manager = makeManager();
  const baseUrl = await withServer(t, manager);

  const response = await fetch(`${baseUrl}/campaigns/ui/state`);
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(payload.status, "idle");
  assert.deepEqual(manager.calls, []);
});

test("campaign UI state route returns recurring call list", async (t) => {
  const manager = makeManager({
    getState: () => ({
      status: "running",
      campaignId: "loop-test",
      uploadedCsv: { name: "leads.csv" },
      uploadedLeadCount: 2,
      activeCallCount: 1,
      pendingLeadCount: 1,
      stopRequested: false,
      summary: null,
      activity: [],
      recurringCallList: [
        {
          leadId: "lead-1",
          leadName: "Ada Lovelace",
          leadPhone: "+15550000001",
          status: "active",
          lastCallStatus: "",
          lastIntent: "",
          callSid: "CA-active",
          round: 1,
          isPending: true,
          isActive: true,
          updatedAt: "2026-04-15T00:00:00.000Z"
        },
        {
          leadId: "lead-2",
          leadName: "Grace Hopper",
          leadPhone: "+15550000002",
          status: "waiting_next_loop",
          lastCallStatus: "no-answer",
          lastIntent: "unknown",
          callSid: "CA-missed",
          round: 1,
          isPending: true,
          isActive: false,
          updatedAt: "2026-04-15T00:01:00.000Z"
        }
      ]
    })
  });
  const baseUrl = await withServer(t, manager);

  const response = await fetch(`${baseUrl}/campaigns/ui/state`);
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(payload.recurringCallList.length, 2);
  assert.equal(payload.recurringCallList[0].status, "active");
  assert.equal(payload.recurringCallList[0].callSid, "CA-active");
  assert.equal(payload.recurringCallList[1].status, "waiting_next_loop");
  assert.equal(payload.recurringCallList[1].lastCallStatus, "no-answer");
});

test("campaign UI upload accepts CSV files and passes saved path to manager", async (t) => {
  const manager = makeManager();
  const baseUrl = await withServer(t, manager);
  const formData = new FormData();
  formData.append(
    "csv",
    new Blob(["lead_id,lead_name,lead_phone\n1,Ada,+15550000001\n"], { type: "text/csv" }),
    "leads.csv"
  );

  const response = await fetch(`${baseUrl}/campaigns/ui/upload`, {
    method: "POST",
    body: formData
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(payload.uploadedLeadCount, 1);
  assert.equal(manager.calls.length, 1);
  assert.equal(manager.calls[0].method, "setUploadedCsv");
  assert.equal(manager.calls[0].exists, true);
  assert.match(path.basename(manager.calls[0].csvPath), /^\d+-leads\.csv$/);
});

test("campaign UI upload rejects non-CSV files", async (t) => {
  const manager = makeManager();
  const baseUrl = await withServer(t, manager);
  const formData = new FormData();
  formData.append("csv", new Blob(["not csv"], { type: "text/plain" }), "leads.txt");

  const response = await fetch(`${baseUrl}/campaigns/ui/upload`, {
    method: "POST",
    body: formData
  });
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(payload.error, "Only CSV files can be uploaded.");
});

test("campaign UI start and end routes call manager controls", async (t) => {
  const manager = makeManager();
  const baseUrl = await withServer(t, manager);

  const startResponse = await fetch(`${baseUrl}/campaigns/ui/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId: "spring-test", loopEnabled: true, loopIntervalHours: 6 })
  });
  const startPayload = await readJson(startResponse);

  assert.equal(startResponse.status, 202);
  assert.equal(startPayload.status, "running");
  assert.equal(manager.calls.at(-1).method, "start");
  assert.equal(manager.calls.at(-1).campaignId, "spring-test");
  assert.deepEqual(manager.calls.at(-1).options, {
    loopEnabled: true,
    loopIntervalHours: 6
  });

  const endResponse = await fetch(`${baseUrl}/campaigns/ui/end`, { method: "POST" });
  const endPayload = await readJson(endResponse);

  assert.equal(endResponse.status, 202);
  assert.equal(endPayload.status, "stopping");
  assert.equal(manager.calls.at(-1).method, "stop");
});
