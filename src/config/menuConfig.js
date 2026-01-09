import { hasPermission, ROLE_PERMISSIONS } from "../../ROLE_PERMISSIONS_CONFIG.js";

export const ALL_MENUS = {
  dashboard: {
    id: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    link: "/dashboard-affiliate",
    order: 1,
    requiredPermission: "dashboard:view_personal",
  },
  referral: {
    id: "referral",
    label: "Komisi Referral",
    icon: "cards",
    link: "/referral-commission",
    order: 2,
    requiredPermission: "commission:view_own",
  },
  commissionHistory: {
    id: "commission-history",
    label: "Riwayat Komisi",
    icon: "history",
    link: "/commission-history",
    order: 3,
    requiredPermission: "commission:view_own",
  },
  wallet: {
    id: "wallet",
    label: "Dompet",
    icon: "wallet",
    link: "/wallet",
    order: 4,
    requiredPermission: "withdrawal:view_balance",
  },
  withdrawal: {
    id: "withdrawal",
    label: "Penarikan",
    icon: "money",
    link: "/withdrawal",
    order: 5,
    requiredPermission: "withdrawal:request",
  },
  referralTree: {
    id: "referral-tree",
    label: "Jaringan Referral",
    icon: "network",
    link: "/referral-tree",
    order: 6,
    requiredPermission: "dashboard:view_referral_tree",
  },
  profile: {
    id: "profile",
    label: "Profil",
    icon: "user",
    link: "/profile",
    order: 7,
    requiredPermission: "profile:view",
  },
  notifications: {
    id: "notifications",
    label: "Notifikasi",
    icon: "bell",
    link: "/notifications",
    order: 8,
    requiredPermission: "profile:view", 
  },
  adminDashboard: {
    id: "admin-dashboard",
    label: "Dashboard Admin",
    icon: "dashboard-admin",
    link: "/admin/dashboard",
    order: 1,
    requiredPermission: "dashboard:view_admin",
    isAdmin: true,
  },
  approvalCommission: {
    id: "approval-commission",
    label: "Approval Komisi",
    icon: "check-circle",
    link: "/approval-commission",
    order: 11,
    requiredPermission: "commission:approve",
    isAdmin: true,
  },
  manageWithdrawal: {
    id: "manage-withdrawal",
    label: "Kelola Penarikan",
    icon: "bank",
    link: "/admin/withdrawals",
    order: 12,
    requiredPermission: "withdrawal:approve",
    isAdmin: true,
  },
  allCommissions: {
    id: "all-commissions",
    label: "Semua Komisi",
    icon: "list",
    link: "/admin/commissions",
    order: 13,
    requiredPermission: "commission:view_all",
    isAdmin: true,
  },
  allUsers: {
    id: "all-users",
    label: "Kelola User",
    icon: "users",
    link: "/admin/users",
    order: 14,
    requiredPermission: "admin:manage_users",
    isAdmin: true,
  },
  systemConfig: {
    id: "system-config",
    label: "Konfigurasi Sistem",
    icon: "settings",
    link: "/admin/config",
    order: 20,
    requiredPermission: "admin:system_config",
    isAdmin: true,
  },
  roleManagement: {
    id: "role-management",
    label: "Manajemen Menu",
    icon: "shield",
    link: "/admin/roles",
    order: 21,
    requiredPermission: "admin:change_user_role",
    isAdmin: true,
  },
};

export const ROLE_MENUS = {
  MEMBER: [
    "dashboard",
    "referral",
    "commissionHistory",
    "wallet",
    "withdrawal",
    "referralTree",
    "profile",
    "notifications",
  ],
  ADMIN: [
    "dashboard",
    "referral",
    "commissionHistory",
    "wallet",
    "withdrawal",
    "referralTree",
    "profile",
    "notifications",
    "adminDashboard",
    "approvalCommission",
    "manageWithdrawal",
    "allCommissions",
  ],
  SUPERADMIN: [
    "dashboard",
    "referral",
    "commissionHistory",
    "wallet",
    "withdrawal",
    "referralTree",
    "profile",
    "notifications",
    "adminDashboard",
    "approvalCommission",
    "manageWithdrawal",
    "allCommissions",
    "allUsers",
    "systemConfig",
    "roleManagement",
  ],
};

export const getMenusForRole = (role) => {
  const menuIds = ROLE_MENUS[role] || ROLE_MENUS.MEMBER;
  
  const menus = menuIds
    .map((menuId) => ALL_MENUS[menuId])
    .filter((menu) => {
      if (!menu) return false;
      
      if (role === 'SUPERADMIN') {
        return true;
      }
      
      if (menu.requiredPermission) {
        return hasPermission(role, menu.requiredPermission);
      }
      return true;
    })
    .sort((a, b) => a.order - b.order);

  const userMenus = menus.filter((m) => !m.isAdmin);
  const adminMenus = menus.filter((m) => m.isAdmin);

  if (role === 'ADMIN' || role === 'SUPERADMIN') {
    const adminDashboard = adminMenus.find(m => m.id === 'admin-dashboard');
    const otherAdminMenus = adminMenus.filter(m => m.id !== 'admin-dashboard');

    if (adminDashboard) adminDashboard.order = -1000;

    const combined = [...userMenus];
    if (adminDashboard) combined.unshift(adminDashboard);
    combined.sort((a, b) => a.order - b.order);

    try { console.log('[getMenusForRole] role=', role, 'menus=', combined.map(m => ({ id: m.id, order: m.order }))); } catch (e) {}

    return {
      menus: combined,
      adminMenus: otherAdminMenus.length > 0 ? otherAdminMenus : undefined,
    };
  }

  return {
    menus: userMenus,
    adminMenus: adminMenus.length > 0 ? adminMenus : undefined,
  };
};

export const getPermissionsForRole = (role) => {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.MEMBER || [];
};

export default {
  ALL_MENUS,
  ROLE_MENUS,
  getMenusForRole,
  getPermissionsForRole,
};
