import prisma from "../../shared/lib/prisma.js";
import { approveCommission, rejectCommission } from "./commission.service.js";

export const getPendingCommissionsGrouped = async (req, res) => {
  try {
    const { search } = req.query;
    const commissions = await prisma.affiliateCommission.findMany({ where: { status: "PENDING" }, include: { affiliate: { select: { id: true, code: true, totalEarnings: true, totalPaid: true, user: { select: { id: true, email: true, fullName: true } } } }, receiver: { select: { id: true, email: true, fullName: true } } }, orderBy: { createdAt: "desc" } });

    const groupedMap = new Map();
    for (const c of commissions) {
      const affiliateId = c.affiliate?.id || "unknown";
      const affiliateName = c.affiliate?.user?.fullName || "Unknown";
      if (search && !affiliateName.toLowerCase().includes(search.toLowerCase())) continue;

      if (!groupedMap.has(affiliateId)) groupedMap.set(affiliateId, { affiliateId, affiliateCode: c.affiliate?.code, affiliateName, affiliateEmail: c.affiliate?.user?.email, totalPending: 0, totalAmount: 0, commissions: [] });

      const group = groupedMap.get(affiliateId);
      group.totalPending += 1;
      group.totalAmount += c.amount;
      group.commissions.push({ id: c.id, transactionId: c.transactionId, amount: c.amount, level: c.level, buyerName: c.buyerName, productName: c.productName, sourceType: c.sourceType, createdAt: c.createdAt });
    }

    const grouped = Array.from(groupedMap.values()).sort((a, b) => a.affiliateName.localeCompare(b.affiliateName));
    res.json({ summary: { totalAffiliates: grouped.length, totalPendingCount: commissions.length, totalPendingAmount: commissions.reduce((sum, c) => sum + c.amount, 0) }, affiliates: grouped });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const approveAffiliateCommissions = async (req, res) => {
  try {
    const { affiliateId, customAmount, reason } = req.body;
    if (!affiliateId) return res.status(400).json({ error: "affiliateId is required" });

    const pendingCommissions = await prisma.affiliateCommission.findMany({ where: { affiliateId, status: "PENDING" }, include: { affiliate: { select: { code: true, user: { select: { fullName: true } } } } } });
    if (pendingCommissions.length === 0) return res.status(404).json({ error: "No pending commissions found" });

    const originalTotal = pendingCommissions.reduce((sum, c) => sum + c.amount, 0);
    const finalAmount = customAmount && customAmount > 0 ? customAmount : originalTotal;
    const approvedAt = new Date();

    await prisma.affiliateCommission.updateMany({ where: { affiliateId, status: "PENDING" }, data: { status: "APPROVED", approvedAt } });
    await prisma.affiliateProfile.update({ where: { id: affiliateId }, data: { totalEarnings: { increment: finalAmount }, totalPaid: { increment: finalAmount } } });

    res.json({ message: "All affiliate commissions approved", affiliate: { id: affiliateId, code: pendingCommissions[0]?.affiliate?.code, name: pendingCommissions[0]?.affiliate?.user?.fullName }, summary: { commissionsApproved: pendingCommissions.length, originalTotal, finalAmount, adjusted: !!customAmount, reason: reason || null }, approvedAt });
  } catch (error) { res.status(400).json({ error: error.message }); }
};

export const getPendingCommissions = async (req, res) => {
  try {
    const { page = 1, limit = 20, affiliateId, search } = req.query;
    const where = { status: "PENDING" };
    if (affiliateId) where.affiliateId = affiliateId;
    if (search) where.OR = [{ transactionId: { contains: search, mode: "insensitive" } }, { buyerName: { contains: search, mode: "insensitive" } }];

    const [commissions, total, totalPendingAmount] = await Promise.all([
      prisma.affiliateCommission.findMany({ where, include: { affiliate: { select: { id: true, code: true, user: { select: { id: true, email: true, fullName: true } } } }, receiver: { select: { id: true, email: true, fullName: true } } }, orderBy: { createdAt: "desc" }, skip: (parseInt(page) - 1) * parseInt(limit), take: parseInt(limit) }),
      prisma.affiliateCommission.count({ where }),
      prisma.affiliateCommission.aggregate({ where: { status: "PENDING" }, _sum: { amount: true } }),
    ]);

    res.json({ page: parseInt(page), limit: parseInt(limit), total, totalPendingAmount: totalPendingAmount._sum.amount || 0, commissions: commissions.map((c) => ({ id: c.id, transactionId: c.transactionId, affiliateCode: c.affiliate?.code, affiliateName: c.affiliate?.user?.fullName, receiverName: c.receiver?.fullName, receiverEmail: c.receiver?.email, amount: c.amount, level: c.level, status: c.status, buyerName: c.buyerName, productName: c.productName, sourceType: c.sourceType, createdAt: c.createdAt })) });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const approveCommissionByAdmin = async (req, res) => {
  try {
    const { commissionId } = req.params;
    if (!commissionId) return res.status(400).json({ error: "Commission ID required" });

    const commission = await prisma.affiliateCommission.findUnique({ where: { id: commissionId }, include: { affiliate: { select: { code: true, user: { select: { fullName: true } } } }, receiver: { select: { fullName: true, email: true } } } });
    if (!commission) return res.status(404).json({ error: "Commission not found" });
    if (commission.status !== "PENDING") return res.status(400).json({ error: `Commission sudah ${commission.status}` });

    const updatedCommission = await approveCommission(commissionId);
    res.json({ message: "Commission approved", commission: { id: updatedCommission.id, transactionId: updatedCommission.transactionId, affiliateCode: commission.affiliate?.code, receiverName: commission.receiver?.fullName, amount: updatedCommission.amount, level: updatedCommission.level, status: updatedCommission.status, approvedAt: updatedCommission.approvedAt } });
  } catch (error) { res.status(400).json({ error: error.message }); }
};

export const approveWithAdjustedAmount = async (req, res) => {
  try {
    const { commissionId } = req.params;
    const { adjustedAmount, reason } = req.body;
    if (!commissionId) return res.status(400).json({ error: "Commission ID required" });
    if (!adjustedAmount || adjustedAmount <= 0) return res.status(400).json({ error: "Adjusted amount required and must be positive" });

    const commission = await prisma.affiliateCommission.findUnique({ where: { id: commissionId }, include: { affiliate: { select: { id: true, code: true, user: { select: { fullName: true } } } }, receiver: { select: { fullName: true, email: true } } } });
    if (!commission) return res.status(404).json({ error: "Commission not found" });
    if (commission.status !== "PENDING") return res.status(400).json({ error: `Commission sudah ${commission.status}` });

    const originalAmount = commission.amount;
    const updatedCommission = await prisma.affiliateCommission.update({ where: { id: commissionId }, data: { amount: adjustedAmount, status: "APPROVED", approvedAt: new Date() } });
    await prisma.affiliateProfile.update({ where: { id: commission.affiliateId }, data: { totalEarnings: { increment: adjustedAmount }, totalPaid: { increment: adjustedAmount } } });

    res.json({ message: "Commission approved with adjusted amount", commission: { id: updatedCommission.id, affiliateCode: commission.affiliate?.code, receiverName: commission.receiver?.fullName, originalAmount, adjustedAmount, difference: adjustedAmount - originalAmount, reason: reason || null, status: updatedCommission.status, approvedAt: updatedCommission.approvedAt } });
  } catch (error) { res.status(400).json({ error: error.message }); }
};

export const batchApproveCommissions = async (req, res) => {
  try {
    const { commissionIds } = req.body;
    if (!Array.isArray(commissionIds) || commissionIds.length === 0) return res.status(400).json({ error: "commissionIds must be a non-empty array" });

    const results = [];
    const errors = [];
    let totalApprovedAmount = 0;

    for (const id of commissionIds) {
      try { const approved = await approveCommission(id); totalApprovedAmount += approved.amount; results.push({ id, status: "approved", amount: approved.amount, approvedAt: approved.approvedAt }); }
      catch (err) { errors.push({ id, error: err.message }); }
    }

    res.json({ summary: { requested: commissionIds.length, approved: results.length, failed: errors.length, totalApprovedAmount }, results, errors: errors.length > 0 ? errors : undefined });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const rejectCommissionByAdmin = async (req, res) => {
  try {
    const { commissionId } = req.params;
    const { reason } = req.body;
    if (!commissionId) return res.status(400).json({ error: "Commission ID required" });
    if (!reason) return res.status(400).json({ error: "Reason required for rejection" });

    const commission = await prisma.affiliateCommission.findUnique({ where: { id: commissionId }, include: { affiliate: { select: { code: true, user: { select: { fullName: true } } } }, receiver: { select: { fullName: true } } } });
    if (!commission) return res.status(404).json({ error: "Commission not found" });
    if (commission.status !== "PENDING") return res.status(400).json({ error: `Commission sudah ${commission.status}` });

    const updatedCommission = await rejectCommission(commissionId, reason);
    res.json({ message: "Commission rejected", commission: { id: updatedCommission.id, affiliateCode: commission.affiliate?.code, receiverName: commission.receiver?.fullName, amount: updatedCommission.amount, status: updatedCommission.status, rejectedReason: reason, rejectedAt: updatedCommission.rejectedAt } });
  } catch (error) { res.status(400).json({ error: error.message }); }
};

export const getCommissionStats = async (req, res) => {
  try {
    const [stats, recentPending] = await Promise.all([
      prisma.affiliateCommission.groupBy({ by: ["status"], _sum: { amount: true }, _count: true }),
      prisma.affiliateCommission.findMany({ where: { status: "PENDING" }, include: { affiliate: { select: { code: true, user: { select: { fullName: true } } } }, receiver: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 5 }),
    ]);

    const statsByStatus = {};
    let totalAmount = 0;
    let totalCount = 0;
    for (const stat of stats) { statsByStatus[stat.status] = { count: stat._count, amount: stat._sum.amount || 0 }; totalAmount += stat._sum.amount || 0; totalCount += stat._count; }

    res.json({
      overview: { totalCommissions: totalCount, totalAmount },
      byStatus: { pending: statsByStatus.PENDING || { count: 0, amount: 0 }, approved: statsByStatus.APPROVED || { count: 0, amount: 0 }, paid: statsByStatus.PAID || { count: 0, amount: 0 }, rejected: statsByStatus.REJECTED || { count: 0, amount: 0 }, withdrawn: statsByStatus.WITHDRAWN || { count: 0, amount: 0 } },
      recentPending: recentPending.map((c) => ({ id: c.id, affiliateCode: c.affiliate?.code, receiverName: c.receiver?.fullName, amount: c.amount, level: c.level, createdAt: c.createdAt })),
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const payoutCommission = async (req, res) => {
  return res.status(410).json({ error: "DEPRECATED_ENDPOINT", message: "This endpoint is no longer used", newFlow: "PENDING → APPROVED → WITHDRAWN" });
};
