const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
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

test("CampaignManager schedules a non-loop campaign in the selected time zone", async () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "campaign.csv", makeCsv());
  const createdCalls = [];
  let scheduledCallback;
  let scheduledDelay;
  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({
      calls: {
        create: async (payload) => {
          createdCalls.push(payload);
          return { sid: "CA-scheduled" };
        }
      }
    }),
    now: () => new Date("2026-04-15T12:00:00.000Z"),
    setTimer: (callback, delay) => {
      scheduledCallback = callback;
      scheduledDelay = delay;
      return { id: "timer-1" };
    },
    clearTimer: () => {}
  });

  manager.setUploadedCsv(csvPath);
  const state = manager.start("scheduled-non-loop", {
    scheduleStartAt: "2026-04-15T09:30",
    scheduleTimezone: "America/New_York"
  });

  assert.equal(state.status, "scheduled");
  assert.equal(state.scheduledStartAt, "2026-04-15T13:30:00.000Z");
  assert.equal(state.scheduledTimezone, "America/New_York");
  assert.equal(state.loopEnabled, false);
  assert.equal(scheduledDelay, 90 * 60 * 1000);
  assert.equal(createdCalls.length, 0);

  scheduledCallback();
  await manager.runPromise;

  const finishedState = manager.getState();
  assert.equal(finishedState.status, "completed");
  assert.equal(finishedState.campaignId, "scheduled-non-loop");
  assert.equal(finishedState.scheduledStartAt, null);
  assert.equal(finishedState.scheduledTimezone, null);
  assert.equal(createdCalls.length, 1);
});

test("CampaignManager schedules a looped campaign and keeps loop options for launch", async () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "campaign.csv", makeCsv());
  const createdCalls = [];
  let scheduledCallback;
  let waitCount = 0;
  let manager;
  manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({
      calls: {
        create: async (payload) => {
          const sid = `CA-scheduled-loop-${createdCalls.length + 1}`;
          createdCalls.push(payload);
          return { sid };
        }
      }
    }),
    now: () => new Date("2026-04-15T12:00:00.000Z"),
    setTimer: (callback) => {
      scheduledCallback = callback;
      return { id: "timer-loop" };
    },
    clearTimer: () => {},
    sleep: async () => {
      waitCount += 1;
      if (waitCount === 1) {
        manager.handleCallOutcome({
          campaign_id: "scheduled-loop",
          lead_id: "lead-1",
          call_sid: "CA-scheduled-loop-1",
          call_status: "completed",
          interest_intent: "no"
        });
      }
    }
  });

  manager.setUploadedCsv(csvPath);
  const scheduledState = manager.start("scheduled-loop", {
    loopEnabled: true,
    loopIntervalHours: 0.25,
    scheduleStartAt: "2026-04-15T14:00",
    scheduleTimezone: "UTC"
  });

  assert.equal(scheduledState.status, "scheduled");
  assert.equal(scheduledState.loopEnabled, true);
  assert.equal(scheduledState.loopIntervalHours, 0.25);
  assert.equal(scheduledState.pendingLeadCount, 1);

  scheduledCallback();
  await manager.runPromise;

  const state = manager.getState();
  assert.equal(state.status, "completed");
  assert.equal(state.summary.loopEnabled, true);
  assert.equal(state.summary.loopRound, 1);
  assert.equal(state.summary.removedNotInterestedCount, 1);
  assert.equal(createdCalls.length, 1);
});

test("CampaignManager cancels a scheduled campaign before it starts", async () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "campaign.csv", makeCsv());
  const clearedTimers = [];
  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({ calls: { create: async () => ({ sid: "CA-unused" }) } }),
    now: () => new Date("2026-04-15T12:00:00.000Z"),
    setTimer: () => "scheduled-timer",
    clearTimer: (timer) => clearedTimers.push(timer)
  });

  manager.setUploadedCsv(csvPath);
  manager.start("cancel-scheduled", {
    scheduleStartAt: "2026-04-15T13:00",
    scheduleTimezone: "UTC"
  });

  const state = await manager.stop();

  assert.equal(state.status, "idle");
  assert.equal(state.campaignId, null);
  assert.equal(state.scheduledStartAt, null);
  assert.deepEqual(clearedTimers, ["scheduled-timer"]);
  assert.equal(
    state.activity.some((entry) => entry.message === "Scheduled campaign cancelled"),
    true
  );
});

test("CampaignManager validates scheduled start edge cases", () => {
  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({ calls: { create: async () => ({ sid: "CA-unused" }) } }),
    now: () => new Date("2026-04-15T12:00:00.000Z")
  });
  const dir = makeTempDir();
  manager.setUploadedCsv(writeTempFile(dir, "campaign.csv", makeCsv()));

  assert.throws(
    () => manager.start("missing-zone", { scheduleStartAt: "2026-04-15T13:00" }),
    /Schedule time zone is required/
  );
  assert.throws(
    () =>
      manager.start("bad-zone", {
        scheduleStartAt: "2026-04-15T13:00",
        scheduleTimezone: "Mars/Olympus"
      }),
    /valid IANA time zone/
  );
  assert.throws(
    () =>
      manager.start("past", {
        scheduleStartAt: "2026-04-15T11:59",
        scheduleTimezone: "UTC"
      }),
    /Schedule time must be in the future/
  );
  assert.throws(
    () =>
      manager.start("dst-gap", {
        scheduleStartAt: "2026-03-08T02:30",
        scheduleTimezone: "America/New_York"
      }),
    /not valid in the selected time zone/
  );
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

test("CampaignManager pauses loop dialing until resumed", async () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "campaign.csv",
    "lead_id,lead_name,lead_phone\nlead-1,Ada Lovelace,+15550000001\n"
  );
  const createdCalls = [];
  let manager;
  let sleepResolve;
  let pauseWaitStarted = false;
  let pauseWaitResolve;

  manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({
      calls: {
        create: async (payload) => {
          const sid = `CA-pause-${createdCalls.length + 1}`;
          createdCalls.push({ sid, payload });
          return { sid };
        }
      }
    }),
    sleep: async () =>
      new Promise((resolve) => {
        sleepResolve = resolve;
      })
  });

  manager.setUploadedCsv(csvPath);
  const originalHandleCampaignEvent = manager.handleCampaignEvent.bind(manager);
  manager.handleCampaignEvent = (eventName, event) => {
    originalHandleCampaignEvent(eventName, event);
    if (eventName === "campaign.call_created" && event.callSid === "CA-pause-1") {
      manager.handleCallOutcome({
        campaign_id: "pause-test",
        lead_id: "lead-1",
        call_sid: event.callSid,
        call_status: "no-answer",
        interest_intent: "unknown"
      });
    }
    if (eventName === "campaign.call_created" && event.callSid === "CA-pause-2") {
      manager.handleCallOutcome({
        campaign_id: "pause-test",
        lead_id: "lead-1",
        call_sid: event.callSid,
        call_status: "completed",
        interest_intent: "no"
      });
    }
  };
  manager.start("pause-test", { loopEnabled: true, loopIntervalHours: 0.1 });

  while (!sleepResolve) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  manager.togglePause();
  assert.equal(manager.getState().isPaused, true);
  assert.equal(manager.getState().status, "running");
  assert.equal(
    manager.getState().activity.some((entry) => entry.message === "Campaign paused"),
    true
  );

  const originalWaitWhilePaused = manager.waitWhilePaused.bind(manager);
  manager.waitWhilePaused = async () => {
    if (pauseWaitStarted) {
      return originalWaitWhilePaused();
    }

    pauseWaitStarted = true;
    await new Promise((resolve) => {
      pauseWaitResolve = resolve;
    });
    return originalWaitWhilePaused();
  };

  sleepResolve();
  while (!pauseWaitStarted) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(createdCalls.length, 1);
  assert.equal(manager.runPromise !== null, true);

  manager.togglePause();
  pauseWaitResolve();
  await manager.runPromise;

  const state = manager.getState();
  assert.equal(state.status, "completed");
  assert.equal(state.isPaused, false);
  assert.equal(createdCalls.length, 2);
  assert.equal(
    state.activity.some((entry) => entry.message === "Campaign resumed"),
    true
  );
});

test("CampaignManager pauses queued leads in the current dial round", async () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "campaign.csv",
    [
      "lead_id,lead_name,lead_phone",
      "lead-1,Ada Lovelace,+15550000001",
      "lead-2,Grace Hopper,+15550000002"
    ].join("\n") + "\n"
  );
  const createdCalls = [];
  let manager;

  manager = new CampaignManager({
    config: buildTestConfig({ batch: { maxConcurrency: 1 } }),
    twilioClientFactory: () => ({
      calls: {
        create: async (payload) => {
          const sid = `CA-current-round-${createdCalls.length + 1}`;
          createdCalls.push({ sid, payload });
          return { sid };
        }
      }
    })
  });

  manager.setUploadedCsv(csvPath);
  const originalHandleCampaignEvent = manager.handleCampaignEvent.bind(manager);
  manager.handleCampaignEvent = (eventName, event) => {
    originalHandleCampaignEvent(eventName, event);
    if (eventName === "campaign.call_created" && event.callSid === "CA-current-round-1") {
      manager.togglePause();
    }
  };

  manager.start("current-round-pause");

  while (createdCalls.length < 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(manager.getState().isPaused, true);
  assert.equal(createdCalls.length, 1);

  manager.togglePause();
  await manager.runPromise;

  const state = manager.getState();
  assert.equal(state.status, "completed");
  assert.equal(createdCalls.length, 2);
  assert.equal(createdCalls[1].payload.to, "+15550000002");
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

test("CampaignManager labels non-loop voicemail outcomes as unresolved", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "campaign.csv", makeCsv());
  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({ calls: { create: async () => ({ sid: "CA-unused" }) } })
  });

  manager.setUploadedCsv(csvPath);
  manager.currentCampaignId = "non-loop-voicemail";
  manager.loopEnabled = false;
  manager.pendingLeadIds.add("lead-1");
  manager.handleCallOutcome({
    campaign_id: "non-loop-voicemail",
    lead_id: "lead-1",
    call_sid: "CA-non-loop-voicemail",
    call_status: "voicemail",
    interest_intent: "v/f"
  });

  const [lead] = manager.getState().recurringCallList;
  const [activity] = manager.getState().activity;
  assert.equal(lead.status, "unresolved");
  assert.equal(lead.lastCallStatus, "voicemail");
  assert.equal(lead.lastIntent, "v/f");
  assert.equal(activity.message, "Lead unresolved after call");
  assert.equal(activity.meta.pendingLeadCount, 0);
});

test("CampaignManager exposes completed call transcripts in recurring call list", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "campaign.csv",
    "lead_id,lead_name,lead_phone,lead_address\nlead-1,Ada Lovelace,+15550000001,123 Oak St\n"
  );
  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({ calls: { create: async () => ({ sid: "CA-unused" }) } })
  });

  manager.setUploadedCsv(csvPath);
  manager.currentCampaignId = "transcript-test";
  manager.loopEnabled = true;
  manager.pendingLeadIds.add("lead-1");
  manager.handleCallOutcome({
    campaign_id: "transcript-test",
    lead_id: "lead-1",
    lead_name: "Ada Lovelace",
    lead_phone: "+15550000001",
    lead_address: "123 Oak St",
    call_sid: "CA-transcript",
    call_status: "completed",
    interest_intent: "unknown",
    preferred_phone: "+15550009999",
    call_transcript: "Intent: maybe later\nPreferred phone: 555 000 9999",
    timestamp_utc: "2026-04-15T12:34:56.000Z"
  });

  const [lead] = manager.getState().recurringCallList;
  assert.equal(lead.lastCallStatus, "completed");
  assert.equal(lead.callTranscript, "Intent: maybe later\nPreferred phone: 555 000 9999");
  assert.equal(lead.preferredPhone, "+15550009999");
  assert.equal(lead.completedAt, "2026-04-15T12:34:56.000Z");
  assert.equal(lead.leadAddress, "123 Oak St");
});

test("CampaignManager can remove a lead from the recurring call list", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "campaign.csv",
    [
      "lead_id,lead_name,lead_phone",
      "lead-1,Ada Lovelace,+15550000001",
      "lead-2,Grace Hopper,+15550000002"
    ].join("\n") + "\n"
  );
  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({ calls: { create: async () => ({ sid: "CA-unused" }) } })
  });

  manager.setUploadedCsv(csvPath);
  manager.currentCampaignId = "remove-test";
  manager.loopEnabled = true;
  manager.pendingLeadIds = new Set(["lead-1", "lead-2"]);

  const state = manager.removeRecurringLead("lead-1");

  assert.equal(state.uploadedLeadCount, 1);
  assert.equal(state.pendingLeadCount, 1);
  assert.deepEqual(
    state.recurringCallList.map((lead) => lead.leadId),
    ["lead-2"]
  );
  assert.equal(manager.getState().activity[0].message, "Lead removed from recurring calls");
  assert.throws(() => manager.removeRecurringLead("missing"), /Lead was not found/);
});

test("CampaignManager updates visible lead count after removing every recurring lead", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "campaign.csv", makeCsv());
  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({ calls: { create: async () => ({ sid: "CA-unused" }) } })
  });

  manager.setUploadedCsv(csvPath);
  manager.currentCampaignId = "remove-count-test";
  manager.pendingLeadIds = new Set(["lead-1"]);

  const state = manager.removeRecurringLead("lead-1");

  assert.equal(state.uploadedLeadCount, 0);
  assert.equal(state.pendingLeadCount, 0);
  assert.deepEqual(state.recurringCallList, []);
});

test("CampaignManager saves the recurring call list as a new CSV", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "campaign.csv",
    [
      "lead_id,lead_name,lead_phone,lead_address,lead_city",
      'lead-1,"Ada, Lovelace",+15550000001,"123 Oak St, Boston, MA",Boston',
      "lead-2,Grace Hopper,+15550000002,456 Pine St,Arlington"
    ].join("\n") + "\n"
  );
  const exportDir = path.join(dir, "exports");
  const manager = new CampaignManager({
    config: buildTestConfig(),
    twilioClientFactory: () => ({ calls: { create: async () => ({ sid: "CA-unused" }) } }),
    now: () => new Date("2026-04-15T12:34:56.000Z")
  });

  manager.setUploadedCsv(csvPath);
  manager.currentCampaignId = "export-test";
  manager.loopEnabled = true;
  manager.pendingLeadIds = new Set(["lead-1", "lead-2"]);
  manager.handleCallOutcome({
    campaign_id: "export-test",
    lead_id: "lead-1",
    call_sid: "CA-export",
    call_status: "completed",
    interest_intent: "unknown",
    preferred_phone: "+15550009999",
    call_transcript: "Line one\nLine two",
    timestamp_utc: "2026-04-15T12:30:00.000Z"
  });
  manager.removeRecurringLead("lead-2");

  const saved = manager.saveRecurringCallListCsv({ outputDir: exportDir });
  const csv = fs.readFileSync(saved.path, "utf8");

  assert.equal(saved.name, "export-test-recurring-calls-2026-04-15T12-34-56-000Z.csv");
  assert.equal(saved.count, 1);
  assert.equal(path.dirname(saved.path), exportDir);
  assert.equal(
    csv,
    [
      "lead_id,lead_name,lead_phone,lead_address,lead_city,status,last_call_status,last_intent,call_sid,round,is_pending,is_active,completed_at,preferred_phone,call_transcript,updated_at",
      '"lead-1","Ada, Lovelace","+15550000001","123 Oak St, Boston, MA","Boston","waiting_next_loop","completed","unknown","CA-export","0","true","false","2026-04-15T12:30:00.000Z","+15550009999","Line one\nLine two","2026-04-15T12:34:56.000Z"',
      ""
    ].join("\n")
  );
  assert.equal(manager.getState().lastRecurringCsv.name, saved.name);
  assert.equal(manager.getState().activity[0].message, "Recurring call list saved");
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
