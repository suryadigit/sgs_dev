import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";

export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: "No token provided",
      code: "NO_TOKEN",
      message: "Authorization header is missing",
      hint: "Add 'Authorization: Bearer <token>' in request headers",
      requireLogin: true,
      redirectTo: "/signin"
    });
  }

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Invalid token format",
      code: "INVALID_FORMAT",
      message: "Authorization header must start with 'Bearer'",
      hint: "Correct format: 'Authorization: Bearer <token>'",
      requireLogin: true,
      redirectTo: "/signin"
    });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      error: "No token provided",
      code: "NO_TOKEN",
      message: "Token is missing after 'Bearer'",
      hint: "Correct format: 'Authorization: Bearer <token>'",
      requireLogin: true,
      redirectTo: "/signin"
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Token expired",
        code: "TOKEN_EXPIRED",
        message: "Sesi login Anda telah berakhir. Silakan login kembali.",
        hint: "Please login again to get a new token",
        requireLogin: true,
        redirectTo: "/signin"
      });
    }
    return res.status(401).json({
      error: "Invalid token",
      code: "INVALID_TOKEN",
      message: "Token tidak valid. Silakan login kembali.",
      hint: "Token is invalid or corrupted. Please login again.",
      requireLogin: true,
      redirectTo: "/signin"
    });
  }
};

export const verifyAdmin = async (req, res, next) => {
  try {
    const userId = req.userId;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ 
        error: "Access denied",
        message: "Admin privileges required"
      });
    }
    
    next();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const errorHandler = (err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
};
