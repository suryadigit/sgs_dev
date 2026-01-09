import express from "express";
import { verifyToken } from "../../shared/middlewares/auth.js";
import { getReferralProgramDashboard } from "./affiliateDashboard.controller.js";
import {
  getCommissionBreakdown,
  getRecentCommissionsDetails,
  getCommissionStatsByLevel,
} from "../commission/commissionBreakdown.controller.js";

const router = express.Router();

router.get("/referral", verifyToken, getReferralProgramDashboard);
router.get("/breakdown", verifyToken, getCommissionBreakdown);
router.get("/commissions/recent", verifyToken, getRecentCommissionsDetails);
router.get("/commissions/stats", verifyToken, getCommissionStatsByLevel);

export default router;
