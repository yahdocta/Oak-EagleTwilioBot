#!/usr/bin/env node

const fs = require("fs");
const { spawnSync } = require("child_process");
const {
  buildInstallCommands,
  getDefaultServiceOptions,
  getUnitPath,
  renderSystemdService
} = require("../src/deployment/systemdService");

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/install-systemd-service.js --print
  sudo node scripts/install-systemd-service.js --install

Environment overrides:
  OAK_EAGLE_SERVICE_NAME
  OAK_EAGLE_SERVICE_USER
  OAK_EAGLE_SERVICE_GROUP
  OAK_EAGLE_SERVICE_NPM
`);
}

function runCommand(command) {
  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} exited with status ${result.status}.`);
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    printUsage();
    return;
  }

  const options = getDefaultServiceOptions();
  const unit = renderSystemdService(options);
  const unitPath = getUnitPath(options.serviceName);

  if (args.has("--print") || args.has("--dry-run")) {
    process.stdout.write(unit);
    return;
  }

  if (!args.has("--install")) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!process.getuid || process.getuid() !== 0) {
    process.stderr.write(
      `Root privileges are required to write ${unitPath}.\nRun: sudo npm run service:install\n`
    );
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(unitPath, unit, "utf8");
  for (const command of buildInstallCommands({ serviceName: options.serviceName, unitPath })) {
    runCommand(command);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
