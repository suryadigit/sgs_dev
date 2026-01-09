const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || null;
const RECAPTCHA_VERIFY_URL = process.env.RECAPTCHA_VERIFY_URL || 'https://www.google.com/recaptcha/api/siteverify';
// Opt-in flag: set USE_RECAPTCHA=true to enable verification. Default: disabled.
const USE_RECAPTCHA = process.env.USE_RECAPTCHA === 'true';

export default {
  RECAPTCHA_SECRET_KEY,
  RECAPTCHA_VERIFY_URL,
  USE_RECAPTCHA,
};
