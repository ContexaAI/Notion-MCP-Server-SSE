import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "https://cb2d40c2f75f0b4587e10c47ca168f06@o1423697.ingest.us.sentry.io/4511207462666240",
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
});
