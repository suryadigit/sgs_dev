import prisma from "../../shared/lib/prisma.js";

const VALID_ROLES = ["MEMBER", "ADMIN", "SUPERADMIN"];

export const getUserMenusDynamic = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const roleMenus = await prisma.roleMenu.findMany({ 
      where: { role: user.role, isEnabled: true }, 
      include: { menu: true }, 
      orderBy: { menu: { order: "asc" } } 
    });

    const menus = roleMenus
      .filter(rm => rm.menu.isActive)
      .map(rm => ({
        id: rm.menu.id,
        menuId: rm.menu.menuId,
        label: rm.menu.label,
        icon: rm.menu.icon,
        link: rm.menu.link,
        order: rm.menu.order,
        isAdmin: rm.menu.isAdmin,
        isEnabled: rm.isEnabled,
      }))
      .sort((a, b) => a.order - b.order);

    const userMenus = menus.filter(m => !m.isAdmin);
    const adminMenus = menus.filter(m => m.isAdmin);

    res.json({ 
      message: "User menus retrieved dynamically", 
      user: { id: user.id, role: user.role }, 
      menus: userMenus,
      adminMenus: adminMenus.length > 0 ? adminMenus : undefined
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAllMenus = async (req, res) => {
  try {
    const { includeInactive = false } = req.query;
    const where = includeInactive === 'true' ? {} : { isActive: true };
    const menus = await prisma.menu.findMany({ where, orderBy: { order: "asc" } });

    res.json({ 
      message: "All menus retrieved", 
      total: menus.length, 
      menus: menus.map(m => ({
        id: m.id,
        menuId: m.menuId,
        label: m.label,
        icon: m.icon,
        link: m.link,
        order: m.order,
        isAdmin: m.isAdmin,
        isActive: m.isActive,
        requiredPermission: m.requiredPermission,
      }))
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const createMenu = async (req, res) => {
  try {
    const { menuId, label, link, icon, order, isAdmin = false, isActive = true, requiredPermission } = req.body;
    if (!menuId || !label || !link) return res.status(400).json({ error: "menuId, label, and link are required" });

    const existingMenu = await prisma.menu.findFirst({ where: { OR: [{ menuId }, { link }] } });
    if (existingMenu) return res.status(409).json({ error: "Menu with this menuId or link already exists" });

    const menu = await prisma.menu.create({ 
      data: { menuId, label, icon, link, order: order || 0, isAdmin, isActive, requiredPermission } 
    });
    res.status(201).json({ message: "Menu created successfully", menu });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const updateMenu = async (req, res) => {
  try {
    const { id } = req.params;
    const { menuId, label, link, icon, order, isAdmin, isActive, requiredPermission } = req.body;
    if (!id) return res.status(400).json({ error: "Menu ID is required" });

    const existingMenu = await prisma.menu.findUnique({ where: { id } });
    if (!existingMenu) return res.status(404).json({ error: "Menu not found" });

    const updateData = {};
    if (menuId !== undefined) updateData.menuId = menuId;
    if (label !== undefined) updateData.label = label;
    if (link !== undefined) updateData.link = link;
    if (icon !== undefined) updateData.icon = icon;
    if (order !== undefined) updateData.order = order;
    if (isAdmin !== undefined) updateData.isAdmin = isAdmin;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (requiredPermission !== undefined) updateData.requiredPermission = requiredPermission;

    const menu = await prisma.menu.update({ where: { id }, data: updateData });
    res.json({ message: "Menu updated successfully", menu });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const deleteMenu = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Menu ID is required" });

    const existingMenu = await prisma.menu.findUnique({ where: { id } });
    if (!existingMenu) return res.status(404).json({ error: "Menu not found" });

    await prisma.roleMenu.deleteMany({ where: { menuId: id } });
    await prisma.menu.delete({ where: { id } });

    res.json({ message: "Menu deleted successfully", deletedMenu: { id: existingMenu.id, menuId: existingMenu.menuId, label: existingMenu.label } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAllPermissions = async (req, res) => {
  try {
    const permissions = await prisma.permission.findMany({ where: { isActive: true }, orderBy: { category: "asc" } });
    res.json({ 
      message: "All permissions retrieved", 
      total: permissions.length, 
      permissions: permissions.map(p => ({
        id: p.id,
        permissionId: p.permissionId,
        name: p.name,
        description: p.description,
        category: p.category,
        isActive: p.isActive,
      }))
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const createPermission = async (req, res) => {
  try {
    const { permissionId, name, description, category } = req.body;
    if (!permissionId || !name) return res.status(400).json({ error: "permissionId and name are required" });

    const existingPermission = await prisma.permission.findFirst({ where: { permissionId } });
    if (existingPermission) return res.status(409).json({ error: "Permission with this permissionId already exists" });

    const permission = await prisma.permission.create({ data: { permissionId, name, description, category } });
    res.status(201).json({ message: "Permission created successfully", permission });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getRoleConfig = async (req, res) => {
  try {
    const { role } = req.params;
    if (!role) return res.status(400).json({ error: "Role is required" });

    if (!VALID_ROLES.includes(role.toUpperCase())) {
      return res.status(400).json({ error: "Invalid role", validRoles: VALID_ROLES });
    }

    const [allMenus, allPermissions, roleMenus, rolePermissions] = await Promise.all([
      prisma.menu.findMany({ where: { isActive: true }, orderBy: { order: "asc" } }),
      prisma.permission.findMany({ where: { isActive: true }, orderBy: { category: "asc" } }),
      prisma.roleMenu.findMany({ where: { role: role.toUpperCase() } }),
      prisma.rolePermission.findMany({ where: { role: role.toUpperCase() } })
    ]);

    // Create a map of menuId -> isEnabled for this role
    const roleMenuMap = new Map();
    roleMenus.forEach(rm => {
      roleMenuMap.set(rm.menuId, rm.isEnabled);
    });

    // Create a map of permissionId -> isEnabled for this role  
    const rolePermissionMap = new Map();
    rolePermissions.forEach(rp => {
      rolePermissionMap.set(rp.permissionId, rp.isEnabled);
    });

    res.json({ 
      message: `Role configuration for ${role.toUpperCase()}`, 
      role: role.toUpperCase(),
      menus: allMenus.map(menu => ({
        id: menu.id,
        menuId: menu.menuId,
        label: menu.label,
        icon: menu.icon,
        link: menu.link,
        order: menu.order,
        isAdmin: menu.isAdmin,
        // Only show as enabled if explicitly set to true in roleMenu
        isEnabled: roleMenuMap.has(menu.id) ? roleMenuMap.get(menu.id) : false,
      })),
      permissions: allPermissions.map(perm => ({
        id: perm.id,
        permissionId: perm.permissionId,
        name: perm.name,
        description: perm.description,
        category: perm.category,
        // Only show as enabled if explicitly set to true in rolePermission
        isEnabled: rolePermissionMap.has(perm.id) ? rolePermissionMap.get(perm.id) : false,
      }))
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

// Toggle single menu for a role (simpler endpoint)
export const toggleRoleMenu = async (req, res) => {
  try {
    const { role, menuId } = req.params;
    if (!role || !menuId) return res.status(400).json({ error: "Role and menuId are required" });

    if (!VALID_ROLES.includes(role.toUpperCase())) {
      return res.status(400).json({ error: "Invalid role", validRoles: VALID_ROLES });
    }

    const menu = await prisma.menu.findUnique({ where: { id: menuId } });
    if (!menu) return res.status(404).json({ error: "Menu not found" });

    const existingRoleMenu = await prisma.roleMenu.findUnique({ 
      where: { role_menuId: { role: role.toUpperCase(), menuId } } 
    });

    let roleMenu;
    let newState;
    
    if (existingRoleMenu) {
      // Toggle the current state
      newState = !existingRoleMenu.isEnabled;
      roleMenu = await prisma.roleMenu.update({ 
        where: { role_menuId: { role: role.toUpperCase(), menuId } }, 
        data: { isEnabled: newState } 
      });
    } else {
      // Create new with enabled = true
      newState = true;
      roleMenu = await prisma.roleMenu.create({ 
        data: { role: role.toUpperCase(), menuId, isEnabled: true } 
      });
    }

    res.json({ 
      success: true,
      message: `Menu "${menu.label}" ${newState ? 'enabled' : 'disabled'} for ${role.toUpperCase()}`,
      roleMenu: { 
        role: roleMenu.role, 
        menuId: roleMenu.menuId, 
        menuLabel: menu.label, 
        isEnabled: roleMenu.isEnabled 
      }
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const updateRoleMenu = async (req, res) => {
  try {
    const { role, menuId } = req.params;
    const { isEnabled } = req.body;
    if (!role || !menuId) return res.status(400).json({ error: "Role and menuId are required" });
    if (isEnabled === undefined) return res.status(400).json({ error: "isEnabled is required" });

    if (!VALID_ROLES.includes(role.toUpperCase())) {
      return res.status(400).json({ error: "Invalid role", validRoles: VALID_ROLES });
    }

    const menu = await prisma.menu.findUnique({ where: { id: menuId } });
    if (!menu) return res.status(404).json({ error: "Menu not found" });

    const existingRoleMenu = await prisma.roleMenu.findUnique({ 
      where: { role_menuId: { role: role.toUpperCase(), menuId } } 
    });

    let roleMenu;
    if (existingRoleMenu) {
      roleMenu = await prisma.roleMenu.update({ 
        where: { role_menuId: { role: role.toUpperCase(), menuId } }, 
        data: { isEnabled } 
      });
    } else {
      roleMenu = await prisma.roleMenu.create({ 
        data: { role: role.toUpperCase(), menuId, isEnabled } 
      });
    }

    res.json({ 
      message: "Role menu updated", 
      roleMenu: { 
        role: roleMenu.role, 
        menuId: roleMenu.menuId, 
        menuLabel: menu.label, 
        isEnabled: roleMenu.isEnabled 
      }, 
      action: existingRoleMenu ? "updated" : "created" 
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const bulkUpdateRoleMenus = async (req, res) => {
  try {
    const { role } = req.params;
    
    // DEBUG LOGGING - Remove after fixing
    console.log("========== BULK UPDATE ROLE MENUS ==========");
    console.log("Role:", role);
    console.log("Request Body:", JSON.stringify(req.body, null, 2));
    console.log("=============================================");
    
    if (!role) return res.status(400).json({ error: "Role is required" });
    
    if (!VALID_ROLES.includes(role.toUpperCase())) {
      return res.status(400).json({ error: "Invalid role", validRoles: VALID_ROLES });
    }

    // Get all menus first
    const allMenus = await prisma.menu.findMany({ where: { isActive: true } });
    
    // Support multiple input formats from frontend
    let menuUpdates = new Map(); // Map of menuId -> isEnabled
    
    const inputData = req.body.menuIds || req.body.menus || req.body;
    
    console.log("Input Data:", JSON.stringify(inputData, null, 2));
    console.log("Is Array:", Array.isArray(inputData));
    
    if (Array.isArray(inputData)) {
      if (inputData.length > 0 && typeof inputData[0] === 'object') {
        // Format: [{ id: 'xxx', isEnabled: true/false }, ...]
        // This format explicitly specifies each menu's state
        inputData.forEach(item => {
          const menuId = item.id || item.menuId;
          if (menuId) {
            menuUpdates.set(menuId, Boolean(item.isEnabled));
          }
        });
      } else {
        // Format: ['id1', 'id2', ...] - simple array of enabled menu IDs
        // All IDs in array = enabled, all others = disabled
        allMenus.forEach(menu => {
          menuUpdates.set(menu.id, inputData.includes(menu.id));
        });
      }
    } else {
      return res.status(400).json({ 
        error: "Invalid format", 
        hint: "Send { menus: [{ id: 'x', isEnabled: true/false }] } or { menuIds: ['id1', 'id2'] }",
        received: req.body 
      });
    }

    // If using object format but not all menus are specified, keep existing state for unspecified ones
    if (inputData.length > 0 && typeof inputData[0] === 'object') {
      // Get current role menu states
      const currentRoleMenus = await prisma.roleMenu.findMany({ 
        where: { role: role.toUpperCase() } 
      });
      
      // For menus not in the update request, keep their current state
      for (const menu of allMenus) {
        if (!menuUpdates.has(menu.id)) {
          const current = currentRoleMenus.find(rm => rm.menuId === menu.id);
          menuUpdates.set(menu.id, current ? current.isEnabled : false);
        }
      }
    }

    const results = [];
    for (const menu of allMenus) {
      const shouldEnable = menuUpdates.get(menu.id) ?? false;
      const existingRoleMenu = await prisma.roleMenu.findUnique({ 
        where: { role_menuId: { role: role.toUpperCase(), menuId: menu.id } } 
      });

      if (existingRoleMenu) {
        // Only update if state is different
        if (existingRoleMenu.isEnabled !== shouldEnable) {
          await prisma.roleMenu.update({ 
            where: { role_menuId: { role: role.toUpperCase(), menuId: menu.id } }, 
            data: { isEnabled: shouldEnable } 
          });
          results.push({ menuId: menu.id, label: menu.label, action: "updated", isEnabled: shouldEnable });
        }
      } else {
        // Create new record - whether enabled or disabled
        await prisma.roleMenu.create({ 
          data: { role: role.toUpperCase(), menuId: menu.id, isEnabled: shouldEnable } 
        });
        results.push({ menuId: menu.id, label: menu.label, action: "created", isEnabled: shouldEnable });
      }
    }

    res.json({ 
      message: "Bulk role menus updated", 
      role: role.toUpperCase(), 
      results,
      summary: { 
        total: results.length, 
        updated: results.filter(r => r.action === "updated").length, 
        created: results.filter(r => r.action === "created").length,
        enabled: results.filter(r => r.isEnabled).length,
        disabled: results.filter(r => !r.isEnabled).length
      } 
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

// Toggle single permission for a role
export const toggleRolePermission = async (req, res) => {
  try {
    const { role, permissionId } = req.params;
    if (!role || !permissionId) return res.status(400).json({ error: "Role and permissionId are required" });

    if (!VALID_ROLES.includes(role.toUpperCase())) {
      return res.status(400).json({ error: "Invalid role", validRoles: VALID_ROLES });
    }

    const permission = await prisma.permission.findUnique({ where: { id: permissionId } });
    if (!permission) return res.status(404).json({ error: "Permission not found" });

    const existingRolePermission = await prisma.rolePermission.findUnique({ 
      where: { role_permissionId: { role: role.toUpperCase(), permissionId } } 
    });

    let rolePermission;
    let newState;
    
    if (existingRolePermission) {
      newState = !existingRolePermission.isEnabled;
      rolePermission = await prisma.rolePermission.update({ 
        where: { role_permissionId: { role: role.toUpperCase(), permissionId } }, 
        data: { isEnabled: newState } 
      });
    } else {
      newState = true;
      rolePermission = await prisma.rolePermission.create({ 
        data: { role: role.toUpperCase(), permissionId, isEnabled: true } 
      });
    }

    res.json({ 
      success: true,
      message: `Permission "${permission.name}" ${newState ? 'enabled' : 'disabled'} for ${role.toUpperCase()}`,
      rolePermission: { 
        role: rolePermission.role, 
        permissionId: rolePermission.permissionId, 
        permissionName: permission.name, 
        isEnabled: rolePermission.isEnabled 
      }
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const updateRolePermission = async (req, res) => {
  try {
    const { role, permissionId } = req.params;
    const { isEnabled } = req.body;
    if (!role || !permissionId) return res.status(400).json({ error: "Role and permissionId are required" });
    if (isEnabled === undefined) return res.status(400).json({ error: "isEnabled is required" });

    if (!VALID_ROLES.includes(role.toUpperCase())) {
      return res.status(400).json({ error: "Invalid role", validRoles: VALID_ROLES });
    }

    const permission = await prisma.permission.findUnique({ where: { id: permissionId } });
    if (!permission) return res.status(404).json({ error: "Permission not found" });

    const existingRolePermission = await prisma.rolePermission.findUnique({ 
      where: { role_permissionId: { role: role.toUpperCase(), permissionId } } 
    });

    let rolePermission;
    if (existingRolePermission) {
      rolePermission = await prisma.rolePermission.update({ 
        where: { role_permissionId: { role: role.toUpperCase(), permissionId } }, 
        data: { isEnabled } 
      });
    } else {
      rolePermission = await prisma.rolePermission.create({ 
        data: { role: role.toUpperCase(), permissionId, isEnabled } 
      });
    }

    res.json({ 
      message: "Role permission updated", 
      rolePermission: { 
        role: rolePermission.role, 
        permissionId: rolePermission.permissionId, 
        permissionName: permission.name, 
        isEnabled: rolePermission.isEnabled 
      }, 
      action: existingRolePermission ? "updated" : "created" 
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const bulkUpdateRolePermissions = async (req, res) => {
  try {
    const { role } = req.params;
    
    if (!role) return res.status(400).json({ error: "Role is required" });
    
    if (!VALID_ROLES.includes(role.toUpperCase())) {
      return res.status(400).json({ error: "Invalid role", validRoles: VALID_ROLES });
    }

    // Get all permissions first
    const allPermissions = await prisma.permission.findMany({ where: { isActive: true } });
    
    // Support multiple input formats from frontend
    let permissionUpdates = new Map(); // Map of permissionId -> isEnabled
    
    const inputData = req.body.permissionIds || req.body.permissions || req.body;
    
    if (Array.isArray(inputData)) {
      if (inputData.length > 0 && typeof inputData[0] === 'object') {
        // Format: [{ id: 'xxx', isEnabled: true/false }, ...]
        inputData.forEach(item => {
          const permId = item.id || item.permissionId;
          if (permId) {
            permissionUpdates.set(permId, Boolean(item.isEnabled));
          }
        });
      } else {
        // Format: ['id1', 'id2', ...] - simple array of enabled permission IDs
        allPermissions.forEach(perm => {
          permissionUpdates.set(perm.id, inputData.includes(perm.id));
        });
      }
    } else {
      return res.status(400).json({ 
        error: "Invalid format",
        hint: "Send { permissions: [{ id: 'x', isEnabled: true/false }] } or { permissionIds: ['id1', 'id2'] }",
        received: req.body
      });
    }

    // If using object format but not all permissions are specified, keep existing state
    if (inputData.length > 0 && typeof inputData[0] === 'object') {
      const currentRolePermissions = await prisma.rolePermission.findMany({ 
        where: { role: role.toUpperCase() } 
      });
      
      for (const perm of allPermissions) {
        if (!permissionUpdates.has(perm.id)) {
          const current = currentRolePermissions.find(rp => rp.permissionId === perm.id);
          permissionUpdates.set(perm.id, current ? current.isEnabled : false);
        }
      }
    }

    const results = [];
    for (const perm of allPermissions) {
      const shouldEnable = permissionUpdates.get(perm.id) ?? false;
      const existingRolePermission = await prisma.rolePermission.findUnique({ 
        where: { role_permissionId: { role: role.toUpperCase(), permissionId: perm.id } } 
      });

      if (existingRolePermission) {
        // Only update if state is different
        if (existingRolePermission.isEnabled !== shouldEnable) {
          await prisma.rolePermission.update({ 
            where: { role_permissionId: { role: role.toUpperCase(), permissionId: perm.id } }, 
            data: { isEnabled: shouldEnable } 
          });
          results.push({ permissionId: perm.id, name: perm.name, action: "updated", isEnabled: shouldEnable });
        }
      } else {
        // Create new record - whether enabled or disabled
        await prisma.rolePermission.create({ 
          data: { role: role.toUpperCase(), permissionId: perm.id, isEnabled: shouldEnable } 
        });
        results.push({ permissionId: perm.id, name: perm.name, action: "created", isEnabled: shouldEnable });
      }
    }

    res.json({ 
      message: "Bulk role permissions updated", 
      role: role.toUpperCase(), 
      results,
      summary: { 
        total: results.length, 
        updated: results.filter(r => r.action === "updated").length, 
        created: results.filter(r => r.action === "created").length,
        enabled: results.filter(r => r.isEnabled).length,
        disabled: results.filter(r => !r.isEnabled).length
      } 
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAccessConfig = async (req, res) => {
  try {
    const [allMenus, allPermissions, allRoleMenus, allRolePermissions] = await Promise.all([
      prisma.menu.findMany({ where: { isActive: true }, orderBy: { order: "asc" } }),
      prisma.permission.findMany({ where: { isActive: true }, orderBy: { category: "asc" } }),
      prisma.roleMenu.findMany(),
      prisma.rolePermission.findMany()
    ]);

    const roleConfigs = VALID_ROLES.map(role => {
      const roleMenus = allRoleMenus.filter(rm => rm.role === role);
      const rolePermissions = allRolePermissions.filter(rp => rp.role === role);

      // Create maps for efficient lookup
      const roleMenuMap = new Map();
      roleMenus.forEach(rm => {
        roleMenuMap.set(rm.menuId, rm.isEnabled);
      });

      const rolePermissionMap = new Map();
      rolePermissions.forEach(rp => {
        rolePermissionMap.set(rp.permissionId, rp.isEnabled);
      });

      return {
        role,
        menus: allMenus.map(menu => ({
          id: menu.id,
          menuId: menu.menuId,
          label: menu.label,
          isAdmin: menu.isAdmin,
          // Only enabled if explicitly set to true
          isEnabled: roleMenuMap.has(menu.id) ? roleMenuMap.get(menu.id) : false,
        })),
        permissions: allPermissions.map(perm => ({
          id: perm.id,
          permissionId: perm.permissionId,
          name: perm.name,
          category: perm.category,
          // Only enabled if explicitly set to true
          isEnabled: rolePermissionMap.has(perm.id) ? rolePermissionMap.get(perm.id) : false,
        }))
      };
    });

    res.json({ 
      message: "Access configuration retrieved", 
      roles: VALID_ROLES, 
      totalMenus: allMenus.length, 
      totalPermissions: allPermissions.length, 
      roleConfigs 
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};
