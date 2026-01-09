import express from "express";
import { verifyToken } from "../../shared/middlewares/auth.js";
import {
  bypassRecordCommission,
  getCommissionBreakdown,
  getMyCommissions,
  getCommissionSummary,
  getDashboardSummary,
  handleWordPressWebhook,
  getReferralHierarchyWithCommissions,
} from "./commission.controller.js";
import {
  getPendingCommissions,
  getPendingCommissionsGrouped,
  approveCommissionByAdmin,
  approveWithAdjustedAmount,
  approveAffiliateCommissions,
  batchApproveCommissions,
  rejectCommissionByAdmin,
  getCommissionStats,
  payoutCommission,
} from "./adminApproval.controller.js";
import { requireUser } from "../../shared/utils/role.middleware.js";

const router = express.Router();
import { responseCache } from "../../shared/middlewares/responseCache.middleware.js";

router.post("/webhook/wordpress", handleWordPressWebhook);

router.get("/my", verifyToken, getMyCommissions);
router.get("/summary", verifyToken, getCommissionSummary);
router.get("/dashboard-summary", verifyToken, getDashboardSummary);
router.get("/breakdown", verifyToken, getCommissionBreakdown);
router.get(
  "/referral-hierarchy",
  verifyToken,
  requireUser,
  responseCache({ ttl: 60, getKey: (req) => `commissions:referral-hierarchy:${req.userId}` }),
  getReferralHierarchyWithCommissions
);

router.post("/bypass/record", bypassRecordCommission);

router.get("/admin/stats", getCommissionStats);
router.get("/admin/pending", getPendingCommissions);
router.get("/admin/pending-grouped", getPendingCommissionsGrouped);
router.post("/admin/approve/:commissionId", approveCommissionByAdmin);
router.post("/admin/approve-with-amount/:commissionId", approveWithAdjustedAmount);
router.post("/admin/approve-affiliate", approveAffiliateCommissions);
router.post("/admin/approve-batch", batchApproveCommissions);
router.post("/admin/reject/:commissionId", rejectCommissionByAdmin);
router.post("/admin/payout/:commissionId", payoutCommission);

export default router;
