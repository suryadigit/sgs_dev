import express from "express";
import { verifyToken } from "../../shared/middlewares/auth.js";
import { requireRole } from "../../shared/utils/role.middleware.js";
import {
  getUsers,
  getUserDetail,
  updateUserAccess,
  updateUserStatus,
  changeUserRole,
} from "./userManagement.controller.js";

const router = express.Router();

router.get("/", verifyToken, requireRole(["ADMIN", "SUPERADMIN"]), getUsers);
router.get("/:userId", verifyToken, requireRole(["ADMIN", "SUPERADMIN"]), getUserDetail);
router.put("/:userId/access", verifyToken, requireRole(["SUPERADMIN"]), updateUserAccess);
router.put("/:userId/status", verifyToken, requireRole(["ADMIN", "SUPERADMIN"]), updateUserStatus);
router.put("/:userId/role", verifyToken, requireRole(["SUPERADMIN"]), changeUserRole);

export default router;
