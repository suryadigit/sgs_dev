import express from "express";
import { verifyToken } from "../../shared/middlewares/auth.js";
import { getReferralProgramDashboard } from "./affiliateDashboard.controller.js";
import { responseCache } from "../../shared/middlewares/responseCache.middleware.js";

const router = express.Router();

router.get(
	"/affiliate/dashboard/komisi",
	verifyToken,
	responseCache({ ttl: 60, getKey: (req) => `affiliate:dashboard:komisi:${req.userId}` }),
	getReferralProgramDashboard
);

export default router;