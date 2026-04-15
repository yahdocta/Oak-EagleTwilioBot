const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  buildCloudflaredArgs,
  createCloudflaredStatus,
  expandHome,
  getCloudflaredStatusSnapshot,
  startCloudflaredTunnel,
  stopCloudflaredTunnel
} = require("../src/server/cloudflared");

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

test("buildCloudflaredArgs builds config-based tunnel run command", () => {
  assert.deepEqual(
    buildCloudflaredArgs({
      configPath: "/home/user/.cloudflared/config.yml",
      tunnel: ""
    }),
    ["tunnel", "--config", "/home/user/.cloudflared/config.yml", "run"]
  );
});

test("buildCloudflaredArgs appends explicit tunnel name when configured", () => {
  assert.deepEqual(
    buildCloudflaredArgs({
      configPath: "/etc/cloudflared/config.yml",
      tunnel: "oak-eagle-bot"
    }),
    ["tunnel", "--config", "/etc/cloudflared/config.yml", "run", "oak-eagle-bot"]
  );
});

test("expandHome expands tilde paths", () => {
  assert.match(expandHome("~/.cloudflared/config.yml"), /\/\.cloudflared\/config\.yml$/);
});

test("startCloudflaredTunnel skips startup when disabled", () => {
  const logger = makeLogger();
  const status = createCloudflaredStatus({ autoStart: true });
  let spawnCalled = false;

  const child = startCloudflaredTunnel(
    { autoStart: false },
    {
      logger,
      status,
      spawn: () => {
        spawnCalled = true;
      }
    }
  );

  assert.equal(child, null);
  assert.equal(spawnCalled, false);
  assert.equal(status.status, "disabled");
  assert.equal(status.enabled, false);
  assert.equal(logger.entries[0].message, "cloudflared.disabled");
});

test("startCloudflaredTunnel skips startup when config file is missing", () => {
  const logger = makeLogger();
  const status = createCloudflaredStatus({ autoStart: true });
  let spawnCalled = false;

  const child = startCloudflaredTunnel(
    {
      autoStart: true,
      command: "cloudflared",
      configPath: "/missing/config.yml",
      tunnel: ""
    },
    {
      logger,
      status,
      existsSync: () => false,
      spawn: () => {
        spawnCalled = true;
      }
    }
  );

  assert.equal(child, null);
  assert.equal(spawnCalled, false);
  assert.equal(status.status, "missing_config");
  assert.match(status.lastError, /config was not found/);
  assert.equal(logger.entries[0].message, "cloudflared.config_missing");
});

test("startCloudflaredTunnel tracks process status and stop terminates it", () => {
  const logger = makeLogger();
  const status = createCloudflaredStatus({ autoStart: true });
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.pid = 123;
  child.kill = (signal) => {
    child.killed = true;
    child.signal = signal;
  };
  let spawnArgs = null;

  const result = startCloudflaredTunnel(
    {
      autoStart: true,
      command: "cloudflared",
      configPath: "/home/user/.cloudflared/config.yml",
      tunnel: ""
    },
    {
      logger,
      status,
      existsSync: () => true,
      spawn: (command, args, options) => {
        spawnArgs = { command, args, options };
        return child;
      }
    }
  );

  assert.equal(result, child);
  assert.equal(spawnArgs.command, "cloudflared");
  assert.deepEqual(spawnArgs.args, [
    "tunnel",
    "--config",
    "/home/user/.cloudflared/config.yml",
    "run"
  ]);
  assert.deepEqual(spawnArgs.options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(status.status, "starting");
  assert.equal(status.pid, 123);

  child.stderr.write("2026 INF Registered tunnel connection connIndex=0\n");
  assert.equal(status.status, "running");

  child.stderr.write("2026 ERR failed to serve tunnel connection\n");
  assert.match(status.lastError, /failed to serve tunnel connection/);

  stopCloudflaredTunnel(child, logger);
  assert.equal(child.killed, true);
  assert.equal(child.signal, "SIGTERM");
  assert.equal(status.status, "stopping");

  child.emit("exit", null, "SIGTERM");
  assert.equal(status.status, "stopped");
  assert.equal(status.pid, null);
});

test("getCloudflaredStatusSnapshot returns a defensive copy", () => {
  const status = createCloudflaredStatus({
    autoStart: true,
    command: "cloudflared",
    configPath: "/tmp/config.yml"
  });
  const snapshot = getCloudflaredStatusSnapshot(status);

  snapshot.status = "mutated";
  assert.equal(status.status, "not_started");
});
