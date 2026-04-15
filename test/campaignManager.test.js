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

test("CampaignManager loop keeps no-answer leads and removes yes or no intent leads", async () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "campaign.csv",
    "lead_id,lead_name,lead_phone\nlead-1,Ada Lovelace,+15550000001\nlead-2,Grace Hopper,+15550000002\n"
  );
  const createdCalls = [];
  let manager;
  let waitCount = 0;

  manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({
      calls: {
        create: async (payload) => {
          const sid = `CA-loop-${createdCalls.length + 1}`;
          createdCalls.push({ sid, payload });
          return { sid };
        }
      }
    }),
    sleep: async () => {
      waitCount += 1;
      if (waitCount === 1) {
        manager.handleCallOutcome({
          campaign_id: "loop-test",
          lead_id: "lead-1",
          call_sid: "CA-loop-1",
          call_status: "no-answer",
          interest_intent: "unknown"
        });
        manager.handleCallOutcome({
          campaign_id: "loop-test",
          lead_id: "lead-2",
          call_sid: "CA-loop-2",
          call_status: "completed",
          interest_intent: "yes"
        });
        return;
      }

      manager.handleCallOutcome({
        campaign_id: "loop-test",
        lead_id: "lead-1",
        call_sid: "CA-loop-3",
        call_status: "completed",
        interest_intent: "no"
      });
    }
  });

  manager.setUploadedCsv(csvPath);
  manager.start("loop-test", { loopEnabled: true, loopIntervalHours: 0.1 });
  await manager.runPromise;

  const state = manager.getState();
  assert.equal(state.status, "completed");
  assert.equal(createdCalls.length, 3);
  assert.equal(createdCalls[0].payload.to, "+15550000001");
  assert.equal(createdCalls[1].payload.to, "+15550000002");
  assert.equal(createdCalls[2].payload.to, "+15550000001");
  assert.equal(state.summary.pendingLeadCount, 0);
  assert.equal(state.summary.removedInterestedCount, 1);
  assert.equal(state.summary.removedNotInterestedCount, 1);
});

test("CampaignManager labels duplicate yes outcomes as logging lead", () => {
  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({ calls: { create: async () => ({ sid: "CA-unused" }) } })
  });

  manager.currentCampaignId = "label-test";
  manager.handleCallOutcome({
    campaign_id: "label-test",
    lead_id: "lead-1",
    call_sid: "CA-label-test",
    call_status: "completed",
    interest_intent: "yes"
  });

  assert.equal(manager.getState().activity[0].message, "Logging lead");
});

test("CampaignManager marks no intent as declined even outside loop pending state", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "campaign.csv", makeCsv());
  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({ calls: { create: async () => ({ sid: "CA-unused" }) } })
  });

  manager.setUploadedCsv(csvPath);
  manager.currentCampaignId = "non-loop-no";
  manager.loopEnabled = false;
  manager.pendingLeadIds.clear();
  manager.handleCallOutcome({
    campaign_id: "non-loop-no",
    lead_id: "lead-1",
    call_sid: "CA-non-loop-no",
    call_status: "completed",
    interest_intent: "no"
  });

  const [lead] = manager.getState().recurringCallList;
  assert.equal(lead.status, "declined");
  assert.equal(lead.lastCallStatus, "completed");
  assert.equal(lead.lastIntent, "no");
  assert.equal(lead.callSid, "CA-non-loop-no");
  assert.equal(manager.getState().activity[0].message, "Lead declined and removed");
});

test("CampaignManager exposes recurring call list statuses", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "campaign.csv",
    [
      "lead_id,lead_name,lead_phone",
      "lead-1,Ada Lovelace,+15550000001",
      "lead-2,Grace Hopper,+15550000002",
      "lead-3,Katherine Johnson,+15550000003",
      "lead-4,Dorothy Vaughan,+15550000004",
      "lead-5,Mary Jackson,+15550000005",
      "lead-6,Hedy Lamarr,+15550000006",
      "lead-7,Annie Easley,+15550000007"
    ].join("\n") + "\n"
  );

  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({ calls: { create: async () => ({ sid: "CA-unused" }) } })
  });

  manager.setUploadedCsv(csvPath);
  assert.deepEqual(
    manager.getState().recurringCallList.map((lead) => lead.status),
    ["ready", "ready", "ready", "ready", "ready", "ready", "ready"]
  );

  manager.currentCampaignId = "status-test";
  manager.loopEnabled = true;
  manager.pendingLeadIds = new Set([
    "lead-1",
    "lead-2",
    "lead-3",
    "lead-4",
    "lead-5",
    "lead-6",
    "lead-7"
  ]);
  manager.handleCampaignEvent("campaign.call_creating", {
    campaignId: "status-test",
    lead: {
      lead_id: "lead-1",
      lead_name: "Ada Lovelace",
      lead_phone: "+15550000001"
    }
  });
  manager.handleCampaignEvent("campaign.call_created", {
    campaignId: "status-test",
    lead: {
      lead_id: "lead-1",
      lead_name: "Ada Lovelace",
      lead_phone: "+15550000001"
    },
    callSid: "CA-active"
  });
  manager.handleCallOutcome({
    campaign_id: "status-test",
    lead_id: "lead-1",
    call_sid: "CA-logged",
    call_status: "completed",
    interest_intent: "yes"
  });
  manager.handleCallOutcome({
    campaign_id: "status-test",
    lead_id: "lead-2",
    call_sid: "CA-missed",
    call_status: "no-answer",
    interest_intent: "unknown"
  });
  manager.handleCallOutcome({
    campaign_id: "status-test",
    lead_id: "lead-3",
    call_sid: "CA-declined",
    call_status: "completed",
    interest_intent: "no"
  });
  manager.handleCampaignEvent("campaign.call_create_failed", {
    campaignId: "status-test",
    lead: {
      lead_id: "lead-4",
      lead_name: "Dorothy Vaughan",
      lead_phone: "+15550000004"
    },
    error: "Twilio rejected this number"
  });
  manager.handleCampaignEvent("campaign.lead_skipped", {
    campaignId: "status-test",
    lead: {
      lead_id: "lead-5",
      lead_name: "Mary Jackson",
      lead_phone: "+15550000005"
    }
  });
  manager.handleCampaignEvent("campaign.call_created", {
    campaignId: "status-test",
    lead: {
      lead_id: "lead-6",
      lead_name: "Hedy Lamarr",
      lead_phone: "+15550000006"
    },
    callSid: "CA-active"
  });

  const list = manager.getState().recurringCallList;
  assert.equal(list[0].status, "logged");
  assert.equal(list[0].isActive, false);
  assert.equal(list[0].isPending, false);
  assert.equal(list[0].callSid, "CA-logged");
  assert.equal(list[1].status, "waiting_next_loop");
  assert.equal(list[1].isPending, true);
  assert.equal(list[1].lastCallStatus, "no-answer");
  assert.equal(list[2].status, "declined");
  assert.equal(list[2].isPending, false);
  assert.equal(list[2].lastIntent, "no");
  assert.equal(list[3].status, "retrying");
  assert.equal(list[3].lastCallStatus, "call-create-failed");
  assert.equal(list[4].status, "skipped");
  assert.equal(list[5].status, "active");
  assert.equal(list[5].isActive, true);
  assert.equal(list[5].callSid, "CA-active");
  assert.equal(list[6].status, "ready");
});
