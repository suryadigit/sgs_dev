import express from "express";
import { verifyToken } from "../../shared/middlewares/auth.js";
import {
  requestWithdrawal,
  getWithdrawalHistory,
  getMemberWithdrawalRequests,
  getWithdrawalDetails,
  getAvailableBalance,
  approveWithdrawal,
  rejectWithdrawal,
  completeWithdrawal,
  getPendingWithdrawals,
  getAdminWithdrawals,
} from "./withdrawal.controller.js";

const router = express.Router();

router.get("/balance", verifyToken, getAvailableBalance);
router.post("/request", verifyToken, requestWithdrawal);
router.get("/history", verifyToken, getWithdrawalHistory);
router.get("/requests", verifyToken, getMemberWithdrawalRequests);
router.get("/:withdrawalId", verifyToken, getWithdrawalDetails);

router.get("/admin/list", getAdminWithdrawals);
router.get("/admin/pending", getPendingWithdrawals);
router.post("/admin/approve/:withdrawalId", approveWithdrawal);
router.post("/admin/reject/:withdrawalId", rejectWithdrawal);
router.post("/admin/complete/:withdrawalId", completeWithdrawal);

export default router;
