import axios from "axios";
import recaptchaConfig from "../../config/recaptcha.config.js";

const { RECAPTCHA_SECRET_KEY, RECAPTCHA_VERIFY_URL, USE_RECAPTCHA } = recaptchaConfig;

export const verifyRecaptcha = async (token) => {
  if (!USE_RECAPTCHA) {
    console.log('⚠️ reCAPTCHA disabled by USE_RECAPTCHA - skipping verification');
    return { success: true };
  }

  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "staging") {
    console.log("⚠️ reCAPTCHA verification SKIPPED (development/staging mode)");
    return { success: true };
  }

  if (!token) {
    return { success: false, error: "reCAPTCHA token is required" };
  }

  if (!RECAPTCHA_SECRET_KEY) {
    console.warn("⚠️ RECAPTCHA_SECRET_KEY not configured, skipping verification");
    return { success: true }; 
  }

  try {
    const response = await axios.post(
      RECAPTCHA_VERIFY_URL,
      null,
      {
        params: {
          secret: RECAPTCHA_SECRET_KEY,
          response: token,
        },
      }
    );

    const { success, score, "error-codes": errorCodes } = response.data;

    if (!success) {
      console.error("❌ reCAPTCHA verification failed:", errorCodes);
      return { 
        success: false, 
        error: "reCAPTCHA verification failed",
        errorCodes 
      };
    }

    console.log(`✅ reCAPTCHA verified. Score: ${score}`);
    return { success: true, score };
  } catch (error) {
    console.error("❌ reCAPTCHA API error:", error.message);
    return { success: false, error: error.message };
  }
};
