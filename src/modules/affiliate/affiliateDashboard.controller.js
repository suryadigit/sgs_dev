import prisma from "../../shared/lib/prisma.js";
import {
  getCommissionBreakdownByLevel,
  calculateSummaryFromBreakdown,
  queryRecentCommissions,
  getDirectReferralsWithCommissions,
  calculateReferralProgramSummary,
  calculateTotalOmsetFromActiveReferrals,
  calculateNetworkCountsForMany,
} from "../commission/referralCommission.service.js";

export const getReferralProgramDashboard = async (req, res) => {
  try {
    const userId = req.userId;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, email: true }
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const affiliate = await prisma.affiliateProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        code: true,
        status: true,
        totalEarnings: true,
        totalPaid: true,
        totalOmset: true,
        registeredAt: true,
        wpUserId: true,
        wpAffiliateId: true,
        wpReferralLink: true,
      }
    });

    if (!affiliate) {
      return res.status(404).json({ error: "Affiliate profile not found" });
    }

    const commissionByLevel = await getCommissionBreakdownByLevel(userId);
    const earnings = calculateSummaryFromBreakdown(commissionByLevel);
    const recentCommissions = await queryRecentCommissions(userId, 10);
    const directReferrals = await getDirectReferralsWithCommissions(affiliate.id, 50);
    const directReferralIds = directReferrals.map(r => r.id);
    const idsToCalc = [affiliate.id, ...directReferralIds].filter(Boolean);
    const counts = idsToCalc.length ? await calculateNetworkCountsForMany(idsToCalc, 10) : {};

    const enrichedReferrals = directReferrals.map(r => ({
      ...r,
      networkMembersCount: counts[r.id] || 0,
      totalMembersInNetwork: (counts[r.id] || 0) + 1,
    }));
        console.time(`dashboard_total_${userId}`);

    const summary = calculateReferralProgramSummary(directReferrals);
    const totalOmset = await calculateTotalOmsetFromActiveReferrals(affiliate.id);
    const networkData = {
      totalNetworkMembers: counts[affiliate.id] || 0,
      membersByLevel: {},
    };

    const generateDisplayCode = (wpAffiliateId, name) => {
      if (!wpAffiliateId || !name) return null;
      const paddedId = String(wpAffiliateId).padStart(3, '0');
      const prefix = name.substring(0, 3).toUpperCase();
      return `AFF${paddedId}${prefix}`;
    };

    const wpCustomCode = generateDisplayCode(affiliate.wpAffiliateId, user.fullName);
    const wpDisplayLink = wpCustomCode 
      ? `https://jagobikinaplikasi.com/woo/shop/?slicewp_ref=${wpCustomCode}`
      : null;

    const responseData = {
      message: "Referral program dashboard retrieved",
      affiliate: {
        id: affiliate.id,
        name: user.fullName,
        code: affiliate.code,
        status: affiliate.status,
        joinDate: affiliate.registeredAt,
        totalPenghasilan: totalOmset,  
        totalKomisi: affiliate.totalEarnings,  
        totalPaid: affiliate.totalPaid,
        wpUserId: affiliate.wpUserId,
        wpAffiliateId: affiliate.wpAffiliateId,
        wpReferralLink: affiliate.wpReferralLink,
        wpDisplayLink: wpDisplayLink,
        wpCustomCode: wpCustomCode,
        isWordPressAffiliate: !!affiliate.wpAffiliateId,
      },
      earnings: {
        total: totalOmset,  
        pending: earnings.pending,
        approved: earnings.approved,
      },
      commissionBreakdown: {
        byLevel: commissionByLevel,
      },
      commissionDetails: {
        total_records: earnings.total > 0 ? Object.values(commissionByLevel).reduce((sum, l) => sum + l.count, 0) : 0,
        recent_commissions: recentCommissions.map(c => ({
          id: c.id,
          level: c.level,
          amount: c.amount,
          status: c.status,
          from: c.affiliate?.user?.fullName || 'Unknown',
          date: c.createdAt,
        })),
      },
      referrals: {
        totalCount: directReferrals.length,
        list: enrichedReferrals,
      },
      network: {
        totalNetworkMembers: networkData.totalNetworkMembers,
        directReferrals: directReferrals.length,
        membersByLevel: networkData.membersByLevel,
      },
      summary: {
        ...summary,
        totalNetworkMembers: networkData.totalNetworkMembers,
      },
      performance: {
        optimized: true,
        queries: 8,
        note: "Using batch queries and aggregation with network member calculation"
      }
    };

    res.json(responseData);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export default {
  getReferralProgramDashboard,
};
