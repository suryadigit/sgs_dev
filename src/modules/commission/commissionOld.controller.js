import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const bypassRecordCommission = async (req, res) => {
  try {
    const { buyerId, productPrice, productName, transactionRef } = req.body;
    if (!buyerId || !productPrice) return res.status(400).json({ success: false, message: "buyerId dan productPrice wajib diisi" });

    const buyer = await prisma.user.findUnique({ where: { id: buyerId }, include: { affiliateProfile: true } });
    if (!buyer) return res.status(404).json({ success: false, message: "User pembeli tidak ditemukan" });

    const COMMISSION_RATES = { level1: 0.2, level2: 0.1, level3: 0.05, level4: 0.03, level5: 0.02 };
    const commissions = [];
    let currentReferrerId = buyer.referredById;
    let level = 1;

    while (currentReferrerId && level <= 5) {
      const referrer = await prisma.user.findUnique({ where: { id: currentReferrerId }, include: { affiliateProfile: true } });
      if (!referrer || !referrer.affiliateProfile) break;

      const rate = COMMISSION_RATES[`level${level}`];
      const commissionAmount = Math.round(productPrice * rate);

      if (commissionAmount > 0) {
        const commission = await prisma.affiliateCommission.create({ data: { affiliateId: referrer.affiliateProfile.id, amount: commissionAmount, sourceUserId: buyerId, level: level, status: "PENDING", description: `Komisi Level ${level} dari pembelian ${productName || "produk"} - Rp ${productPrice.toLocaleString("id-ID")}`, metadata: { productPrice, productName, transactionRef, rate: rate * 100 + "%", buyerEmail: buyer.email } } });
        commissions.push({ level, affiliateCode: referrer.affiliateProfile.affiliateCode, affiliateName: referrer.name, amount: commissionAmount, rate: rate * 100 + "%", commissionId: commission.id });
      }

      currentReferrerId = referrer.referredById;
      level++;
    }

    return res.status(201).json({ success: true, message: `Berhasil mencatat ${commissions.length} komisi`, data: { buyer: { id: buyer.id, email: buyer.email, name: buyer.name }, productPrice, productName, transactionRef, commissionsRecorded: commissions } });
  } catch (error) { return res.status(500).json({ success: false, message: "Terjadi kesalahan server", error: error.message }); }
};

export const getCommissionBreakdown = async (req, res) => {
  try {
    const { productPrice } = req.query;
    if (!productPrice) return res.status(400).json({ success: false, message: "productPrice wajib diisi" });

    const price = parseFloat(productPrice);
    const COMMISSION_RATES = { level1: 0.2, level2: 0.1, level3: 0.05, level4: 0.03, level5: 0.02 };
    const breakdown = [];
    let totalCommission = 0;

    for (let level = 1; level <= 5; level++) {
      const rate = COMMISSION_RATES[`level${level}`];
      const amount = Math.round(price * rate);
      totalCommission += amount;
      breakdown.push({ level, rate: rate * 100 + "%", amount, formattedAmount: `Rp ${amount.toLocaleString("id-ID")}` });
    }

    return res.status(200).json({ success: true, data: { productPrice: price, formattedPrice: `Rp ${price.toLocaleString("id-ID")}`, breakdown, totalCommission, formattedTotal: `Rp ${totalCommission.toLocaleString("id-ID")}`, companyRetention: price - totalCommission } });
  } catch (error) { return res.status(500).json({ success: false, message: "Terjadi kesalahan server", error: error.message }); }
};

export const getPendingCommissions = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [commissions, total] = await Promise.all([
      prisma.affiliateCommission.findMany({ where: { status: "PENDING" }, include: { affiliate: { include: { user: { select: { id: true, name: true, email: true } } } }, sourceUser: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "desc" }, skip, take: parseInt(limit) }),
      prisma.affiliateCommission.count({ where: { status: "PENDING" } })
    ]);

    return res.status(200).json({ success: true, data: { commissions: commissions.map((c) => ({ id: c.id, amount: c.amount, level: c.level, status: c.status, description: c.description, createdAt: c.createdAt, affiliate: { id: c.affiliate.id, code: c.affiliate.affiliateCode, userName: c.affiliate.user?.name, userEmail: c.affiliate.user?.email }, sourceUser: c.sourceUser })), pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) } } });
  } catch (error) { return res.status(500).json({ success: false, message: "Terjadi kesalahan server", error: error.message }); }
};

export const approveCommissionByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const commission = await prisma.affiliateCommission.findUnique({ where: { id } });
    if (!commission) return res.status(404).json({ success: false, message: "Komisi tidak ditemukan" });
    if (commission.status !== "PENDING") return res.status(400).json({ success: false, message: `Komisi sudah ${commission.status}` });

    const updatedCommission = await prisma.affiliateCommission.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date(), approvedBy: req.user?.id || null } });
    return res.status(200).json({ success: true, message: "Komisi berhasil disetujui", data: updatedCommission });
  } catch (error) { return res.status(500).json({ success: false, message: "Terjadi kesalahan server", error: error.message }); }
};

export const batchApproveCommissions = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: "ids harus berupa array yang tidak kosong" });

    const result = await prisma.affiliateCommission.updateMany({ where: { id: { in: ids }, status: "PENDING" }, data: { status: "APPROVED", approvedAt: new Date(), approvedBy: req.user?.id || null } });
    return res.status(200).json({ success: true, message: `${result.count} komisi berhasil disetujui`, data: { approvedCount: result.count } });
  } catch (error) { return res.status(500).json({ success: false, message: "Terjadi kesalahan server", error: error.message }); }
};

export const rejectCommissionByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const commission = await prisma.affiliateCommission.findUnique({ where: { id } });
    if (!commission) return res.status(404).json({ success: false, message: "Komisi tidak ditemukan" });
    if (commission.status !== "PENDING") return res.status(400).json({ success: false, message: `Komisi sudah ${commission.status}` });

    const updatedCommission = await prisma.affiliateCommission.update({ where: { id }, data: { status: "REJECTED", rejectedAt: new Date(), rejectedBy: req.user?.id || null, rejectionReason: reason || null } });
    return res.status(200).json({ success: true, message: "Komisi berhasil ditolak", data: updatedCommission });
  } catch (error) { return res.status(500).json({ success: false, message: "Terjadi kesalahan server", error: error.message }); }
};

export const getMyCommissions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId } });
    if (!affiliate) return res.status(404).json({ success: false, message: "Profil affiliate tidak ditemukan" });

    const where = { affiliateId: affiliate.id };
    if (status) where.status = status;

    const [commissions, total] = await Promise.all([
      prisma.affiliateCommission.findMany({ where, include: { sourceUser: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "desc" }, skip, take: parseInt(limit) }),
      prisma.affiliateCommission.count({ where })
    ]);

    return res.status(200).json({ success: true, data: { commissions: commissions.map((c) => ({ id: c.id, amount: c.amount, level: c.level, status: c.status, description: c.description, createdAt: c.createdAt, sourceUser: c.sourceUser })), pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) } } });
  } catch (error) { return res.status(500).json({ success: false, message: "Terjadi kesalahan server", error: error.message }); }
};

export const getCommissionSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId } });
    if (!affiliate) return res.status(404).json({ success: false, message: "Profil affiliate tidak ditemukan" });

    const [pending, approved, rejected, withdrawn] = await Promise.all([
      prisma.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, status: "PENDING" }, _sum: { amount: true }, _count: true }),
      prisma.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, status: "APPROVED" }, _sum: { amount: true }, _count: true }),
      prisma.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, status: "REJECTED" }, _sum: { amount: true }, _count: true }),
      prisma.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, status: "WITHDRAWN" }, _sum: { amount: true }, _count: true })
    ]);

    return res.status(200).json({ success: true, data: { pending: { total: pending._sum.amount || 0, count: pending._count }, approved: { total: approved._sum.amount || 0, count: approved._count }, rejected: { total: rejected._sum.amount || 0, count: rejected._count }, withdrawn: { total: withdrawn._sum.amount || 0, count: withdrawn._count }, availableBalance: approved._sum.amount || 0, totalEarnings: (approved._sum.amount || 0) + (withdrawn._sum.amount || 0) } });
  } catch (error) { return res.status(500).json({ success: false, message: "Terjadi kesalahan server", error: error.message }); }
};

export const handleWordPressWebhook = async (req, res) => {
  try {
    const { event, data } = req.body;

    if (event === "order_completed" && data) {
      const { customer_email, order_total, order_id, product_name } = data;
      const buyer = await prisma.user.findUnique({ where: { email: customer_email } });

      if (buyer) {
        const mockReq = { body: { buyerId: buyer.id, productPrice: parseFloat(order_total), productName: product_name || "WordPress Product", transactionRef: `WP-${order_id}` } };
        const mockRes = { status: (code) => ({ json: (data) => res.status(code).json(data) }) };
        return bypassRecordCommission(mockReq, mockRes);
      }
    }

    return res.status(200).json({ success: true, message: "Webhook received" });
  } catch (error) { return res.status(500).json({ success: false, message: "Terjadi kesalahan server", error: error.message }); }
};

export const getReferralHierarchyWithCommissions = async (req, res) => {
  try {
    const userId = req.user.id;
    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId }, include: { user: { select: { id: true, name: true, email: true } } } });
    if (!affiliate) return res.status(404).json({ success: false, message: "Profil affiliate tidak ditemukan" });

    const buildHierarchy = async (affiliateId, currentLevel = 1) => {
      if (currentLevel > 5) return [];
      const downlines = await prisma.affiliateProfile.findMany({ where: { user: { referredById: (await prisma.affiliateProfile.findUnique({ where: { id: affiliateId } }))?.userId } }, include: { user: { select: { id: true, name: true, email: true } } } });
      const result = [];
      for (const downline of downlines) {
        const commissions = await prisma.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, sourceUserId: downline.userId }, _sum: { amount: true }, _count: true });
        result.push({ level: currentLevel, affiliate: { id: downline.id, code: downline.affiliateCode, user: downline.user }, commissionFromThisUser: { total: commissions._sum.amount || 0, count: commissions._count }, downlines: await buildHierarchy(downline.id, currentLevel + 1) });
      }
      return result;
    };

    const hierarchy = await buildHierarchy(affiliate.id);
    return res.status(200).json({ success: true, data: { affiliate: { id: affiliate.id, code: affiliate.affiliateCode, user: affiliate.user }, hierarchy } });
  } catch (error) { return res.status(500).json({ success: false, message: "Terjadi kesalahan server", error: error.message }); }
};

export const getDashboardSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId } });
    if (!affiliate) return res.status(404).json({ success: false, message: "Profil affiliate tidak ditemukan" });

    const [pendingCommissions, approvedCommissions, withdrawnCommissions, totalDownlines, recentCommissions] = await Promise.all([
      prisma.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, status: "PENDING" }, _sum: { amount: true }, _count: true }),
      prisma.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, status: "APPROVED" }, _sum: { amount: true }, _count: true }),
      prisma.affiliateCommission.aggregate({ where: { affiliateId: affiliate.id, status: "WITHDRAWN" }, _sum: { amount: true }, _count: true }),
      prisma.user.count({ where: { referredById: userId } }),
      prisma.affiliateCommission.findMany({ where: { affiliateId: affiliate.id }, include: { sourceUser: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 5 })
    ]);

    return res.status(200).json({ success: true, data: { summary: { pendingAmount: pendingCommissions._sum.amount || 0, pendingCount: pendingCommissions._count, approvedAmount: approvedCommissions._sum.amount || 0, approvedCount: approvedCommissions._count, withdrawnAmount: withdrawnCommissions._sum.amount || 0, withdrawnCount: withdrawnCommissions._count, availableBalance: approvedCommissions._sum.amount || 0, totalEarnings: (approvedCommissions._sum.amount || 0) + (withdrawnCommissions._sum.amount || 0), totalDownlines }, recentCommissions: recentCommissions.map((c) => ({ id: c.id, amount: c.amount, level: c.level, status: c.status, createdAt: c.createdAt, sourceUser: c.sourceUser })) } });
  } catch (error) { return res.status(500).json({ success: false, message: "Terjadi kesalahan server", error: error.message }); }
};

