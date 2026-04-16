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
    scheduledStartAt: null,
    scheduledTimezone: null,
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
    togglePause: () => {
      calls.push({ method: "togglePause" });
      state.isPaused = !state.isPaused;
      return state;
    },
    removeRecurringLead: (leadId) => {
      calls.push({ method: "removeRecurringLead", leadId });
      state.recurringCallList = state.recurringCallList.filter((lead) => lead.leadId !== leadId);
      state.uploadedLeadCount = state.recurringCallList.length;
      state.pendingLeadCount = state.recurringCallList.filter((lead) => lead.isPending).length;
      return state;
    },
    saveRecurringCallListCsv: () => {
      calls.push({ method: "saveRecurringCallListCsv" });
      state.lastRecurringCsv = {
        name: "loop-test-recurring-calls-2026-04-15T00-00-00-000Z.csv",
        path: path.resolve(
          "campaign-inputs",
          "exports",
          "loop-test-recurring-calls-2026-04-15T00-00-00-000Z.csv"
        ),
        count: state.recurringCallList.length
      };
      return state.lastRecurringCsv;
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
          leadAddress: "123 Oak St",
          status: "active",
          lastCallStatus: "",
          lastIntent: "",
          callSid: "CA-active",
          callTranscript: "",
          preferredPhone: "",
          completedAt: "",
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
          callTranscript: "Intent: no answer",
          preferredPhone: "",
          completedAt: "2026-04-15T00:01:00.000Z",
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
  assert.equal(payload.recurringCallList[0].leadAddress, "123 Oak St");
  assert.equal(payload.recurringCallList[0].callSid, "CA-active");
  assert.equal(payload.recurringCallList[1].status, "waiting_next_loop");
  assert.equal(payload.recurringCallList[1].lastCallStatus, "no-answer");
  assert.equal(payload.recurringCallList[1].callTranscript, "Intent: no answer");
  assert.equal(payload.recurringCallList[1].completedAt, "2026-04-15T00:01:00.000Z");
});

test("campaign UI remove recurring lead route delegates to manager", async (t) => {
  const manager = makeManager({
    getState: undefined
  });
  manager.getState = () => ({
    status: "running",
    campaignId: "loop-test",
    uploadedCsv: { name: "leads.csv" },
    uploadedLeadCount: 1,
    activeCallCount: 0,
    pendingLeadCount: 1,
    stopRequested: false,
    summary: null,
    activity: [],
    recurringCallList: [
      {
        leadId: "lead-1",
        leadName: "Ada Lovelace",
        leadPhone: "+15550000001",
        status: "waiting_next_loop",
        isPending: true,
        isActive: false
      }
    ]
  });
  const baseUrl = await withServer(t, manager);

  const response = await fetch(`${baseUrl}/campaigns/ui/recurring-leads/lead-1/remove`, {
    method: "POST"
  });
  const payload = await readJson(response);

  assert.equal(response.status, 202);
  assert.equal(manager.calls.at(-1).method, "removeRecurringLead");
  assert.equal(manager.calls.at(-1).leadId, "lead-1");
  assert.equal(payload.uploadedLeadCount, 0);
  assert.equal(payload.pendingLeadCount, 0);
  assert.deepEqual(payload.recurringCallList, []);
});

test("campaign UI save recurring CSV route delegates to manager", async (t) => {
  let lastRecurringCsv = null;
  const manager = makeManager({
    saveRecurringCallListCsv: () => {
      manager.calls.push({ method: "saveRecurringCallListCsv" });
      lastRecurringCsv = {
        name: "loop-test-recurring-calls-2026-04-15T00-00-00-000Z.csv",
        path: path.resolve(
          "campaign-inputs",
          "exports",
          "loop-test-recurring-calls-2026-04-15T00-00-00-000Z.csv"
        ),
        count: 1
      };
      return lastRecurringCsv;
    }
  });
  manager.getState = () => ({
    status: "running",
    campaignId: "loop-test",
    uploadedCsv: { name: "leads.csv" },
    uploadedLeadCount: 1,
    activeCallCount: 0,
    pendingLeadCount: 1,
    stopRequested: false,
    summary: null,
    lastRecurringCsv,
    activity: [],
    recurringCallList: [
      {
        leadId: "lead-1",
        leadName: "Ada Lovelace",
        leadPhone: "+15550000001",
        status: "waiting_next_loop",
        isPending: true,
        isActive: false
      }
    ]
  });
  const baseUrl = await withServer(t, manager);

  const response = await fetch(`${baseUrl}/campaigns/ui/recurring-leads/save-csv`, {
    method: "POST"
  });
  const payload = await readJson(response);

  assert.equal(response.status, 201);
  assert.equal(manager.calls.at(-1).method, "saveRecurringCallListCsv");
  assert.equal(payload.savedCsv.name, "loop-test-recurring-calls-2026-04-15T00-00-00-000Z.csv");
  assert.equal(payload.savedCsv.count, 1);
  assert.equal(payload.state.lastRecurringCsv.name, payload.savedCsv.name);
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

test("campaign UI upload converts DealMachine CSVs when requested", async (t) => {
  const manager = makeManager();
  const baseUrl = await withServer(t, manager);
  const formData = new FormData();
  formData.append("dealMachineCsv", "true");
  formData.append(
    "csv",
    new Blob(
      [
        "contact_id,associated_property_address_full,first_name,last_name,phone_1,phone_2,phone_3\n",
        '150186385122,"Eliot Ln, Albrightsville, Pa 18210",Mark,Migliaccio,Wireless Excluded,8565474260,8565475464\n'
      ],
      { type: "text/csv" }
    ),
    "dealmachine-contacts.csv"
  );

  const response = await fetch(`${baseUrl}/campaigns/ui/upload`, {
    method: "POST",
    body: formData
  });
  const payload = await readJson(response);
  const savedCsv = fs.readFileSync(manager.calls[0].csvPath, "utf8");

  assert.equal(response.status, 200);
  assert.equal(payload.uploadedLeadCount, 1);
  assert.match(path.basename(manager.calls[0].csvPath), /^\d+-dealmachine-contacts\.csv$/);
  assert.equal(
    savedCsv,
    [
      "lead_id,first_name,last_name,lead_phone,lead_address,lead_city",
      '150186385122,Mark,Migliaccio,+18565474260,"Eliot Ln, Albrightsville, Pa 18210",Albrightsville',
      ""
    ].join("\n")
  );
});

test("campaign UI upload converts recurring export CSVs when requested", async (t) => {
  const manager = makeManager();
  const baseUrl = await withServer(t, manager);
  const formData = new FormData();
  formData.append("recurringExportCsv", "true");
  formData.append(
    "csv",
    new Blob(
      [
        "lead_id,lead_name,lead_phone,lead_address,lead_city,status,last_call_status,last_intent,call_sid,round,is_pending,is_active,completed_at,preferred_phone,call_transcript,updated_at\n",
        "lead-1,Ada Lovelace,+15550000001,123 Oak St,Boston,waiting_next_loop,no-answer,unknown,CA-missed,1,true,false,,,,2026-04-15T12:31:00.000Z\n",
        "lead-2,Grace Hopper,+15550000002,456 Pine St,Arlington,logged,completed,yes,CA-logged,1,false,false,2026-04-15T12:32:00.000Z,+15550009999,Preferred phone: 555 000 9999,2026-04-15T12:33:00.000Z\n"
      ],
      { type: "text/csv" }
    ),
    "havasu-landlines-recurring-calls.csv"
  );

  const response = await fetch(`${baseUrl}/campaigns/ui/upload`, {
    method: "POST",
    body: formData
  });
  const payload = await readJson(response);
  const savedCsv = fs.readFileSync(manager.calls[0].csvPath, "utf8");

  assert.equal(response.status, 200);
  assert.equal(payload.uploadedLeadCount, 1);
  assert.match(path.basename(manager.calls[0].csvPath), /^\d+-havasu-landlines-recurring-calls\.csv$/);
  assert.equal(
    savedCsv,
    [
      "lead_id,lead_name,lead_phone,lead_address,lead_city",
      "lead-1,Ada Lovelace,+15550000001,123 Oak St,Boston",
      ""
    ].join("\n")
  );
});

test("campaign UI upload rejects multiple CSV import formats", async (t) => {
  const manager = makeManager();
  const baseUrl = await withServer(t, manager);
  const formData = new FormData();
  formData.append("dealMachineCsv", "true");
  formData.append("recurringExportCsv", "true");
  formData.append(
    "csv",
    new Blob(["lead_id,lead_name,lead_phone,status\n1,Ada,+15550000001,ready\n"], { type: "text/csv" }),
    "leads.csv"
  );

  const response = await fetch(`${baseUrl}/campaigns/ui/upload`, {
    method: "POST",
    body: formData
  });
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(payload.error, "Choose only one CSV import format.");
  assert.equal(manager.calls.length, 0);
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
    loopIntervalHours: 6,
    scheduleStartAt: undefined,
    scheduleTimezone: undefined
  });

  const endResponse = await fetch(`${baseUrl}/campaigns/ui/end`, { method: "POST" });
  const endPayload = await readJson(endResponse);

  assert.equal(endResponse.status, 202);
  assert.equal(endPayload.status, "stopping");
  assert.equal(manager.calls.at(-1).method, "stop");
});

test("campaign UI start route forwards schedule fields to manager", async (t) => {
  const manager = makeManager();
  const baseUrl = await withServer(t, manager);

  const response = await fetch(`${baseUrl}/campaigns/ui/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      campaignId: "scheduled-route",
      loopEnabled: false,
      loopIntervalHours: 24,
      scheduleStartAt: "2026-04-16T09:15",
      scheduleTimezone: "America/Chicago"
    })
  });
  const payload = await readJson(response);

  assert.equal(response.status, 202);
  assert.equal(payload.status, "running");
  assert.equal(manager.calls.at(-1).method, "start");
  assert.deepEqual(manager.calls.at(-1).options, {
    loopEnabled: false,
    loopIntervalHours: 24,
    scheduleStartAt: "2026-04-16T09:15",
    scheduleTimezone: "America/Chicago"
  });
});

test("campaign UI pause route toggles manager pause state", async (t) => {
  const manager = makeManager();
  const baseUrl = await withServer(t, manager);

  const pauseResponse = await fetch(`${baseUrl}/campaigns/ui/pause`, { method: "POST" });
  const pausePayload = await readJson(pauseResponse);

  assert.equal(pauseResponse.status, 202);
  assert.equal(pausePayload.isPaused, true);
  assert.equal(manager.calls.at(-1).method, "togglePause");

  const resumeResponse = await fetch(`${baseUrl}/campaigns/ui/pause`, { method: "POST" });
  const resumePayload = await readJson(resumeResponse);

  assert.equal(resumeResponse.status, 202);
  assert.equal(resumePayload.isPaused, false);
  assert.equal(manager.calls.at(-1).method, "togglePause");
});
