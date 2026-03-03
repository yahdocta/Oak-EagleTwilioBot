const express = require("express");
const path = require("path");
const { config } = require("../../config");
const { startCampaign } = require("../../campaigns");

function createCampaignRouter() {
  const router = express.Router();
  const withErrorHandling =
    (handler) =>
    (req, res, next) =>
      Promise.resolve(handler(req, res, next)).catch(next);

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

  return router;
}

module.exports = {
  createCampaignRouter
};
