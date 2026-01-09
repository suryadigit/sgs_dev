import express from "express";
import { verifyToken, verifyAdmin } from "../../shared/middlewares/auth.js";
import {
  getWordPressStatus,
  syncToWordPress,
  checkAndUpgrade,
  getWPAffiliateDashboard,
  simulateSale,
  webhookOrderCompleted,
  requestWithdrawal,
  getWithdrawalHistory,
  processWithdrawal,
  getUserCommissions
} from "./wordpress.controller.js";

const router = express.Router();

router.get("/status", verifyToken, getWordPressStatus);
router.post("/sync", verifyToken, syncToWordPress);
router.post("/check-purchase", verifyToken, checkAndUpgrade);
router.get("/dashboard", verifyToken, getWPAffiliateDashboard);
router.post("/simulate-sale", verifyToken, simulateSale);
router.post("/webhook/order-completed", webhookOrderCompleted);
router.post("/withdraw", verifyToken, requestWithdrawal);
router.get("/withdrawals", verifyToken, getWithdrawalHistory);
router.post("/admin/process-withdrawal", verifyToken, verifyAdmin, processWithdrawal);
router.get("/commissions", verifyToken, getUserCommissions);

export default router;
