const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const {
  buildInstallCommands,
  getDefaultServiceOptions,
  renderSystemdService
} = require("../src/deployment/systemdService");

test("renderSystemdService creates a restarting Node app unit", () => {
  const unit = renderSystemdService({
    serviceName: "oak-eagle-twilio-bot",
    description: "Oak & Eagle Twilio Bot",
    user: "yahdocta",
    group: "yahdocta",
    workingDirectory: "/home/yahdocta/apps/Oak-EagleTwilioBot",
    npmPath: "/usr/bin/npm",
    environmentFile: "/home/yahdocta/apps/Oak-EagleTwilioBot/.env"
  });

  assert.match(unit, /^\[Unit\]/);
  assert.match(unit, /Description=Oak & Eagle Twilio Bot/);
  assert.match(unit, /After=network-online\.target/);
  assert.match(unit, /Wants=network-online\.target/);
  assert.match(unit, /User=yahdocta/);
  assert.match(unit, /Group=yahdocta/);
  assert.match(unit, /WorkingDirectory=\/home\/yahdocta\/apps\/Oak-EagleTwilioBot/);
  assert.match(unit, /Environment=NODE_ENV=production/);
  assert.match(unit, /EnvironmentFile=\/home\/yahdocta\/apps\/Oak-EagleTwilioBot\/\.env/);
  assert.match(unit, /ExecStart=\/usr\/bin\/npm start/);
  assert.match(unit, /Restart=always/);
  assert.match(unit, /RestartSec=10/);
  assert.match(unit, /KillSignal=SIGTERM/);
  assert.match(unit, /\[Install\]\nWantedBy=multi-user\.target/);
});

test("renderSystemdService omits optional group and env file when not provided", () => {
  const unit = renderSystemdService({
    serviceName: "oak-eagle-twilio-bot",
    description: "Oak & Eagle Twilio Bot",
    user: "oak",
    workingDirectory: "/srv/oak",
    npmPath: "/usr/bin/npm"
  });

  assert.match(unit, /User=oak/);
  assert.doesNotMatch(unit, /Group=/);
  assert.doesNotMatch(unit, /EnvironmentFile=/);
});

test("getDefaultServiceOptions discovers repo-local defaults", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oak-eagle-systemd-"));
  fs.writeFileSync(path.join(repoRoot, ".env"), "PORT=3000\n", "utf8");

  const options = getDefaultServiceOptions({
    cwd: repoRoot,
    env: {
      USER: "oakuser",
      npm_execpath: "/tmp/ignored/npm-cli.js"
    },
    getuid: () => 1000,
    getgid: () => 1000,
    userInfo: () => ({ username: "oakuser" })
  });

  assert.equal(options.serviceName, "oak-eagle-twilio-bot");
  assert.equal(options.description, "Oak & Eagle Twilio Bot");
  assert.equal(options.user, "oakuser");
  assert.equal(options.group, "oakuser");
  assert.equal(options.workingDirectory, repoRoot);
  assert.equal(options.environmentFile, path.join(repoRoot, ".env"));
  assert.equal(options.npmPath, "/usr/bin/npm");
});

test("getDefaultServiceOptions preserves sudo caller as service user", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oak-eagle-systemd-sudo-"));
  fs.writeFileSync(path.join(repoRoot, ".env"), "PORT=3000\n", "utf8");

  const options = getDefaultServiceOptions({
    cwd: repoRoot,
    env: {
      USER: "root",
      SUDO_USER: "yahdocta"
    },
    userInfo: () => ({ username: "root" })
  });

  assert.equal(options.user, "yahdocta");
  assert.equal(options.group, "yahdocta");
});

test("buildInstallCommands returns non-interactive systemctl steps", () => {
  const commands = buildInstallCommands({
    serviceName: "oak-eagle-twilio-bot",
    unitPath: "/etc/systemd/system/oak-eagle-twilio-bot.service"
  });

  assert.deepEqual(commands, [
    ["systemctl", "daemon-reload"],
    ["systemctl", "enable", "oak-eagle-twilio-bot.service"],
    ["systemctl", "restart", "oak-eagle-twilio-bot.service"],
    ["systemctl", "status", "--no-pager", "oak-eagle-twilio-bot.service"]
  ]);
});
