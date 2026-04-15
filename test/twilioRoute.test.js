const assert = require("node:assert/strict");
const express = require("express");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const test = require("node:test");

const bootDir = fs.mkdtempSync(path.join(os.tmpdir(), "oak-eagle-twilio-route-"));
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

const { createTwilioRouter } = require("../src/server/routes/twilio");

async function withServer(t, sheetsAdapter) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use("/twilio", createTwilioRouter({ sheetsAdapter, promptAudioUrls: new Map() }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function postForm(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  const text = await response.text();
  return { response, text };
}

function makeSheetsRecorder() {
  const appended = [];
  return {
    appended,
    adapter: {
      appendCallOutcome: async (outcome) => {
        appended.push(outcome);
      }
    }
  };
}

test("outbound human calls return intro gather TwiML", async (t) => {
  const sheets = makeSheetsRecorder();
  const baseUrl = await withServer(t, sheets.adapter);

  const { response, text } = await postForm(baseUrl, "/twilio/voice/outbound", {
    lead_id: "lead-1",
    lead_name: "Ada Lovelace",
    lead_phone: "+15551234567",
    campaign_id: "campaign-1",
    CallSid: "CA-human-outbound",
    AnsweredBy: "human"
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/xml/);
  assert.match(text, /<Gather/);
  assert.match(text, /\/twilio\/voice\/intent\?/);
  assert.match(text, /retry_count=0/);
  assert.match(text, /Hi this is Kevin from Oak and Eagle/);
  assert.equal(sheets.appended.length, 0);
});

test("outbound machine calls get voicemail TwiML and hang up", async (t) => {
  const sheets = makeSheetsRecorder();
  const baseUrl = await withServer(t, sheets.adapter);

  const { response, text } = await postForm(baseUrl, "/twilio/voice/outbound", {
    lead_id: "lead-2",
    lead_name: "Grace Hopper",
    lead_phone: "+15551230000",
    CallSid: "CA-machine-outbound",
    AnsweredBy: "machine_start"
  });

  assert.equal(response.status, 200);
  assert.match(text, /Voicemail from Oak and Eagle/);
  assert.match(text, /<Hangup\/>/);
});

test("intent route branches yes, no, and retry exhaustion", async (t) => {
  const sheets = makeSheetsRecorder();
  const baseUrl = await withServer(t, sheets.adapter);

  const yes = await postForm(baseUrl, "/twilio/voice/intent?lead_id=lead-yes&CallSid=CA-intent-yes", {
    SpeechResult: "yes I am interested"
  });
  assert.match(yes.text, /\/twilio\/voice\/contact\?/);
  assert.match(yes.text, /interest_intent=yes/);
  assert.match(yes.text, /best phone number/);

  const no = await postForm(baseUrl, "/twilio/voice/intent?lead_id=lead-no&CallSid=CA-intent-no", {
    SpeechResult: "no stop calling"
  });
  assert.match(no.text, /Thanks for your time/);
  assert.match(no.text, /<Hangup\/>/);

  const retry = await postForm(
    baseUrl,
    "/twilio/voice/intent?lead_id=lead-retry&CallSid=CA-intent-retry&retry_count=1",
    { SpeechResult: "maybe later" }
  );
  assert.match(retry.text, /retry_count=2/);
  assert.match(retry.text, /did not catch that/);

  const exhausted = await postForm(
    baseUrl,
    "/twilio/voice/intent?lead_id=lead-exhausted&CallSid=CA-intent-exhausted&retry_count=2",
    { SpeechResult: "" }
  );
  assert.match(exhausted.text, /Thanks for your time/);
  assert.match(exhausted.text, /<Hangup\/>/);
});

test("contact route retries unclear numbers and stores valid preferred numbers for final status", async (t) => {
  const sheets = makeSheetsRecorder();
  const baseUrl = await withServer(t, sheets.adapter);
  const callSid = "CA-contact-flow";

  const unclear = await postForm(
    baseUrl,
    `/twilio/voice/contact?lead_id=lead-contact&lead_name=Ada+Lovelace&lead_phone=%2B15551234567&CallSid=${callSid}&retry_count=0`,
    { SpeechResult: "call my office" }
  );
  assert.match(unclear.text, /retry_count=1/);
  assert.match(unclear.text, /could not capture the number/);

  const captured = await postForm(
    baseUrl,
    `/twilio/voice/contact?lead_id=lead-contact&lead_name=Ada+Lovelace&lead_phone=%2B15551234567&CallSid=${callSid}&retry_count=1`,
    { SpeechResult: "555 765 4321" }
  );
  assert.match(captured.text, /Thank you, we will be in touch soon/);
  assert.match(captured.text, /<Hangup\/>/);

  const status = await postForm(baseUrl, "/twilio/voice/status", {
    lead_id: "lead-contact",
    lead_name: "Ada Lovelace",
    lead_phone: "+15551234567",
    CallSid: callSid,
    CallStatus: "completed"
  });

  assert.equal(status.response.status, 204);
  assert.equal(sheets.appended.length, 1);
  assert.equal(sheets.appended[0].lead_name, "Ada Lovelace");
  assert.equal(sheets.appended[0].lead_phone, "+15551234567");
  assert.equal(sheets.appended[0].preferred_phone, "+15557654321");
  assert.equal(sheets.appended[0].interest_intent, "yes");
  assert.equal(sheets.appended[0].call_status, "completed");
  assert.match(sheets.appended[0].timestamp_utc, /^\d{4}-\d{2}-\d{2}T/);
});

test("terminal status callbacks append once and failed calls are marked v/f", async (t) => {
  const sheets = makeSheetsRecorder();
  const baseUrl = await withServer(t, sheets.adapter);

  const first = await postForm(baseUrl, "/twilio/status", {
    lead_name: "Failure Case",
    lead_phone: "+15550009999",
    CallSid: "CA-terminal-once",
    CallStatus: "failed"
  });
  const duplicate = await postForm(baseUrl, "/twilio/status", {
    lead_name: "Failure Case",
    lead_phone: "+15550009999",
    CallSid: "CA-terminal-once",
    CallStatus: "failed"
  });

  assert.equal(first.response.status, 204);
  assert.equal(duplicate.response.status, 204);
  assert.equal(sheets.appended.length, 1);
  assert.equal(sheets.appended[0].interest_intent, "v/f");
  assert.equal(sheets.appended[0].call_status, "failed");
});

test("non-terminal status callbacks are ignored", async (t) => {
  const sheets = makeSheetsRecorder();
  const baseUrl = await withServer(t, sheets.adapter);

  const status = await postForm(baseUrl, "/twilio/voice/status", {
    lead_name: "Ringing Case",
    lead_phone: "+15550008888",
    CallSid: "CA-ringing",
    CallStatus: "ringing"
  });

  assert.equal(status.response.status, 204);
  assert.equal(sheets.appended.length, 0);
});
