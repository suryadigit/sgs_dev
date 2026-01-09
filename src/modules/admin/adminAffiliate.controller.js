import prisma from "../../shared/lib/prisma.js";

export const getAdminAffiliateDashboard = async (req, res) => {
  try {
    const [totalAffiliates, activeAffiliates, pendingAffiliates, totalCommissions, pendingCommissions, approvedCommissions, totalWithdrawals, pendingWithdrawals] = await Promise.all([
      prisma.affiliateProfile.count(),
      prisma.affiliateProfile.count({ where: { status: 'ACTIVE' } }),
      prisma.affiliateProfile.count({ where: { status: 'PENDING' } }),
      prisma.affiliateCommission.aggregate({ _sum: { amount: true } }),
      prisma.affiliateCommission.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true } }),
      prisma.affiliateCommission.aggregate({ where: { status: 'APPROVED' }, _sum: { amount: true } }),
      prisma.commissionWithdrawal.aggregate({ _sum: { amount: true } }),
      prisma.commissionWithdrawal.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true } }),
    ]);

    const topAffiliates = await prisma.affiliateProfile.findMany({ take: 10, orderBy: { totalEarnings: 'desc' }, where: { status: 'ACTIVE' }, select: { id: true, code: true, totalEarnings: true, totalPaid: true, status: true, registeredAt: true, user: { select: { id: true, fullName: true, email: true } }, _count: { select: { referrals: true } } } });
    const recentCommissions = await prisma.affiliateCommission.findMany({ take: 10, orderBy: { createdAt: 'desc' }, select: { id: true, amount: true, level: true, status: true, createdAt: true, receiver: { select: { fullName: true, email: true } }, affiliate: { select: { code: true, user: { select: { fullName: true } } } } } });
    const commissionByLevel = await prisma.affiliateCommission.groupBy({ by: ['level', 'status'], _sum: { amount: true }, _count: true });

    const levelBreakdown = {};
    for (let level = 1; level <= 10; level++) { const levelStats = commissionByLevel.filter(c => c.level === level); levelBreakdown[`level_${level}`] = { total: levelStats.reduce((sum, s) => sum + (s._sum.amount || 0), 0), count: levelStats.reduce((sum, s) => sum + s._count, 0), pending: levelStats.filter(s => s.status === 'PENDING').reduce((sum, s) => sum + (s._sum.amount || 0), 0), approved: levelStats.filter(s => s.status === 'APPROVED').reduce((sum, s) => sum + (s._sum.amount || 0), 0) }; }

    const networkStats = await prisma.affiliateProfile.findMany({ where: { referredById: { not: null } }, select: { id: true, referredById: true, status: true } });
    const totalNetworkMembers = networkStats.length;
    const activeNetworkMembers = networkStats.filter(n => n.status === 'ACTIVE').length;

    res.json({
      message: "Admin affiliate dashboard retrieved",
      summary: { affiliates: { total: totalAffiliates, active: activeAffiliates, pending: pendingAffiliates }, commissions: { total: totalCommissions._sum.amount || 0, pending: pendingCommissions._sum.amount || 0, approved: approvedCommissions._sum.amount || 0 }, withdrawals: { total: totalWithdrawals._sum.amount || 0, pending: pendingWithdrawals._sum.amount || 0 }, network: { totalMembers: totalNetworkMembers, activeMembers: activeNetworkMembers } },
      commissionBreakdown: { byLevel: levelBreakdown },
      topAffiliates: topAffiliates.map(a => ({ id: a.id, code: a.code, name: a.user?.fullName || 'Unknown', email: a.user?.email, totalEarnings: a.totalEarnings, totalPaid: a.totalPaid, referralsCount: a._count.referrals, status: a.status, joinDate: a.registeredAt })),
      recentCommissions: recentCommissions.map(c => ({ id: c.id, amount: c.amount, level: c.level, status: c.status, date: c.createdAt, recipient: c.receiver?.fullName || 'Unknown', from: c.affiliate?.user?.fullName || 'Unknown', affiliateCode: c.affiliate?.code })),
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAllAffiliates = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const search = req.query.search;

    const where = {};
    if (status) where.status = status;
    if (search) where.OR = [{ code: { contains: search, mode: 'insensitive' } }, { user: { fullName: { contains: search, mode: 'insensitive' } } }, { user: { email: { contains: search, mode: 'insensitive' } } }];

    const [affiliates, total] = await Promise.all([
      prisma.affiliateProfile.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { registeredAt: 'desc' }, select: { id: true, code: true, status: true, totalEarnings: true, totalPaid: true, registeredAt: true, activatedAt: true, user: { select: { id: true, fullName: true, email: true, phone: true } }, referredBy: { select: { code: true, user: { select: { fullName: true } } } }, _count: { select: { referrals: true } } } }),
      prisma.affiliateProfile.count({ where })
    ]);

    res.json({
      message: "Affiliates list retrieved",
      data: affiliates.map(a => ({ id: a.id, code: a.code, name: a.user?.fullName || 'Unknown', email: a.user?.email, phone: a.user?.phone, status: a.status, totalEarnings: a.totalEarnings, totalPaid: a.totalPaid, referralsCount: a._count.referrals, referredBy: a.referredBy ? { code: a.referredBy.code, name: a.referredBy.user?.fullName } : null, joinDate: a.registeredAt, activatedAt: a.activatedAt })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAffiliateDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const affiliate = await prisma.affiliateProfile.findUnique({ where: { id }, include: { user: { select: { id: true, fullName: true, email: true, phone: true, role: true } }, referredBy: { select: { id: true, code: true, user: { select: { fullName: true, email: true } } } }, referrals: { select: { id: true, code: true, status: true, totalEarnings: true, registeredAt: true, user: { select: { fullName: true, email: true } }, _count: { select: { referrals: true } } }, orderBy: { registeredAt: 'desc' } } } });
    if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });

    const commissions = await prisma.affiliateCommission.findMany({ where: { affiliateId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, amount: true, level: true, status: true, createdAt: true, receiver: { select: { fullName: true } } } });

    let totalNetworkMembers = 0;
    let currentIds = [id];
    const membersByLevel = {};

    for (let level = 1; level <= 10; level++) {
      if (currentIds.length === 0) break;
      const downlines = await prisma.affiliateProfile.findMany({ where: { referredById: { in: currentIds } }, select: { id: true, status: true } });
      if (downlines.length > 0) { membersByLevel[`level_${level}`] = { total: downlines.length, active: downlines.filter(d => d.status === 'ACTIVE').length }; totalNetworkMembers += downlines.length; }
      currentIds = downlines.map(d => d.id);
    }

    res.json({
      message: "Affiliate detail retrieved",
      affiliate: { id: affiliate.id, code: affiliate.code, status: affiliate.status, totalEarnings: affiliate.totalEarnings, totalPaid: affiliate.totalPaid, joinDate: affiliate.registeredAt, activatedAt: affiliate.activatedAt, user: affiliate.user, referredBy: affiliate.referredBy ? { id: affiliate.referredBy.id, code: affiliate.referredBy.code, name: affiliate.referredBy.user?.fullName } : null },
      network: { directReferrals: affiliate.referrals.length, totalNetworkMembers, membersByLevel },
      directReferrals: affiliate.referrals.map(r => ({ id: r.id, code: r.code, name: r.user?.fullName, email: r.user?.email, status: r.status, totalEarnings: r.totalEarnings, subReferralsCount: r._count.referrals, joinDate: r.registeredAt })),
      recentCommissions: commissions.map(c => ({ id: c.id, amount: c.amount, level: c.level, status: c.status, date: c.createdAt, from: c.receiver?.fullName })),
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export default { getAdminAffiliateDashboard, getAllAffiliates, getAffiliateDetail };
