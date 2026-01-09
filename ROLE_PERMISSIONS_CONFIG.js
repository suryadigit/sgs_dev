// ============================================
// ROLE PERMISSIONS CONFIGURATION
// ============================================

export const PERMISSIONS = {
  // Dashboard
  DASHBOARD_VIEW_PERSONAL: "dashboard:view_personal",
  DASHBOARD_VIEW_ADMIN: "dashboard:view_admin",
  DASHBOARD_VIEW_REFERRAL_TREE: "dashboard:view_referral_tree",

  // Profile
  PROFILE_VIEW: "profile:view",
  PROFILE_EDIT: "profile:edit",

  // Commission
  COMMISSION_VIEW_OWN: "commission:view_own",
  COMMISSION_VIEW_ALL: "commission:view_all",
  COMMISSION_APPROVE: "commission:approve",

  // Withdrawal
  WITHDRAWAL_VIEW_BALANCE: "withdrawal:view_balance",
  WITHDRAWAL_REQUEST: "withdrawal:request",
  WITHDRAWAL_APPROVE: "withdrawal:approve",

  // Admin
  ADMIN_MANAGE_USERS: "admin:manage_users",
  ADMIN_SYSTEM_CONFIG: "admin:system_config",
  ADMIN_CHANGE_USER_ROLE: "admin:change_user_role",
};

export const ROLE_PERMISSIONS = {
  MEMBER: [
    PERMISSIONS.DASHBOARD_VIEW_PERSONAL,
    PERMISSIONS.DASHBOARD_VIEW_REFERRAL_TREE,
    PERMISSIONS.PROFILE_VIEW,
    PERMISSIONS.PROFILE_EDIT,
    PERMISSIONS.COMMISSION_VIEW_OWN,
    PERMISSIONS.WITHDRAWAL_VIEW_BALANCE,
    PERMISSIONS.WITHDRAWAL_REQUEST,
  ],
  ADMIN: [
    // All MEMBER permissions
    PERMISSIONS.DASHBOARD_VIEW_PERSONAL,
    PERMISSIONS.DASHBOARD_VIEW_REFERRAL_TREE,
    PERMISSIONS.PROFILE_VIEW,
    PERMISSIONS.PROFILE_EDIT,
    PERMISSIONS.COMMISSION_VIEW_OWN,
    PERMISSIONS.WITHDRAWAL_VIEW_BALANCE,
    PERMISSIONS.WITHDRAWAL_REQUEST,
    // Admin specific
    PERMISSIONS.DASHBOARD_VIEW_ADMIN,
    PERMISSIONS.COMMISSION_VIEW_ALL,
    PERMISSIONS.COMMISSION_APPROVE,
    PERMISSIONS.WITHDRAWAL_APPROVE,
  ],
  SUPERADMIN: [
    // All permissions
    PERMISSIONS.DASHBOARD_VIEW_PERSONAL,
    PERMISSIONS.DASHBOARD_VIEW_REFERRAL_TREE,
    PERMISSIONS.DASHBOARD_VIEW_ADMIN,
    PERMISSIONS.PROFILE_VIEW,
    PERMISSIONS.PROFILE_EDIT,
    PERMISSIONS.COMMISSION_VIEW_OWN,
    PERMISSIONS.COMMISSION_VIEW_ALL,
    PERMISSIONS.COMMISSION_APPROVE,
    PERMISSIONS.WITHDRAWAL_VIEW_BALANCE,
    PERMISSIONS.WITHDRAWAL_REQUEST,
    PERMISSIONS.WITHDRAWAL_APPROVE,
    PERMISSIONS.ADMIN_MANAGE_USERS,
    PERMISSIONS.ADMIN_SYSTEM_CONFIG,
    PERMISSIONS.ADMIN_CHANGE_USER_ROLE,
  ],
};

/**
 * Check if a role has a specific permission
 * @param {string} role - User role (MEMBER, ADMIN, SUPERADMIN)
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
export const hasPermission = (role, permission) => {
  // SUPERADMIN has all permissions
  if (role === "SUPERADMIN") {
    return true;
  }

  const rolePermissions = ROLE_PERMISSIONS[role];
  if (!rolePermissions) {
    return false;
  }

  return rolePermissions.includes(permission);
};

/**
 * Get all permissions for a role
 * @param {string} role - User role
 * @returns {string[]}
 */
export const getPermissionsForRole = (role) => {
  return ROLE_PERMISSIONS[role] || [];
};

// Alias for backward compatibility
export const getPermissions = getPermissionsForRole;

/**
 * Get role information
 * @param {string} role - User role
 * @returns {object}
 */
export const getRoleInfo = (role) => {
  const descriptions = {
    MEMBER: { name: "Member", description: "Regular user with basic access" },
    ADMIN: { name: "Admin", description: "Administrator with management access" },
    SUPERADMIN: { name: "Super Admin", description: "Full system access" },
  };
  return descriptions[role] || { name: "Unknown", description: "Unknown role" };
};

export default {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  getPermissionsForRole,
  getPermissions,
  getRoleInfo,
};
