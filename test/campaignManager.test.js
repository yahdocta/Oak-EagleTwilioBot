const assert = require("node:assert/strict");
const test = require("node:test");

const { CampaignManager } = require("../src/server/campaignManager");
const { buildTestConfig, makeTempDir, writeTempFile } = require("./helpers");

function makeCsv() {
  return "lead_id,lead_name,lead_phone\nlead-1,Ada Lovelace,+15550000001\n";
}

test("CampaignManager uploads CSVs and records campaign activity", async () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "campaign.csv", makeCsv());
  const createdCalls = [];
  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({
      calls: {
        create: async (payload) => {
          createdCalls.push(payload);
          return { sid: "CA-manager-test" };
        }
      }
    })
  });

  manager.setUploadedCsv(csvPath);
  assert.equal(manager.getState().uploadedLeadCount, 1);

  manager.start("manager-test");
  await manager.runPromise;

  const state = manager.getState();
  assert.equal(state.status, "completed");
  assert.equal(state.summary.successCount, 1);
  assert.equal(createdCalls.length, 1);
  assert.equal(state.activity.some((entry) => entry.message === "Call created"), true);
});

test("CampaignManager rejects starting without an uploaded CSV", () => {
  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({ calls: { create: async () => ({ sid: "CA-unused" }) } })
  });

  assert.throws(() => manager.start("missing-csv"), /Upload a CSV before starting/);
  assert.equal(manager.getState().status, "idle");
});

test("CampaignManager stop ends active calls and records the stop request", async () => {
  const endedCalls = [];
  const calls = (callSid) => ({
    update: async (payload) => {
      endedCalls.push({ callSid, payload });
    }
  });
  calls.create = async () => ({ sid: "CA-unused" });

  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({ calls })
  });

  manager.status = "running";
  manager.currentCampaignId = "stop-test";
  manager.twilioClient = { calls };
  manager.activeCalls.set("CA-stop-test", {
    lead_id: "lead-1",
    lead_name: "Ada Lovelace",
    lead_phone: "+15550000001"
  });

  const stoppingState = await manager.stop();
  assert.equal(stoppingState.status, "stopping");
  assert.equal(stoppingState.stopRequested, true);
  assert.deepEqual(endedCalls, [
    {
      callSid: "CA-stop-test",
      payload: { status: "completed" }
    }
  ]);
  assert.equal(
    manager.getState().activity.some((entry) => entry.message === "Campaign stop requested"),
    true
  );
});
