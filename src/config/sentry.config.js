export const sentryDsn = process.env.SENTRY_DSN ||
  "https://fec57772f3d288148ba33e5a703c0b22@o4510582609149952.ingest.us.sentry.io/4510590410489856";

export const sentryOptions = {
  sendDefaultPii: true,
};

export default { sentryDsn, sentryOptions };
