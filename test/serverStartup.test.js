const assert = require("node:assert/strict");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const bootDir = fs.mkdtempSync(path.join(os.tmpdir(), "oak-eagle-server-startup-"));
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

const { createApp, startServer } = require("../src/server/app");
const { createCloudflaredStatus } = require("../src/server/cloudflared");

function makeLogger() {
  const entries = [];
  return {
    entries,
    debug: (message, meta) => entries.push({ level: "debug", message, meta }),
    info: (message, meta) => entries.push({ level: "info", message, meta }),
    warn: (message, meta) => entries.push({ level: "warn", message, meta }),
    error: (message, meta) => entries.push({ level: "error", message, meta })
  };
}

async function waitForListening(server) {
  if (server.listening) {
    return;
  }
  await new Promise((resolve) => server.once("listening", resolve));
}

async function waitForClose(server) {
  if (!server.listening) {
    return;
  }
  await new Promise((resolve) => server.once("close", resolve));
}

async function waitForCondition(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("startServer starts Cloudflare Tunnel after Express is listening", async () => {
  const app = express();
  app.get("/healthz", (req, res) => res.status(200).json({ ok: true }));
  const logger = makeLogger();
  const tunnelProcess = { pid: 123, killed: false };
  const cloudflaredStatus = createCloudflaredStatus({ autoStart: true });
  const tunnelStarts = [];

  const runtime = startServer({
    app,
    config: {
      server: { port: 0 },
      cloudflare: {
        autoStart: true,
        command: "cloudflared",
        configPath: "/home/user/.cloudflared/config.yml",
        tunnel: ""
      }
    },
    logger,
    cloudflaredStatus,
    startTunnel: (cloudflareConfig, dependencies) => {
      tunnelStarts.push({
        cloudflareConfig,
        loggerMatches: dependencies.logger === logger,
        statusMatches: dependencies.status === cloudflaredStatus,
        serverWasListening: runtime.server.listening
      });
      return tunnelProcess;
    },
    stopTunnel: (child) => {
      child.killed = true;
    },
    exitProcess: () => {}
  });

  await waitForListening(runtime.server);
  await waitForCondition(() => tunnelStarts.length === 1);

  assert.equal(tunnelStarts.length, 1);
  assert.equal(tunnelStarts[0].serverWasListening, true);
  assert.equal(tunnelStarts[0].loggerMatches, true);
  assert.equal(tunnelStarts[0].statusMatches, true);
  assert.equal(runtime.getCloudflaredProcess(), tunnelProcess);
  assert.equal(
    logger.entries.some((entry) => entry.message === "server.started"),
    true
  );

  runtime.shutdown("SIGTERM");
  await waitForClose(runtime.server);
  await waitForCondition(() =>
    logger.entries.some((entry) => entry.message === "server.stopped")
  );
  assert.equal(tunnelProcess.killed, true);
  assert.equal(
    logger.entries.some((entry) => entry.message === "server.stopped"),
    true
  );
});

test("createApp exposes Cloudflare Tunnel status", async (t) => {
  const cloudflaredStatus = createCloudflaredStatus({
    autoStart: true,
    command: "cloudflared",
    configPath: "/home/user/.cloudflared/config.yml",
    tunnel: ""
  });
  cloudflaredStatus.status = "running";
  cloudflaredStatus.pid = 456;
  cloudflaredStatus.lastMessage = "Registered tunnel connection";

  const app = createApp(new Map(), { cloudflaredStatus });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await waitForListening(server);
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/system/status`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.cloudflareTunnel.status, "running");
  assert.equal(payload.cloudflareTunnel.pid, 456);
  assert.equal(payload.cloudflareTunnel.lastMessage, "Registered tunnel connection");
});

test("createApp exposes disabled Cloudflare Tunnel status", async (t) => {
  const cloudflaredStatus = createCloudflaredStatus({ autoStart: false });
  cloudflaredStatus.lastMessage = "Cloudflare Tunnel auto-start is disabled.";

  const app = createApp(new Map(), { cloudflaredStatus });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await waitForListening(server);
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/system/status`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.cloudflareTunnel.enabled, false);
  assert.equal(payload.cloudflareTunnel.status, "disabled");
  assert.equal(payload.cloudflareTunnel.lastMessage, "Cloudflare Tunnel auto-start is disabled.");
});

test("static web UI includes Cloudflare Tunnel status metric hooks", async (t) => {
  const app = createApp(new Map(), {
    cloudflaredStatus: createCloudflaredStatus({ autoStart: false })
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await waitForListening(server);
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Cloudflare Tunnel/);
  assert.match(html, /id="tunnelStatus"/);
  assert.match(html, /id="tunnelDetail"/);
});

test("static web UI includes recurring call list hooks", async (t) => {
  const app = createApp(new Map(), {
    cloudflaredStatus: createCloudflaredStatus({ autoStart: false })
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await waitForListening(server);
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/`);
  const html = await response.text();
  const jsResponse = await fetch(`http://127.0.0.1:${port}/app.js`);
  const js = await jsResponse.text();
  const cssResponse = await fetch(`http://127.0.0.1:${port}/styles.css`);
  const css = await cssResponse.text();

  assert.equal(response.status, 200);
  assert.equal(jsResponse.status, 200);
  assert.equal(cssResponse.status, 200);
  assert.match(html, /Recurring Calls/);
  assert.match(html, /id="recurringSummary"/);
  assert.match(html, /id="recurringSort"/);
  assert.match(html, /id="saveRecurringCsvButton"/);
  assert.match(html, /id="downloadRecurringCsvButton"/);
  assert.match(html, /id="recurringLeadList"/);
  assert.match(html, /id="recurringTableWrap"/);
  assert.match(html, /id="recurringResizeHandle"/);
  assert.match(html, /id="leadDetailDialog"/);
  assert.match(html, /id="leadDetailTranscript"/);
  assert.match(js, /function renderRecurringCalls/);
  assert.match(js, /function startRecurringResize/);
  assert.match(js, /function setRecurringTableHeight/);
  assert.match(js, /displayedLeadCount/);
  assert.match(js, /function sortRecurringLeads/);
  assert.match(js, /function getIntentSortPriority/);
  assert.match(js, /function openLeadDetail/);
  assert.match(js, /removeRecurringLead/);
  assert.match(js, /saveRecurringCsv/);
  assert.match(js, /downloadRecurringCsv/);
  assert.match(js, /showSaveFilePicker/);
  assert.match(js, /recurringCallList/);
  assert.match(js, /recurringSort/);
  assert.match(css, /\.lead-table/);
  assert.match(css, /\.recurring-controls/);
  assert.match(css, /\.resize-handle/);
  assert.match(css, /\.lead-detail/);
  assert.match(css, /\.status-badge/);
});

test("static web UI includes campaign scheduling hooks", async (t) => {
  const app = createApp(new Map(), {
    cloudflaredStatus: createCloudflaredStatus({ autoStart: false })
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await waitForListening(server);
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/`);
  const html = await response.text();
  const jsResponse = await fetch(`http://127.0.0.1:${port}/app.js`);
  const js = await jsResponse.text();

  assert.equal(response.status, 200);
  assert.equal(jsResponse.status, 200);
  assert.match(html, /id="scheduleEnabled"/);
  assert.match(html, /id="scheduleStartAt"/);
  assert.match(html, /id="scheduleTimezone"/);
  assert.match(js, /scheduleStartAt/);
  assert.match(js, /scheduleTimezone/);
  assert.match(js, /Campaign scheduled/);
});
