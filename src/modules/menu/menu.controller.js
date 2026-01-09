import { PrismaClient } from "@prisma/client";
import { getMenusForRole } from "../../config/menuConfig.js";
import { ROLE_PERMISSIONS } from "../../../ROLE_PERMISSIONS_CONFIG.js";

const prisma = new PrismaClient();

export const getUserMenus = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, fullName: true } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const role = user.role || "MEMBER";
    const { menus, adminMenus } = getMenusForRole(role);
    // ROLE_PERMISSIONS is an array, not an object with .permissions
    const permissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.MEMBER || [];

    res.json({ message: "User menus retrieved successfully", user: { id: user.id, fullName: user.fullName, role: role }, menus, ...(adminMenus && { adminMenus }), permissions });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAllMenus = async (req, res) => {
  try {
    const { ALL_MENUS, ROLE_MENUS } = await import("../config/menuConfig.js");
    res.json({ message: "All menus retrieved", allMenus: Object.values(ALL_MENUS), roleMenus: ROLE_MENUS });
  } catch (error) { res.status(500).json({ error: error.message }); }
};
