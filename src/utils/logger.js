function formatLog(level, message, meta) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message
  };

  if (meta && typeof meta === "object" && Object.keys(meta).length > 0) {
    payload.meta = meta;
  }

  return JSON.stringify(payload);
}

function createLogger(defaultMeta = {}) {
  function write(level, message, meta = {}) {
    const mergedMeta = { ...defaultMeta, ...meta };
    const line = formatLog(level, message, mergedMeta);

    if (level === "error") {
      console.error(line);
      return;
    }

    console.log(line);
  }

  return {
    debug(message, meta) {
      write("debug", message, meta);
    },
    info(message, meta) {
      write("info", message, meta);
    },
    warn(message, meta) {
      write("warn", message, meta);
    },
    error(message, meta) {
      write("error", message, meta);
    },
    child(meta = {}) {
      return createLogger({ ...defaultMeta, ...meta });
    }
  };
}

const logger = createLogger();

module.exports = {
  createLogger,
  logger
};
