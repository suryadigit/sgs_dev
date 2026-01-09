import express from "express";
import { verifyToken } from "../../shared/middlewares/auth.js";
import {
  checkActivationStatus,
  createPaymentInvoice,
  getPaymentStatus,
  getCompleteActivationStatus,
  handlePaymentWebhook,
  refreshPaymentInvoice,
  verifyPaymentFromXendit,
  verifyPaymentNoAuth,
  startPaymentPolling,
  checkPaymentStatusById,
  sendInvoiceEmail,
} from "./payment.controller.js";

const router = express.Router();

router.get("/activation-status", verifyToken, checkActivationStatus);
router.post("/create-invoice", verifyToken, createPaymentInvoice);
router.get("/status", verifyToken, getPaymentStatus);
router.get("/complete-status", verifyToken, getCompleteActivationStatus);
router.post("/refresh-invoice", verifyToken, refreshPaymentInvoice);
router.post("/send-invoice-email", verifyToken, sendInvoiceEmail);
router.post("/verify", verifyToken, verifyPaymentFromXendit);
router.post("/verify-no-auth", verifyPaymentNoAuth);
router.post("/start-polling", verifyToken, startPaymentPolling);
router.post("/webhook", handlePaymentWebhook);
router.get("/:paymentId/status", checkPaymentStatusById);

export default router;
