import prisma from "../../shared/lib/prisma.js";
import { createNotification, notifyAdmins, markWithdrawalNotificationsProcessed } from "../notification/notification.controller.js";

export const requestWithdrawal = async (req, res) => {
  try {
    const userId = req.userId;
    const { amount, bankName, accountNumber, accountHolder } = req.body;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });
    if (!amount || !bankName || !accountNumber || !accountHolder) return res.status(400).json({ error: "Missing required fields", required: ["amount", "bankName", "accountNumber", "accountHolder"], example: { amount: 500000, bankName: "BCA", accountNumber: "1234567890", accountHolder: "BUDI SANTOSO" } });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true, code: true } });
    if (!affiliate) return res.status(400).json({ error: "User is not registered as affiliate" });

    const approvedCommissions = await prisma.affiliateCommission.aggregate({ where: { userId, status: "APPROVED" }, _sum: { amount: true } });
    const availableBalance = approvedCommissions._sum.amount || 0;
    if (amount > availableBalance) return res.status(400).json({ error: "Insufficient balance", availableBalance, requestedAmount: amount, message: `Requested amount (${amount}) exceeds available balance (${availableBalance})` });

    const withdrawal = await prisma.commissionWithdrawal.create({ data: { userId, amount, bankName, accountNumber, accountHolder, status: "PENDING" } });

    try { await notifyAdmins({ fromUserId: userId, type: "WITHDRAWAL_REQUEST", title: "Permintaan Penarikan Baru", message: `${user.fullName} mengajukan penarikan sebesar Rp ${amount.toLocaleString("id-ID")} ke ${bankName}`, data: { withdrawalId: withdrawal.id, amount, bankName, accountNumber, accountHolder } }); } catch (notifError) {}

    res.status(201).json({ message: "Withdrawal request created successfully", withdrawal: { id: withdrawal.id, amount: withdrawal.amount, status: withdrawal.status, bankName: withdrawal.bankName, accountNumber: "****" + withdrawal.accountNumber.slice(-4), accountHolder: withdrawal.accountHolder, requestedAt: withdrawal.requestedAt }, affiliate: { code: affiliate.code }, availableBalance, newBalance: availableBalance - amount });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAvailableBalance = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true } });

    const approvedCommissions = affiliate
      ? await prisma.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, status: "APPROVED" }, _sum: { amount: true } })
      : await prisma.affiliateCommission.aggregate({ where: { userId, status: "APPROVED" }, _sum: { amount: true } });

    const pendingWithdrawals = await prisma.commissionWithdrawal.aggregate({ where: { userId, status: { in: ["PENDING", "APPROVED"] } }, _sum: { amount: true } });
    const completedWithdrawals = await prisma.commissionWithdrawal.aggregate({ where: { userId, status: "COMPLETED" }, _sum: { amount: true } });

    const totalApprovedCommission = approvedCommissions._sum.amount || 0;
    const totalCompletedWithdrawal = completedWithdrawals._sum.amount || 0;
    const totalPendingWithdrawal = pendingWithdrawals._sum.amount || 0;
    const availableForWithdrawal = Math.max(0, totalApprovedCommission - totalPendingWithdrawal);
    const totalEarned = totalApprovedCommission + totalCompletedWithdrawal;

    // Provide multiple key names for frontend compatibility
    res.json({
      message: "Available balance retrieved",
      user: { id: user.id, email: user.email, fullName: user.fullName },
      balance: {
        totalEarned,
        inWallet: totalApprovedCommission,
        approvedCommission: totalApprovedCommission,
        pendingWithdrawal: totalPendingWithdrawal,
        completedWithdrawal: totalCompletedWithdrawal,
        availableForWithdrawal,
        availableBalance: availableForWithdrawal
      }
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getWithdrawalHistory = async (req, res) => {
  try {
    const userId = req.userId;
    const { status = "ALL", page = 1, limit = 10 } = req.query;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const where = { userId };
    if (status !== "ALL") where.status = status;

    const total = await prisma.commissionWithdrawal.count({ where });
    const withdrawals = await prisma.commissionWithdrawal.findMany({ where, orderBy: { requestedAt: "desc" }, skip: (pageNum - 1) * limitNum, take: limitNum });

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true } });
    const [approvedCommissions, pendingWithdrawals, completedWithdrawalsAgg] = await Promise.all([
      affiliate ? prisma.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, status: "APPROVED" }, _sum: { amount: true } }) : prisma.affiliateCommission.aggregate({ where: { userId, status: "APPROVED" }, _sum: { amount: true } }),
      prisma.commissionWithdrawal.aggregate({ where: { userId, status: { in: ["PENDING", "APPROVED"] } }, _sum: { amount: true } }),
      prisma.commissionWithdrawal.aggregate({ where: { userId, status: "COMPLETED" }, _sum: { amount: true } })
    ]);

    const totalApprovedCommission = approvedCommissions._sum.amount || 0;
    const totalPendingWithdrawal = pendingWithdrawals._sum.amount || 0;
    const totalCompletedWithdrawal = completedWithdrawalsAgg._sum.amount || 0;
    const totalEarned = totalApprovedCommission + totalCompletedWithdrawal;
    const availableBalance = totalApprovedCommission - totalPendingWithdrawal;

    const summary = { total, pending: 0, approved: 0, rejected: 0, completed: 0, totalAmount: 0, completedAmount: 0 };
    withdrawals.forEach((w) => { if (w.status === "PENDING") summary.pending += 1; if (w.status === "APPROVED") summary.approved += 1; if (w.status === "REJECTED") summary.rejected += 1; if (w.status === "COMPLETED") { summary.completed += 1; summary.completedAmount += w.amount; } summary.totalAmount += w.amount; });

    res.json({ message: "Withdrawal history retrieved", balance: { totalEarned, inWallet: totalApprovedCommission, pendingWithdrawal: totalPendingWithdrawal, availableBalance }, summary, withdrawals: withdrawals.map((w) => ({ id: w.id, amount: w.amount, status: w.status, bankName: w.bankName || "", accountNumber: w.accountNumber ? "****" + w.accountNumber.slice(-4) : "", accountHolder: w.accountHolder || "", notes: w.notes || "", requestedAt: w.requestedAt, approvedAt: w.approvedAt, completedAt: w.completedAt })), pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getMemberWithdrawalRequests = async (req, res) => {
  try {
    const userId = req.userId;
    const { status = "PENDING,APPROVED", page = 1, limit = 20 } = req.query;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    const statusArray = status === "ALL" ? ["PENDING", "APPROVED", "COMPLETED", "REJECTED"] : status.split(",").map((s) => s.trim().toUpperCase());
    const where = { userId, status: { in: statusArray } };

    const total = await prisma.commissionWithdrawal.count({ where });
    const withdrawals = await prisma.commissionWithdrawal.findMany({ where, orderBy: { requestedAt: "desc" }, skip: (pageNum - 1) * limitNum, take: limitNum });

    const totalAmount = withdrawals.reduce((sum, w) => sum + w.amount, 0);

    const summary = {
      totalRequests: total,
      totalAmount,
      byStatus: {
        pending: withdrawals.filter((w) => w.status === "PENDING").length,
        approved: withdrawals.filter((w) => w.status === "APPROVED").length,
        completed: withdrawals.filter((w) => w.status === "COMPLETED").length,
        rejected: withdrawals.filter((w) => w.status === "REJECTED").length,
      },
    };

    res.json({ message: "Member withdrawal requests retrieved", summary, withdrawals: withdrawals.map((w) => ({ id: w.id, amount: w.amount, status: w.status, bankName: w.bankName || "", accountNumber: w.accountNumber ? "****" + w.accountNumber.slice(-4) : "", accountHolder: w.accountHolder || "", notes: w.notes || "", requestedAt: w.requestedAt, approvedAt: w.approvedAt, completedAt: w.completedAt })), pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getWithdrawalDetails = async (req, res) => {
  try {
    const userId = req.userId;
    const { withdrawalId } = req.params;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });
    if (!withdrawalId) return res.status(400).json({ error: "Withdrawal ID is required" });

    const withdrawal = await prisma.commissionWithdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) return res.status(404).json({ error: "Withdrawal request not found" });

    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = currentUser?.role === "ADMIN" || currentUser?.role === "SUPERADMIN";
    if (withdrawal.userId !== userId && !isAdmin) return res.status(403).json({ error: "Unauthorized - withdrawal belongs to another user" });

    const withdrawalOwner = await prisma.user.findUnique({ where: { id: withdrawal.userId }, select: { id: true, fullName: true, email: true } });

    res.json({ message: "Withdrawal details retrieved", withdrawal: { id: withdrawal.id, amount: withdrawal.amount, status: withdrawal.status, bankName: withdrawal.bankName, accountNumber: isAdmin ? withdrawal.accountNumber : "****" + withdrawal.accountNumber.slice(-4), accountHolder: withdrawal.accountHolder, notes: withdrawal.notes, requestedAt: withdrawal.requestedAt, approvedAt: withdrawal.approvedAt, completedAt: withdrawal.completedAt, createdAt: withdrawal.createdAt, updatedAt: withdrawal.updatedAt }, ...(isAdmin && withdrawalOwner && { user: { id: withdrawalOwner.id, fullName: withdrawalOwner.fullName, email: withdrawalOwner.email } }) });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const approveWithdrawal = async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { notes } = req.body;
    if (!withdrawalId) return res.status(400).json({ error: "Withdrawal ID is required" });

    const withdrawal = await prisma.commissionWithdrawal.findUnique({ where: { id: withdrawalId }, include: { user: { select: { fullName: true, email: true } } } });
    if (!withdrawal) return res.status(404).json({ error: "Withdrawal request not found" });
    if (withdrawal.status !== "PENDING") return res.status(400).json({ error: `Cannot approve withdrawal with status: ${withdrawal.status}`, currentStatus: withdrawal.status, message: "Only PENDING withdrawals can be approved" });

    const updated = await prisma.commissionWithdrawal.update({ where: { id: withdrawalId }, data: { status: "APPROVED", approvedAt: new Date(), notes } });

    try { await markWithdrawalNotificationsProcessed(withdrawalId, "APPROVED"); } catch (notifError) {}
    try { await createNotification({ userId: withdrawal.userId, fromUserId: req.userId, type: "WITHDRAWAL_APPROVED", title: "Penarikan Disetujui", message: `Penarikan sebesar Rp ${updated.amount.toLocaleString("id-ID")} telah disetujui dan akan segera diproses.`, data: { withdrawalId: updated.id, amount: updated.amount, bankName: updated.bankName, accountNumber: updated.accountNumber } }); } catch (notifError) {}

    res.json({ message: "Withdrawal request approved", withdrawal: { id: updated.id, amount: updated.amount, status: updated.status, bankName: updated.bankName, accountHolder: updated.accountHolder, approvedAt: updated.approvedAt, notes: updated.notes }, user: { name: withdrawal.user.fullName, email: withdrawal.user.email } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const rejectWithdrawal = async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { notes } = req.body;
    if (!withdrawalId) return res.status(400).json({ error: "Withdrawal ID is required" });
    if (!notes) return res.status(400).json({ error: "Rejection reason (notes) is required" });

    const withdrawal = await prisma.commissionWithdrawal.findUnique({ where: { id: withdrawalId }, include: { user: { select: { fullName: true, email: true } } } });
    if (!withdrawal) return res.status(404).json({ error: "Withdrawal request not found" });
    if (withdrawal.status !== "PENDING") return res.status(400).json({ error: `Cannot reject withdrawal with status: ${withdrawal.status}`, currentStatus: withdrawal.status, message: "Only PENDING withdrawals can be rejected" });

    const updated = await prisma.commissionWithdrawal.update({ where: { id: withdrawalId }, data: { status: "REJECTED", notes } });

    try { await markWithdrawalNotificationsProcessed(withdrawalId, "REJECTED"); } catch (notifError) {}
    try { await createNotification({ userId: withdrawal.userId, fromUserId: req.userId, type: "WITHDRAWAL_REJECTED", title: "Penarikan Ditolak", message: `Penarikan sebesar Rp ${updated.amount.toLocaleString("id-ID")} ditolak. Alasan: ${notes}`, data: { withdrawalId: updated.id, amount: updated.amount, reason: notes } }); } catch (notifError) {}

    res.json({ message: "Withdrawal request rejected", withdrawal: { id: updated.id, amount: updated.amount, status: updated.status, notes: updated.notes }, user: { name: withdrawal.user.fullName, email: withdrawal.user.email } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const completeWithdrawal = async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { notes } = req.body;
    if (!withdrawalId) return res.status(400).json({ error: "Withdrawal ID is required" });

    const withdrawal = await prisma.commissionWithdrawal.findUnique({ where: { id: withdrawalId }, include: { user: { select: { fullName: true, email: true } } } });
    if (!withdrawal) return res.status(404).json({ error: "Withdrawal request not found" });
    if (!["PENDING", "APPROVED"].includes(withdrawal.status)) return res.status(400).json({ error: `Cannot mark withdrawal as completed with status: ${withdrawal.status}`, currentStatus: withdrawal.status, message: "Only PENDING or APPROVED withdrawals can be marked as completed" });

    const approvedCommissions = await prisma.affiliateCommission.findMany({ where: { userId: withdrawal.userId, status: "APPROVED" }, orderBy: { createdAt: "asc" }, take: 1000 });

    let remainingAmount = withdrawal.amount;
    const commissionsToUpdate = [];
    for (const commission of approvedCommissions) { if (remainingAmount <= 0) break; const deductAmount = Math.min(commission.amount, remainingAmount); remainingAmount -= deductAmount; commissionsToUpdate.push({ id: commission.id, deductAmount, newAmount: commission.amount - deductAmount }); }
    if (remainingAmount > 0) return res.status(400).json({ error: "Insufficient commission balance to complete withdrawal", withdrawalAmount: withdrawal.amount, availableBalance: approvedCommissions.reduce((sum, c) => sum + c.amount, 0), shortfall: remainingAmount });

    try {
      const updatePromises = commissionsToUpdate.map((item) => { if (item.newAmount <= 0) return prisma.affiliateCommission.update({ where: { id: item.id }, data: { amount: 0, status: "WITHDRAWN" } }); return prisma.affiliateCommission.update({ where: { id: item.id }, data: { amount: item.newAmount } }); });
      await Promise.all(updatePromises);
    } catch (updateError) { throw updateError; }

    const [updated, remainingBalance] = await Promise.all([
      prisma.commissionWithdrawal.update({ where: { id: withdrawalId }, data: { status: "COMPLETED", completedAt: new Date(), notes: notes || withdrawal.notes } }),
      prisma.affiliateCommission.aggregate({ where: { userId: withdrawal.userId, status: "PAID" }, _sum: { amount: true } })
    ]);

    const newBalance = remainingBalance._sum.amount || 0;

    res.json({ message: "Withdrawal marked as completed and commission balance deducted", withdrawal: { id: updated.id, amount: updated.amount, status: updated.status, bankName: updated.bankName, accountHolder: updated.accountHolder, completedAt: updated.completedAt, notes: updated.notes }, user: { name: withdrawal.user.fullName, email: withdrawal.user.email }, balanceUpdate: { deductedAmount: withdrawal.amount, commissionsAffected: commissionsToUpdate.length, newAvailableBalance: newBalance } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getPendingWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    const total = await prisma.commissionWithdrawal.count({ where: { status: "PENDING" } });
    const withdrawals = await prisma.commissionWithdrawal.findMany({ where: { status: "PENDING" }, include: { user: { select: { id: true, email: true, fullName: true } } }, orderBy: { requestedAt: "asc" }, skip: (pageNum - 1) * limitNum, take: limitNum });
    const totalAmount = withdrawals.reduce((sum, w) => sum + w.amount, 0);

    res.json({ message: "Pending withdrawal requests retrieved", summary: { totalRequests: total, totalAmount, averageAmount: total > 0 ? Math.round(totalAmount / total) : 0 }, withdrawals: withdrawals.map((w) => ({ id: w.id, user: { id: w.user.id, name: w.user.fullName, email: w.user.email }, amount: w.amount, bankName: w.bankName, accountNumber: "****" + w.accountNumber.slice(-4), accountHolder: w.accountHolder, status: w.status, requestedAt: w.requestedAt, actions: ["approve", "reject", "complete"] })), pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAdminWithdrawals = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const where = {};

    if (status) { const statusArray = status.split(",").map((s) => s.trim().toUpperCase()); where.status = { in: statusArray }; }
    if (search) where.user = { OR: [{ fullName: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] };

    const total = await prisma.commissionWithdrawal.count({ where });
    const withdrawals = await prisma.commissionWithdrawal.findMany({ where, include: { user: { select: { id: true, email: true, fullName: true } } }, orderBy: { requestedAt: "desc" }, skip: (pageNum - 1) * limitNum, take: limitNum });
    const allWithdrawals = await prisma.commissionWithdrawal.findMany({ where: status ? { status: { in: status.split(",").map((s) => s.trim().toUpperCase()) } } : {}, select: { status: true, amount: true } });

    const summary = {
      totalRequests: total,
      totalAmount: allWithdrawals.reduce((sum, w) => sum + w.amount, 0),
      byStatus: {
        pending: allWithdrawals.filter((w) => w.status === "PENDING").length,
        pendingAmount: allWithdrawals.filter((w) => w.status === "PENDING").reduce((sum, w) => sum + w.amount, 0),
        approved: allWithdrawals.filter((w) => w.status === "APPROVED").length,
        approvedAmount: allWithdrawals.filter((w) => w.status === "APPROVED").reduce((sum, w) => sum + w.amount, 0),
        completed: allWithdrawals.filter((w) => w.status === "COMPLETED").length,
        completedAmount: allWithdrawals.filter((w) => w.status === "COMPLETED").reduce((sum, w) => sum + w.amount, 0),
        rejected: allWithdrawals.filter((w) => w.status === "REJECTED").length,
        rejectedAmount: allWithdrawals.filter((w) => w.status === "REJECTED").reduce((sum, w) => sum + w.amount, 0)
      }
    };

    const getActions = (withdrawalStatus) => { switch (withdrawalStatus) { case "PENDING": return ["approve", "reject", "complete"]; case "APPROVED": return ["complete", "reject"]; case "COMPLETED": return []; case "REJECTED": return []; default: return []; } };

    res.json({ message: "Admin withdrawals retrieved", summary, withdrawals: withdrawals.map((w) => ({ id: w.id, user: { id: w.user.id, name: w.user.fullName, email: w.user.email }, amount: w.amount, bankName: w.bankName, accountNumber: "****" + w.accountNumber.slice(-4), accountHolder: w.accountHolder, status: w.status, requestedAt: w.requestedAt, approvedAt: w.approvedAt, completedAt: w.completedAt, notes: w.notes, actions: getActions(w.status) })), pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};
