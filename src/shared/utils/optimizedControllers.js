import { prisma } from "../../shared/prismaClient.js";

export const getReferralHierarchyWithCommissions_OPTIMIZED = async (req, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "User ID not found in token" });
    }

    const userAffiliate = await prisma.affiliateProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        code: true,
        status: true,
        totalEarnings: true,
        totalPaid: true,
        user: { select: { id: true, email: true, fullName: true } }
      }
    });

    if (!userAffiliate) {
      return res.status(404).json({ error: "User is not registered as affiliate" });
    }

    const commissionStats = await prisma.affiliateCommission.groupBy({
      by: ['status'],
      where: { userId },
      _sum: { amount: true },
      _count: true
    });

    const commissionSummary = {
      total: commissionStats.reduce((sum, s) => sum + (s._sum.amount || 0), 0),
      pending: commissionStats.find(s => s.status === 'PENDING')?._sum?.amount || 0,
      approved: commissionStats.find(s => s.status === 'APPROVED')?._sum?.amount || 0,
      paid: commissionStats.find(s => s.status === 'PAID')?._sum?.amount || 0,
    };

    const allAffiliates = await prisma.affiliateProfile.findMany({
      select: {
        id: true,
        code: true,
        status: true,
        totalEarnings: true,
        referredById: true,
        user: { select: { fullName: true } }
      }
    });

    const allReferralIds = allAffiliates.map(a => a.id);
    const allCommissions = allReferralIds.length > 0
      ? await prisma.affiliateCommission.findMany({
          where: { affiliateId: { in: allReferralIds } },
          select: { affiliateId: true, level: true, amount: true, status: true },
        })
      : [];

    const affiliateMap = new Map(allAffiliates.map(a => [a.id, a]));
    const commissionMap = new Map();
    for (const comm of allCommissions) {
      if (!commissionMap.has(comm.affiliateId)) {
        commissionMap.set(comm.affiliateId, []);
      }
      commissionMap.get(comm.affiliateId).push(comm);
    }

    function buildTreeInMemory(affiliateId, currentLevel = 1, visitedIds = new Set()) {
      if (visitedIds.has(affiliateId)) return null;
      visitedIds.add(affiliateId);

      const affiliate = affiliateMap.get(affiliateId);
      if (!affiliate) return null;

      const referrals = allAffiliates
        .filter(a => a.referredById === affiliateId)
        .map(a => buildTreeInMemory(a.id, currentLevel + 1, visitedIds))
        .filter(Boolean);

      return {
        id: affiliate.id,
        level: currentLevel,
        name: affiliate.user?.fullName || 'Unknown',
        code: affiliate.code,
        status: affiliate.status,
        totalEarnings: affiliate.totalEarnings,
        commissions: (commissionMap.get(affiliateId) || []).map(c => ({
          level: c.level,
          amount: c.amount,
          status: c.status
        })),
        referrals
      };
    }

    const referralTree = allAffiliates
      .filter(a => a.referredById === userAffiliate.id)
      .map(a => buildTreeInMemory(a.id, 1))
      .filter(Boolean);

    res.json({
      message: "Referral hierarchy with commissions retrieved (optimized - single batch query)",
      user: {
        id: userAffiliate.user.id,
        email: userAffiliate.user.email,
        fullName: userAffiliate.user.fullName,
        affiliateCode: userAffiliate.code,
        status: userAffiliate.status,
      },
      commissionSummary,
      referrals: referralTree,
      performance: {
        optimized: true,
        queries: 4,
        note: "Batch query + in-memory tree building (was recursive queries before)"
      }
    });
  } catch (error) {
    console.error("Get referral hierarchy error:", error);
    res.status(500).json({ error: error.message });
  }
};

export const getCommissionBreakdown_OPTIMIZED = async (req, res) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 10, status = "ALL" } = req.query;

    if (!userId) {
      return res.status(401).json({ error: "User ID not found in token" });
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));

    const affiliate = await prisma.affiliateProfile.findUnique({
      where: { userId },
      select: { id: true, code: true, status: true },
    });

    if (!affiliate) {
      return res.status(404).json({ error: "User is not registered as affiliate" });
    }

    const commissionStats = await prisma.affiliateCommission.groupBy({
      by: ['status'],
      where: { userId },
      _sum: { amount: true },
      _count: true,
    });

    const breakdown = {};
    let totalAmount = 0;

    for (const stat of commissionStats) {
      breakdown[stat.status] = {
        count: stat._count,
        amount: stat._sum.amount || 0,
      };
      totalAmount += stat._sum.amount || 0;
    }

    const commissions = await prisma.affiliateCommission.findMany({
      where: { userId },
      select: {
        id: true,
        amount: true,
        level: true,
        status: true,
        createdAt: true,
        affiliate: {
          select: {
            code: true,
            user: { select: { fullName: true, email: true } }
          }
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    });

    const total = commissionStats.reduce((sum, s) => sum + s._count, 0);

    res.json({
      message: "Commission breakdown retrieved (optimized - aggregation query)",
      affiliate: {
        code: affiliate.code,
        status: affiliate.status,
      },
      summary: {
        totalCommissions: total,
        totalAmount,
        breakdown,
      },
      commissions: commissions.map(c => ({
        id: c.id,
        amount: c.amount,
        level: c.level,
        status: c.status,
        from: c.affiliate?.user?.fullName || 'Unknown',
        email: c.affiliate?.user?.email,
        date: c.createdAt,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      performance: {
        optimized: true,
        note: "Using aggregation + paginated fetch instead of findMany all"
      }
    });
  } catch (error) {
    console.error("Get commission breakdown error:", error);
    res.status(500).json({ error: error.message });
  }
};

export const getAvailableBalance_OPTIMIZED = async (req, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "User ID not found in token" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true }
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const [commissionStats, withdrawalStats] = await Promise.all([
      prisma.affiliateCommission.groupBy({
        by: ['status'],
        where: { userId },
        _sum: { amount: true },
      }),
      prisma.commissionWithdrawal.groupBy({
        by: ['status'],
        where: { userId },
        _sum: { amount: true },
      }),
    ]);

    const totalApprovedCommission = commissionStats
      .find(s => s.status === 'APPROVED')?._sum?.amount || 0;
    const totalCompletedWithdrawal = withdrawalStats
      .find(s => s.status === 'COMPLETED')?._sum?.amount || 0;
    const totalPendingWithdrawal = withdrawalStats
      .filter(s => s.status === 'PENDING' || s.status === 'APPROVED')
      .reduce((sum, s) => sum + (s._sum?.amount || 0), 0);

    const availableForWithdrawal = Math.max(0, totalApprovedCommission - totalPendingWithdrawal);
    const totalEarned = totalApprovedCommission + totalCompletedWithdrawal;

    res.json({
      message: "Available balance retrieved (optimized - batch groupBy queries)",
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName
      },
      balance: {
        totalEarned,
        approvedCommission: totalApprovedCommission,
        pendingWithdrawal: totalPendingWithdrawal,
        completedWithdrawal: totalCompletedWithdrawal,
        availableForWithdrawal,
      },
      performance: {
        optimized: true,
        queries: 2,
        note: "Using batch groupBy instead of 3 separate aggregate calls"
      }
    });
  } catch (error) {
    console.error("Get available balance error:", error);
    res.status(500).json({ error: error.message });
  }
};

export default {
  getReferralHierarchyWithCommissions_OPTIMIZED,
  getCommissionBreakdown_OPTIMIZED,
  getAvailableBalance_OPTIMIZED,
};
