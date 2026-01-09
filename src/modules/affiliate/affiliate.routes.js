import express from "express";
import { verifyToken } from "../../shared/middlewares/auth.js";
import {
  createAffiliateProfile,
  getAffiliateProfile,
  updateAffiliateProfile,
  getAffiliateStats,
  getDashboardSummary,
  getActivationStatus,
  getDirectReferrals,
  getReferralTree,
  getReferralProgramDashboard,
  getUsersUsingAffiliateCode,
  getPaginatedReferrals,
} from "./affiliate.controller.js";

const router = express.Router();

router.post("/register", verifyToken, createAffiliateProfile);
router.get("/profile", verifyToken, getAffiliateProfile);
router.get("/activation-status", verifyToken, getActivationStatus);
router.put("/profile", verifyToken, updateAffiliateProfile);
router.get("/stats", verifyToken, getAffiliateStats);
router.get("/dashboard", verifyToken, getDashboardSummary);
router.get("/referrals", verifyToken, getDirectReferrals);
router.get("/referrals/tree", verifyToken, getReferralTree);
router.get("/referrals/paginated", verifyToken, getPaginatedReferrals);
router.get("/dashboard/komisi", verifyToken, getReferralProgramDashboard);
router.get("/users-by-code", getUsersUsingAffiliateCode);

export default router;
