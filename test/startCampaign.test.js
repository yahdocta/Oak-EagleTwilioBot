const assert = require("node:assert/strict");
const test = require("node:test");

const { startCampaign } = require("../src/campaigns/startCampaign");
const { buildTestConfig, makeTempDir, writeTempFile } = require("./helpers");

function makeCsv(rowCount) {
  const rows = ["lead_id,lead_name,lead_phone"];
  for (let index = 1; index <= rowCount; index += 1) {
    rows.push(`lead-${index},Lead ${index},+1555000000${index}`);
  }
  return `${rows.join("\n")}\n`;
}

test("startCampaign creates outbound calls from a fake CSV", async () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "campaign.csv", makeCsv(2));
  const createdCalls = [];
  const twilioClient = {
    calls: {
      create: async (payload) => {
        createdCalls.push(payload);
        return { sid: `CA${createdCalls.length}` };
      }
    }
  };

  const summary = await startCampaign(csvPath, {
    config: buildTestConfig(),
    campaignId: "spring-test",
    twilioClient
  });

  assert.equal(summary.totalLeads, 2);
  assert.equal(summary.successCount, 2);
  assert.equal(summary.failureCount, 0);
  assert.equal(createdCalls.length, 2);
  assert.equal(createdCalls[0].to, "+15550000001");
  assert.equal(createdCalls[0].from, "+15550000000");
  assert.equal(createdCalls[0].machineDetection, "DetectMessageEnd");
  assert.equal(createdCalls[0].asyncAmd, true);
  assert.match(createdCalls[0].url, /^https:\/\/voice\.example\.test\/twilio\/voice\/outbound\?/);
  assert.match(createdCalls[0].url, /lead_id=lead-1/);
  assert.match(createdCalls[0].url, /lead_name=Lead\+1/);
  assert.match(createdCalls[0].statusCallback, /^https:\/\/hooks\.example\.test\/twilio\/status\?/);
  assert.match(createdCalls[0].asyncAmdStatusCallback, /\/twilio\/voice\/status\?/);
});

test("startCampaign reports individual call failures without aborting the campaign", async () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "campaign.csv", makeCsv(3));
  const twilioClient = {
    calls: {
      create: async (payload) => {
        if (payload.to.endsWith("2")) {
          throw new Error("Twilio rejected this number");
        }
        return { sid: `CA-${payload.to}` };
      }
    }
  };

  const summary = await startCampaign(csvPath, {
    config: buildTestConfig(),
    campaignId: "failure-test",
    twilioClient
  });

  assert.equal(summary.totalLeads, 3);
  assert.equal(summary.successCount, 2);
  assert.equal(summary.failureCount, 1);
  assert.equal(summary.results[1].ok, false);
  assert.equal(summary.results[1].error, "Twilio rejected this number");
});

test("startCampaign respects configured maxConcurrency", async () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "campaign.csv", makeCsv(6));
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const twilioClient = {
    calls: {
      create: async () => {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeCalls -= 1;
        return { sid: "CA-concurrent" };
      }
    }
  };

  const summary = await startCampaign(csvPath, {
    config: buildTestConfig({ batch: { maxConcurrency: 2 } }),
    campaignId: "concurrency-test",
    twilioClient
  });

  assert.equal(summary.successCount, 6);
  assert.equal(maxActiveCalls <= 2, true);
});

test("startCampaign handles empty fake CSVs without calling Twilio", async () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "empty.csv", "lead_id,lead_name,lead_phone\n");
  let createCount = 0;
  const twilioClient = {
    calls: {
      create: async () => {
        createCount += 1;
        return { sid: "CA-empty" };
      }
    }
  };

  const summary = await startCampaign(csvPath, {
    config: buildTestConfig(),
    campaignId: "empty-test",
    twilioClient
  });

  assert.equal(createCount, 0);
  assert.deepEqual(summary, {
    campaignId: "empty-test",
    totalLeads: 0,
    successCount: 0,
    failureCount: 0,
    results: []
  });
});

test("startCampaign skips queued leads when stop is requested", async () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "campaign.csv", makeCsv(3));
  const events = [];
  let shouldStop = false;
  const twilioClient = {
    calls: {
      create: async () => {
        shouldStop = true;
        return { sid: "CA-first-only" };
      }
    }
  };

  const summary = await startCampaign(csvPath, {
    config: buildTestConfig({ batch: { maxConcurrency: 1 } }),
    campaignId: "stop-test",
    twilioClient,
    shouldStop: () => shouldStop,
    onEvent: async (eventName, event) => {
      events.push({ eventName, event });
    }
  });

  assert.equal(summary.totalLeads, 3);
  assert.equal(summary.successCount, 1);
  assert.equal(summary.failureCount, 0);
  assert.equal(summary.skippedCount, 2);
  assert.equal(summary.results.filter((result) => result.skipped).length, 2);
  assert.equal(
    events.filter((entry) => entry.eventName === "campaign.lead_skipped").length,
    2
  );
});
