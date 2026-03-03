#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { config } = require("../config");
const { startCampaign } = require("../campaigns");

function printUsage() {
  console.error("Usage: ./run <file.csv> [campaign-id]");
  console.error("CSV files default to ./campaign-inputs when only a filename is provided.");
}

function resolveCsvPath(inputPath) {
  const hasPathSeparators =
    inputPath.includes("/") || inputPath.includes("\\") || path.isAbsolute(inputPath);

  if (hasPathSeparators) {
    return path.resolve(inputPath);
  }

  return path.resolve(process.cwd(), "campaign-inputs", inputPath);
}

async function main() {
  const csvArg = process.argv[2];
  const campaignIdArg = process.argv[3];

  if (!csvArg) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const csvPath = resolveCsvPath(csvArg);
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exitCode = 1;
    return;
  }

  const campaignId =
    campaignIdArg || `manual-${path.basename(csvArg, path.extname(csvArg)).toLowerCase()}`;

  const summary = await startCampaign(csvPath, {
    config,
    campaignId
  });

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
