import prisma from "../../shared/lib/prisma.js";

export const getCommissionTransactions = async (req, res) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 20, status = "ALL" } = req.query;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const where = { userId };
    if (status !== "ALL") where.status = status.toUpperCase();

    const total = await prisma.affiliateCommission.count({ where });
    const commissions = await prisma.affiliateCommission.findMany({ where, select: { id: true, affiliateId: true, transactionId: true, userId: true, amount: true, level: true, status: true, createdAt: true, affiliate: { select: { code: true, user: { select: { fullName: true, email: true } } } } }, orderBy: { createdAt: 'desc' }, skip: (pageNum - 1) * limitNum, take: limitNum });

    const formattedCommissions = commissions.map(c => ({ ...c, from: c.affiliate?.user?.fullName || 'Unknown' }));
    const summary = { total, pending: await prisma.affiliateCommission.count({ where: { ...where, status: 'PENDING' } }), approved: await prisma.affiliateCommission.count({ where: { ...where, status: 'APPROVED' } }), paid: await prisma.affiliateCommission.count({ where: { ...where, status: 'PAID' } }), withdrawn: await prisma.affiliateCommission.count({ where: { ...where, status: 'WITHDRAWN' } }) };

    res.json({ message: "Commission transactions retrieved", summary, transactions: formattedCommissions, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getCommissionTransactionsByLevel = async (req, res) => {
  try {
    const userId = req.userId;
    const { level } = req.params;
    const { page = 1, limit = 20, status = "ALL" } = req.query;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const levelNum = parseInt(level, 10);
    if (isNaN(levelNum) || levelNum < 1 || levelNum > 10) return res.status(400).json({ error: "Invalid level", message: "Level must be between 1 and 10", received: level });

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const where = { userId, level: levelNum };
    if (status !== "ALL") where.status = status.toUpperCase();

    const total = await prisma.affiliateCommission.count({ where });
    const commissions = await prisma.affiliateCommission.findMany({ where, select: { id: true, amount: true, level: true, status: true, createdAt: true, affiliate: { select: { code: true, user: { select: { fullName: true, email: true } } } } }, orderBy: { createdAt: 'desc' }, skip: (pageNum - 1) * limitNum, take: limitNum });

    const transactions = commissions.map(c => ({ id: c.id, transactionId: c.id, from: c.affiliate?.user?.fullName || 'Unknown', fromEmail: c.affiliate?.user?.email, fromCode: c.affiliate?.code, level: c.level, amount: c.amount, status: c.status, date: c.createdAt }));

    res.json({ message: `Commission transactions for level ${levelNum} retrieved`, level: levelNum, transactions, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getCommissionTransactionsByStatus = async (req, res) => {
  try {
    const userId = req.userId;
    const { status } = req.params;
    const { page = 1, limit = 20 } = req.query;
    if (!userId) return res.status(401).json({ error: "User ID not found in token" });

    const validStatuses = ['PENDING', 'APPROVED', 'PAID', 'WITHDRAWN', 'REJECTED'];
    if (!validStatuses.includes(status.toUpperCase())) return res.status(400).json({ error: "Invalid status", valid: validStatuses, received: status });

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const where = { userId, status: status.toUpperCase() };
    const total = await prisma.affiliateCommission.count({ where });
    const commissions = await prisma.affiliateCommission.findMany({ where, select: { id: true, amount: true, level: true, status: true, createdAt: true, affiliate: { select: { code: true, user: { select: { fullName: true, email: true } } } } }, orderBy: { createdAt: 'desc' }, skip: (pageNum - 1) * limitNum, take: limitNum });

    const transactions = commissions.map(c => ({ id: c.id, transactionId: c.id, from: c.affiliate?.user?.fullName || 'Unknown', fromEmail: c.affiliate?.user?.email, fromCode: c.affiliate?.code, level: c.level, amount: c.amount, status: c.status, date: c.createdAt }));

    res.json({ message: `Commission transactions with status ${status} retrieved`, status: status.toUpperCase(), transactions, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (error) { res.status(500).json({ error: error.message }); }
};
