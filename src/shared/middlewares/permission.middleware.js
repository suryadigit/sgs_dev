import { hasPermission } from "../../../ROLE_PERMISSIONS_CONFIG.js";

export const requirePermission = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not authenticated"
      });
    }

    const hasAny = requiredPermissions.some(permission => 
      hasPermission(req.user.role, permission)
    );

    if (!hasAny) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Permission required: ${requiredPermissions.join(" or ")}`,
        userRole: req.user.role,
        requiredPermissions
      });
    }

    next();
  };
};

export const requireAllPermissions = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not authenticated"
      });
    }

    const hasAll = requiredPermissions.every(permission => 
      hasPermission(req.user.role, permission)
    );

    if (!hasAll) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: All permissions required: ${requiredPermissions.join(", ")}`,
        userRole: req.user.role,
        requiredPermissions
      });
    }

    next();
  };
};

export default requirePermission;
