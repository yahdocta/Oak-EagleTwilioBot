const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_SERVICE_NAME = "oak-eagle-twilio-bot";
const DEFAULT_DESCRIPTION = "Oak & Eagle Twilio Bot";
const DEFAULT_NPM_PATH = "/usr/bin/npm";

function requireSystemdValue(value, key) {
  if (!value || !String(value).trim()) {
    throw new Error(`${key} is required.`);
  }

  if (String(value).includes("\n")) {
    throw new Error(`${key} must not contain newlines.`);
  }

  return String(value).trim();
}

function renderSystemdService(options) {
  const serviceName = requireSystemdValue(options.serviceName, "serviceName");
  const description = requireSystemdValue(options.description, "description");
  const user = requireSystemdValue(options.user, "user");
  const workingDirectory = requireSystemdValue(options.workingDirectory, "workingDirectory");
  const npmPath = requireSystemdValue(options.npmPath, "npmPath");
  const group = options.group ? requireSystemdValue(options.group, "group") : null;
  const environmentFile = options.environmentFile
    ? requireSystemdValue(options.environmentFile, "environmentFile")
    : null;

  const serviceLines = [
    "[Unit]",
    `Description=${description}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `User=${user}`
  ];

  if (group) {
    serviceLines.push(`Group=${group}`);
  }

  serviceLines.push(
    `WorkingDirectory=${workingDirectory}`,
    "Environment=NODE_ENV=production"
  );

  if (environmentFile) {
    serviceLines.push(`EnvironmentFile=${environmentFile}`);
  }

  serviceLines.push(
    `ExecStart=${npmPath} start`,
    "Restart=always",
    "RestartSec=10",
    "KillSignal=SIGTERM",
    "TimeoutStopSec=30",
    "SyslogIdentifier=oak-eagle-twilio-bot",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    ""
  );

  return serviceLines.join("\n");
}

function getDefaultServiceOptions(dependencies = {}) {
  const cwd = dependencies.cwd || process.cwd();
  const env = dependencies.env || process.env;
  const userInfo = dependencies.userInfo || os.userInfo;
  const username = env.OAK_EAGLE_SERVICE_USER || env.SUDO_USER || userInfo().username;
  const group = env.OAK_EAGLE_SERVICE_GROUP || username;
  const envFile = path.join(cwd, ".env");

  return {
    serviceName: env.OAK_EAGLE_SERVICE_NAME || DEFAULT_SERVICE_NAME,
    description: env.OAK_EAGLE_SERVICE_DESCRIPTION || DEFAULT_DESCRIPTION,
    user: username,
    group,
    workingDirectory: cwd,
    npmPath: env.OAK_EAGLE_SERVICE_NPM || DEFAULT_NPM_PATH,
    environmentFile: fs.existsSync(envFile) ? envFile : null
  };
}

function getUnitPath(serviceName) {
  return path.join("/etc/systemd/system", `${serviceName}.service`);
}

function buildInstallCommands({ serviceName }) {
  const unitName = `${serviceName}.service`;
  return [
    ["systemctl", "daemon-reload"],
    ["systemctl", "enable", unitName],
    ["systemctl", "restart", unitName],
    ["systemctl", "status", "--no-pager", unitName]
  ];
}

module.exports = {
  DEFAULT_DESCRIPTION,
  DEFAULT_NPM_PATH,
  DEFAULT_SERVICE_NAME,
  buildInstallCommands,
  getDefaultServiceOptions,
  getUnitPath,
  renderSystemdService
};
