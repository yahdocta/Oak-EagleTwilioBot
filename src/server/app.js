const express = require("express");
const { config } = require("../config");
const { logger } = require("../utils/logger");
const { createTwilioRouter } = require("./routes/twilio");
const { createCampaignRouter } = require("./routes/campaigns");
const { sheetsAdapter } = require("./services");

function requestLoggerMiddleware(req, res, next) {
  const startedAt = Date.now();

  res.on("finish", () => {
    logger.info("request.completed", {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  next();
}

function mountTwilioRoutes(app) {
  app.use("/twilio", createTwilioRouter({ sheetsAdapter }));
}

function mountCampaignRoutes(app) {
  app.use("/campaigns", createCampaignRouter());
}

function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(requestLoggerMiddleware);

  app.get("/healthz", (req, res) => {
    res.status(200).json({ ok: true });
  });

  mountTwilioRoutes(app);
  mountCampaignRoutes(app);

  app.use((error, req, res, next) => {
    logger.error("request.failed", {
      method: req.method,
      path: req.originalUrl,
      error: error.message
    });

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({ error: "Internal Server Error" });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(config.server.port, () => {
    logger.info("server.started", {
      port: config.server.port
    });
  });
}

module.exports = {
  createApp
};
