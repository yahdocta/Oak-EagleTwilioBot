const express = require("express");
const path = require("path");
const { config } = require("../config");
const { logger } = require("../utils/logger");
const { createTwilioRouter } = require("./routes/twilio");
const { createCampaignRouter } = require("./routes/campaigns");
const { CampaignManager } = require("./campaignManager");
const {
  createCloudflaredStatus,
  getCloudflaredStatusSnapshot,
  startCloudflaredTunnel,
  stopCloudflaredTunnel
} = require("./cloudflared");
const { sheetsAdapter, elevenLabsTts } = require("./services");
const { buildVoicePrompts } = require("./voicePrompts");

const defaultCloudflaredStatus = createCloudflaredStatus(config.cloudflare);

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

function mountTwilioRoutes(app, promptAudioUrls, campaignManager) {
  app.use("/twilio", createTwilioRouter({ sheetsAdapter, elevenLabsTts, promptAudioUrls, campaignManager }));
}

function mountCampaignRoutes(app, campaignManager) {
  app.use("/campaigns", createCampaignRouter({ manager: campaignManager }));
}

function createApp(promptAudioUrls, options = {}) {
  const app = express();
  const campaignManager = new CampaignManager({ config });
  const cloudflaredStatus = options.cloudflaredStatus || defaultCloudflaredStatus;

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(requestLoggerMiddleware);
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/healthz", (req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/system/status", (req, res) => {
    res.status(200).json({
      ok: true,
      cloudflareTunnel: getCloudflaredStatusSnapshot(cloudflaredStatus)
    });
  });

  mountTwilioRoutes(app, promptAudioUrls, campaignManager);
  mountCampaignRoutes(app, campaignManager);

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

async function warmupVoicePrompts() {
  if (!elevenLabsTts.enabled) {
    return new Map();
  }

  const prompts = buildVoicePrompts(config);
  const urls = await elevenLabsTts.preGeneratePrompts(prompts);
  logger.info("voice.elevenlabs.pre_generated", { promptCount: urls.size });
  return urls;
}

function startServer(options) {
  const {
    app,
    config,
    logger,
    startTunnel = startCloudflaredTunnel,
    stopTunnel = stopCloudflaredTunnel,
    cloudflaredStatus = defaultCloudflaredStatus,
    exitProcess = process.exit
  } = options;
  let cloudflaredProcess = null;

  const server = app.listen(config.server.port, () => {
    logger.info("server.started", {
      port: config.server.port
    });
    cloudflaredProcess = startTunnel(config.cloudflare, { logger, status: cloudflaredStatus });
  });

  function shutdown(signal) {
    logger.info("server.shutdown_requested", { signal });
    stopTunnel(cloudflaredProcess, logger);
    server.close(() => {
      logger.info("server.stopped");
      exitProcess(0);
    });
  }

  return {
    server,
    shutdown,
    getCloudflaredProcess() {
      return cloudflaredProcess;
    }
  };
}

if (require.main === module) {
  (async () => {
    let promptAudioUrls = new Map();
    try {
      promptAudioUrls = await warmupVoicePrompts();
    } catch (error) {
      logger.error("voice.elevenlabs.pre_generate_failed", { error: error.message });
      promptAudioUrls = new Map();
    }

    const app = createApp(promptAudioUrls, { cloudflaredStatus: defaultCloudflaredStatus });
    const runtime = startServer({
      app,
      config,
      logger,
      cloudflaredStatus: defaultCloudflaredStatus
    });

    process.on("SIGINT", runtime.shutdown);
    process.on("SIGTERM", runtime.shutdown);
  })().catch((error) => {
    logger.error("server.start_failed", { error: error.message });
    process.exit(1);
  });
}

module.exports = {
  createApp,
  startServer,
  warmupVoicePrompts
};
