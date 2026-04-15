const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

function expandHome(filePath) {
  const value = String(filePath || "");
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return `${os.homedir()}${value.slice(1)}`;
  }
  return value;
}

function buildCloudflaredArgs(options) {
  const args = ["tunnel"];
  const configPath = expandHome(options.configPath);

  if (configPath) {
    args.push("--config", configPath);
  }

  args.push("run");

  if (options.tunnel) {
    args.push(options.tunnel);
  }

  return args;
}

function createCloudflaredStatus(options = {}) {
  return {
    enabled: Boolean(options.autoStart),
    status: options.autoStart ? "not_started" : "disabled",
    pid: null,
    command: options.command || "cloudflared",
    configPath: expandHome(options.configPath || "~/.cloudflared/config.yml"),
    tunnel: options.tunnel || "",
    startedAt: null,
    updatedAt: new Date().toISOString(),
    lastMessage: "",
    lastError: "",
    exitCode: null,
    exitSignal: null
  };
}

function updateCloudflaredStatus(status, updates) {
  if (!status) {
    return;
  }

  Object.assign(status, updates, {
    updatedAt: new Date().toISOString()
  });
}

function getCloudflaredStatusSnapshot(status) {
  if (!status) {
    return createCloudflaredStatus({ autoStart: false });
  }

  return { ...status };
}

function startCloudflaredTunnel(options, dependencies = {}) {
  const logger = dependencies.logger || console;
  const spawnProcess = dependencies.spawn || spawn;
  const existsSync = dependencies.existsSync || fs.existsSync;
  const status = dependencies.status;

  if (!options || !options.autoStart) {
    updateCloudflaredStatus(status, {
      enabled: false,
      status: "disabled",
      lastMessage: "Cloudflare Tunnel auto-start is disabled."
    });
    logger.info("cloudflared.disabled");
    return null;
  }

  const command = options.command || "cloudflared";
  const configPath = expandHome(options.configPath);
  if (configPath && !existsSync(configPath)) {
    updateCloudflaredStatus(status, {
      status: "missing_config",
      lastError: `Cloudflare Tunnel config was not found at ${configPath}.`
    });
    logger.warn("cloudflared.config_missing", { configPath });
    return null;
  }

  const args = buildCloudflaredArgs(options);
  const child = spawnProcess(command, args, {
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.cloudflaredStatus = status;

  updateCloudflaredStatus(status, {
    enabled: true,
    status: "starting",
    pid: child.pid || null,
    command,
    configPath,
    tunnel: options.tunnel || "",
    startedAt: new Date().toISOString(),
    lastMessage: "Cloudflare Tunnel process started.",
    lastError: "",
    exitCode: null,
    exitSignal: null
  });

  logger.info("cloudflared.starting", { command, args });

  child.stdout?.on("data", (chunk) => {
    const line = String(chunk).trim();
    updateCloudflaredStatus(status, { lastMessage: line });
    logger.info("cloudflared.stdout", { line });
  });

  child.stderr?.on("data", (chunk) => {
    const line = String(chunk).trim();
    const updates = { lastMessage: line };
    if (line.includes("Registered tunnel connection")) {
      updates.status = "running";
    }
    if (line.includes("ERR ")) {
      updates.lastError = line;
    }
    updateCloudflaredStatus(status, updates);
    logger.warn("cloudflared.stderr", { line });
  });

  child.on("error", (error) => {
    updateCloudflaredStatus(status, {
      status: "error",
      lastError: error.message
    });
    logger.error("cloudflared.start_failed", { error: error.message });
  });

  child.on("exit", (code, signal) => {
    updateCloudflaredStatus(status, {
      status: child.killed ? "stopped" : "exited",
      pid: null,
      exitCode: code,
      exitSignal: signal
    });
    logger.warn("cloudflared.exited", { code, signal });
  });

  return child;
}

function stopCloudflaredTunnel(child, logger = console) {
  if (!child || child.killed) {
    return;
  }

  updateCloudflaredStatus(child.cloudflaredStatus, {
    status: "stopping",
    lastMessage: "Cloudflare Tunnel stop requested."
  });
  logger.info("cloudflared.stopping", { pid: child.pid });
  child.kill("SIGTERM");
}

module.exports = {
  buildCloudflaredArgs,
  createCloudflaredStatus,
  expandHome,
  getCloudflaredStatusSnapshot,
  startCloudflaredTunnel,
  stopCloudflaredTunnel
};
