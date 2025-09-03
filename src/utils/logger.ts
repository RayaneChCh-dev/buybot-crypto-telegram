import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const isHeroku = !!process.env.DYNO;

const loggerConfig = isHeroku
  ? {
      level: "info",
      transport: undefined,
      formatters: {
        level: (label: string) => ({ level: label.toUpperCase() }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      base: {
        pid: process.pid,
        hostname: process.env.DYNO || "heroku",
      },
    }
  : {
      level: "debug",
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          levelFirst: true,
          translateTime: "yyyy-mm-dd HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    };

// Create logger
const logger = pino(loggerConfig as pino.LoggerOptions);

// Quick startup log
logger.info(
  `Logger initialized. Env=${process.env.NODE_ENV}, Heroku=${isHeroku}, Mode=${
    isHeroku ? "sync" : "pretty"
  }`
);

export default logger;
