import express from "express";
import { verifyToken } from "../../shared/middlewares/auth.js";
import { requireAdmin } from "../../shared/utils/role.middleware.js";
import {
  getMyNotifications,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  deleteNotification,
  getAllNotifications,
  sendNotificationToUser,
  sendBroadcastNotification,
  getAdminNotifications,
} from "./notification.controller.js";

const router = express.Router();

router.get("/", verifyToken, getMyNotifications);
router.get("/unread-count", verifyToken, getUnreadCount);
router.patch("/read-all", verifyToken, markAllAsRead);

router.get("/admin/all", verifyToken, requireAdmin, getAllNotifications);
router.get("/admin/inbox", verifyToken, requireAdmin, getAdminNotifications);
router.post("/admin/send", verifyToken, requireAdmin, sendNotificationToUser);
router.post("/admin/broadcast", verifyToken, requireAdmin, sendBroadcastNotification);

router.get("/:notificationId", verifyToken, getNotificationById);
router.patch("/:notificationId/read", verifyToken, markAsRead);
router.delete("/:notificationId", verifyToken, deleteNotification);

export default router;
