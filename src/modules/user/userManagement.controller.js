import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", role = "" } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      ...(search && { OR: [{ fullName: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }, { phone: { contains: search, mode: "insensitive" } }] }),
      ...(role && { role: role }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, skip, take: parseInt(limit), orderBy: { createdAt: "desc" }, select: { id: true, email: true, fullName: true, phone: true, role: true, isEmailVerified: true, isPhoneVerified: true, createdAt: true, affiliateProfile: { select: { id: true, code: true, status: true } } } }),
      prisma.user.count({ where }),
    ]);

    res.json({ message: "Users retrieved successfully", users, pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getUserDetail = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true, phone: true, bank: true, alamat: true, role: true, isEmailVerified: true, isPhoneVerified: true, createdAt: true, updatedAt: true, affiliateProfile: { select: { id: true, code: true, status: true, totalEarnings: true, totalPaid: true } } } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const allMenus = await prisma.menu.findMany({ where: { isActive: true }, orderBy: { order: "asc" } });
    const allPermissions = await prisma.permission.findMany({ where: { isActive: true }, orderBy: { category: "asc" } });
    const roleMenus = await prisma.roleMenu.findMany({ where: { role: user.role }, select: { menuId: true, isEnabled: true } });
    const rolePermissions = await prisma.rolePermission.findMany({ where: { role: user.role }, select: { permissionId: true, isEnabled: true } });

    const availableMenus = allMenus.map((menu) => { const roleMenu = roleMenus.find((rm) => rm.menuId === menu.id); return { id: menu.id, menuId: menu.menuId, label: menu.label, icon: menu.icon, link: menu.link, order: menu.order, isAdmin: menu.isAdmin, requiredPermission: menu.requiredPermission, isEnabled: roleMenu?.isEnabled || false }; });
    const availablePermissions = allPermissions.map((perm) => { const rolePerm = rolePermissions.find((rp) => rp.permissionId === perm.id); return { id: perm.id, permissionId: perm.permissionId, name: perm.name, description: perm.description, category: perm.category, isEnabled: rolePerm?.isEnabled || false }; });

    const userPermissions = rolePermissions.filter((rp) => rp.isEnabled).map((rp) => { const perm = allPermissions.find((p) => p.id === rp.permissionId); return perm?.permissionId; }).filter(Boolean);
    const userMenuAccess = roleMenus.filter((rm) => rm.isEnabled).map((rm) => { const menu = allMenus.find((m) => m.id === rm.menuId); return menu?.menuId; }).filter(Boolean);
    const isActive = user.affiliateProfile?.status === "ACTIVE";

    res.json({ message: "User detail retrieved successfully", user: { ...user, isActive, permissions: userPermissions, menuAccess: userMenuAccess }, availableMenus, availablePermissions });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const updateUserAccess = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, menuAccess, permissions } = req.body;
    const adminId = req.userId;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (userId === adminId && role && role !== user.role) return res.status(400).json({ error: "You cannot change your own role" });

    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    if (user.role === "SUPERADMIN" && admin.role !== "SUPERADMIN") return res.status(403).json({ error: "Only SUPERADMIN can modify SUPERADMIN users" });

    const updates = [];

    if (role && role !== user.role) { await prisma.user.update({ where: { id: userId }, data: { role } }); updates.push(`Role changed to ${role}`); }
    const targetRole = role || user.role;

    if (menuAccess && Array.isArray(menuAccess)) {
      for (const menu of menuAccess) await prisma.roleMenu.upsert({ where: { role_menuId: { role: targetRole, menuId: menu.menuId } }, update: { isEnabled: menu.isEnabled }, create: { role: targetRole, menuId: menu.menuId, isEnabled: menu.isEnabled } });
      updates.push(`${menuAccess.length} menu(s) updated`);
    }

    if (permissions && Array.isArray(permissions)) {
      for (const perm of permissions) await prisma.rolePermission.upsert({ where: { role_permissionId: { role: targetRole, permissionId: perm.permissionId } }, update: { isEnabled: perm.isEnabled }, create: { role: targetRole, permissionId: perm.permissionId, isEnabled: perm.isEnabled } });
      updates.push(`${permissions.length} permission(s) updated`);
    }

    const updatedUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true, role: true } });
    res.json({ message: `User access updated: ${updates.join(", ")}`, user: updatedUser });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { affiliateProfile: true } });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.affiliateProfile) await prisma.affiliateProfile.update({ where: { id: user.affiliateProfile.id }, data: { status: isActive ? "ACTIVE" : "INACTIVE" } });

    res.json({ message: `User ${isActive ? "activated" : "deactivated"} successfully`, user: { id: user.id, email: user.email, fullName: user.fullName, isActive } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const changeUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    const adminId = req.userId;

    if (!["MEMBER", "ADMIN", "SUPERADMIN"].includes(role)) return res.status(400).json({ error: "Invalid role. Must be MEMBER, ADMIN, or SUPERADMIN" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (userId === adminId) return res.status(400).json({ error: "You cannot change your own role" });

    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    if (user.role === "SUPERADMIN" && admin.role !== "SUPERADMIN") return res.status(403).json({ error: "Only SUPERADMIN can modify SUPERADMIN users" });
    if (role === "SUPERADMIN" && admin.role !== "SUPERADMIN") return res.status(403).json({ error: "Only SUPERADMIN can assign SUPERADMIN role" });

    const updatedUser = await prisma.user.update({ where: { id: userId }, data: { role }, select: { id: true, email: true, fullName: true, role: true } });
    res.json({ message: `User role changed to ${role}`, user: updatedUser });
  } catch (error) { res.status(500).json({ error: error.message }); }
};
