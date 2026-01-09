import express from "express";
import {
  getPendingCommissions,
  approveCommissionByAdmin,
  approveWithAdjustedAmount,
  batchApproveCommissions,
  rejectCommissionByAdmin,
  getCommissionStats,
  payoutCommission,
} from "./adminApproval.controller.js";

import { verifyToken } from "../../shared/middlewares/auth.js";
import { requireAdmin } from "../../shared/utils/role.middleware.js";

const router = express.Router();

router.get("/stats", verifyToken, requireAdmin, getCommissionStats);
router.get("/pending", getPendingCommissions);
router.post("/approve/:commissionId", approveCommissionByAdmin);
router.post("/approve-with-amount/:commissionId", approveWithAdjustedAmount);
router.post("/approve-batch", batchApproveCommissions);
router.post("/reject/:commissionId", rejectCommissionByAdmin);
router.post("/payout/:commissionId", payoutCommission);

export default router;
