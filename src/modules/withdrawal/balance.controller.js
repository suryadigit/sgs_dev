import prisma from "../../shared/lib/prisma.js";

export const requestWithdrawal = async (req, res) => {
  try {
    const userId = req.userId;
    const { amount, bankName, accountNumber, accountHolder } = req.body;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });
    if (!amount || !bankName || !accountNumber || !accountHolder) return res.status(400).json({ error: "Missing required fields", required: ["amount", "bankName", "accountNumber", "accountHolder"] });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true, code: true } });
    if (!affiliate) return res.status(400).json({ error: "User is not registered as affiliate" });

    const approvedCommissions = await prisma.affiliateCommission.aggregate({ where: { userId, status: "APPROVED" }, _sum: { amount: true } });
    const availableBalance = approvedCommissions._sum.amount || 0;
    if (amount > availableBalance) return res.status(400).json({ error: "Insufficient balance", availableBalance, requestedAmount: amount });

    const withdrawal = await prisma.commissionWithdrawal.create({ data: { userId, amount, bankName, accountNumber, accountHolder, status: "PENDING" } });

    res.status(201).json({ message: "Withdrawal request created successfully", withdrawal: { id: withdrawal.id, amount: withdrawal.amount, status: withdrawal.status, bankName: withdrawal.bankName, accountNumber: "****" + withdrawal.accountNumber.slice(-4), accountHolder: withdrawal.accountHolder, requestedAt: withdrawal.requestedAt }, affiliate: { code: affiliate.code }, availableBalance, newBalance: availableBalance - amount });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAvailableBalance = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const [commissionStats, withdrawalStats] = await Promise.all([
      prisma.affiliateCommission.groupBy({ by: ['status'], where: { userId }, _sum: { amount: true } }),
      prisma.commissionWithdrawal.groupBy({ by: ['status'], where: { userId }, _sum: { amount: true } }),
    ]);

    const totalApprovedCommission = commissionStats.find(s => s.status === 'APPROVED')?._sum?.amount || 0;
    const totalCompletedWithdrawal = withdrawalStats.find(s => s.status === 'COMPLETED')?._sum?.amount || 0;
    const totalPendingWithdrawal = withdrawalStats.filter(s => s.status === 'PENDING' || s.status === 'APPROVED').reduce((sum, s) => sum + (s._sum?.amount || 0), 0);
    const availableForWithdrawal = Math.max(0, totalApprovedCommission - totalPendingWithdrawal);
    const totalEarned = totalApprovedCommission + totalCompletedWithdrawal;

    res.json({ message: "Available balance retrieved", user: { id: user.id, email: user.email, fullName: user.fullName }, balance: { totalEarned, approvedCommission: totalApprovedCommission, pendingWithdrawal: totalPendingWithdrawal, completedWithdrawal: totalCompletedWithdrawal, availableForWithdrawal } });
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

    const [total, withdrawals, approvedCommissions, pendingWithdrawals, completedWithdrawalsAgg] = await Promise.all([
      prisma.commissionWithdrawal.count({ where }),
      prisma.commissionWithdrawal.findMany({ where, orderBy: { requestedAt: "desc" }, skip: (pageNum - 1) * limitNum, take: limitNum }),
      prisma.affiliateCommission.aggregate({ where: { userId, status: "APPROVED" }, _sum: { amount: true } }),
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

    res.json({ message: "Withdrawal history retrieved", balance: { totalEarned, inWallet: totalApprovedCommission, pendingWithdrawal: totalPendingWithdrawal, availableBalance }, summary, withdrawals: withdrawals.map((w) => ({ id: w.id, amount: w.amount, status: w.status, bankName: w.bankName, accountNumber: "****" + w.accountNumber.slice(-4), accountHolder: w.accountHolder, notes: w.notes, requestedAt: w.requestedAt, approvedAt: w.approvedAt, completedAt: w.completedAt })), pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getWithdrawalDetails = async (req, res) => {
  try {
    const userId = req.userId;
    const { withdrawalId } = req.params;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });
    if (!withdrawalId) return res.status(400).json({ error: "Withdrawal ID is required" });

    const withdrawal = await prisma.commissionWithdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) return res.status(404).json({ error: "Withdrawal request not found" });
    if (withdrawal.userId !== userId) return res.status(403).json({ error: "Unauthorized - withdrawal belongs to another user" });

    res.json({ message: "Withdrawal details retrieved", withdrawal: { id: withdrawal.id, amount: withdrawal.amount, status: withdrawal.status, bankName: withdrawal.bankName, accountNumber: "****" + withdrawal.accountNumber.slice(-4), accountHolder: withdrawal.accountHolder, notes: withdrawal.notes, requestedAt: withdrawal.requestedAt, approvedAt: withdrawal.approvedAt, completedAt: withdrawal.completedAt } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const approveWithdrawal = async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { notes } = req.body;
    if (!withdrawalId) return res.status(400).json({ error: "Withdrawal ID is required" });

    const withdrawal = await prisma.commissionWithdrawal.findUnique({ where: { id: withdrawalId }, include: { user: { select: { fullName: true, email: true } } } });
    if (!withdrawal) return res.status(404).json({ error: "Withdrawal request not found" });
    if (withdrawal.status !== "PENDING") return res.status(400).json({ error: `Cannot approve withdrawal with status: ${withdrawal.status}`, message: "Only PENDING withdrawals can be approved" });

    const updated = await prisma.commissionWithdrawal.update({ where: { id: withdrawalId }, data: { status: "APPROVED", approvedAt: new Date(), notes } });

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
    if (withdrawal.status !== "PENDING") return res.status(400).json({ error: `Cannot reject withdrawal with status: ${withdrawal.status}`, message: "Only PENDING withdrawals can be rejected" });

    const updated = await prisma.commissionWithdrawal.update({ where: { id: withdrawalId }, data: { status: "REJECTED", notes } });
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
    if (!["PENDING", "APPROVED"].includes(withdrawal.status)) return res.status(400).json({ error: `Cannot complete withdrawal with status: ${withdrawal.status}`, message: "Only PENDING or APPROVED withdrawals can be completed" });

    const approvedCommissions = await prisma.affiliateCommission.findMany({ where: { userId: withdrawal.userId, status: "APPROVED" }, orderBy: { createdAt: "asc" }, take: 1000 });

    let remainingAmount = withdrawal.amount;
    const commissionsToUpdate = [];
    for (const commission of approvedCommissions) { if (remainingAmount <= 0) break; const deductAmount = Math.min(commission.amount, remainingAmount); remainingAmount -= deductAmount; commissionsToUpdate.push({ id: commission.id, deductAmount, newAmount: commission.amount - deductAmount }); }
    if (remainingAmount > 0) return res.status(400).json({ error: "Insufficient commission balance", withdrawalAmount: withdrawal.amount, availableBalance: approvedCommissions.reduce((sum, c) => sum + c.amount, 0), shortfall: remainingAmount });

    const updatePromises = commissionsToUpdate.map((item) => { if (item.newAmount <= 0) return prisma.affiliateCommission.update({ where: { id: item.id }, data: { amount: 0, status: "WITHDRAWN" } }); return prisma.affiliateCommission.update({ where: { id: item.id }, data: { amount: item.newAmount } }); });
    await Promise.all(updatePromises);

    const [updated, remainingBalance] = await Promise.all([
      prisma.commissionWithdrawal.update({ where: { id: withdrawalId }, data: { status: "COMPLETED", completedAt: new Date(), notes: notes || withdrawal.notes } }),
      prisma.affiliateCommission.aggregate({ where: { userId: withdrawal.userId, status: "APPROVED" }, _sum: { amount: true } })
    ]);

    try { const { invalidateAffiliateCache, invalidateUserCache } = await import('../../shared/utils/dashboardCache.js'); invalidateAffiliateCache(withdrawal.affiliateId); invalidateUserCache(withdrawal.userId); } catch (e) {}

    res.json({ message: "Withdrawal completed", withdrawal: { id: updated.id, amount: updated.amount, status: updated.status, bankName: updated.bankName, accountHolder: updated.accountHolder, completedAt: updated.completedAt, notes: updated.notes }, user: { name: withdrawal.user.fullName, email: withdrawal.user.email }, balanceUpdate: { deductedAmount: withdrawal.amount, commissionsAffected: commissionsToUpdate.length, newAvailableBalance: remainingBalance._sum.amount || 0 } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getPendingWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    const [total, withdrawals] = await Promise.all([
      prisma.commissionWithdrawal.count({ where: { status: "PENDING" } }),
      prisma.commissionWithdrawal.findMany({ where: { status: "PENDING" }, include: { user: { select: { id: true, email: true, fullName: true } } }, orderBy: { requestedAt: "asc" }, skip: (pageNum - 1) * limitNum, take: limitNum })
    ]);

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

    if (status) { const statusArray = status.split(",").map(s => s.trim().toUpperCase()); where.status = { in: statusArray }; }
    if (search) where.user = { OR: [{ fullName: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] };

    const [total, withdrawals, allWithdrawals] = await Promise.all([
      prisma.commissionWithdrawal.count({ where }),
      prisma.commissionWithdrawal.findMany({ where, include: { user: { select: { id: true, email: true, fullName: true } } }, orderBy: { requestedAt: "desc" }, skip: (pageNum - 1) * limitNum, take: limitNum }),
      prisma.commissionWithdrawal.findMany({ where: status ? { status: { in: status.split(",").map(s => s.trim().toUpperCase()) } } : {}, select: { status: true, amount: true } })
    ]);

    const summary = {
      totalRequests: total,
      totalAmount: allWithdrawals.reduce((sum, w) => sum + w.amount, 0),
      byStatus: { pending: allWithdrawals.filter(w => w.status === "PENDING").length, pendingAmount: allWithdrawals.filter(w => w.status === "PENDING").reduce((sum, w) => sum + w.amount, 0), approved: allWithdrawals.filter(w => w.status === "APPROVED").length, approvedAmount: allWithdrawals.filter(w => w.status === "APPROVED").reduce((sum, w) => sum + w.amount, 0), completed: allWithdrawals.filter(w => w.status === "COMPLETED").length, completedAmount: allWithdrawals.filter(w => w.status === "COMPLETED").reduce((sum, w) => sum + w.amount, 0), rejected: allWithdrawals.filter(w => w.status === "REJECTED").length, rejectedAmount: allWithdrawals.filter(w => w.status === "REJECTED").reduce((sum, w) => sum + w.amount, 0) }
    };

    const getActions = (s) => { if (s === "PENDING") return ["approve", "reject", "complete"]; if (s === "APPROVED") return ["complete", "reject"]; return []; };
    res.json({ message: "Admin withdrawals retrieved", summary, withdrawals: withdrawals.map((w) => ({ id: w.id, user: { id: w.user.id, name: w.user.fullName, email: w.user.email }, amount: w.amount, bankName: w.bankName, accountNumber: "****" + w.accountNumber.slice(-4), accountHolder: w.accountHolder, status: w.status, requestedAt: w.requestedAt, approvedAt: w.approvedAt, completedAt: w.completedAt, notes: w.notes, actions: getActions(w.status) })), pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};
