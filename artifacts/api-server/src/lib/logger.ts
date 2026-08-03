import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    // HTTP headers
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    // Sensitive PII fields — defense-in-depth: strip any of these if they
    // accidentally reach a log statement via a spread or raw-object log.
    "*.ssn",
    "*.ownerSsn",
    "*.routingNumber",
    "*.accountNumber",
    "*.fundingRoutingNumber",
    "*.fundingAccountNumber",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
