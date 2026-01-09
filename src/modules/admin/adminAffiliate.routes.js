import express from "express";
import { verifyToken } from "../../shared/middlewares/auth.js";
import { requireAdmin } from "../../shared/utils/role.middleware.js";
import {
  getAdminAffiliateDashboard,
  getAllAffiliates,
  getAffiliateDetail,
} from "./adminAffiliate.controller.js";

const router = express.Router();
router.get("/dashboard", verifyToken, requireAdmin, getAdminAffiliateDashboard);
router.get("/list", verifyToken, requireAdmin, getAllAffiliates);
router.get("/:id", verifyToken, requireAdmin, getAffiliateDetail);

export default router;