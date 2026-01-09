import express from "express";
import { verifyToken } from "../../shared/middlewares/auth.js";
import { signup, login, verifyLoginOtp, resendLoginOtp } from "../auth/auth.controller.js";
import {
  validateWhatsApp,
  sendWhatsAppVerificationCode,
  verifyWhatsAppCode,
  checkWhatsAppVerification,
} from "../auth/whatsappVerification.controller.js";
import {
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  resendResetOtp,
} from "../auth/forgotPassword.controller.js";
import {
  verifyEmailOtp,
  checkOtpStatus,
  requestEmailOtp,
  resendEmailOtp,
  requestPhoneOtp,
  verifyPhoneOtp,
} from "../auth/emailOtp.controller.js";
import { getUserProfile, updateUserProfile } from "./profile.controller.js";
import responseCache from "../../shared/middlewares/responseCache.middleware.js";
import { checkPaymentStatusByUserId } from "../payment/payment.controller.js";
import { getUserMenus } from "../menu/menu.controller.js";

const router = express.Router();

//sample> http://localhost:4000/api/v1/users/

router.post("/validate-whatsapp", validateWhatsApp);
router.post("/send-whatsapp-code", sendWhatsAppVerificationCode);
router.post("/verify-whatsapp-code", verifyWhatsAppCode);
router.post("/check-whatsapp-verification", checkWhatsAppVerification);

router.post("/signup", signup);
router.post("/login", login);
router.post("/verify-login-otp", verifyLoginOtp);
router.post("/resend-login-otp", resendLoginOtp);
router.post("/verify-email-otp", verifyEmailOtp);
router.post("/check-otp-status", checkOtpStatus);

router.post("/forgot-password", forgotPassword);
router.post("/verify-reset-otp", verifyResetOtp);
router.post("/reset-password", resetPassword);
router.post("/resend-reset-otp", resendResetOtp);

router.post("/request-email-otp", requestEmailOtp);
router.post("/resend-email-otp", resendEmailOtp);
router.post("/request-phone-otp", requestPhoneOtp);
router.post("/verify-phone-otp", verifyPhoneOtp);

router.get("/profile", verifyToken, responseCache({ ttl: 60 }), getUserProfile);
router.put("/profile", verifyToken, updateUserProfile);
router.get("/menus", verifyToken, getUserMenus);
router.get("/:userId/payment-status", checkPaymentStatusByUserId);

export default router;
