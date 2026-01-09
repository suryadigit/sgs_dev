const missing = (k) => { throw new Error(`Missing required env var: ${k}`); };

const XENDIT_API_KEY = process.env.XENDIT_API_KEY || missing('XENDIT_API_KEY');
const XENDIT_API_URL = process.env.XENDIT_API_URL || 'https://api.xendit.co/v2/invoices';
const ACTIVATION_AMOUNT = Number(process.env.ACTIVATION_AMOUNT || '75000');
const INVOICE_DURATION_SECONDS = Number(process.env.INVOICE_DURATION_SECONDS || '900');
const SUCCESS_REDIRECT_URL = process.env.XENDIT_SUCCESS_REDIRECT_URL || null;
const FAILURE_REDIRECT_URL = process.env.XENDIT_FAILURE_REDIRECT_URL || null;

if (Number.isNaN(ACTIVATION_AMOUNT) || Number.isNaN(INVOICE_DURATION_SECONDS)) {
  throw new Error('Invalid numeric payment config (ACTIVATION_AMOUNT/INVOICE_DURATION_SECONDS)');
}

export default {
  XENDIT_API_KEY,
  XENDIT_API_URL,
  ACTIVATION_AMOUNT,
  INVOICE_DURATION_SECONDS,
  SUCCESS_REDIRECT_URL,
  FAILURE_REDIRECT_URL,
};
