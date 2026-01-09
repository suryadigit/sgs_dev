const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || null;
const RECAPTCHA_VERIFY_URL = process.env.RECAPTCHA_VERIFY_URL || 'https://www.google.com/recaptcha/api/siteverify';

export default {
  RECAPTCHA_SECRET_KEY,
  RECAPTCHA_VERIFY_URL,
};
