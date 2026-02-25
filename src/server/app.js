const express = require("express");
const { config } = require("../config");
const { logger } = require("../utils/logger");

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

function twilioPlaceholderHandler(routeName) {
  return (req, res) => {
    logger.warn("twilio.placeholder_route_called", {
      route: routeName,
      bodyKeys: Object.keys(req.body || {})
    });

    res.status(501).json({
      error: `${routeName} is not implemented yet.`
    });
  };
}

function mountTwilioRoutes(app) {
  app.post("/twilio/voice", twilioPlaceholderHandler("voice"));
  app.post("/twilio/gather/intent", twilioPlaceholderHandler("gather_intent"));
  app.post("/twilio/gather/callback", twilioPlaceholderHandler("gather_callback"));
  app.post("/twilio/status", twilioPlaceholderHandler("status"));
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
