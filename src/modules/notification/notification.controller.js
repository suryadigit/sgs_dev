import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const createNotification = async ({ userId, fromUserId = null, type, title, message, data = null }) => {
  try {
    const notification = await prisma.notification.create({ data: { userId, fromUserId, type, title, message, data } });
    return notification;
  } catch (error) { throw error; }
};

export const getMyNotifications = async (req, res) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 5, unreadOnly = false, pendingOnly = "false", cursor = null, type = null } = req.query;
    const take = parseInt(limit);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

    const where = { userId, ...(unreadOnly === "true" && { isRead: false }), ...(pendingOnly === "true" && { isProcessed: false }), ...(type && { type }) };

    const paginationOptions = cursor ? { cursor: { id: cursor }, skip: 1, take } : { skip: (parseInt(page) - 1) * take, take };

    const [notifications, total, unreadCount, pendingCount] = await Promise.all([
      prisma.notification.findMany({ where, include: { fromUser: { select: { id: true, fullName: true, email: true, role: true } } }, orderBy: { createdAt: "desc" }, ...paginationOptions }),
      !cursor ? prisma.notification.count({ where }) : Promise.resolve(null),
      prisma.notification.count({ where: { userId, isRead: false } }),
      isAdmin ? prisma.notification.count({ where: { userId, isProcessed: false } }) : Promise.resolve(0),
    ]);

    const nextCursor = notifications.length === take ? notifications[notifications.length - 1]?.id : null;

    res.json({ message: "Notifications retrieved successfully", notifications, unreadCount, ...(isAdmin && { pendingCount }), pagination: { page: parseInt(page), limit: take, ...(total !== null && { total }), ...(total !== null && { totalPages: Math.ceil(total / take) }), nextCursor, hasMore: notifications.length === take } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getNotificationById = async (req, res) => {
  try {
    const userId = req.userId;
    const { notificationId } = req.params;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

    let where = { id: notificationId };
    if (isAdmin) {
      const admins = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "SUPERADMIN"] } }, select: { id: true } });
      const adminIds = admins.map((a) => a.id);
      where = { id: notificationId, OR: [{ userId }, { userId: { in: adminIds } }] };
    } else {
      where = { id: notificationId, userId };
    }

    const notification = await prisma.notification.findFirst({ where, include: { fromUser: { select: { id: true, fullName: true, email: true, role: true, phone: true } }, user: { select: { id: true, fullName: true, email: true, role: true } } } });
    if (!notification) return res.status(404).json({ error: "Notification not found" });

    if (!notification.isRead) {
      await prisma.notification.update({ where: { id: notificationId }, data: { isRead: true, readAt: new Date() } });
      notification.isRead = true;
      notification.readAt = new Date();
    }

    res.json({ message: "Notification retrieved successfully", notification });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const markAsRead = async (req, res) => {
  try {
    const userId = req.userId;
    const { notificationId } = req.params;
    const notification = await prisma.notification.findFirst({ where: { id: notificationId, userId } });
    if (!notification) return res.status(404).json({ error: "Notification not found" });
    await prisma.notification.update({ where: { id: notificationId }, data: { isRead: true, readAt: new Date() } });
    res.json({ message: "Notification marked as read" });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.userId;
    await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true, readAt: new Date() } });
    res.json({ message: "All notifications marked as read" });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.userId;
    const count = await prisma.notification.count({ where: { userId, isRead: false } });
    res.json({ unreadCount: count });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAllNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 50, type, cursor = null } = req.query;
    const take = parseInt(limit);
    const where = { ...(type && { type }) };
    const paginationOptions = cursor ? { cursor: { id: cursor }, skip: 1, take } : { skip: (parseInt(page) - 1) * take, take };

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({ where, include: { user: { select: { id: true, fullName: true, email: true } }, fromUser: { select: { id: true, fullName: true, email: true, role: true } } }, orderBy: { createdAt: "desc" }, ...paginationOptions }),
      !cursor ? prisma.notification.count({ where }) : Promise.resolve(null),
    ]);

    const nextCursor = notifications.length === take ? notifications[notifications.length - 1]?.id : null;
    res.json({ message: "All notifications retrieved", notifications, pagination: { page: parseInt(page), limit: take, ...(total !== null && { total }), ...(total !== null && { totalPages: Math.ceil(total / take) }), nextCursor, hasMore: notifications.length === take } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const sendNotificationToUser = async (req, res) => {
  try {
    const adminId = req.userId;
    const { userId, type, title, message, data } = req.body;
    if (!userId || !type || !title || !message) return res.status(400).json({ error: "userId, type, title, and message are required" });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const notification = await createNotification({ userId, fromUserId: adminId, type, title, message, data });
    res.status(201).json({ message: "Notification sent successfully", notification });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const sendBroadcastNotification = async (req, res) => {
  try {
    const adminId = req.userId;
    const { title, message, data } = req.body;
    if (!title || !message) return res.status(400).json({ error: "title and message are required" });

    const users = await prisma.user.findMany({ where: { role: "MEMBER" }, select: { id: true } });
    const notifications = await prisma.notification.createMany({ data: users.map((user) => ({ userId: user.id, fromUserId: adminId, type: "SYSTEM_ANNOUNCEMENT", title, message, data })) });
    res.status(201).json({ message: `Broadcast sent to ${notifications.count} users`, count: notifications.count });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAdminNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, pendingOnly = "false", cursor = null, type = null } = req.query;
    const take = parseInt(limit);

    const admins = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "SUPERADMIN"] } }, select: { id: true } });
    const adminIds = admins.map((a) => a.id);

    const where = { userId: { in: adminIds }, ...(pendingOnly === "true" && { isProcessed: false }), ...(type && { type }) };
    const paginationOptions = cursor ? { cursor: { id: cursor }, skip: 1, take } : { skip: (parseInt(page) - 1) * take, take };

    const [notifications, total, unreadCount, pendingCount] = await Promise.all([
      prisma.notification.findMany({ where, include: { fromUser: { select: { id: true, fullName: true, email: true } } }, orderBy: { createdAt: "desc" }, ...paginationOptions }),
      !cursor ? prisma.notification.count({ where }) : Promise.resolve(null),
      prisma.notification.count({ where: { ...where, isRead: false } }),
      prisma.notification.count({ where: { userId: { in: adminIds }, isProcessed: false, type: { in: ["WITHDRAWAL_REQUEST", "ACTIVATION_REQUEST", "SUPPORT_REQUEST"] } } }),
    ]);

    const nextCursor = notifications.length === take ? notifications[notifications.length - 1]?.id : null;
    res.json({ message: "Admin notifications retrieved", notifications, unreadCount, pendingCount, pagination: { page: parseInt(page), limit: take, ...(total !== null && { total }), ...(total !== null && { totalPages: Math.ceil(total / take) }), nextCursor, hasMore: notifications.length === take } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const notifyAdmins = async ({ fromUserId, type, title, message, data }) => {
  try {
    const admins = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "SUPERADMIN"] } }, select: { id: true } });
    if (admins.length === 0) return [];
    const notifications = await prisma.notification.createMany({ data: admins.map((admin) => ({ userId: admin.id, fromUserId, type, title, message, data })) });
    return notifications;
  } catch (error) { throw error; }
};

export const markWithdrawalNotificationsProcessed = async (withdrawalId, status) => {
  try {
    const notifications = await prisma.notification.findMany({ where: { type: "WITHDRAWAL_REQUEST", isProcessed: false } });
    const toUpdate = notifications.filter((n) => { if (n.data && typeof n.data === "object") return n.data.withdrawalId === withdrawalId; return false; });
    if (toUpdate.length === 0) return 0;

    const updateResult = await prisma.notification.updateMany({ where: { id: { in: toUpdate.map((n) => n.id) } }, data: { isProcessed: true, processedAt: new Date(), message: toUpdate[0].message + ` → ${status === "APPROVED" ? "✅ DISETUJUI" : "❌ DITOLAK"}` } });
    return updateResult.count;
  } catch (error) { return 0; }
};

export const deleteNotification = async (req, res) => {
  try {
    const userId = req.userId;
    const { notificationId } = req.params;
    const notification = await prisma.notification.findFirst({ where: { id: notificationId, userId } });
    if (!notification) return res.status(404).json({ error: "Notification not found" });
    await prisma.notification.delete({ where: { id: notificationId } });
    res.json({ message: "Notification deleted" });
  } catch (error) { res.status(500).json({ error: error.message }); }
};
