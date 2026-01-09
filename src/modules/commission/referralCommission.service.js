import prisma from "../../shared/lib/prisma.js";

const MAX_LEVELS = 10;

export const queryCommissionStatsWithDetails = async (userId) => {
  return prisma.affiliateCommission.findMany({
    where: { userId },
    select: {
      level: true,
      status: true,
      amount: true,
      affiliateId: true,
      affiliate: {
        select: {
          id: true,
          code: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
};

export const calculateBreakdownWithDetails = (commissions) => {
  const commissionByLevel = {};
  
  for (let level = 1; level <= MAX_LEVELS; level++) {
    const levelCommissions = commissions.filter(c => c.level === level);
    const total = levelCommissions.reduce((sum, c) => sum + c.amount, 0);
    const pending = levelCommissions
      .filter(c => c.status === 'PENDING')
      .reduce((sum, c) => sum + c.amount, 0);
    const approved = levelCommissions
      .filter(c => c.status === 'APPROVED')
      .reduce((sum, c) => sum + c.amount, 0);

    const uniqueDownlines = [];
    const seenIds = new Set();
    
    levelCommissions.forEach(c => {
      const affiliateUserId = c.affiliate?.user?.id;
      if (affiliateUserId && !seenIds.has(affiliateUserId)) {
        seenIds.add(affiliateUserId);
        uniqueDownlines.push({
          name: c.affiliate?.user?.fullName || 'Unknown',
          code: c.affiliate?.code || 'N/A',
          email: c.affiliate?.user?.email,
        });
      }
    });

    const referrerDetail = uniqueDownlines.length > 1 
      ? uniqueDownlines 
      : uniqueDownlines.length === 1 
        ? uniqueDownlines[0] 
        : null;

    commissionByLevel[`level_${level}`] = {
      count: levelCommissions.length,
      total,
      pending,
      approved,
      fixed_amount: level === 1 ? 87500 : 12500,
      referrers: uniqueDownlines,
      referrer: referrerDetail,
      details: levelCommissions.map(c => ({
        amount: c.amount,
        status: c.status,
        referrerName: c.affiliate?.user?.fullName,
        referrerCode: c.affiliate?.code,
      })),
    };
  }

  return commissionByLevel;
};

export const getCommissionBreakdownWithDetails = async (userId) => {
  const commissions = await queryCommissionStatsWithDetails(userId);
  return calculateBreakdownWithDetails(commissions);
};

export const queryCommissionStats = async (userId) => {
  return prisma.affiliateCommission.groupBy({
    by: ['status', 'level'],
    where: { userId },
    _sum: { amount: true },
    _count: true,
  });
};

export const calculateBreakdownFromStats = (commissionStats) => {
  const commissionByLevel = {};
  
  for (let level = 1; level <= MAX_LEVELS; level++) {
    const levelStats = commissionStats.filter(s => s.level === level);
    const total = levelStats.reduce((sum, s) => sum + (s._sum.amount || 0), 0);
    const pending = levelStats
      .filter(s => s.status === 'PENDING')
      .reduce((sum, s) => sum + (s._sum.amount || 0), 0);
    const approved = levelStats
      .filter(s => s.status === 'APPROVED')
      .reduce((sum, s) => sum + (s._sum.amount || 0), 0);

    commissionByLevel[`level_${level}`] = {
      count: levelStats.reduce((sum, s) => sum + s._count, 0),
      total,
      pending,
      approved,
      fixed_amount: level === 1 ? 87500 : 12500,
    };
  }

  return commissionByLevel;
};

export const getCommissionBreakdownByLevel = async (userId) => {
  const stats = await queryCommissionStats(userId);
  return calculateBreakdownFromStats(stats);
};

export const calculateSummaryFromBreakdown = (commissionByLevel) => {
  const totalCommissions = Object.values(commissionByLevel).reduce((sum, l) => sum + l.total, 0);
  const pendingCommissions = Object.values(commissionByLevel).reduce((sum, l) => sum + l.pending, 0);
  const approvedCommissions = Object.values(commissionByLevel).reduce((sum, l) => sum + l.approved, 0);

  return {
    total: totalCommissions,
    pending: pendingCommissions,
    approved: approvedCommissions,
  };
};

export const queryRecentCommissions = async (userId, limit = 10) => {
  return prisma.affiliateCommission.findMany({
    where: { userId },
    select: {
      id: true,
      level: true,
      amount: true,
      status: true,
      createdAt: true,
      affiliate: {
        select: {
          code: true,
          user: { select: { fullName: true } }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: limit
  });
};

export const queryDirectReferrals = async (affiliateId, limit = 50) => {
  return prisma.affiliateProfile.findMany({
    where: { referredById: affiliateId },
    select: {
      id: true,
      code: true,
      status: true,
      totalEarnings: true,
      registeredAt: true,
      activatedAt: true,
      user: { select: { fullName: true, email: true } },
      _count: { select: { referrals: true } }
    },
    orderBy: { registeredAt: 'desc' },
    take: limit
  });
};

export const queryReferralCommissionStats = async (referralIds) => {
  if (referralIds.length === 0) return [];
  
  return prisma.affiliateCommission.groupBy({
    by: ['affiliateId', 'status'],
    where: { affiliateId: { in: referralIds } },
    _sum: { amount: true },
  });
};

export const mapReferralsWithCommissions = (referrals, referralCommissions) => {
  return referrals.map(ref => {
    const refCommStats = referralCommissions.filter(c => c.affiliateId === ref.id);
    const totalEarnings = refCommStats.reduce((sum, c) => sum + (c._sum.amount || 0), 0);
    const pendingEarnings = refCommStats
      .filter(c => c.status === 'PENDING')
      .reduce((sum, c) => sum + (c._sum.amount || 0), 0);
    const approvedEarnings = refCommStats
      .filter(c => c.status === 'APPROVED')
      .reduce((sum, c) => sum + (c._sum.amount || 0), 0);

    return {
      id: ref.id,
      code: ref.code,
      name: ref.user?.fullName || 'Unknown',
      email: ref.user?.email,
      status: ref.status,
      joinDate: ref.registeredAt,
      activatedAt: ref.activatedAt,
      subReferralsCount: ref._count.referrals,
      totalEarnings,
      pendingEarnings,
      approvedEarnings,
    };
  });
};

export const getDirectReferralsWithCommissions = async (affiliateId, limit = 50) => {
  const directReferrals = await queryDirectReferrals(affiliateId, limit);
  const directReferralIds = directReferrals.map(r => r.id);
  const referralCommissions = await queryReferralCommissionStats(directReferralIds);
  
  return mapReferralsWithCommissions(directReferrals, referralCommissions);
};

export const calculateReferralProgramSummary = (directReferrals) => {
  const totalMembers = directReferrals.length;
  const activeMembers = directReferrals.filter(r => r.status === 'ACTIVE').length;
  const totalCommissionDistributed = directReferrals.reduce((sum, ref) => sum + ref.totalEarnings, 0);
  const pendingDistributed = directReferrals.reduce((sum, ref) => sum + ref.pendingEarnings, 0);

  return {
    totalMembers,
    activeMembers,
    totalCommissionDistributed,
    pendingCommissions: pendingDistributed,
  };
};

export const calculateTotalOmsetFromActiveReferrals = async (affiliateId) => {
  try {
    const level1Downlines = await prisma.affiliateProfile.findMany({
      where: { 
        referredById: affiliateId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        status: true,
        user: { select: { id: true } },
      },
    });

    const omsetPerActiveUser = 575000;
    const totalOmset = level1Downlines.length * omsetPerActiveUser;

    return totalOmset;
  } catch (error) {
    return 0;
  }
};

export const calculateTotalNetworkMembers = async (affiliateId, maxDepth = 10) => {
  try {
    const membersByLevel = {};
    let totalNetworkMembers = 0;
    let currentLevelIds = [affiliateId];

    for (let level = 1; level <= maxDepth; level++) {
      if (currentLevelIds.length === 0) break;

      const downlines = await prisma.affiliateProfile.findMany({
        where: { 
          referredById: { in: currentLevelIds }
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (downlines.length === 0) break;

      const activeCount = downlines.filter(d => d.status === 'ACTIVE').length;
      
      membersByLevel[`level_${level}`] = {
        total: downlines.length,
        active: activeCount,
        inactive: downlines.length - activeCount,
      };

      totalNetworkMembers += downlines.length;
      currentLevelIds = downlines.map(d => d.id);
    }

    return {
      totalNetworkMembers,
      membersByLevel,
    };
  } catch (error) {
    return {
      totalNetworkMembers: 0,
      membersByLevel: {},
    };
  }
};

export const enrichReferralsWithNetworkCount = async (referrals) => {
  const ids = referrals.map(r => r.id);
  const counts = await calculateNetworkCountsForMany(ids, 10);
  return referrals.map(r => ({
    ...r,
    networkMembersCount: counts[r.id] || 0,
    totalMembersInNetwork: (counts[r.id] || 0) + 1,
  }));
};

export const calculateNetworkCountsForMany = async (affiliateIds, maxDepth = 10) => {
  if (!affiliateIds || affiliateIds.length === 0) return {};
  try {
    const idsList = affiliateIds.map(id => `'${id}'`).join(',');
    const query = `
      WITH RECURSIVE downlines AS (
        SELECT id, "referredById", id AS root_id, 0 AS depth
        FROM "AffiliateProfile"
        WHERE id IN (${idsList})
        UNION ALL
        SELECT a.id, a."referredById", d.root_id, d.depth + 1
        FROM "AffiliateProfile" a
        JOIN downlines d ON a."referredById" = d.id
        WHERE d.depth + 1 <= ${maxDepth}
      )
      SELECT root_id, COUNT(*) - 1 AS total
      FROM downlines
      GROUP BY root_id;
    `;

    const rows = await prisma.$queryRawUnsafe(query);
    const result = {};
    for (const r of rows) {
      result[String(r.root_id)] = parseInt(r.total, 10) || 0;
    }
    for (const id of affiliateIds) {
      if (!Object.prototype.hasOwnProperty.call(result, id)) result[id] = 0;
    }
    return result;
  } catch (error) {
    const allAffiliates = await prisma.affiliateProfile.findMany({ select: { id: true, referredById: true } });
    const childrenMap = new Map();
    for (const a of allAffiliates) {
      const p = a.referredById || null;
      if (!childrenMap.has(p)) childrenMap.set(p, []);
      childrenMap.get(p).push(a.id);
    }

    const result = {};
    for (const rootId of affiliateIds) {
      let total = 0;
      let level = 1;
      let current = [rootId];
      while (level <= maxDepth && current.length) {
        const next = [];
        for (const id of current) {
          const kids = childrenMap.get(id) || [];
          for (const k of kids) { next.push(k); total += 1; }
        }
        current = next;
        level += 1;
      }
      result[rootId] = total;
    }
    return result;
  }
};

export const buildReferralHierarchyBatched = async (rootAffiliateId, myCommissions = [], maxDepth = 10) => {
  const commissionByBuyer = new Map();
  myCommissions.forEach(c => {
    const key = (c.buyerName || '').toLowerCase();
    if (!commissionByBuyer.has(key)) commissionByBuyer.set(key, { total: 0, pending: 0, approved: 0, count: 0 });
    const entry = commissionByBuyer.get(key);
    entry.total += c.amount || 0;
    if (c.status === 'PENDING') entry.pending += c.amount || 0;
    if (c.status === 'APPROVED') entry.approved += c.amount || 0;
    entry.count += 1;
  });

  const affiliateMap = new Map();
  const childrenMap = new Map();
  let currentLevelIds = [rootAffiliateId];
  for (let level = 1; level <= maxDepth; level++) {
    if (!currentLevelIds.length) break;
    const downlines = await prisma.affiliateProfile.findMany({
      where: { referredById: { in: currentLevelIds } },
      select: {
        id: true,
        referredById: true,
        code: true,
        status: true,
        totalEarnings: true,
        registeredAt: true,
        user: { select: { id: true, fullName: true, email: true } }
      }
    });

    if (!downlines.length) break;

    const nextIds = [];
    for (const d of downlines) {
      affiliateMap.set(d.id, d);
      const p = d.referredById || null;
      if (!childrenMap.has(p)) childrenMap.set(p, []);
      childrenMap.get(p).push(d.id);
      nextIds.push(d.id);
    }

    currentLevelIds = nextIds;
  }

  const allAffiliateIds = Array.from(affiliateMap.keys());

  let referralCommissions = [];
  if (allAffiliateIds.length) {
    referralCommissions = await prisma.affiliateCommission.groupBy({
      by: ['affiliateId', 'status'],
      where: { affiliateId: { in: allAffiliateIds } },
      _sum: { amount: true },
      _count: true,
    });
  }

  const commissionStatsMap = new Map();
  for (const c of referralCommissions) {
    const key = c.affiliateId;
    if (!commissionStatsMap.has(key)) commissionStatsMap.set(key, { total: 0, pending: 0, approved: 0, count: 0 });
    const s = commissionStatsMap.get(key);
    s.total += c._sum.amount || 0;
    if (c.status === 'PENDING') s.pending += c._sum.amount || 0;
    if (c.status === 'APPROVED') s.approved += c._sum.amount || 0;
    s.count += c._count || 0;
  }

  const computeCommissionFromReferral = (affiliate) => {
    if (!affiliate || !affiliate.user) return { total: 0, pending: 0, approved: 0, transactions: 0 };
    const buyerEmailPrefix = (affiliate.user.email || '').split('@')[0].toLowerCase();
    const buyerName = (affiliate.user.fullName || '').toLowerCase();
    const byEmail = commissionByBuyer.get(buyerEmailPrefix) || { total: 0, pending: 0, approved: 0, count: 0 };
    const byName = commissionByBuyer.get(buyerName) || { total: 0, pending: 0, approved: 0, count: 0 };
    return {
      total: Math.max(byEmail.total, byName.total),
      pending: Math.max(byEmail.pending, byName.pending),
      approved: Math.max(byEmail.approved, byName.approved),
      transactions: Math.max(byEmail.count, byName.count)
    };
  };

  const buildNode = (affiliateId, level) => {
    const aff = affiliateMap.get(affiliateId);
    if (!aff) return null;
    const commissionStats = commissionStatsMap.get(affiliateId) || { total: 0, pending: 0, approved: 0, count: 0 };
    const referrals = (childrenMap.get(affiliateId) || []).map(cid => buildNode(cid, level + 1)).filter(Boolean);
    return {
      id: aff.id,
      level,
      name: aff.user?.fullName || 'Unknown',
      email: aff.user?.email,
      code: aff.code,
      status: aff.status,
      totalEarnings: aff.totalEarnings,
      registeredAt: aff.registeredAt,
      commissionFromThisReferral: computeCommissionFromReferral(aff),
      commissions: { total: commissionStats.total, pending: commissionStats.pending, approved: commissionStats.approved, transactions: commissionStats.count },
      referrals
    };
  };

  const directIds = childrenMap.get(rootAffiliateId) || [];
  const tree = directIds.map(id => buildNode(id, 1)).filter(Boolean);

  return { tree, totalDirect: directIds.length };
};
