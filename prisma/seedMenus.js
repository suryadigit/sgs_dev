import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seedMenusAndPermissions() {
  console.log("🌱 Seeding Menus, Permissions, and Role Configurations...\n");

  try {
    // Clear existing data
    console.log("🗑️  Clearing existing menu/permission data...");
    await prisma.roleMenu.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.menu.deleteMany({});
    await prisma.permission.deleteMany({});

    // ==================== CREATE PERMISSIONS ====================
    console.log("\n📋 Creating Permissions...");
    const permissions = [
      { permissionId: "dashboard:view_personal", name: "View Personal Dashboard", category: "Dashboard" },
      { permissionId: "dashboard:view_admin", name: "View Admin Dashboard", category: "Dashboard" },
      { permissionId: "dashboard:view_referral_tree", name: "View Referral Tree", category: "Dashboard" },
      { permissionId: "profile:view", name: "View Profile", category: "Profile" },
      { permissionId: "profile:edit", name: "Edit Profile", category: "Profile" },
      { permissionId: "commission:view_own", name: "View Own Commissions", category: "Commission" },
      { permissionId: "commission:view_all", name: "View All Commissions", category: "Commission" },
      { permissionId: "commission:approve", name: "Approve Commissions", category: "Commission" },
      { permissionId: "withdrawal:view_balance", name: "View Balance", category: "Withdrawal" },
      { permissionId: "withdrawal:request", name: "Request Withdrawal", category: "Withdrawal" },
      { permissionId: "withdrawal:approve", name: "Approve Withdrawals", category: "Withdrawal" },
      { permissionId: "admin:manage_users", name: "Manage Users", category: "Admin" },
      { permissionId: "admin:system_config", name: "System Configuration", category: "Admin" },
      { permissionId: "admin:change_user_role", name: "Change User Role", category: "Admin" },
    ];

    for (const perm of permissions) {
      await prisma.permission.create({ data: perm });
      console.log(`  ✅ ${perm.permissionId}`);
    }

    // ==================== CREATE MENUS ====================
    console.log("\n📁 Creating Menus...");
    const menus = [
      // User Menus
      { menuId: "dashboard", label: "Dashboard", icon: "dashboard", link: "/dashboard-affiliate", order: 1, isAdmin: false, requiredPermission: "dashboard:view_personal" },
      { menuId: "referral", label: "Komisi Referral", icon: "cards", link: "/referral-commission", order: 2, isAdmin: false, requiredPermission: "commission:view_own" },
      { menuId: "commission-history", label: "Riwayat Komisi", icon: "history", link: "/commission-history", order: 3, isAdmin: false, requiredPermission: "commission:view_own" },
      { menuId: "wallet", label: "Dompet", icon: "wallet", link: "/wallet", order: 4, isAdmin: false, requiredPermission: "withdrawal:view_balance" },
      { menuId: "withdrawal", label: "Penarikan", icon: "money", link: "/withdrawal", order: 5, isAdmin: false, requiredPermission: "withdrawal:request" },
      { menuId: "referral-tree", label: "Jaringan Referral", icon: "network", link: "/referral-tree", order: 6, isAdmin: false, requiredPermission: "dashboard:view_referral_tree" },
      { menuId: "profile", label: "Profil", icon: "user", link: "/profile", order: 7, isAdmin: false, requiredPermission: "profile:view" },
      { menuId: "notifications", label: "Notifikasi", icon: "bell", link: "/notifications", order: 8, isAdmin: false, requiredPermission: "profile:view" },
      // Admin Menus
      { menuId: "admin-dashboard", label: "Dashboard Admin", icon: "dashboard-admin", link: "/admin/dashboard", order: 10, isAdmin: true, requiredPermission: "dashboard:view_admin" },
      { menuId: "approval-commission", label: "Approval Komisi", icon: "check-circle", link: "/approval-commission", order: 11, isAdmin: true, requiredPermission: "commission:approve" },
      { menuId: "manage-withdrawal", label: "Kelola Penarikan", icon: "bank", link: "/admin/withdrawals", order: 12, isAdmin: true, requiredPermission: "withdrawal:approve" },
      { menuId: "all-commissions", label: "Semua Komisi", icon: "list", link: "/admin/commissions", order: 13, isAdmin: true, requiredPermission: "commission:view_all" },
      { menuId: "manage-users", label: "Kelola User", icon: "users", link: "/admin/users", order: 14, isAdmin: true, requiredPermission: "admin:manage_users" },
      { menuId: "manage-roles", label: "Manajemen Role", icon: "shield", link: "/admin/roles", order: 15, isAdmin: true, requiredPermission: "admin:system_config" },
    ];

    const createdMenus = {};
    for (const menu of menus) {
      const created = await prisma.menu.create({ data: menu });
      createdMenus[menu.menuId] = created.id;
      console.log(`  ✅ ${menu.label} (${menu.menuId})`);
    }

    // ==================== ROLE PERMISSIONS ====================
    console.log("\n🔐 Creating Role Permissions...");
    
    // MEMBER permissions
    const memberPermissions = [
      "dashboard:view_personal",
      "dashboard:view_referral_tree",
      "profile:view",
      "profile:edit",
      "commission:view_own",
      "withdrawal:view_balance",
      "withdrawal:request",
    ];

    // ADMIN permissions (includes MEMBER + admin)
    const adminPermissions = [
      ...memberPermissions,
      "dashboard:view_admin",
      "commission:view_all",
      "commission:approve",
      "withdrawal:approve",
      "admin:manage_users",
    ];

    // SUPERADMIN permissions (all)
    const superadminPermissions = [
      ...adminPermissions,
      "admin:system_config",
      "admin:change_user_role",
    ];

    const allPermissions = await prisma.permission.findMany();
    const permissionMap = {};
    allPermissions.forEach(p => { permissionMap[p.permissionId] = p.id; });

    // Create MEMBER role permissions
    for (const permId of memberPermissions) {
      if (permissionMap[permId]) {
        await prisma.rolePermission.create({
          data: { role: "MEMBER", permissionId: permissionMap[permId], isEnabled: true }
        });
      }
    }
    console.log(`  ✅ MEMBER: ${memberPermissions.length} permissions`);

    // Create ADMIN role permissions
    for (const permId of adminPermissions) {
      if (permissionMap[permId]) {
        await prisma.rolePermission.create({
          data: { role: "ADMIN", permissionId: permissionMap[permId], isEnabled: true }
        });
      }
    }
    console.log(`  ✅ ADMIN: ${adminPermissions.length} permissions`);

    // Create SUPERADMIN role permissions
    for (const permId of superadminPermissions) {
      if (permissionMap[permId]) {
        await prisma.rolePermission.create({
          data: { role: "SUPERADMIN", permissionId: permissionMap[permId], isEnabled: true }
        });
      }
    }
    console.log(`  ✅ SUPERADMIN: ${superadminPermissions.length} permissions`);

    // ==================== ROLE MENUS ====================
    console.log("\n📋 Creating Role Menus...");

    // MEMBER menus (user menus only)
    const memberMenus = ["dashboard", "referral", "commission-history", "wallet", "withdrawal", "referral-tree", "profile", "notifications"];
    
    // ADMIN menus (user menus + some admin menus)
    const adminMenus = [...memberMenus, "admin-dashboard", "approval-commission", "manage-withdrawal", "all-commissions", "manage-users"];
    
    // SUPERADMIN menus (all menus)
    const superadminMenus = [...adminMenus, "manage-roles"];

    // Create MEMBER role menus
    for (const menuId of memberMenus) {
      if (createdMenus[menuId]) {
        await prisma.roleMenu.create({
          data: { role: "MEMBER", menuId: createdMenus[menuId], isEnabled: true }
        });
      }
    }
    console.log(`  ✅ MEMBER: ${memberMenus.length} menus`);

    // Create ADMIN role menus
    for (const menuId of adminMenus) {
      if (createdMenus[menuId]) {
        await prisma.roleMenu.create({
          data: { role: "ADMIN", menuId: createdMenus[menuId], isEnabled: true }
        });
      }
    }
    console.log(`  ✅ ADMIN: ${adminMenus.length} menus`);

    // Create SUPERADMIN role menus
    for (const menuId of superadminMenus) {
      if (createdMenus[menuId]) {
        await prisma.roleMenu.create({
          data: { role: "SUPERADMIN", menuId: createdMenus[menuId], isEnabled: true }
        });
      }
    }
    console.log(`  ✅ SUPERADMIN: ${superadminMenus.length} menus`);

    console.log("\n═".repeat(60));
    console.log("✨ Menu & Permission seed completed successfully!");
    console.log("═".repeat(60));

  } catch (error) {
    console.error("❌ Error during seed:", error);
    throw error;
  }
}

seedMenusAndPermissions()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
