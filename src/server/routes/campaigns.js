const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const { config } = require("../../config");
const { startCampaign } = require("../../campaigns");
const { convertDealMachineCsvFile } = require("../../campaigns/dealMachineCsv");
const { convertRecurringExportCsvFile } = require("../../campaigns/recurringExportCsv");
const { CampaignManager } = require("../campaignManager");

const uploadDir = path.resolve("campaign-inputs", "uploads");

function ensureUploadDir() {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function sanitizeFilename(filename) {
  return path
    .basename(filename)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createCsvUploader() {
  ensureUploadDir();
  const storage = multer.diskStorage({
    destination: uploadDir,
    filename(req, file, callback) {
      const safeName = sanitizeFilename(file.originalname) || "leads.csv";
      callback(null, `${Date.now()}-${safeName}`);
    }
  });

  return multer({
    storage,
    limits: {
      fileSize: 10 * 1024 * 1024
    },
    fileFilter(req, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase();
      if (extension !== ".csv") {
        callback(new Error("Only CSV files can be uploaded."));
        return;
      }
      callback(null, true);
    }
  });
}

function isChecked(value) {
  return value === true || value === "true" || value === "on" || value === "1";
}

function createCampaignRouter(options = {}) {
  const router = express.Router();
  const manager = options.manager || new CampaignManager({ config });
  const upload = createCsvUploader();
  const withErrorHandling =
    (handler) =>
    (req, res, next) =>
      Promise.resolve(handler(req, res, next)).catch(next);

  router.get("/ui/state", (req, res) => {
    res.status(200).json(manager.getState());
  });

  router.post(
    "/ui/upload",
    upload.single("csv"),
    withErrorHandling(async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: "CSV upload is required." });
      }

      const dealMachineCsv = isChecked(req.body.dealMachineCsv);
      const recurringExportCsv = isChecked(req.body.recurringExportCsv);
      if (dealMachineCsv && recurringExportCsv) {
        return res.status(400).json({ error: "Choose only one CSV import format." });
      }

      if (dealMachineCsv) {
        convertDealMachineCsvFile(req.file.path);
      }
      if (recurringExportCsv) {
        convertRecurringExportCsvFile(req.file.path);
      }

      const state = manager.setUploadedCsv(req.file.path);
      return res.status(200).json(state);
    })
  );

  router.post(
    "/ui/start",
    withErrorHandling(async (req, res) => {
      const state = manager.start(req.body.campaignId, {
        loopEnabled: req.body.loopEnabled,
        loopIntervalHours: req.body.loopIntervalHours,
        scheduleStartAt: req.body.scheduleStartAt,
        scheduleTimezone: req.body.scheduleTimezone
      });
      return res.status(202).json(state);
    })
  );

  router.post(
    "/ui/end",
    withErrorHandling(async (req, res) => {
      const state = await manager.stop();
      return res.status(202).json(state);
    })
  );

  router.post(
    "/ui/pause",
    withErrorHandling(async (req, res) => {
      const state = manager.togglePause();
      return res.status(202).json(state);
    })
  );

  router.post(
    "/ui/recurring-leads/:leadId/remove",
    withErrorHandling(async (req, res) => {
      const state = manager.removeRecurringLead(req.params.leadId);
      return res.status(202).json(state);
    })
  );

  router.post(
    "/ui/recurring-leads/save-csv",
    withErrorHandling(async (req, res) => {
      const savedCsv = manager.saveRecurringCallListCsv();
      return res.status(201).json({
        savedCsv,
        state: manager.getState()
      });
    })
  );

  router.post(
    "/:id/start",
    withErrorHandling(async (req, res) => {
      const campaignId = req.params.id;
      const csvPathInput = req.body.csvPath;
      if (!csvPathInput) {
        return res.status(400).json({ error: "csvPath is required." });
      }

      const csvPath = path.resolve(csvPathInput);
      const summary = await startCampaign(csvPath, {
        config,
        campaignId
      });

      return res.status(200).json(summary);
    })
  );

  router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError || error.message.includes("CSV")) {
      return res.status(400).json({ error: error.message });
    }

    if (
      error.message === "A campaign is already running." ||
      error.message === "A campaign is already scheduled." ||
      error.message === "Upload a CSV before starting a campaign." ||
      error.message === "No campaign is currently running." ||
      error.message === "Loop interval must be a positive number of hours." ||
      error.message === "Schedule time zone is required." ||
      error.message === "Schedule time zone must be a valid IANA time zone." ||
      error.message === "Schedule time must be in the future." ||
      error.message === "Schedule time must use YYYY-MM-DDTHH:mm format." ||
      error.message === "Schedule time must be a valid calendar date and time." ||
      error.message === "Schedule time is not valid in the selected time zone." ||
      error.message === "Lead was not found in the recurring call list."
    ) {
      return res.status(409).json({ error: error.message });
    }

    return next(error);
  });

  return router;
}

module.exports = {
  createCampaignRouter
};
