import express from "express";
import { verifyToken } from "../../shared/middlewares/auth.js";
import { requireRole } from "../../shared/utils/role.middleware.js";
import {
  getUserMenusDynamic,
  getAllMenus,
  createMenu,
  updateMenu,
  deleteMenu,
  getAllPermissions,
  createPermission,
  getRoleConfig,
  updateRoleMenu,
  toggleRoleMenu,
  updateRolePermission,
  toggleRolePermission,
  bulkUpdateRolePermissions,
  bulkUpdateRoleMenus,
  getAccessConfig,
} from "./dynamicMenu.controller.js";

const router = express.Router();

router.get("/user/menus", verifyToken, getUserMenusDynamic);

router.get("/access-config", verifyToken, requireRole(["ADMIN", "SUPERADMIN"]), getAccessConfig);

router.get("/menus", verifyToken, requireRole(["ADMIN", "SUPERADMIN"]), getAllMenus);
router.post("/menus", verifyToken, requireRole(["SUPERADMIN"]), createMenu);
router.put("/menus/:id", verifyToken, requireRole(["SUPERADMIN"]), updateMenu);
router.delete("/menus/:id", verifyToken, requireRole(["SUPERADMIN"]), deleteMenu);

router.get("/permissions", verifyToken, requireRole(["ADMIN", "SUPERADMIN"]), getAllPermissions);
router.post("/permissions", verifyToken, requireRole(["SUPERADMIN"]), createPermission);

router.get("/roles/:role/config", verifyToken, requireRole(["ADMIN", "SUPERADMIN"]), getRoleConfig);
router.get("/roles/:role", verifyToken, requireRole(["ADMIN", "SUPERADMIN"]), getRoleConfig);
router.put("/roles/:role/menus", verifyToken, requireRole(["SUPERADMIN"]), bulkUpdateRoleMenus);
router.put("/roles/:role/menus/:menuId", verifyToken, requireRole(["SUPERADMIN"]), updateRoleMenu);
router.patch("/roles/:role/menus/:menuId/toggle", verifyToken, requireRole(["SUPERADMIN"]), toggleRoleMenu);
router.put("/roles/:role/permissions/:permissionId", verifyToken, requireRole(["SUPERADMIN"]), updateRolePermission);
router.patch("/roles/:role/permissions/:permissionId/toggle", verifyToken, requireRole(["SUPERADMIN"]), toggleRolePermission);
router.put("/roles/:role/permissions", verifyToken, requireRole(["SUPERADMIN"]), bulkUpdateRolePermissions);

export default router;