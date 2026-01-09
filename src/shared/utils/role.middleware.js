import { hasPermission } from "../../../ROLE_PERMISSIONS_CONFIG.js";

const requireRole = (...allowedRoles) => {
  const roles = allowedRoles.flat();
  
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not authenticated"
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Only ${roles.join(", ")} can access this resource`,
        userRole: req.user.role
      });
    }

    next();
  };
};

const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not authenticated"
      });
    }

    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: You don't have permission "${permission}"`,
        userRole: req.user.role,
        requiredPermission: permission
      });
    }

    next();
  };
};

const requireAnyPermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not authenticated"
      });
    }

    const hasAny = permissions.some(p => hasPermission(req.user.role, p));
    
    if (!hasAny) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: You need one of these permissions: ${permissions.join(", ")}`,
        userRole: req.user.role,
        requiredPermissions: permissions
      });
    }

    next();
  };
};

const requireAllPermissions = (...permissions) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not authenticated"
      });
    }

    const missingPermissions = permissions.filter(p => !hasPermission(req.user.role, p));
    
    if (missingPermissions.length > 0) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Missing permissions: ${missingPermissions.join(", ")}`,
        userRole: req.user.role,
        missingPermissions
      });
    }

    next();
  };
};

const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.role) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: User not authenticated"
    });
  }

  if (!["ADMIN", "SUPERADMIN"].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Admin access required",
      userRole: req.user.role
    });
  }

  next();
};

const requireSuperAdmin = (req, res, next) => {
  if (!req.user || !req.user.role) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: User not authenticated"
    });
  }

  if (req.user.role !== "SUPERADMIN") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: Super Admin access required",
      userRole: req.user.role
    });
  }

  next();
};

const requireUser = (req, res, next) => {
  if (!req.user || !req.user.role) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: User not authenticated"
    });
  }

  if (req.user.role !== "MEMBER") {
    return res.status(403).json({
      success: false,
      message: "Forbidden: User access required",
      userRole: req.user.role
    });
  }

  next();
};

const checkRole = (userRole, requiredRoles) => {
  if (typeof requiredRoles === "string") {
    requiredRoles = [requiredRoles];
  }
  return requiredRoles.includes(userRole);
};
const getRoleDescription = (role) => {
  const descriptions = {
    USER: "Regular User",
    ADMIN: "Administrator",
    SUPERADMIN: "Super Administrator"
  };
  return descriptions[role] || "Unknown Role";
};

export {
  requireRole,          
  requireAdmin,         
  requireSuperAdmin,    
  requireUser,           
  requirePermission,    
  requireAnyPermission,  
  requireAllPermissions, 
  checkRole,            
  getRoleDescription     
};
