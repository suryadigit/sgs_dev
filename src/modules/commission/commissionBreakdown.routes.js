import express from "express";
import { verifyToken } from "../../shared/middlewares/auth.js";
import {
  getCommissionBreakdown,
  getRecentCommissionsDetails,
  getCommissionStatsByLevel,
} from "./commissionBreakdown.controller.js";

const router = express.Router();

router.get("/breakdown", verifyToken, getCommissionBreakdown);
router.get("/recent", verifyToken, getRecentCommissionsDetails);
router.get("/stats-by-level", verifyToken, getCommissionStatsByLevel);

export default router;
